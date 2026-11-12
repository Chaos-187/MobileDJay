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
    const loseOverlay = document.getElementById('hiloLoseOverlay');
    const loseSub = document.getElementById('hiloLoseSub');
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

    function cardHtml(card) {
        if (!card) return '';
        const red = card.suit === 'hearts' || card.suit === 'diamonds';
        const sym = SUIT_SYM[card.suit] || '';
        return (
            '<div class="hilo-playing-card' +
            (red ? ' hilo-playing-card--red' : ' hilo-playing-card--black') +
            '" data-card-id="' +
            (card.id || '') +
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

    function mountCard(slot, card, animate) {
        if (!slot) return;
        if (!card) {
            slot.innerHTML = '';
            return;
        }
        const cardId = card.id || card.rank + '-' + card.suit;
        const existing = slot.querySelector('.hilo-playing-card');
        if (existing && existing.getAttribute('data-card-id') === cardId) {
            return;
        }
        slot.innerHTML = cardHtml(card);
        if (animate) {
            const el = slot.querySelector('.hilo-playing-card');
            if (el) {
                el.classList.add('hilo-playing-card--pop');
                el.addEventListener(
                    'animationend',
                    function () {
                        el.classList.remove('hilo-playing-card--pop');
                    },
                    { once: true }
                );
            }
        }
    }

    function renderState(state) {
        const showLayer = !!state?.active;
        if (!showLayer) {
            setActive(false);
            return;
        }
        setActive(true);

        const gameOver = !!state.gameOver;

        if (layer) layer.classList.toggle('hilo--game-over', gameOver);

        if (metaEl) {
            if (gameOver) {
                metaEl.textContent = 'Game over — waiting for a new game';
            } else {
                const ace = state.aceHigh ? 'Ace high' : 'Ace low';
                const ties = state.tiesWin ? ' · ties win' : '';
                metaEl.textContent = `${ace}${ties} · ${state.cardsLeft} cards left`;
            }
        }
        if (streakEl) {
            streakEl.textContent = gameOver ? String(state.streakAtLoss ?? 0) : String(state.streak ?? 0);
        }

        const animateCurrent = state.revision !== lastRevision && !gameOver;
        mountCard(currentSlot, state.currentCard, animateCurrent);

        if (previousSlot) {
            const showPrev = (state.revealedCard && state.previousCard) || gameOver;
            if (showPrev && state.previousCard) {
                mountCard(previousSlot, state.previousCard, false);
            } else {
                previousSlot.innerHTML = '';
            }
            previousSlot.classList.toggle('has-card', showPrev && !!state.previousCard);
        }

        if (loseOverlay) {
            loseOverlay.hidden = !gameOver;
        }
        if (loseSub && gameOver) {
            const n = state.streakAtLoss ?? 0;
            const guess = state.lastGuess === 'higher' ? 'Higher' : 'Lower';
            loseSub.textContent =
                n > 0
                    ? `You called ${guess} — streak ended at ${n}. DJ: start a new game.`
                    : `Wrong call (${guess}). DJ: start a new game.`;
        }

        if (resultBanner && resultText) {
            const showWin =
                !gameOver &&
                state.lastResult === 'win' &&
                state.resultRemainingMs > 0 &&
                state.revealedCard;
            if (showWin) {
                const guess = state.lastGuess === 'higher' ? 'Higher' : 'Lower';
                resultBanner.hidden = false;
                resultBanner.classList.add('hilo-result--win');
                resultBanner.classList.remove('hilo-result--lose');
                resultText.textContent = `${guess} — correct!`;
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

    pollTimer = setInterval(pollState, 800);
    pollState();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollTimer);
        } else {
            clearInterval(pollTimer);
            pollTimer = setInterval(pollState, 800);
            pollState();
        }
    });
})();
