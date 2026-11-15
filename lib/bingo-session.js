const {
    pickNextBall,
    claimLabel,
    prizeLabelForPlayingFor,
    normalizePlayingFor,
    normalizePrizes
} = require('./bingo');

const DEFAULT_CLAIM_BREAK_MS = 10000;
const RESUME_COUNTDOWN_MS = 5000;

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
        resumeEndsAt: null,
        claimWindowEndsAt: null,
        claimBreakMs: DEFAULT_CLAIM_BREAK_MS,
        pendingGameEnd: false,
        pendingAdvanceAfterClaim: false,
        showWinnersPopup: false,
        revision: 0
    };
}

function claimBreakMsForState(state) {
    return Math.max(1000, Math.min(120000, Number(state?.claimBreakMs) || DEFAULT_CLAIM_BREAK_MS));
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

function isInResume(state) {
    return !!(state && state.resumeEndsAt && Date.now() < state.resumeEndsAt);
}

function resumeRemainingMs(state) {
    if (!state.resumeEndsAt) return 0;
    return Math.max(0, state.resumeEndsAt - Date.now());
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

function ensureResumeAdvanced(slug, gameId, callBallFn) {
    const state = getBingoState(slug, gameId);
    if (!state.resumeEndsAt || Date.now() < state.resumeEndsAt) return;
    state.resumeEndsAt = null;
    bumpRevision(state);
    if (
        state.active &&
        state.autoCall &&
        !state.paused &&
        !isInIntro(state) &&
        !isInClaimWindow(state) &&
        typeof callBallFn === 'function'
    ) {
        scheduleAutoCall(slug, gameId, callBallFn);
    }
}

function healClaimWindow(slug, gameId) {
    const state = getBingoState(slug, gameId);
    if (state.claimWindowEndsAt && Date.now() >= state.claimWindowEndsAt) {
        endClaimWindow(slug, gameId);
    }
}

function publicBingoState(slug, gameId = 0) {
    healClaimWindow(slug, gameId);
    const s = getBingoState(slug, gameId);
    const inIntro = isInIntro(s);
    const inResume = isInResume(s);
    const introMs = introRemainingMs(s);
    const resumeMs = resumeRemainingMs(s);
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
        phase: inIntro ? 'intro' : inResume ? 'resume' : inClaimBreak ? 'claim_break' : 'calling',
        introSeconds: s.introSeconds ?? 0,
        introRemainingMs: introMs,
        introRemainingSec: Math.ceil(introMs / 1000),
        resumeRemainingMs: resumeMs,
        resumeRemainingSec: Math.ceil(resumeMs / 1000),
        claimBreakMs: claimBreakMsForState(s),
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
        pendingAdvanceAfterClaim: !!s.pendingAdvanceAfterClaim,
        pendingGameEnd: !!s.pendingGameEnd,
        claimWindowOpen: inClaimBreak || !!s.pendingAdvanceAfterClaim || !!s.pendingGameEnd,
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
        if (!current.active || !current.autoCall || current.paused || isInIntro(current) || isInResume(current)) return;
        if (isInClaimWindow(current)) return;
        const fn = autoCallFnByKey[key];
        if (typeof fn === 'function') fn();
    }, wait);
}

function extendClaimWindow(slug, gameId, ms) {
    const state = getBingoState(slug, gameId);
    if (!state.active) return;
    const key = sessionKey(slug, gameId);
    clearAutoTimer(slug, gameId);
    const duration = Math.max(1000, Number(ms) || claimBreakMsForState(state));
    state.claimWindowEndsAt = Date.now() + duration;
    if (state.pauseReason !== 'claim' && state.pauseReason !== 'manual') {
        state.paused = false;
        state.pauseReason = null;
    }
    bumpRevision(state);
    bingoAutoTimers[key] = setTimeout(() => endClaimWindow(slug, gameId), duration);
}

function endClaimWindow(slug, gameId) {
    const state = getBingoState(slug, gameId);
    state.claimWindowEndsAt = null;
    if (state.paused && (state.pauseReason === 'claim' || state.pauseReason === 'manual')) {
        bumpRevision(state);
        return;
    }
    if (state.pauseReason === 'claim_window') {
        state.paused = false;
        state.pauseReason = null;
    }
    bumpRevision(state);
    if (state.pendingGameEnd) {
        completeGameEnd(slug, gameId);
        return;
    }
    if (state.pendingAdvanceAfterClaim) {
        state.pendingAdvanceAfterClaim = false;
        advancePlayingForAfterWin(slug, gameId);
        bumpRevision(state);
    }
    const allCalled = (state.calledBalls || []).length >= (state.ballCount || 90);
    if (state.autoCall && !allCalled && !state.paused) {
        queueAutoCall(slug, gameId, state.callIntervalMs || 5000);
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
    extendClaimWindow(slug, gameId, claimBreakMsForState(state));
    return state;
}

function markPendingAdvanceAfterClaim(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    state.pendingAdvanceAfterClaim = true;
    bumpRevision(state);
    return state;
}

function dismissWinnersPopup(slug, gameId = 0) {
    const state = getBingoState(slug, gameId);
    state.showWinnersPopup = false;
    bumpRevision(state);
    return state;
}

function pauseCalling(slug, gameId = 0, reason = 'claim', options = {}) {
    const state = getBingoState(slug, gameId);
    const keepClaimWindow = !!options.keepClaimWindow;
    if (!keepClaimWindow) {
        clearAutoTimer(slug, gameId);
        state.claimWindowEndsAt = null;
    } else if (!isInClaimWindow(state)) {
        extendClaimWindow(slug, gameId, claimBreakMsForState(state));
    }
    state.paused = true;
    state.resumeEndsAt = null;
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
        bumpRevision(state);
        extendClaimWindow(slug, gameId, claimBreakMsForState(state));
        return { success: true, state: publicBingoState(slug, gameId) };
    }
    if (state.pendingAdvanceAfterClaim) {
        state.pendingAdvanceAfterClaim = false;
        advancePlayingForAfterWin(slug, gameId);
    }
    state.paused = false;
    state.pauseReason = null;
    state.claimWindowEndsAt = null;
    state.resumeEndsAt = Date.now() + RESUME_COUNTDOWN_MS;
    bumpRevision(state);
    return { success: true, state: publicBingoState(slug, gameId) };
}

function scheduleAutoCall(slug, gameId, callBallFn) {
    registerAutoCallFn(slug, gameId, callBallFn);
    const state = getBingoState(slug, gameId);
    if (!state.active || !state.autoCall || state.paused || isInIntro(state) || isInResume(state) || isInClaimWindow(state)) {
        return;
    }
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
    const prev = getBingoState(slug, gid);
    const claimBreakMs = Math.max(
        1000,
        Math.min(120000, Number(options.claimBreakMs) || Number(prev?.claimBreakMs) || DEFAULT_CLAIM_BREAK_MS)
    );
    const introEndsAt = introSeconds > 0 ? Date.now() + introSeconds * 1000 : null;
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
        resumeEndsAt: null,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: Date.now(),
        claimFlash: null,
        prizeWinners: { line: null, 'two-lines': null, house: null },
        claimWindowEndsAt: null,
        claimBreakMs,
        pendingGameEnd: false,
        pendingAdvanceAfterClaim: false,
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
    delete autoCallFnByKey[key];
    const state = getBingoState(slug, gameId);
    state.active = false;
    state.autoCall = false;
    state.paused = false;
    state.pauseReason = null;
    state.resumeEndsAt = null;
    state.claimWindowEndsAt = null;
    state.pendingGameEnd = false;
    state.pendingAdvanceAfterClaim = false;
    state.showWinnersPopup = false;
    state.claimFlash = null;
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
    state.resumeEndsAt = null;
    state.claimWindowEndsAt = null;
    state.pendingGameEnd = false;
    state.pendingAdvanceAfterClaim = false;
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
    if (isInResume(state)) {
        return { error: 'Resuming — calling starts in a few seconds' };
    }
    if (isInClaimWindow(state)) {
        return { error: 'Claim window — wait for guests to call' };
    }
    if (state.paused) {
        return { error: 'Calling is paused — tap Resume after the claim check' };
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
    const allCalled = state.calledBalls.length >= (state.ballCount || 90);
    if (state.autoCall && !allCalled && !state.paused) {
        queueAutoCall(slug, gameId, state.callIntervalMs || 5000);
    }
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
    if (options.claimBreakMs != null) {
        state.claimBreakMs = Math.max(
            1000,
            Math.min(120000, Number(options.claimBreakMs) || DEFAULT_CLAIM_BREAK_MS)
        );
    }
    bumpRevision(state);
    return state;
}

function appendPrizeWinner(cur, name) {
    const wn = name ? String(name).trim().slice(0, 50) : '';
    if (!wn) return cur || null;
    if (!cur) return wn;
    const parts = String(cur)
        .split(/\s*·\s*|\s*,\s*/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    if (parts.includes(wn.toLowerCase())) return cur;
    return String(cur) + ' · ' + wn;
}

function recordPrizeWinner(state, prizeTier, name) {
    const pf = normalizePlayingFor(prizeTier);
    if (!state.prizeWinners) {
        state.prizeWinners = { line: null, 'two-lines': null, house: null };
    }
    state.prizeWinners[pf] = appendPrizeWinner(state.prizeWinners[pf], name);
}

function setClaimFlash(slug, gameId, claimType, extra = {}) {
    const state = getBingoState(slug, gameId);
    const pf = normalizePlayingFor(claimType);
    const label = prizeLabelForPlayingFor(pf, state.prizes) || claimLabel(claimType);
    if (extra.pause === true) {
        const keepClaimWindow =
            !!extra.valid ||
            isInClaimWindow(state) ||
            !!state.pendingAdvanceAfterClaim ||
            !!state.pendingGameEnd;
        pauseCalling(slug, gameId, 'claim', { keepClaimWindow });
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
        recordPrizeWinner(state, pf, winnerName);
        extendClaimWindow(slug, gameId, claimBreakMsForState(state));
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
    markPendingAdvanceAfterClaim,
    appendPrizeWinner,
    recordPrizeWinner,
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
    healClaimWindow,
    ensureIntroAdvanced,
    ensureResumeAdvanced,
    isInResume,
    RESUME_COUNTDOWN_MS,
    armPendingGameEnd,
    dismissWinnersPopup,
    DEFAULT_CLAIM_BREAK_MS,
    claimBreakMsForState
};
