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
    const trackScene = document.getElementById('racingTrackScene');
    const countdownStage = document.getElementById('racingCountdownStage');
    const countdownNum = document.getElementById('racingCountdownNum');
    const winnerOverlay = document.getElementById('racingWinnerOverlay');
    const winnerTitle = document.getElementById('racingWinnerTitle');
    const winnerSub = document.getElementById('racingWinnerSub');
    const waitingMessage = document.getElementById('waitingMessage');
    const qrOverlay = document.getElementById('qrOverlay');
    const controlPanel = document.getElementById('controlPanel');

    let pollTimer = null;
    let animFrame = null;
    let lastRevision = -1;
    let lastState = null;
    let runnerEls = new Map();
    let laneEls = new Map();
    let clockSkewMs = 0;

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
                const ease = u * u * (3 - 2 * u);
                return a.p + (b.p - a.p) * ease;
            }
        }
        return kf[kf.length - 1].p;
    }

    function liveProgressForState(state) {
        if (!state || !state.runners) return [];
        if (state.phase !== 'racing' && state.phase !== 'finish') {
            return state.runners.map((r) => ({ id: r.id, progress: 0 }));
        }
        if (!state.racePlan || !state.raceStartAt) {
            return state.runners.map((r) => ({ id: r.id, progress: Number(r.progress) || 0 }));
        }
        const now = Date.now() - clockSkewMs;
        const dur = state.raceDurationMs || 14000;
        const elapsed = Math.max(0, now - state.raceStartAt);
        const t = state.phase === 'finish' ? 1 : Math.min(1, elapsed / dur);
        return state.runners.map((r) => ({
            id: r.id,
            progress: progressFromPlan(state.racePlan[r.id], t)
        }));
    }

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
        if (on) startAnimLoop();
        else stopAnimLoop();
    }

    function runnerGlyph(variant) {
        return variant === 'dog' ? '🐕' : '🏇';
    }

    function ensureLanes(runners, variant) {
        if (!trackEl) return;
        const sig = runners.map((r) => r.id).join('|');
        if (trackEl.dataset.sig === sig && trackEl.dataset.variant === variant) {
            return;
        }
        trackEl.innerHTML = '';
        trackEl.dataset.sig = sig;
        trackEl.dataset.variant = variant;
        runnerEls.clear();
        laneEls.clear();
        runners.forEach(function (r, index) {
            const lane = document.createElement('div');
            lane.className = 'racing-lane';
            lane.dataset.runnerId = r.id;
            lane.style.setProperty('--lane-i', String(index));
            lane.innerHTML =
                '<span class="racing-lane__label">' +
                r.number +
                '</span>' +
                '<div class="racing-lane__track-line" aria-hidden="true"></div>' +
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
                '<span class="racing-runner__dust" aria-hidden="true"></span>' +
                '</div>';
            trackEl.appendChild(lane);
            laneEls.set(r.id, lane);
            runnerEls.set(r.id, lane.querySelector('.racing-runner'));
        });
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    function updatePositions(progressList) {
        const maxPct = 86;
        let lead = 0;
        progressList.forEach(function (item) {
            lead = Math.max(lead, item.progress || 0);
        });
        if (layer) layer.style.setProperty('--race-energy', String(lead));

        const sorted = progressList.slice().sort((a, b) => a.progress - b.progress);
        sorted.forEach(function (item, z) {
            const el = runnerEls.get(item.id);
            const lane = laneEls.get(item.id);
            if (!el) return;
            const pct = Math.max(0, Math.min(1, Number(item.progress) || 0));
            el.style.setProperty('--race-pct', String(pct));
            el.style.transform = 'translateY(-50%) translateX(calc(' + pct * maxPct + 'vw))';
            el.classList.toggle('racing-runner--lead', z === sorted.length - 1);
            el.classList.toggle('racing-runner--sprint', pct > 0.05);
            if (lane) lane.style.zIndex = String(10 + z);
        });
    }

    function renderState(state) {
        lastState = state;
        if (state.serverNow) {
            clockSkewMs = Date.now() - state.serverNow;
        }
        if (!state.active) {
            setFullscreenActive(false);
            countdownStage?.setAttribute('hidden', '');
            winnerOverlay?.setAttribute('hidden', '');
            if (layer) {
                layer.classList.remove('racing-variant-dog', 'racing-variant-horse');
            }
            return;
        }
        setFullscreenActive(true);
        if (layer) {
            layer.classList.toggle('racing-variant-dog', state.variant === 'dog');
            layer.classList.toggle('racing-variant-horse', state.variant !== 'dog');
        }
        if (titleEl) titleEl.textContent = state.variantLabel || 'Virtual racing';
        if (metaEl) {
            if (state.phase === 'countdown') metaEl.textContent = 'Under starter’s orders…';
            else if (state.phase === 'racing') metaEl.textContent = 'And they’re off!';
            else if (state.phase === 'finish') metaEl.textContent = 'Photo finish';
            else metaEl.textContent = 'Ready to race';
        }
        ensureLanes(state.runners || [], state.variant);
        updatePositions(liveProgressForState(state));

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

    function tick() {
        if (lastState?.active && (lastState.phase === 'racing' || lastState.phase === 'finish')) {
            updatePositions(liveProgressForState(lastState));
        }
        animFrame = requestAnimationFrame(tick);
    }

    function startAnimLoop() {
        if (animFrame != null) return;
        animFrame = requestAnimationFrame(tick);
    }

    function stopAnimLoop() {
        if (animFrame != null) cancelAnimationFrame(animFrame);
        animFrame = null;
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

    pollTimer = setInterval(pollState, 250);
    pollState();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollTimer);
            stopAnimLoop();
        } else {
            clearInterval(pollTimer);
            pollTimer = setInterval(pollState, 250);
            pollState();
            if (lastState?.active) startAnimLoop();
        }
    });
})();
