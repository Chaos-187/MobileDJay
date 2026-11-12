/**
 * DJ dashboard — Hi-Lo card game.
 */
(function () {
    const panel = document.getElementById('gamePanelHilo');
    if (!panel) return;

    const els = {
        status: document.getElementById('hiloRunStatus'),
        streak: document.getElementById('hiloStreak'),
        best: document.getElementById('hiloBestStreak'),
        cardsLeft: document.getElementById('hiloCardsLeft'),
        preview: document.getElementById('hiloCardPreview'),
        aceHigh: document.getElementById('hiloAceHigh'),
        tiesWin: document.getElementById('hiloTiesWin'),
        lastResult: document.getElementById('hiloLastResult')
    };

    let pollTimer = null;

    function slug() {
        return typeof window.mdjGetPromptTargetSlug === 'function' ? window.mdjGetPromptTargetSlug() : null;
    }

    function suitSymbol(suit) {
        const map = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
        return map[suit] || '';
    }

    function renderCardPreview(card) {
        if (!els.preview) return;
        if (!card) {
            els.preview.innerHTML = '<span class="text-muted">—</span>';
            return;
        }
        const red = card.suit === 'hearts' || card.suit === 'diamonds';
        els.preview.innerHTML =
            '<span class="mdj-hilo-mini-card' +
            (red ? ' is-red' : '') +
            '"><span class="mdj-hilo-mini-rank">' +
            card.rank +
            '</span><span class="mdj-hilo-mini-suit">' +
            suitSymbol(card.suit) +
            '</span></span>';
    }

    async function api(method, path, body) {
        const s = slug();
        if (!s) {
            alert('Select an event first.');
            return null;
        }
        const res = await mdjFetch('/api/display/' + encodeURIComponent(s) + path, {
            method: method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        return res.json();
    }

    function syncButtons(state) {
        const hasSlug = !!slug();
        const active = !!state?.active;
        const gameOver = !!state?.gameOver;
        const playing = active && !gameOver;
        const canGuess = playing && (state?.cardsLeft || 0) > 0;
        const set = (id, prop, val) => {
            const el = document.getElementById(id);
            if (el) el[prop] = val;
        };
        set('hiloStartBtn', 'disabled', !hasSlug || playing);
        set('hiloStopBtn', 'disabled', !hasSlug || !active);
        set('hiloNewDeckBtn', 'disabled', !hasSlug || playing);
        set('hiloHigherBtn', 'disabled', !hasSlug || !canGuess);
        set('hiloLowerBtn', 'disabled', !hasSlug || !canGuess);
        set('hiloSaveConfigBtn', 'disabled', !hasSlug || active);
        if (els.aceHigh) els.aceHigh.disabled = active;
        if (els.tiesWin) els.tiesWin.disabled = active;
    }

    function statusBadge(state) {
        if (!els.status) return;
        if (state?.gameOver) {
            els.status.textContent = 'Game over';
            els.status.className = 'badge bg-danger mdj-bingo-status-pill';
            return;
        }
        if (!state?.active) {
            els.status.textContent = 'Idle';
            els.status.className = 'badge bg-secondary mdj-bingo-status-pill';
            return;
        }
        els.status.textContent = 'Live on display';
        els.status.className = 'badge bg-success mdj-bingo-status-pill';
    }

    function renderLastResult(state) {
        if (!els.lastResult) return;
        if (state?.gameOver) {
            els.lastResult.textContent = 'Game over — tap Start for a new game.';
            els.lastResult.className = 'small text-danger mb-0 fw-semibold';
            return;
        }
        if (!state?.lastResult || !state.lastGuess) {
            els.lastResult.textContent = '';
            els.lastResult.className = 'small text-muted mb-0';
            return;
        }
        const word = state.lastResult === 'win' ? 'Correct' : 'Wrong';
        const guess = state.lastGuess === 'higher' ? 'Higher' : 'Lower';
        els.lastResult.textContent = `${word} — called ${guess}`;
        els.lastResult.className =
            state.lastResult === 'win' ? 'small text-success mb-0' : 'small text-danger mb-0';
    }

    function renderStatus(state) {
        statusBadge(state);
        syncButtons(state);
        if (els.streak) els.streak.textContent = String(state?.streak ?? 0);
        if (els.best) els.best.textContent = String(state?.bestStreak ?? 0);
        if (els.cardsLeft) els.cardsLeft.textContent = String(state?.cardsLeft ?? 0);
        if (state?.aceHigh != null && els.aceHigh) els.aceHigh.checked = !!state.aceHigh;
        if (state?.tiesWin != null && els.tiesWin) els.tiesWin.checked = !!state.tiesWin;
        renderCardPreview(state?.currentCard);
        renderLastResult(state);
    }

    function configBody() {
        return {
            aceHigh: !!els.aceHigh?.checked,
            tiesWin: !!els.tiesWin?.checked
        };
    }

    async function fetchState() {
        const s = slug();
        if (!s) {
            renderStatus({ active: false });
            return;
        }
        try {
            const res = await fetch('/api/display/' + encodeURIComponent(s) + '/games/hilo/state');
            const state = await res.json();
            renderStatus(state);
        } catch (e) {
            console.error('Hi-Lo state fetch failed', e);
        }
    }

    document.getElementById('hiloStartBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/hilo/start', configBody());
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('hiloStopBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/hilo/stop');
        if (data?.success) renderStatus(data.state);
    });

    document.getElementById('hiloNewDeckBtn')?.addEventListener('click', async () => {
        const data = await api('POST', '/games/hilo/new-deck');
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('hiloSaveConfigBtn')?.addEventListener('click', async () => {
        const data = await api('PUT', '/games/hilo/config', configBody());
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    async function guess(choice) {
        const data = await api('POST', '/games/hilo/guess', { guess: choice });
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    }

    document.getElementById('hiloHigherBtn')?.addEventListener('click', () => guess('higher'));
    document.getElementById('hiloLowerBtn')?.addEventListener('click', () => guess('lower'));

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(fetchState, 1500);
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
        if (kind === 'hilo') {
            fetchState();
            startPoll();
        } else if (!panel.hidden) {
            /* still on games tab but other kind */
        } else {
            stopPoll();
        }
    });
})();
