const { generateRunners, variantLabel } = require('./virtual-race');

const stateBySlug = {};

function emptyState() {
    return {
        active: false,
        variant: 'horse',
        phase: 'idle',
        revision: 0,
        countdownSeconds: 5,
        raceDurationMs: 14000,
        runnerCount: 6,
        countdownEndsAt: null,
        raceStartAt: null,
        raceEndAt: null,
        finishOrder: [],
        winnerId: null,
        runners: []
    };
}

function getState(slug) {
    if (!slug) return emptyState();
    if (!stateBySlug[slug]) stateBySlug[slug] = emptyState();
    return stateBySlug[slug];
}

function bumpRevision(state) {
    state.revision = (state.revision || 0) + 1;
}

function shuffleFinishOrder(runners) {
    const ids = runners.map((r) => r.id);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
}

function computeRunnerProgress(state, now) {
    if (state.phase !== 'racing' && state.phase !== 'finish') {
        state.runners.forEach((r) => {
            r.progress = state.phase === 'finish' ? 1 : 0;
            r.finished = state.phase === 'finish';
        });
        return;
    }
    const start = state.raceStartAt || now;
    const elapsed = Math.max(0, now - start);
    const dur = state.raceDurationMs || 14000;
    const order = state.finishOrder || [];
    order.forEach((id, rank) => {
        const runner = state.runners.find((r) => r.id === id);
        if (!runner) return;
        const startDelay = rank * (dur * 0.035);
        const finishAt = dur * (0.82 + rank * 0.028);
        const span = Math.max(400, finishAt - startDelay);
        runner.progress = Math.max(0, Math.min(1, (elapsed - startDelay) / span));
        runner.finished = runner.progress >= 0.999 || state.phase === 'finish';
    });
    if (state.phase === 'finish') {
        state.runners.forEach((r) => {
            r.progress = 1;
            r.finished = true;
        });
    }
}

function ensureAdvanced(slug) {
    const state = getState(slug);
    const now = Date.now();
    if (!state.active) return state;

    if (state.phase === 'countdown' && state.countdownEndsAt && now >= state.countdownEndsAt) {
        state.phase = 'racing';
        state.raceStartAt = now;
        state.raceEndAt = now + state.raceDurationMs;
        bumpRevision(state);
    }

    if (state.phase === 'racing' && state.raceEndAt && now >= state.raceEndAt) {
        state.phase = 'finish';
        state.winnerId = state.finishOrder[0] || null;
        bumpRevision(state);
    }

    computeRunnerProgress(state, now);
    return state;
}

function skipCountdown(slug) {
    const state = getState(slug);
    if (!state.active || state.phase !== 'countdown') {
        return { error: 'Not in countdown' };
    }
    const now = Date.now();
    state.phase = 'racing';
    state.raceStartAt = now;
    state.raceEndAt = now + state.raceDurationMs;
    state.countdownEndsAt = now;
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function updateConfig(slug, options = {}) {
    const state = getState(slug);
    if (state.active && state.phase !== 'idle') {
        return { error: 'Cannot change config during a race' };
    }
    if (options.variant === 'horse' || options.variant === 'dog') {
        state.variant = options.variant;
    }
    if (options.runnerCount != null) {
        state.runnerCount = Math.max(4, Math.min(8, Number(options.runnerCount) || 6));
    }
    if (options.countdownSeconds != null) {
        state.countdownSeconds = Math.max(0, Math.min(30, Number(options.countdownSeconds) || 0));
    }
    if (options.raceDurationSeconds != null) {
        state.raceDurationMs = Math.max(5000, Math.min(60000, Number(options.raceDurationSeconds) * 1000 || 14000));
    }
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function newLineup(slug) {
    const state = getState(slug);
    if (state.phase === 'countdown' || state.phase === 'racing') {
        return { error: 'Stop the current race first' };
    }
    state.runners = generateRunners(state.variant, state.runnerCount);
    state.finishOrder = shuffleFinishOrder(state.runners);
    state.winnerId = null;
    state.phase = 'idle';
    state.active = false;
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function startRace(slug, options = {}) {
    const state = getState(slug);
    if (state.phase === 'countdown' || state.phase === 'racing') {
        return { error: 'Race already running' };
    }
    if (state.phase === 'finish') {
        state.active = false;
        state.phase = 'idle';
    }
    if (options.variant === 'horse' || options.variant === 'dog') {
        state.variant = options.variant;
    }
    if (options.runnerCount != null) {
        state.runnerCount = Math.max(4, Math.min(8, Number(options.runnerCount) || state.runnerCount));
    }
    if (options.countdownSeconds != null) {
        state.countdownSeconds = Math.max(0, Math.min(30, Number(options.countdownSeconds) || 0));
    }
    if (options.raceDurationSeconds != null) {
        state.raceDurationMs = Math.max(
            5000,
            Math.min(60000, Number(options.raceDurationSeconds) * 1000 || state.raceDurationMs)
        );
    }
    const st = getState(slug);
    if (!st.runners.length || st.phase === 'finish') {
        st.runners = generateRunners(st.variant, st.runnerCount);
    }
    st.finishOrder = shuffleFinishOrder(st.runners);
    st.winnerId = null;
    st.runners.forEach((r) => {
        r.progress = 0;
        r.finished = false;
    });
    st.active = true;
    const countdownMs = (st.countdownSeconds || 0) * 1000;
    if (countdownMs > 0) {
        st.phase = 'countdown';
        st.countdownEndsAt = Date.now() + countdownMs;
        st.raceStartAt = null;
        st.raceEndAt = null;
    } else {
        const now = Date.now();
        st.phase = 'racing';
        st.countdownEndsAt = now;
        st.raceStartAt = now;
        st.raceEndAt = now + st.raceDurationMs;
    }
    bumpRevision(st);
    return { success: true, state: publicState(slug) };
}

function stopRace(slug) {
    const state = getState(slug);
    state.active = false;
    state.phase = 'idle';
    state.countdownEndsAt = null;
    state.raceStartAt = null;
    state.raceEndAt = null;
    state.winnerId = null;
    state.runners.forEach((r) => {
        r.progress = 0;
        r.finished = false;
    });
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function publicState(slug) {
    const state = ensureAdvanced(slug);
    const now = Date.now();
    let countdownRemainingMs = 0;
    if (state.phase === 'countdown' && state.countdownEndsAt) {
        countdownRemainingMs = Math.max(0, state.countdownEndsAt - now);
    }
    let raceRemainingMs = 0;
    if (state.phase === 'racing' && state.raceEndAt) {
        raceRemainingMs = Math.max(0, state.raceEndAt - now);
    }
    const winner = state.runners.find((r) => r.id === state.winnerId);
    return {
        active: state.active,
        variant: state.variant,
        variantLabel: variantLabel(state.variant),
        phase: state.phase,
        revision: state.revision,
        countdownSeconds: state.countdownSeconds,
        countdownRemainingMs,
        raceDurationMs: state.raceDurationMs,
        raceRemainingMs,
        runnerCount: state.runnerCount,
        runners: state.runners.map((r) => ({
            id: r.id,
            lane: r.lane,
            number: r.number,
            name: r.name,
            silk: r.silk,
            progress: r.progress,
            finished: r.finished
        })),
        winnerId: state.winnerId,
        winnerName: winner ? winner.name : null,
        winnerNumber: winner ? winner.number : null
    };
}

module.exports = {
    getState,
    ensureAdvanced,
    publicState,
    updateConfig,
    newLineup,
    startRace,
    stopRace,
    skipCountdown
};
