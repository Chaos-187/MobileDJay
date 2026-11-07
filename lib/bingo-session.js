const { pickNextBall, claimLabel, playingForDisplayLabel, normalizePlayingFor } = require('./bingo');

const bingoStateByKey = {};
const bingoAutoTimers = {};

function normalizeGameId(gameId) {
    const n = Number(gameId);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function sessionKey(slug, gameId) {
    const s = String(slug || '').trim();
    if (!s) return '';
    return `${s}::${normalizeGameId(gameId)}`;
}

function emptyBingoState(gameId = 0) {
    return {
        gameId: normalizeGameId(gameId),
        active: false,
        ballCount: 90,
        callIntervalMs: 5000,
        autoCall: false,
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

function getBingoState(slug, gameId = 0) {
    const key = sessionKey(slug, gameId);
    if (!key) return emptyBingoState(gameId);
    if (!bingoStateByKey[key]) {
        bingoStateByKey[key] = emptyBingoState(gameId);
    }
    return bingoStateByKey[key];
}

function ensureIntroAdvanced(slug, gameId, callBallFn) {
    const state = getBingoState(slug, gameId);
    if (!state.introEndsAt || Date.now() < state.introEndsAt) return;
    state.introEndsAt = null;
    bumpRevision(state);
    if (state.active && state.autoCall && !state.paused && typeof callBallFn === 'function') {
        scheduleAutoCall(slug, gameId, callBallFn);
    }
}

function publicBingoState(slug, gameId = 0) {
    const s = getBingoState(slug, gameId);
    const inIntro = isInIntro(s);
    const introMs = introRemainingMs(s);
    return {
        gameId: s.gameId,
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

function clearAutoTimer(slug, gameId = 0) {
    const key = sessionKey(slug, gameId);
    if (bingoAutoTimers[key]) {
        clearInterval(bingoAutoTimers[key]);
        delete bingoAutoTimers[key];
    }
}

function pauseCalling(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    clearAutoTimer(slug, gameId);
    state.paused = true;
    bumpRevision(state);
    return state;
}

function resumeCalling(slug, gameId, callBallFn) {
    const state = getBingoState(slug, gameId);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    state.paused = false;
    bumpRevision(state);
    if (state.autoCall && typeof callBallFn === 'function' && !isInIntro(state)) {
        scheduleAutoCall(slug, gameId, callBallFn);
    }
    return { success: true, state: publicBingoState(slug, gameId) };
}

function scheduleAutoCall(slug, gameId, callBallFn) {
    const key = sessionKey(slug, gameId);
    clearAutoTimer(slug, gameId);
    const state = getBingoState(slug, gameId);
    if (!state.active || !state.autoCall || state.paused || isInIntro(state)) return;
    const ms = Math.max(2000, state.callIntervalMs || 5000);
    bingoAutoTimers[key] = setInterval(() => {
        const current = getBingoState(slug, gameId);
        if (!current.active || !current.autoCall || current.paused || isInIntro(current)) {
            if (!current.active || !current.autoCall) clearAutoTimer(slug, gameId);
            return;
        }
        callBallFn(slug, gameId, { auto: true });
    }, ms);
}

function startBingo(slug, gameId = 0, options = {}) {
    // Back-compat: startBingo(slug, options) when gameId omitted
    if (options && typeof options === 'object' && !Number.isFinite(Number(gameId))) {
        options = gameId;
        gameId = 0;
    }
    const gid = normalizeGameId(gameId);
    clearAutoTimer(slug, gid);
    const ballCount = Math.max(9, Math.min(90, Number(options.ballCount) || 90));
    const callIntervalMs = Math.max(2000, Math.min(120000, Number(options.callIntervalMs) || 5000));
    const autoCall = !!options.autoCall;
    const voiceCall = !!options.voiceCall;
    const playingFor = normalizePlayingFor(options.playingFor);
    const introSeconds = Math.max(0, Math.min(600, Number(options.introSeconds) ?? 30));
    const introEndsAt = introSeconds > 0 ? Date.now() + introSeconds * 1000 : null;

    bingoStateByKey[sessionKey(slug, gid)] = {
        gameId: gid,
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

    return getBingoState(slug, gid);
}

function skipIntro(slug, gameId, callBallFn) {
    const state = getBingoState(slug, gameId);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    state.introEndsAt = null;
    bumpRevision(state);
    if (state.autoCall && !state.paused && typeof callBallFn === 'function') {
        scheduleAutoCall(slug, gameId, callBallFn);
    }
    return { success: true, state: publicBingoState(slug, gameId) };
}

function stopBingo(slug, gameId = 0) {
    clearAutoTimer(slug, gameId);
    const state = getBingoState(slug, gameId);
    state.active = false;
    state.autoCall = false;
    state.paused = false;
    bumpRevision(state);
    return state;
}

function resetCalls(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    state.calledBalls = [];
    state.lastBall = null;
    state.lastBallAt = null;
    state.claimFlash = null;
    state.paused = false;
    bumpRevision(state);
    return state;
}

function callBall(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
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
    return { success: true, ball: next, state: publicBingoState(slug, gameId) };
}

function updateBingoConfig(slug, gameId = 0, options = {}) {
    if (options && typeof options === 'object' && arguments.length === 2) {
        options = gameId;
        gameId = 0;
    }
    const state = getBingoState(slug, gameId);
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

function setClaimFlash(slug, gameId, claimType, extra = {}) {
    const state = getBingoState(slug, gameId);
    const label = claimLabel(claimType);
    pauseCalling(slug, gameId);
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

function consumeClaimFlash(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    const flash = state.claimFlash;
    state.claimFlash = null;
    return flash;
}

module.exports = {
    sessionKey,
    normalizeGameId,
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
