/**
 * Hi-Lo playing cards on the venue display.
 */
(function () {
    const slug = window.displayEventSlug;
    if (!slug) return;

    const layer = document.getElementById('hiloDisplayLayer');
    const currentSlot = document.getElementById('hiloCardCurrent');
    const previousSlot = document.getElementById('hiloCardPrevious');
    const streakEl = document.getElementById('hiloDisplayStreak');
    const metaEl = document.getElementById('hiloDisplayMeta');
    const resultBanner = document.getElementById('hiloResultBanner');
    const resultText = document.getElementById('hiloResultText');
    const waitingMessage = document.getElementById('waitingMessage');
    const qrOverlay = document.getElementById('qrOverlay');
    const controlPanel = document.getElementById('controlPanel');

    let pollTimer = null;
    let lastRevision = -1;

    const SUIT_SYM = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

    function hideUnderlays() {
        if (waitingMessage) waitingMessage.style.display = 'none';
        if (qrOverlay) qrOverlay.style.setProperty('display', 'none', 'important');
        if (controlPanel) controlPanel.style.setProperty('display', 'none', 'important');
    }

    function setActive(on) {
        document.body.classList.toggle('hilo-screen-active', on);
        if (layer) {
            layer.classList.toggle('active', on);
            layer.setAttribute('aria-hidden', on ? 'false' : 'true');
        }
        if (on) hideUnderlays();
    }

    function cardHtml(card, extraClass) {
        if (!card) return '';
        const red = card.suit === 'hearts' || card.suit === 'diamonds';
        const sym = SUIT_SYM[card.suit] || '';
        return (
            '<div class="hilo-playing-card' +
            (red ? ' hilo-playing-card--red' : ' hilo-playing-card--black') +
            (extraClass ? ' ' + extraClass : '') +
            '">' +
            '<span class="hilo-card-corner hilo-card-corner--tl"><span class="hilo-card-rank">' +
            card.rank +
            '</span><span class="hilo-card-suit">' +
            sym +
            '</span></span>' +
            '<span class="hilo-card-center" aria-hidden="true">' +
            sym +
            '</span>' +
            '<span class="hilo-card-corner hilo-card-corner--br"><span class="hilo-card-rank">' +
            card.rank +
            '</span><span class="hilo-card-suit">' +
            sym +
            '</span></span></div>'
        );
    }

    function renderState(state) {
        if (!state?.active) {
            setActive(false);
            return;
        }
        setActive(true);

        if (metaEl) {
            const ace = state.aceHigh ? 'Ace high' : 'Ace low';
            const ties = state.tiesWin ? ' · ties win' : '';
            metaEl.textContent = `${ace}${ties} · ${state.cardsLeft} cards left`;
        }
        if (streakEl) {
            streakEl.textContent = String(state.streak ?? 0);
        }

        if (currentSlot) {
            currentSlot.innerHTML = cardHtml(state.currentCard, 'hilo-playing-card--current');
        }
        if (previousSlot) {
            const showPrev = state.revealedCard && state.previousCard;
            previousSlot.innerHTML = showPrev
                ? cardHtml(state.previousCard, 'hilo-playing-card--previous')
                : '';
            previousSlot.classList.toggle('has-card', !!showPrev);
        }

        if (resultBanner && resultText) {
            const show =
                state.lastResult &&
                state.resultRemainingMs > 0 &&
                state.revealedCard;
            if (show) {
                const guess = state.lastGuess === 'higher' ? 'Higher' : 'Lower';
                const won = state.lastResult === 'win';
                resultBanner.hidden = false;
                resultBanner.classList.toggle('hilo-result--win', won);
                resultBanner.classList.toggle('hilo-result--lose', !won);
                resultText.textContent = won
                    ? `${guess} — correct!`
                    : `${guess} — wrong`;
            } else {
                resultBanner.hidden = true;
            }
        }

        if (state.revision !== lastRevision) lastRevision = state.revision;
    }

    async function pollState() {
        try {
            const res = await fetch('/api/display/' + encodeURIComponent(slug) + '/games/hilo/state');
            const state = await res.json();
            renderState(state);
        } catch (e) {
            /* ignore */
        }
    }

    pollTimer = setInterval(pollState, 400);
    pollState();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollTimer);
        } else {
            clearInterval(pollTimer);
            pollTimer = setInterval(pollState, 400);
            pollState();
        }
    });
})();
