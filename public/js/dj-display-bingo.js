/**
 * Bingo overlay on the event display — polls game state from the server.
 */
(function () {
    const slug = window.displayEventSlug;
    if (!slug) return;

    const layer = document.getElementById('bingoDisplayLayer');
    const lastBallEl = document.getElementById('bingoDisplayLastBall');
    const metaEl = document.getElementById('bingoDisplayMeta');
    const recentEl = document.getElementById('bingoDisplayRecent');
    const claimOverlay = document.getElementById('bingoClaimFlashOverlay');
    const claimTitle = document.getElementById('bingoClaimFlashTitle');
    const claimSub = document.getElementById('bingoClaimFlashSub');
    const claimCard = document.getElementById('bingoClaimFlashCard');

    let lastRevision = -1;
    let lastBallSeen = null;
    let claimHideTimer = null;
    let pollTimer = null;

    function showClaim(flash) {
        if (!flash || !claimOverlay) return;
        clearTimeout(claimHideTimer);
        const label = flash.label || 'Bingo';
        claimTitle.textContent = label;
        let sub = '';
        if (flash.serial) sub += `Serial ${flash.serial}`;
        if (flash.valid === true) sub += (sub ? ' · ' : '') + 'Verified winner';
        if (flash.valid === false) sub += (sub ? ' · ' : '') + 'Not verified';
        claimSub.textContent = sub;
        claimCard?.classList.toggle('invalid', flash.valid === false);
        claimOverlay.classList.add('show');
        claimHideTimer = setTimeout(() => {
            claimOverlay.classList.remove('show');
        }, 4500);
    }

    function renderState(state) {
        if (!state.active) {
            layer?.classList.remove('active');
            return;
        }
        layer?.classList.add('active');

        if (state.lastBall != null && state.lastBall !== lastBallSeen) {
            lastBallSeen = state.lastBall;
            if (lastBallEl) {
                lastBallEl.textContent = state.lastBall;
                lastBallEl.style.animation = 'none';
                void lastBallEl.offsetWidth;
                lastBallEl.style.animation = '';
            }
        } else if (state.lastBall == null && lastBallEl) {
            lastBallEl.textContent = '—';
        }

        if (metaEl) {
            const n = (state.calledBalls || []).length;
            metaEl.textContent = `${n} of ${state.ballCount} balls called`;
        }

        if (recentEl) {
            const recent = (state.calledBalls || []).slice(-12).reverse();
            recentEl.innerHTML = recent
                .map((n) => `<span>${n}</span>`)
                .join('');
        }

        if (state.revision !== lastRevision) {
            lastRevision = state.revision;
        }
    }

    async function pollState() {
        try {
            const res = await fetch(
                `/api/display/${encodeURIComponent(slug)}/games/bingo/state?consume=1`
            );
            const state = await res.json();
            renderState(state);
            if (state.claimFlash) showClaim(state.claimFlash);
        } catch (e) {
            /* ignore */
        }
    }

    pollTimer = setInterval(pollState, 800);
    pollState();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(pollTimer);
        } else {
            clearInterval(pollTimer);
            pollTimer = setInterval(pollState, 800);
            pollState();
        }
    });
})();
