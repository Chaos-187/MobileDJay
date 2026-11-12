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
        runners: [],
        racePlan: null
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

function runnersMatchVariant(state) {
    if (!state.runners.length) return false;
    const prefix = `${state.variant}-`;
    return state.runners.every((r) => String(r.id).startsWith(prefix));
}

function refreshLineupForVariant(state) {
    state.runners = generateRunners(state.variant, state.runnerCount);
    state.finishOrder = shuffleFinishOrder(state.runners);
    state.racePlan = buildRacePlan(state.finishOrder);
    state.winnerId = null;
}

/** Keyframed progress — each runner only ever moves forward; pack order shuffles between milestones. */
function buildRacePlan(finishOrder) {
    const n = finishOrder.length;
    const milestoneTs = [0, 0.18, 0.36, 0.54, 0.74, 1];
    const racePlan = {};
    finishOrder.forEach((id) => {
        racePlan[id] = { keyframes: [{ t: 0, p: 0 }] };
    });

    for (let mi = 1; mi < milestoneTs.length; mi++) {
        const t = milestoneTs[mi];
        const prevT = milestoneTs[mi - 1];
        const isFinish = t >= 1;
        const order = isFinish
            ? finishOrder.slice()
            : finishOrder.slice().sort(() => Math.random() - 0.5);

        const spread = isFinish ? 0.014 : 0.05 + 0.035 * Math.sin(mi * 1.3);
        const center = isFinish ? 1 : t * 0.94;
        const seg = Math.max(0.01, t - prevT);

        order.forEach((id, rank) => {
            const prevP = racePlan[id].keyframes[racePlan[id].keyframes.length - 1].p;
            let ideal;
            if (isFinish) {
                ideal = Math.max(0, 1 - rank * 0.012);
            } else {
                const lead = center + spread * 0.5;
                const trail = center - spread * 0.5;
                const denom = Math.max(1, n - 1);
                ideal = lead - (rank / denom) * (lead - trail);
            }
            const minForward = prevP + seg * 0.62;
            const p = Math.max(minForward, Math.min(1, ideal));
            racePlan[id].keyframes.push({ t, p });
        });
    }
    return racePlan;
}

function progressFromPlan(plan, normalizedT) {
    if (!plan || !plan.keyframes || !plan.keyframes.length) return 0;
    const kf = plan.keyframes;
    if (normalizedT <= 0) return 0;
    if (normalizedT >= 1) return kf[kf.length - 1].p;
    for (let i = 0; i < kf.length - 1; i++) {
        const a = kf[i];
        const b = kf[i + 1];
        if (normalizedT >= a.t && normalizedT <= b.t) {
            const u = (normalizedT - a.t) / (b.t - a.t);
            return a.p + (b.p - a.p) * u;
        }
    }
    return kf[kf.length - 1].p;
}

function computeRunnerProgress(state, now) {
    const phase = state.phase;
    if (phase !== 'racing' && phase !== 'finish') {
        state.runners.forEach((r) => {
            r.progress = 0;
            r.finished = false;
        });
        return;
    }
    const dur = state.raceDurationMs || 14000;
    const start = state.raceStartAt || now;
    const elapsed = Math.max(0, now - start);
    const normalizedT = phase === 'finish' ? 1 : Math.min(1, elapsed / dur);

    if (!state.racePlan) {
        state.runners.forEach((r) => {
            r.progress = normalizedT;
            r.finished = phase === 'finish';
        });
        return;
    }

    state.runners.forEach((r) => {
        const plan = state.racePlan[r.id];
        r.progress = plan ? progressFromPlan(plan, normalizedT) : 0;
        r.finished = phase === 'finish' || r.progress >= 0.996;
    });
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
    if (state.active && state.phase !== 'idle' && state.phase !== 'finish') {
        return { error: 'Cannot change config during a race' };
    }
    const prevVariant = state.variant;
    if (options.variant === 'horse' || options.variant === 'dog') {
        state.variant = options.variant;
    }
    if (
        prevVariant !== state.variant &&
        (state.phase === 'idle' || state.phase === 'finish' || !state.active)
    ) {
        refreshLineupForVariant(state);
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
    if (
        !state.runners.length &&
        !state.active &&
        (state.phase === 'idle' || state.phase === 'finish')
    ) {
        refreshLineupForVariant(state);
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
    state.racePlan = buildRacePlan(state.finishOrder);
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
    if (!st.runners.length || st.phase === 'finish' || !runnersMatchVariant(st)) {
        refreshLineupForVariant(st);
    }
    st.finishOrder = shuffleFinishOrder(st.runners);
    st.racePlan = buildRacePlan(st.finishOrder);
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
    state.racePlan = null;
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
    const podium =
        state.phase === 'finish' && state.finishOrder && state.finishOrder.length
            ? state.finishOrder.slice(0, 3).map((id, index) => {
                  const runner = state.runners.find((r) => r.id === id);
                  if (!runner) return null;
                  return {
                      place: index + 1,
                      id: runner.id,
                      number: runner.number,
                      name: runner.name,
                      silk: runner.silk
                  };
              }).filter(Boolean)
            : [];
    const lobby =
        !state.active &&
        state.runners.length > 0 &&
        (state.phase === 'idle' || state.phase === 'finish');
    return {
        active: state.active,
        lobby,
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
        raceStartAt: state.raceStartAt,
        racePlan:
            state.phase === 'racing' || state.phase === 'finish' ? state.racePlan : null,
        serverNow: now,
        winnerId: state.winnerId,
        winnerName: winner ? winner.name : null,
        winnerNumber: winner ? winner.number : null,
        podium
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
    skipCountdown,
    buildRacePlan,
    progressFromPlan
};
