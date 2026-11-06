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
        claimOverlay.classList.add('show');
        layer?.classList.add('claim-active');
        claimHideTimer = setTimeout(function () {
            claimOverlay.classList.remove('show');
            layer?.classList.remove('claim-active');
        }, 5500);
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
        if (!state.active) {
            setFullscreenActive(false);
            lastPlayingFor = null;
            introEndsAtLocal = null;
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
        } else if (state.lastBall == null && lastBallEl && state.phase !== 'intro') {
            lastBallEl.textContent = '—';
            lastBallEl.classList.remove('ball-pop');
        }

        if (metaEl && state.phase !== 'intro') {
            const n = (state.calledBalls || []).length;
            let text = n + ' of ' + ballCount + ' balls called';
            if (state.paused) text += ' · paused';
            else if (state.autoCall) text += ' · auto';
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
