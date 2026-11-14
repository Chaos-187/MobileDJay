const {
    pickNextBall,
    claimLabel,
    prizeLabelForPlayingFor,
    normalizePlayingFor,
    normalizePrizes
} = require('./bingo');

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
        prizeWinners: { line: null, 'two-lines': null, house: null },
        playingFor: 'line',
        prizes: normalizePrizes({}),
        pauseReason: null,
        introSeconds: 30,
        introEndsAt: null,
        revision: 0
    };
}

function playingForLabelFromState(state) {
    return prizeLabelForPlayingFor(state.playingFor || 'line', state.prizes);
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
        prizeWinners: { ...(s.prizeWinners || { line: null, 'two-lines': null, house: null }) },
        playingFor: s.playingFor || 'line',
        playingForLabel: playingForLabelFromState(s),
        prizes: normalizePrizes(s.prizes),
        pausedReason: s.paused ? s.pauseReason || 'claim' : null,
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

function pauseCalling(slug, gameId = 0, reason = 'claim') {
    const state = getBingoState(slug, gameId);
    clearAutoTimer(slug, gameId);
    state.paused = true;
    state.pauseReason = reason === 'manual' ? 'manual' : 'claim';
    bumpRevision(state);
    return state;
}

function pauseGame(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    pauseCalling(slug, gameId, 'manual');
    return { success: true, state: publicBingoState(slug, gameId) };
}

function resumeCalling(slug, gameId, callBallFn) {
    const state = getBingoState(slug, gameId);
    if (!state.active) {
        return { error: 'Bingo is not running' };
    }
    state.paused = false;
    state.pauseReason = null;
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
    const prizes = normalizePrizes(options.prizes);
    const introSeconds = Math.max(0, Math.min(600, Number(options.introSeconds) ?? 30));
    const introEndsAt = introSeconds > 0 ? Date.now() + introSeconds * 1000 : null;
    const prev = getBingoState(slug, gid);
    const mergedPrizes = normalizePrizes({
        line: prizes.line || prev.prizes?.line,
        'two-lines': prizes['two-lines'] || prev.prizes?.['two-lines'],
        house: prizes.house || prev.prizes?.house
    });

    bingoStateByKey[sessionKey(slug, gid)] = {
        gameId: gid,
        active: true,
        ballCount,
        callIntervalMs,
        autoCall,
        voiceCall,
        paused: false,
        playingFor,
        prizes: mergedPrizes,
        pauseReason: null,
        introSeconds,
        introEndsAt,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: Date.now(),
        claimFlash: null,
        prizeWinners: { line: null, 'two-lines': null, house: null },
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
    state.pauseReason = null;
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
    state.pauseReason = null;
    bumpRevision(state);
    return state;
}

/** Reset caller board and prize ladder so an ended game can run again (same cards). */
function restartGameSession(slug, gameId = 0) {
    clearAutoTimer(slug, gameId);
    const state = getBingoState(slug, gameId);
    state.active = false;
    state.autoCall = false;
    state.paused = false;
    state.pauseReason = null;
    state.calledBalls = [];
    state.lastBall = null;
    state.lastBallAt = null;
    state.claimFlash = null;
    state.prizeWinners = { line: null, 'two-lines': null, house: null };
    state.playingFor = 'line';
    state.introEndsAt = null;
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
    if (options.prizes != null) {
        const p = normalizePrizes(options.prizes);
        state.prizes = normalizePrizes({
            line: p.line || state.prizes?.line,
            'two-lines': p['two-lines'] || state.prizes?.['two-lines'],
            house: p.house || state.prizes?.house
        });
    }
    if (options.introSeconds != null && !state.active) {
        state.introSeconds = Math.max(0, Math.min(600, Number(options.introSeconds) || 0));
    }
    bumpRevision(state);
    return state;
}

function setClaimFlash(slug, gameId, claimType, extra = {}) {
    const state = getBingoState(slug, gameId);
    const pf = normalizePlayingFor(claimType);
    const label = prizeLabelForPlayingFor(pf, state.prizes) || claimLabel(claimType);
    const shouldPause = extra.pause !== false;
    if (shouldPause) {
        pauseCalling(slug, gameId, 'claim');
    }
    const winnerName = extra.winnerName || extra.customerName || null;
    state.claimFlash = {
        claimType,
        label,
        serial: extra.serial || null,
        valid: extra.valid,
        winnerName: winnerName ? String(winnerName).trim().slice(0, 50) : null,
        at: Date.now()
    };
    if (extra.valid) {
        if (!state.prizeWinners) {
            state.prizeWinners = { line: null, 'two-lines': null, house: null };
        }
        const wn = winnerName ? String(winnerName).trim().slice(0, 50) : null;
        if (wn) state.prizeWinners[pf] = wn;
    }
    bumpRevision(state);
    return state.claimFlash;
}

/** After a verified win — advance DJ “playing for” to the next prize. */
function advancePlayingForAfterWin(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    const pf = normalizePlayingFor(state.playingFor);
    if (pf === 'line') state.playingFor = 'two-lines';
    else if (pf === 'two-lines') state.playingFor = 'house';
    bumpRevision(state);
    return state.playingFor;
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
    restartGameSession,
    callBall,
    updateBingoConfig,
    setClaimFlash,
    advancePlayingForAfterWin,
    consumeClaimFlash,
    scheduleAutoCall,
    clearAutoTimer,
    pauseCalling,
    pauseGame,
    resumeCalling,
    skipIntro,
    isInIntro,
    ensureIntroAdvanced
};
