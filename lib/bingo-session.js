const { pickNextBall, claimLabel } = require('./bingo');

const bingoStateBySlug = {};
const bingoAutoTimers = {};

function emptyBingoState() {
    return {
        active: false,
        ballCount: 90,
        callIntervalMs: 5000,
        autoCall: false,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: null,
        claimFlash: null,
        revision: 0
    };
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
    return {
        active: s.active,
        ballCount: s.ballCount,
        callIntervalMs: s.callIntervalMs,
        autoCall: s.autoCall,
        calledBalls: s.calledBalls.slice(),
        lastBall: s.lastBall,
        lastBallAt: s.lastBallAt,
        claimFlash: s.claimFlash ? { ...s.claimFlash } : null,
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

function scheduleAutoCall(slug, callBallFn) {
    clearAutoTimer(slug);
    const state = getBingoState(slug);
    if (!state.active || !state.autoCall) return;
    const ms = Math.max(2000, state.callIntervalMs || 5000);
    bingoAutoTimers[slug] = setInterval(() => {
        const current = getBingoState(slug);
        if (!current.active || !current.autoCall) {
            clearAutoTimer(slug);
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

    bingoStateBySlug[slug] = {
        active: true,
        ballCount,
        callIntervalMs,
        autoCall,
        calledBalls: [],
        lastBall: null,
        lastBallAt: null,
        startedAt: Date.now(),
        claimFlash: null,
        revision: 1
    };

    return getBingoState(slug);
}

function stopBingo(slug) {
    clearAutoTimer(slug);
    const state = getBingoState(slug);
    state.active = false;
    state.autoCall = false;
    bumpRevision(state);
    return state;
}

function resetCalls(slug) {
    const state = getBingoState(slug);
    state.calledBalls = [];
    state.lastBall = null;
    state.lastBallAt = null;
    state.claimFlash = null;
    bumpRevision(state);
    return state;
}

function callBall(slug) {
    const state = getBingoState(slug);
    if (!state.active) {
        return { error: 'Bingo is not running for this event' };
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
    bumpRevision(state);
    return state;
}

function setClaimFlash(slug, claimType, extra = {}) {
    const state = getBingoState(slug);
    const label = claimLabel(claimType);
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
    clearAutoTimer
};
