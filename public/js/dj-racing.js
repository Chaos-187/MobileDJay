/**
 * DJ dashboard — virtual horse & dog racing controls.
 */
(function () {
    const panel = document.getElementById('gamePanelRacing');
    if (!panel) return;

    const els = {
        status: document.getElementById('racingRunStatus'),
        runnerCount: document.getElementById('racingRunnerCount'),
        countdown: document.getElementById('racingCountdownSec'),
        raceDuration: document.getElementById('racingDurationSec'),
        lineup: document.getElementById('racingLineupList'),
        skipBtn: document.getElementById('racingSkipCountdownBtn')
    };

    let pollTimer = null;
    let currentVariant = 'horse';

    function slug() {
        return typeof window.mdjGetPromptTargetSlug === 'function' ? window.mdjGetPromptTargetSlug() : null;
    }

    function variantFromKind(kind) {
        return kind === 'dog' ? 'dog' : 'horse';
    }

    function setVariant(kind) {
        currentVariant = variantFromKind(kind);
        panel.dataset.variant = currentVariant;
        const title = document.getElementById('racingPanelTitle');
        if (title) {
            title.textContent = currentVariant === 'dog' ? 'Virtual dogs' : 'Virtual horses';
        }
    }

    window.mdjRacingSetVariant = setVariant;

    async function api(method, path, body) {
        const s = slug();
        if (!s) {
            alert('Select an event first.');
            return null;
        }
        const res = await mdjFetch('/api/display/' + encodeURIComponent(s) + path, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        return res.json();
    }

    function renderLineup(state) {
        if (!els.lineup) return;
        const runners = state?.runners || [];
        if (!runners.length) {
            els.lineup.innerHTML = '<p class="text-muted small mb-0">Tap <strong>New lineup</strong> to draw runners.</p>';
            return;
        }
        els.lineup.innerHTML = runners
            .map(
                (r) =>
                    '<div class="mdj-racing-lineup-row">' +
                    '<span><span class="mdj-racing-lineup-swatch" style="background:' +
                    r.silk +
                    '"></span>' +
                    r.number +
                    '. ' +
                    escapeHtml(r.name) +
                    '</span></div>'
            )
            .join('');
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    function statusBadge(state) {
        if (!els.status) return;
        if (!state?.active) {
            els.status.textContent = 'Idle';
            els.status.className = 'badge bg-secondary mdj-bingo-status-pill';
            return;
        }
        const phase = state.phase || 'idle';
        const labels = {
            countdown: 'Countdown',
            racing: 'Racing',
            finish: 'Finished'
        };
        els.status.textContent = labels[phase] || 'Live';
        els.status.className =
            phase === 'racing'
                ? 'badge bg-success mdj-bingo-status-pill'
                : phase === 'finish'
                  ? 'badge bg-warning text-dark mdj-bingo-status-pill'
                  : 'badge bg-info text-dark mdj-bingo-status-pill';
    }

    function syncButtons(state) {
        const hasSlug = !!slug();
        const phase = state?.phase;
        const active = !!state?.active;
        const set = (id, prop, val) => {
            const el = document.getElementById(id);
            if (el) el[prop] = val;
        };
        set('racingStartBtn', 'disabled', !hasSlug || phase === 'countdown' || phase === 'racing');
        set('racingStopBtn', 'disabled', !hasSlug || !active);
        set('racingNewLineupBtn', 'disabled', !hasSlug || phase === 'countdown' || phase === 'racing');
        set('racingApplyConfigBtn', 'disabled', !hasSlug || phase === 'countdown' || phase === 'racing');
        if (els.skipBtn) {
            els.skipBtn.hidden = phase !== 'countdown';
        }
    }

    function renderStatus(state) {
        statusBadge(state);
        syncButtons(state);
        if (state?.runnerCount && els.runnerCount) els.runnerCount.value = state.runnerCount;
        if (state?.countdownSeconds != null && els.countdown) els.countdown.value = state.countdownSeconds;
        if (state?.raceDurationMs && els.raceDuration) {
            els.raceDuration.value = Math.round(state.raceDurationMs / 1000);
        }
        if (state?.variant) currentVariant = state.variant;
        renderLineup(state);
    }

    function configBody() {
        return {
            variant: currentVariant,
            runnerCount: Number(els.runnerCount?.value) || 6,
            countdownSeconds: Number(els.countdown?.value) || 5,
            raceDurationSeconds: Number(els.raceDuration?.value) || 14
        };
    }

    async function fetchState() {
        const s = slug();
        if (!s) {
            renderStatus({ active: false });
            return;
        }
        try {
            const res = await fetch('/api/display/' + encodeURIComponent(s) + '/games/racing/state');
            const state = await res.json();
            renderStatus(state);
        } catch (e) {
            console.error('Racing state fetch failed', e);
        }
    }

    document.getElementById('racingNewLineupBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/racing/lineup', { variant: currentVariant });
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('racingApplyConfigBtn')?.addEventListener('click', async () => {
        const data = await api('PUT', '/games/racing/config', configBody());
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('racingStartBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/racing/start', configBody());
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('racingStopBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/racing/stop');
        if (data?.success) renderStatus(data.state);
    });

    document.getElementById('racingSkipCountdownBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/racing/skip-countdown');
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(fetchState, 2000);
    }

    function stopPoll() {
        clearInterval(pollTimer);
    }

    document.getElementById('games-tab')?.addEventListener('shown.bs.tab', () => {
        if (!panel.hidden) {
            fetchState();
            startPoll();
        }
    });

    document.getElementById('games-tab')?.addEventListener('hidden.bs.tab', stopPoll);

    window.addEventListener('mdj-dashboard-event-changed', fetchState);

    window.addEventListener('mdj-games-kind-changed', function (ev) {
        const kind = ev.detail && ev.detail.kind;
        if (kind === 'horse' || kind === 'dog') {
            setVariant(kind);
            fetchState();
            startPoll();
        } else {
            stopPoll();
        }
    });
})();
