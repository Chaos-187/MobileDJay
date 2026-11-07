/**
 * Virtual horse / dog racing on the venue display.
 */
(function () {
    const slug = window.displayEventSlug;
    if (!slug) return;

    const layer = document.getElementById('racingDisplayLayer');
    const titleEl = document.getElementById('racingDisplayTitle');
    const metaEl = document.getElementById('racingDisplayMeta');
    const trackEl = document.getElementById('racingDisplayTrack');
    const countdownStage = document.getElementById('racingCountdownStage');
    const countdownNum = document.getElementById('racingCountdownNum');
    const winnerOverlay = document.getElementById('racingWinnerOverlay');
    const winnerTitle = document.getElementById('racingWinnerTitle');
    const winnerSub = document.getElementById('racingWinnerSub');
    const waitingMessage = document.getElementById('waitingMessage');
    const qrOverlay = document.getElementById('qrOverlay');
    const controlPanel = document.getElementById('controlPanel');

    let pollTimer = null;
    let lastRevision = -1;
    let lastState = null;
    let runnerEls = new Map();

    function hideUnderlays() {
        if (waitingMessage) waitingMessage.style.display = 'none';
        if (qrOverlay) qrOverlay.style.setProperty('display', 'none', 'important');
        if (controlPanel) controlPanel.style.setProperty('display', 'none', 'important');
    }

    function setFullscreenActive(on) {
        document.body.classList.toggle('racing-screen-active', on);
        if (layer) {
            layer.classList.toggle('active', on);
            layer.setAttribute('aria-hidden', on ? 'false' : 'true');
        }
        if (on) hideUnderlays();
    }

    function runnerGlyph(variant) {
        return variant === 'dog' ? '🐕' : '🏇';
    }

    function ensureLanes(runners, variant) {
        if (!trackEl) return;
        if (runnerEls.size === runners.length && trackEl.dataset.variant === variant) {
            return;
        }
        trackEl.innerHTML = '';
        trackEl.dataset.variant = variant;
        runnerEls.clear();
        runners.forEach(function (r) {
            const lane = document.createElement('div');
            lane.className = 'racing-lane';
            lane.dataset.runnerId = r.id;
            lane.innerHTML =
                '<span class="racing-lane__label">' +
                r.number +
                '</span>' +
                '<div class="racing-runner">' +
                '<span class="racing-runner__silk" style="background:' +
                r.silk +
                '"></span>' +
                '<span class="racing-runner__glyph">' +
                runnerGlyph(variant) +
                '</span>' +
                '<span class="racing-runner__name">' +
                escapeHtml(r.name) +
                '</span>' +
                '</div>';
            trackEl.appendChild(lane);
            runnerEls.set(r.id, lane.querySelector('.racing-runner'));
        });
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    function updatePositions(runners) {
        runners.forEach(function (r) {
            const el = runnerEls.get(r.id);
            if (!el) return;
            const pct = Math.max(0, Math.min(1, Number(r.progress) || 0));
            const maxLeft = 78;
            el.style.left = pct * maxLeft + '%';
        });
    }

    function renderState(state) {
        lastState = state;
        if (!state.active) {
            setFullscreenActive(false);
            countdownStage?.setAttribute('hidden', '');
            winnerOverlay?.setAttribute('hidden', '');
            return;
        }
        setFullscreenActive(true);
        if (titleEl) titleEl.textContent = state.variantLabel || 'Virtual racing';
        if (metaEl) {
            if (state.phase === 'countdown') metaEl.textContent = 'Under starter’s orders…';
            else if (state.phase === 'racing') metaEl.textContent = 'And they’re off!';
            else if (state.phase === 'finish') metaEl.textContent = 'Photo finish';
            else metaEl.textContent = 'Ready to race';
        }
        ensureLanes(state.runners || [], state.variant);
        updatePositions(state.runners || []);

        if (state.phase === 'countdown') {
            winnerOverlay?.setAttribute('hidden', '');
            countdownStage?.removeAttribute('hidden');
            const sec = Math.ceil((state.countdownRemainingMs || 0) / 1000);
            if (countdownNum) countdownNum.textContent = sec > 0 ? String(sec) : 'Go!';
        } else {
            countdownStage?.setAttribute('hidden', '');
        }

        if (state.phase === 'finish' && state.winnerName) {
            winnerOverlay?.removeAttribute('hidden');
            if (winnerTitle) {
                winnerTitle.textContent = '#' + (state.winnerNumber || '?') + ' ' + state.winnerName;
            }
            if (winnerSub) {
                winnerSub.textContent = state.variant === 'dog' ? 'Winner!' : 'Winner by a nose!';
            }
        } else if (state.phase !== 'finish') {
            winnerOverlay?.setAttribute('hidden', '');
        }

        if (state.revision !== lastRevision) lastRevision = state.revision;
    }

    async function pollState() {
        try {
            const res = await fetch(
                '/api/display/' + encodeURIComponent(slug) + '/games/racing/state'
            );
            const state = await res.json();
            renderState(state);
        } catch (e) {
            /* ignore */
        }
    }

    pollTimer = setInterval(pollState, 350);
    pollState();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollTimer);
        } else {
            clearInterval(pollTimer);
            pollTimer = setInterval(pollState, 350);
            pollState();
        }
    });
})();
