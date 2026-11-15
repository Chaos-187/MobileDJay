const {
    pickNextBall,
    claimLabel,
    prizeLabelForPlayingFor,
    normalizePlayingFor,
    normalizePrizes
} = require('./bingo');

const CLAIM_BREAK_MS = 5000;

const bingoStateByKey = {};
const bingoAutoTimers = {};
const autoCallFnByKey = {};
const gameEndFinalizeByKey = {};

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
        claimWindowEndsAt: null,
        pendingGameEnd: false,
        showWinnersPopup: false,
        revision: 0
    };
}

function isInClaimWindow(state) {
    return !!(state && state.claimWindowEndsAt && Date.now() < state.claimWindowEndsAt);
}

function claimWindowRemainingMs(state) {
    if (!state || !state.claimWindowEndsAt) return 0;
    return Math.max(0, state.claimWindowEndsAt - Date.now());
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
    const claimMs = claimWindowRemainingMs(s);
    const inClaimBreak = isInClaimWindow(s);
    return {
        gameId: s.gameId,
        active: s.active,
        ballCount: s.ballCount,
        callIntervalMs: s.callIntervalMs,
        autoCall: s.autoCall,
        voiceCall: !!s.voiceCall,
        paused: !!s.paused,
        phase: inIntro ? 'intro' : inClaimBreak ? 'claim_break' : 'calling',
        introSeconds: s.introSeconds ?? 0,
        introRemainingMs: introMs,
        introRemainingSec: Math.ceil(introMs / 1000),
        claimBreakMs: CLAIM_BREAK_MS,
        claimBreakRemainingMs: claimMs,
        claimBreakRemainingSec: Math.ceil(claimMs / 1000),
        calledBalls: s.calledBalls.slice(),
        lastBall: s.lastBall,
        lastBallAt: s.lastBallAt,
        claimFlash: s.claimFlash ? { ...s.claimFlash } : null,
        prizeWinners: { ...(s.prizeWinners || { line: null, 'two-lines': null, house: null }) },
        playingFor: s.playingFor || 'line',
        playingForLabel: playingForLabelFromState(s),
        prizes: normalizePrizes(s.prizes),
        pausedReason: s.paused ? s.pauseReason || 'claim' : null,
        pendingGameEnd: !!s.pendingGameEnd,
        showWinnersPopup: !!s.showWinnersPopup,
        revision: s.revision
    };
}

function bumpRevision(state) {
    state.revision = (state.revision || 0) + 1;
}

function clearAutoTimer(slug, gameId = 0) {
    const key = sessionKey(slug, gameId);
    if (bingoAutoTimers[key]) {
        clearTimeout(bingoAutoTimers[key]);
        delete bingoAutoTimers[key];
    }
}

function registerAutoCallFn(slug, gameId, callBallFn) {
    const key = sessionKey(slug, gameId);
    if (key && typeof callBallFn === 'function') {
        autoCallFnByKey[key] = callBallFn;
    }
}

function queueAutoCall(slug, gameId, delayMs = 0) {
    const key = sessionKey(slug, gameId);
    if (!key) return;
    clearAutoTimer(slug, gameId);
    const wait = Math.max(0, Number(delayMs) || 0);
    bingoAutoTimers[key] = setTimeout(() => {
        const current = getBingoState(slug, gameId);
        if (!current.active || !current.autoCall || current.paused || isInIntro(current)) return;
        const fn = autoCallFnByKey[key];
        if (typeof fn === 'function') fn();
    }, wait);
}

function beginClaimWindow(slug, gameId) {
    const state = getBingoState(slug, gameId);
    if (!state.active) return;
    clearAutoTimer(slug, gameId);
    state.claimWindowEndsAt = Date.now() + CLAIM_BREAK_MS;
    state.paused = true;
    state.pauseReason = 'claim_window';
    bumpRevision(state);
    const key = sessionKey(slug, gameId);
    bingoAutoTimers[key] = setTimeout(() => endClaimWindow(slug, gameId), CLAIM_BREAK_MS);
}

function endClaimWindow(slug, gameId) {
    const state = getBingoState(slug, gameId);
    state.claimWindowEndsAt = null;
    if (state.pauseReason !== 'claim_window') return;
    state.paused = false;
    state.pauseReason = null;
    bumpRevision(state);
    if (state.pendingGameEnd) {
        completeGameEnd(slug, gameId);
        return;
    }
    const allCalled = (state.calledBalls || []).length >= (state.ballCount || 90);
    if (state.autoCall && !allCalled) {
        const extra = Math.max(0, (state.callIntervalMs || 5000) - CLAIM_BREAK_MS);
        queueAutoCall(slug, gameId, extra);
    }
}

function completeGameEnd(slug, gameId) {
    const key = sessionKey(slug, gameId);
    const state = getBingoState(slug, gameId);
    clearAutoTimer(slug, gameId);
    state.claimWindowEndsAt = null;
    state.pendingGameEnd = false;
    state.paused = false;
    state.pauseReason = null;
    state.autoCall = false;
    state.active = false;
    state.showWinnersPopup = true;
    bumpRevision(state);
    const finalize = gameEndFinalizeByKey[key];
    if (typeof finalize === 'function') {
        try {
            finalize();
        } catch (e) {
            /* ignore */
        }
    }
    delete gameEndFinalizeByKey[key];
    return state;
}

/** After house win — wait for claim break, then end and surface winners. */
function armPendingGameEnd(slug, gameId, finalizeFn) {
    const key = sessionKey(slug, gameId);
    const state = getBingoState(slug, gameId);
    state.pendingGameEnd = true;
    if (typeof finalizeFn === 'function') gameEndFinalizeByKey[key] = finalizeFn;
    clearAutoTimer(slug, gameId);
    if (isInClaimWindow(state) || state.pauseReason === 'claim_window') {
        return state;
    }
    beginClaimWindow(slug, gameId);
    return state;
}

function dismissWinnersPopup(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    state.showWinnersPopup = false;
    bumpRevision(state);
    return state;
}

function pauseCalling(slug, gameId = 0, reason = 'claim') {
    const state = getBingoState(slug, gameId);
    clearAutoTimer(slug, gameId);
    state.claimWindowEndsAt = null;
    state.paused = true;
    if (reason === 'manual') state.pauseReason = 'manual';
    else if (reason === 'claim_window') state.pauseReason = 'claim_window';
    else state.pauseReason = 'claim';
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
    if (state.pendingGameEnd) {
        state.paused = false;
        state.pauseReason = null;
        state.claimWindowEndsAt = null;
        bumpRevision(state);
        beginClaimWindow(slug, gameId);
        return { success: true, state: publicBingoState(slug, gameId) };
    }
    state.paused = false;
    state.pauseReason = null;
    state.claimWindowEndsAt = null;
    bumpRevision(state);
    if (state.autoCall && typeof callBallFn === 'function' && !isInIntro(state)) {
        scheduleAutoCall(slug, gameId, callBallFn);
    }
    return { success: true, state: publicBingoState(slug, gameId) };
}

function scheduleAutoCall(slug, gameId, callBallFn) {
    registerAutoCallFn(slug, gameId, callBallFn);
    const state = getBingoState(slug, gameId);
    if (!state.active || !state.autoCall || state.paused || isInIntro(state)) return;
    queueAutoCall(slug, gameId, 0);
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
        claimWindowEndsAt: null,
        pendingGameEnd: false,
        showWinnersPopup: false,
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
    const key = sessionKey(slug, gameId);
    clearAutoTimer(slug, gameId);
    delete gameEndFinalizeByKey[key];
    const state = getBingoState(slug, gameId);
    state.active = false;
    state.autoCall = false;
    state.paused = false;
    state.pauseReason = null;
    state.claimWindowEndsAt = null;
    state.pendingGameEnd = false;
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
    state.claimWindowEndsAt = null;
    state.pendingGameEnd = false;
    state.showWinnersPopup = false;
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
    if (state.pendingGameEnd) {
        return { error: 'Game is finishing' };
    }
    const next = pickNextBall(state.calledBalls, state.ballCount);
    if (next == null) {
        return { error: 'All balls have been called' };
    }
    state.calledBalls.push(next);
    state.lastBall = next;
    state.lastBallAt = Date.now();
    bumpRevision(state);
    beginClaimWindow(slug, gameId);
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
    registerAutoCallFn,
    clearAutoTimer,
    pauseCalling,
    pauseGame,
    resumeCalling,
    skipIntro,
    isInIntro,
    isInClaimWindow,
    ensureIntroAdvanced,
    armPendingGameEnd,
    dismissWinnersPopup,
    CLAIM_BREAK_MS
};
