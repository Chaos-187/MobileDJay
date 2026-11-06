/**
 * Full-screen bingo board on the event display.
 */
(function () {
    const slug = window.displayEventSlug;
    if (!slug) return;

    const layer = document.getElementById('bingoDisplayLayer');
    const gridEl = document.getElementById('bingoDisplayGrid');
    const lastBallEl = document.getElementById('bingoDisplayLastBall');
    const metaEl = document.getElementById('bingoDisplayMeta');
    const recentEl = document.getElementById('bingoDisplayRecent');
    const pausedBadge = document.getElementById('bingoDisplayPaused');
    const playingForEl = document.getElementById('bingoDisplayPlayingFor');
    const introStage = document.getElementById('bingoIntroStage');
    const introCountdown = document.getElementById('bingoIntroCountdown');
    const introPlayingFor = document.getElementById('bingoIntroPlayingFor');
    const introRing = document.getElementById('bingoIntroRing');
    const claimOverlay = document.getElementById('bingoClaimFlashOverlay');
    const claimTitle = document.getElementById('bingoClaimFlashTitle');
    const claimSub = document.getElementById('bingoClaimFlashSub');
    const claimCard = document.getElementById('bingoClaimFlashCard');
    const waitingMessage = document.getElementById('waitingMessage');
    const qrOverlay = document.getElementById('qrOverlay');
    const controlPanel = document.getElementById('controlPanel');

    const RING_LEN = 326.7;
    const cellByNumber = new Map();
    let gridBuiltFor = 0;
    let lastRevision = -1;
    let lastBallSeen = null;
    let calledSet = new Set();
    let claimHideTimer = null;
    let pollTimer = null;
    let tickTimer = null;
    let lastPlayingFor = null;
    let introEndsAtLocal = null;
    let introTotalSec = 30;
    let lastState = null;
    let gridResizeObserver = null;
    let gridColBreakpointMql = null;
    let lastSpokenBall = null;
    let prevVoiceCall = false;

    function getDisplayGridCols() {
        return window.matchMedia('(max-width: 900px)').matches ? 9 : 10;
    }

    function fitDisplayGrid() {
        if (!gridEl || !gridBuiltFor) return;
        const cols = getDisplayGridCols();
        const rows = Math.ceil(gridBuiltFor / cols);
        const w = gridEl.clientWidth;
        const h = gridEl.clientHeight;
        if (w < 16 || h < 16) return;
        const cs = window.getComputedStyle(gridEl);
        const gx = parseFloat(cs.columnGap) || 0;
        const gy = parseFloat(cs.rowGap) || gx || 0;
        const cellW = (w - gx * Math.max(0, cols - 1)) / cols;
        const cellH = (h - gy * Math.max(0, rows - 1)) / rows;
        const px = Math.max(7, Math.min(36, Math.min(cellW, cellH) * 0.36));
        const lastPx = Math.min(px * 1.08, px + 3);
        gridEl.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
        gridEl.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))';
        gridEl.style.setProperty('--bingo-display-cell-fs', px + 'px');
        gridEl.style.setProperty('--bingo-display-cell-fs-last', lastPx + 'px');
    }

    function bindDisplayGridFit() {
        if (!gridEl || typeof ResizeObserver === 'undefined') return;
        if (gridResizeObserver) gridResizeObserver.disconnect();
        gridResizeObserver = new ResizeObserver(function () {
            requestAnimationFrame(fitDisplayGrid);
        });
        gridResizeObserver.observe(gridEl);
        if (!gridColBreakpointMql) {
            gridColBreakpointMql = window.matchMedia('(max-width: 900px)');
            const onBp = function () {
                requestAnimationFrame(fitDisplayGrid);
            };
            if (gridColBreakpointMql.addEventListener) gridColBreakpointMql.addEventListener('change', onBp);
            else if (gridColBreakpointMql.addListener) gridColBreakpointMql.addListener(onBp);
        }
    }

    function buildGrid(ballCount) {
        if (!gridEl) return;
        gridEl.innerHTML = '';
        cellByNumber.clear();
        gridBuiltFor = ballCount;
        for (let n = 1; n <= ballCount; n++) {
            const cell = document.createElement('div');
            cell.className = 'bingo-fs-cell';
            cell.dataset.num = String(n);
            cell.innerHTML =
                '<span class="bingo-fs-cell-num">' +
                n +
                '</span><span class="bingo-fs-cell-check" aria-hidden="true"><i class="fas fa-check"></i></span>';
            gridEl.appendChild(cell);
            cellByNumber.set(n, cell);
        }
        bindDisplayGridFit();
        requestAnimationFrame(function () {
            requestAnimationFrame(fitDisplayGrid);
        });
    }

    function syncGrid(calledBalls, lastBall) {
        const nextSet = new Set(calledBalls || []);
        cellByNumber.forEach((cell, n) => {
            const was = calledSet.has(n);
            const is = nextSet.has(n);
            cell.classList.toggle('is-called', is);
            cell.classList.toggle('is-last', is && n === lastBall);
            if (is && !was) {
                cell.classList.remove('is-new');
                void cell.offsetWidth;
                cell.classList.add('is-new');
            }
            if (!is) cell.classList.remove('is-new', 'is-last');
        });
        calledSet = nextSet;
    }

    const CLAIM_TIER_PREFIX = 'claim-tier-';

    function applyClaimTierClasses(overlay, flash) {
        if (!overlay) return;
        const tiers = ['line', 'two-lines', 'house'];
        tiers.forEach(function (t) {
            overlay.classList.remove(CLAIM_TIER_PREFIX + t);
        });
        overlay.classList.remove('claim-invalid');
        const ct = flash.claimType;
        if (ct === 'two-lines') overlay.classList.add(CLAIM_TIER_PREFIX + 'two-lines');
        else if (ct === 'house') overlay.classList.add(CLAIM_TIER_PREFIX + 'house');
        else overlay.classList.add(CLAIM_TIER_PREFIX + 'line');
        if (flash.valid === false) overlay.classList.add('claim-invalid');
    }

    function claimFlashDurationMs(flash) {
        if (flash.valid === false) return 4200;
        if (flash.claimType === 'house') return 9000;
        if (flash.claimType === 'two-lines') return 7000;
        return 5500;
    }

    function showClaim(flash) {
        if (!flash || !claimOverlay) return;
        clearTimeout(claimHideTimer);
        claimTitle.textContent = flash.label || 'Bingo';
        let sub = '';
        if (flash.serial) sub += 'Serial ' + flash.serial;
        if (flash.valid === true) sub += (sub ? ' · ' : '') + 'Verified winner';
        if (flash.valid === false) sub += (sub ? ' · ' : '') + 'Not verified';
        if (!sub) sub = 'Calling paused';
        claimSub.textContent = sub;
        claimCard?.classList.toggle('invalid', flash.valid === false);
        applyClaimTierClasses(claimOverlay, flash);
        const badge = document.getElementById('bingoClaimFlashBadge');
        if (badge) {
            if (flash.valid === false) {
                badge.textContent = '';
            } else if (flash.claimType === 'house') {
                badge.textContent = '★ FULL HOUSE ★';
            } else if (flash.claimType === 'two-lines') {
                badge.textContent = '★★ TWO LINES ★★';
            } else {
                badge.textContent = '★ LINE ★';
            }
        }
        claimOverlay.classList.remove('show');
        void claimOverlay.offsetWidth;
        void claimCard?.offsetWidth;
        claimOverlay.classList.add('show');
        layer?.classList.add('claim-active');
        const hideMs = claimFlashDurationMs(flash);
        claimHideTimer = setTimeout(function () {
            claimOverlay.classList.remove('show');
            layer?.classList.remove('claim-active');
        }, hideMs);
    }

    function speakBallNumber(num) {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel();
        } catch (e) {
            /* ignore */
        }
        const u = new SpeechSynthesisUtterance('Number ' + num);
        u.lang = 'en-GB';
        u.rate = 0.92;
        u.pitch = 1;
        try {
            window.speechSynthesis.speak(u);
        } catch (e) {
            /* ignore */
        }
    }

    function maybeAnnounceBall(state) {
        if (!state.voiceCall) {
            lastSpokenBall = state.lastBall;
            return;
        }
        if (!state.active || state.phase === 'intro' || state.paused) {
            return;
        }
        if (state.lastBall == null) {
            return;
        }
        if (state.lastBall === lastSpokenBall) {
            return;
        }
        lastSpokenBall = state.lastBall;
        speakBallNumber(state.lastBall);
    }

    function hideUnderlays() {
        if (waitingMessage) waitingMessage.style.display = 'none';
        if (qrOverlay) qrOverlay.style.setProperty('display', 'none', 'important');
        if (controlPanel) controlPanel.style.setProperty('display', 'none', 'important');
    }

    function setFullscreenActive(on) {
        document.body.classList.toggle('bingo-screen-active', on);
        if (layer) {
            layer.classList.toggle('active', on);
            layer.setAttribute('aria-hidden', on ? 'false' : 'true');
        }
        if (on) hideUnderlays();
    }

    function updateIntroUI() {
        if (!lastState || lastState.phase !== 'intro' || !introEndsAtLocal) {
            introStage?.setAttribute('hidden', '');
            layer?.classList.remove('is-intro');
            return;
        }
        introStage?.removeAttribute('hidden');
        layer?.classList.add('is-intro');
        const remainingMs = Math.max(0, introEndsAtLocal - Date.now());
        const sec = Math.ceil(remainingMs / 1000);
        if (introCountdown) introCountdown.textContent = String(sec);
        if (introRing && introTotalSec > 0) {
            const progress = remainingMs / (introTotalSec * 1000);
            introRing.style.strokeDashoffset = String(RING_LEN * (1 - progress));
        }
        const pfLabel = lastState.playingForLabel || '1 Line';
        if (introPlayingFor) {
            introPlayingFor.textContent = 'Playing for · ' + pfLabel;
        }
    }

    function syncIntroFromState(state) {
        if (state.phase === 'intro') {
            if (state.introSeconds) introTotalSec = state.introSeconds;
            if (state.introRemainingMs != null) {
                introEndsAtLocal = Date.now() + state.introRemainingMs;
            }
        } else {
            introEndsAtLocal = null;
        }
        updateIntroUI();
    }

    function renderState(state) {
        lastState = state;
        if (state.voiceCall && !prevVoiceCall) {
            lastSpokenBall = state.lastBall;
        }
        prevVoiceCall = !!state.voiceCall;
        if (!state.active) {
            setFullscreenActive(false);
            lastPlayingFor = null;
            introEndsAtLocal = null;
            lastSpokenBall = null;
            prevVoiceCall = false;
            try {
                window.speechSynthesis?.cancel();
            } catch (e) {
                /* ignore */
            }
            introStage?.setAttribute('hidden', '');
            layer?.classList.remove('is-intro');
            return;
        }
        setFullscreenActive(true);
        syncIntroFromState(state);

        const ballCount = state.ballCount || 90;
        if (ballCount !== gridBuiltFor) buildGrid(ballCount);

        if (state.paused) {
            pausedBadge?.removeAttribute('hidden');
            layer?.classList.add('is-paused');
        } else {
            pausedBadge?.setAttribute('hidden', '');
            layer?.classList.remove('is-paused');
        }

        const pf = state.playingFor || 'line';
        const pfLabel = state.playingForLabel || '1 Line';
        if (playingForEl) {
            playingForEl.innerHTML =
                'Playing for · <span class="bingo-fs-playing-for-accent">' + pfLabel + '</span>';
            if (pf !== lastPlayingFor) {
                lastPlayingFor = pf;
                playingForEl.classList.remove('is-updated');
                void playingForEl.offsetWidth;
                playingForEl.classList.add('is-updated');
            }
        }

        if (state.phase === 'intro') {
            if (lastBallEl) lastBallEl.textContent = '—';
            if (metaEl) {
                metaEl.textContent = 'Starting in ' + (state.introRemainingSec || 0) + 's';
            }
        } else if (state.lastBall != null && state.lastBall !== lastBallSeen) {
            lastBallSeen = state.lastBall;
            if (lastBallEl) {
                lastBallEl.textContent = state.lastBall;
                lastBallEl.classList.remove('ball-pop');
                void lastBallEl.offsetWidth;
                lastBallEl.classList.add('ball-pop');
            }
            maybeAnnounceBall(state);
        } else if (state.lastBall == null && lastBallEl && state.phase !== 'intro') {
            lastBallEl.textContent = '—';
            lastBallEl.classList.remove('ball-pop');
        }

        if (metaEl && state.phase !== 'intro') {
            const n = (state.calledBalls || []).length;
            let text = n + ' of ' + ballCount + ' balls called';
            if (state.paused) text += ' · paused';
            else if (state.autoCall) text += ' · auto';
            if (state.voiceCall) text += ' · voice';
            metaEl.textContent = text;
        }

        syncGrid(state.calledBalls || [], state.lastBall);

        if (recentEl) {
            const recent = (state.calledBalls || []).slice(-8).reverse();
            recentEl.innerHTML = recent
                .map(function (n, i) {
                    return (
                        '<span class="bingo-fs-recent-ball' +
                        (i === 0 ? ' is-latest' : '') +
                        '">' +
                        n +
                        '</span>'
                    );
                })
                .join('');
        }

        if (state.revision !== lastRevision) {
            lastRevision = state.revision;
        }
    }

    async function pollState() {
        try {
            const res = await fetch(
                '/api/display/' + encodeURIComponent(slug) + '/games/bingo/state?consume=1'
            );
            const state = await res.json();
            renderState(state);
            if (state.claimFlash) showClaim(state.claimFlash);
        } catch (e) {
            /* ignore */
        }
    }

    buildGrid(90);
    pollTimer = setInterval(pollState, 700);
    tickTimer = setInterval(function () {
        if (lastState?.active && lastState.phase === 'intro') {
            updateIntroUI();
            if (introEndsAtLocal && Date.now() >= introEndsAtLocal) {
                pollState();
            }
        }
    }, 200);
    pollState();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            try {
                window.speechSynthesis?.cancel();
            } catch (e) {
                /* ignore */
            }
            clearInterval(pollTimer);
            clearInterval(tickTimer);
        } else {
            clearInterval(pollTimer);
            clearInterval(tickTimer);
            pollTimer = setInterval(pollState, 700);
            tickTimer = setInterval(function () {
                if (lastState?.active && lastState.phase === 'intro') updateIntroUI();
            }, 200);
            pollState();
        }
    });
})();
