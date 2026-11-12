/**
 * Virtual horse / dog racing on the venue display.
 */
(function () {
    const slug = window.displayEventSlug;
    if (!slug) return;

    const layer = document.getElementById('racingDisplayLayer');
    const titleEl = document.getElementById('racingDisplayTitle');
    const metaEl = document.getElementById('racingDisplayMeta');
    const eyebrowEl = document.querySelector('.racing-fs-eyebrow');
    const trackEl = document.getElementById('racingDisplayTrack');
    const trackScene = document.getElementById('racingTrackScene');
    const countdownStage = document.getElementById('racingCountdownStage');
    const countdownNum = document.getElementById('racingCountdownNum');
    const lobbyStage = document.getElementById('racingLobbyStage');
    const lobbyGrid = document.getElementById('racingLobbyGrid');
    const lobbyHeadline = document.getElementById('racingLobbyHeadline');
    const winnerOverlay = document.getElementById('racingWinnerOverlay');
    const winnerSub = document.getElementById('racingWinnerSub');
    const winnerHeadline = document.getElementById('racingWinnerHeadline');
    const podiumStage = document.getElementById('racingPodiumStage');
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
                return a.p + (b.p - a.p) * u;
            }
        }
        return kf[kf.length - 1].p;
    }

    const displayProgress = new Map();

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
        displayProgress.clear();
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

    const PODIUM_LABELS = { 1: '1st', 2: '2nd', 3: '3rd' };
    const PODIUM_ORDER = [2, 1, 3];

    function renderPodium(state) {
        if (!podiumStage) return;
        const rows = (state.podium && state.podium.length
            ? state.podium
            : state.winnerName
              ? [
                    {
                        place: 1,
                        number: state.winnerNumber,
                        name: state.winnerName,
                        silk: '#fbbf24'
                    }
                ]
              : []
        ).slice(0, 3);
        if (!rows.length) {
            podiumStage.innerHTML = '';
            return;
        }
        const byPlace = {};
        rows.forEach((r) => {
            byPlace[r.place] = r;
        });
        const glyph = runnerGlyph(state.variant);
        let html = '';
        PODIUM_ORDER.forEach((place) => {
            const r = byPlace[place];
            if (!r) return;
            html +=
                '<div class="racing-podium-col racing-podium-col--place-' +
                place +
                '" role="listitem">' +
                '<div class="racing-podium-block">' +
                '<span class="racing-podium-rank">' +
                escapeHtml(PODIUM_LABELS[place] || place) +
                '</span>' +
                '<span class="racing-podium-glyph" aria-hidden="true">' +
                glyph +
                '</span>' +
                '<span class="racing-podium-silk" style="background:' +
                escapeHtml(r.silk || '#64748b') +
                '"></span>' +
                '<span class="racing-podium-num">#' +
                escapeHtml(String(r.number ?? '?')) +
                '</span>' +
                '<span class="racing-podium-name">' +
                escapeHtml(r.name) +
                '</span>' +
                '</div></div>';
        });
        podiumStage.innerHTML = html;
    }

    function updatePositions(progressList, smooth) {
        const maxPct = 86;
        let lead = 0;
        progressList.forEach(function (item) {
            const target = Math.max(0, Math.min(1, Number(item.progress) || 0));
            let pct = target;
            if (smooth) {
                const prev = displayProgress.has(item.id) ? displayProgress.get(item.id) : target;
                pct = Math.max(prev, prev + (target - prev) * 0.35);
            }
            displayProgress.set(item.id, pct);
            item._displayPct = pct;
            lead = Math.max(lead, pct);
        });
        if (layer) layer.style.setProperty('--race-energy', String(lead));

        const sorted = progressList.slice().sort((a, b) => a._displayPct - b._displayPct);
        sorted.forEach(function (item, z) {
            const el = runnerEls.get(item.id);
            const lane = laneEls.get(item.id);
            if (!el) return;
            const pct = item._displayPct;
            el.style.setProperty('--race-pct', String(pct));
            el.style.transform =
                'translate3d(calc(' + pct * maxPct + 'vw - 0px), -50%, 0)';
            el.classList.toggle('racing-runner--lead', z === sorted.length - 1);
            el.classList.toggle('racing-runner--sprint', pct > 0.05);
            if (lane) lane.style.zIndex = String(10 + z);
        });
    }

    function renderLobby(state) {
        const runners = state.runners || [];
        const variant = state.variant || 'horse';
        const isDog = variant === 'dog';
        if (lobbyHeadline) {
            lobbyHeadline.textContent =
                runners.length + ' runner' + (runners.length === 1 ? '' : 's') + ' · Next race soon';
        }
        if (!lobbyGrid) return;
        const glyph = runnerGlyph(variant);
        lobbyGrid.innerHTML = runners
            .map(function (r) {
                return (
                    '<article class="racing-lobby-card" role="listitem">' +
                    '<span class="racing-lobby-card__num">#' +
                    escapeHtml(String(r.number ?? '')) +
                    '</span>' +
                    '<span class="racing-lobby-card__silk" style="background:' +
                    escapeHtml(r.silk || '#64748b') +
                    '"></span>' +
                    '<span class="racing-lobby-card__glyph" aria-hidden="true">' +
                    glyph +
                    '</span>' +
                    '<span class="racing-lobby-card__name">' +
                    escapeHtml(r.name) +
                    '</span>' +
                    '</article>'
                );
            })
            .join('');
        if (titleEl) {
            titleEl.textContent = isDog ? 'Virtual greyhound racing' : 'Virtual horse racing';
        }
        if (eyebrowEl) {
            eyebrowEl.innerHTML = isDog
                ? '<i class="fas fa-dog me-2"></i>Lobby · runners on screen'
                : '<i class="fas fa-horse me-2"></i>Lobby · runners on screen';
        }
        if (metaEl) metaEl.textContent = 'Waiting for the start — good luck!';
    }

    function renderState(state) {
        lastState = state;
        if (state.serverNow) {
            clockSkewMs = Date.now() - state.serverNow;
        }
        const lobbyMode = !!state.lobby;
        if (!state.active && !lobbyMode) {
            setFullscreenActive(false);
            countdownStage?.setAttribute('hidden', '');
            winnerOverlay?.setAttribute('hidden', '');
            lobbyStage?.setAttribute('hidden', '');
            if (layer) {
                layer.classList.remove('racing-variant-dog', 'racing-variant-horse', 'racing-lobby-mode');
            }
            if (trackScene) trackScene.removeAttribute('hidden');
            return;
        }
        setFullscreenActive(true);
        const isDog = state.variant === 'dog';
        if (layer) {
            layer.classList.toggle('racing-variant-dog', isDog);
            layer.classList.toggle('racing-variant-horse', !isDog);
            layer.classList.toggle('racing-lobby-mode', lobbyMode);
        }

        if (lobbyMode) {
            countdownStage?.setAttribute('hidden', '');
            winnerOverlay?.setAttribute('hidden', '');
            if (trackScene) trackScene.setAttribute('hidden', '');
            lobbyStage?.removeAttribute('hidden');
            renderLobby(state);
            return;
        }

        lobbyStage?.setAttribute('hidden', '');
        if (trackScene) trackScene.removeAttribute('hidden');
        if (titleEl) {
            titleEl.textContent =
                state.variantLabel || (isDog ? 'Virtual greyhound racing' : 'Virtual horse racing');
        }
        if (eyebrowEl) {
            eyebrowEl.innerHTML = isDog
                ? '<i class="fas fa-dog me-2"></i>Greyhound racing · live on screen'
                : '<i class="fas fa-horse me-2"></i>Horse racing · live on screen';
        }
        if (metaEl) {
            if (state.phase === 'countdown') metaEl.textContent = 'Under starter’s orders…';
            else if (state.phase === 'racing') metaEl.textContent = 'And they’re off!';
            else if (state.phase === 'finish') metaEl.textContent = 'Photo finish';
            else metaEl.textContent = 'Ready to race';
        }
        ensureLanes(state.runners || [], state.variant);
        updatePositions(liveProgressForState(state), false);

        if (state.phase === 'countdown') {
            winnerOverlay?.setAttribute('hidden', '');
            countdownStage?.removeAttribute('hidden');
            const sec = Math.ceil((state.countdownRemainingMs || 0) / 1000);
            if (countdownNum) countdownNum.textContent = sec > 0 ? String(sec) : 'Go!';
        } else {
            countdownStage?.setAttribute('hidden', '');
        }

        if (state.phase === 'finish' && (state.podium?.length || state.winnerName)) {
            winnerOverlay?.removeAttribute('hidden');
            if (winnerSub) {
                winnerSub.textContent =
                    state.variant === 'dog' ? 'Greyhounds over the line' : 'They’re past the post!';
            }
            if (winnerHeadline) {
                winnerHeadline.textContent =
                    state.variant === 'dog' ? 'Race result' : 'Photo finish';
            }
            renderPodium(state);
        } else if (state.phase !== 'finish') {
            winnerOverlay?.setAttribute('hidden', '');
        }

        if (state.revision !== lastRevision) lastRevision = state.revision;
    }

    function tick() {
        if (lastState?.active && (lastState.phase === 'racing' || lastState.phase === 'finish')) {
            updatePositions(liveProgressForState(lastState), true);
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
