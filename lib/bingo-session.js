const { pickNextBall, claimLabel, playingForDisplayLabel, normalizePlayingFor } = require('./bingo');

const bingoStateBySlug = {};
const bingoAutoTimers = {};

function emptyBingoState() {
    return {
        active: false,
        ballCount: 90,
        callIntervalMs: 5000,
        autoCall: false,
        /** When true, the venue display reads each new ball aloud (browser TTS). */
        voiceCall: false,
        paused: false,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: null,
        claimFlash: null,
        playingFor: 'line',
        introSeconds: 30,
        introEndsAt: null,
        revision: 0
    };
}

function isInIntro(state) {
    return !!(state && state.introEndsAt && Date.now() < state.introEndsAt);
}

function introRemainingMs(state) {
    if (!state.introEndsAt) return 0;
    return Math.max(0, state.introEndsAt - Date.now());
}

/** When intro countdown finishes, clear it and resume auto-call scheduling if enabled. */
function ensureIntroAdvanced(slug, callBallFn) {
    const state = getBingoState(slug);
    if (!state.introEndsAt || Date.now() < state.introEndsAt) return;
    state.introEndsAt = null;
    bumpRevision(state);
    if (state.active && state.autoCall && !state.paused && typeof callBallFn === 'function') {
        scheduleAutoCall(slug, callBallFn);
    }
}

function getBingoState(slug) {
    if (!slug) return emptyBingoState();
    if (!bingoStateBySlug[slug]) {
        bingoStateBySlug[slug] = emptyBingoState();
    }
    return bingoStateBySlug[slug];
}

function publicBingoState(slug) {
    const s = getBingoState(slug);
    const inIntro = isInIntro(s);
    const introMs = introRemainingMs(s);
    return {
        active: s.active,
        ballCount: s.ballCount,
        callIntervalMs: s.callIntervalMs,
        autoCall: s.autoCall,
        voiceCall: !!s.voiceCall,
        paused: !!s.paused,
        phase: inIntro ? 'intro' : 'calling',
        introSeconds: s.introSeconds ?? 0,
        introRemainingMs: introMs,
        introRemainingSec: Math.ceil(introMs / 1000),
        calledBalls: s.calledBalls.slice(),
        lastBall: s.lastBall,
        lastBallAt: s.lastBallAt,
        claimFlash: s.claimFlash ? { ...s.claimFlash } : null,
        playingFor: s.playingFor || 'line',
        playingForLabel: playingForDisplayLabel(s.playingFor || 'line'),
        revision: s.revision
    };
}

function bumpRevision(state) {
    state.revision = (state.revision || 0) + 1;
}

function clearAutoTimer(slug) {
    if (bingoAutoTimers[slug]) {
        clearInterval(bingoAutoTimers[slug]);
        delete bingoAutoTimers[slug];
    }
}

function pauseCalling(slug) {
    const state = getBingoState(slug);
    clearAutoTimer(slug);
    state.paused = true;
    bumpRevision(state);
    return state;
}

function resumeCalling(slug, callBallFn) {
    const state = getBingoState(slug);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    state.paused = false;
    bumpRevision(state);
    if (state.autoCall && typeof callBallFn === 'function' && !isInIntro(state)) {
        scheduleAutoCall(slug, callBallFn);
    }
    return { success: true, state: publicBingoState(slug) };
}

function scheduleAutoCall(slug, callBallFn) {
    clearAutoTimer(slug);
    const state = getBingoState(slug);
    if (!state.active || !state.autoCall || state.paused || isInIntro(state)) return;
    const ms = Math.max(2000, state.callIntervalMs || 5000);
    bingoAutoTimers[slug] = setInterval(() => {
        const current = getBingoState(slug);
        if (!current.active || !current.autoCall || current.paused || isInIntro(current)) {
            if (!current.active || !current.autoCall) clearAutoTimer(slug);
            return;
        }
        callBallFn(slug, { auto: true });
    }, ms);
}

function startBingo(slug, options = {}) {
    clearAutoTimer(slug);
    const ballCount = Math.max(9, Math.min(90, Number(options.ballCount) || 90));
    const callIntervalMs = Math.max(2000, Math.min(120000, Number(options.callIntervalMs) || 5000));
    const autoCall = !!options.autoCall;
    const voiceCall = !!options.voiceCall;
    const playingFor = normalizePlayingFor(options.playingFor);
    const introSeconds = Math.max(0, Math.min(600, Number(options.introSeconds) ?? 30));
    const introEndsAt =
        introSeconds > 0 ? Date.now() + introSeconds * 1000 : null;

    bingoStateBySlug[slug] = {
        active: true,
        ballCount,
        callIntervalMs,
        autoCall,
        voiceCall,
        paused: false,
        playingFor,
        introSeconds,
        introEndsAt,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: Date.now(),
        claimFlash: null,
        revision: 1
    };

    return getBingoState(slug);
}

function skipIntro(slug, callBallFn) {
    const state = getBingoState(slug);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    state.introEndsAt = null;
    bumpRevision(state);
    if (state.autoCall && !state.paused && typeof callBallFn === 'function') {
        scheduleAutoCall(slug, callBallFn);
    }
    return { success: true, state: publicBingoState(slug) };
}

function stopBingo(slug) {
    clearAutoTimer(slug);
    const state = getBingoState(slug);
    state.active = false;
    state.autoCall = false;
    state.paused = false;
    bumpRevision(state);
    return state;
}

function resetCalls(slug) {
    const state = getBingoState(slug);
    state.calledBalls = [];
    state.lastBall = null;
    state.lastBallAt = null;
    state.claimFlash = null;
    state.paused = false;
    bumpRevision(state);
    return state;
}

function callBall(slug) {
    const state = getBingoState(slug);
    if (!state.active) {
        return { error: 'Bingo is not running for this event' };
    }
    if (isInIntro(state)) {
        return { error: 'Intro countdown — calling has not started yet' };
    }
    if (state.paused) {
        return { error: 'Calling is paused — resume after the claim check' };
    }
    const next = pickNextBall(state.calledBalls, state.ballCount);
    if (next == null) {
        return { error: 'All balls have been called' };
    }
    state.calledBalls.push(next);
    state.lastBall = next;
    state.lastBallAt = Date.now();
    bumpRevision(state);
    return { success: true, ball: next, state: publicBingoState(slug) };
}

function updateBingoConfig(slug, options = {}) {
    const state = getBingoState(slug);
    if (options.ballCount != null && !state.active) {
        state.ballCount = Math.max(9, Math.min(90, Number(options.ballCount) || 90));
    }
    if (options.callIntervalMs != null) {
        state.callIntervalMs = Math.max(2000, Math.min(120000, Number(options.callIntervalMs) || 5000));
    }
    if (options.autoCall != null) {
        state.autoCall = !!options.autoCall;
    }
    if (options.voiceCall != null) {
        state.voiceCall = !!options.voiceCall;
    }
    if (options.playingFor != null) {
        state.playingFor = normalizePlayingFor(options.playingFor);
    }
    if (options.introSeconds != null && !state.active) {
        state.introSeconds = Math.max(0, Math.min(600, Number(options.introSeconds) || 0));
    }
    bumpRevision(state);
    return state;
}

function setClaimFlash(slug, claimType, extra = {}) {
    const state = getBingoState(slug);
    const label = claimLabel(claimType);
    pauseCalling(slug);
    state.claimFlash = {
        claimType,
        label,
        serial: extra.serial || null,
        valid: extra.valid,
        at: Date.now()
    };
    bumpRevision(state);
    return state.claimFlash;
}

function consumeClaimFlash(slug) {
    const state = getBingoState(slug);
    const flash = state.claimFlash;
    state.claimFlash = null;
    return flash;
}

module.exports = {
    getBingoState,
    publicBingoState,
    startBingo,
    stopBingo,
    resetCalls,
    callBall,
    updateBingoConfig,
    setClaimFlash,
    consumeClaimFlash,
    scheduleAutoCall,
    clearAutoTimer,
    pauseCalling,
    resumeCalling,
    skipIntro,
    isInIntro,
    ensureIntroAdvanced
};
