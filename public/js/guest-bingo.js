/**
 * Mobile bingo play for guests at /event/:slug/bingo
 */
(function () {
    const slug = window.eventSlug;
    if (!slug) return;

    const guestSession = window.MdjGuestSession;
    const gamesList = document.getElementById('guestBingoGamesList');
    const joinPanel = document.getElementById('guestBingoJoin');
    const playPanel = document.getElementById('guestBingoPlay');
    const cardEl = document.getElementById('guestBingoCard');
    let activeGameId = window.guestBingoGameId || null;
    let pollTimer = null;

    function customerName() {
        return guestSession ? guestSession.getGuestName(slug) : sessionStorage.getItem('customerName') || '';
    }

    function deviceId() {
        return guestSession ? guestSession.deviceId() : null;
    }

    async function loadGames() {
        if (!gamesList) return;
        try {
            const res = await fetch('/api/event/' + encodeURIComponent(slug) + '/bingo/games');
            const data = await res.json();
            if (!data.enabled) {
                gamesList.innerHTML = '<p class="text-warning">Bingo is not enabled for this event.</p>';
                return;
            }
            if (!data.games.length) {
                gamesList.innerHTML = '<p class="text-muted">No games open yet — check back when the DJ opens join.</p>';
                return;
            }
            gamesList.innerHTML = data.games
                .map(function (g) {
                    const slots =
                        g.slotsRemaining > 0 ? g.slotsRemaining + ' cards left' : 'Full — ask the DJ';
                    return (
                        '<button type="button" class="guest-bingo-game-pick" data-game-id="' +
                        g.id +
                        '">' +
                        '<span class="guest-bingo-game-pick__title">' +
                        escapeHtml(g.title) +
                        '</span>' +
                        '<span class="guest-bingo-game-pick__meta">' +
                        escapeHtml(g.status.replace('_', ' ')) +
                        ' · ' +
                        slots +
                        '</span></button>'
                    );
                })
                .join('');
            gamesList.querySelectorAll('.guest-bingo-game-pick').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    joinGame(parseInt(btn.dataset.gameId, 10));
                });
            });
        } catch (e) {
            gamesList.innerHTML = '<p class="text-danger">Could not load games.</p>';
        }
    }

    async function joinGame(gameId) {
        const name = customerName();
        if (!name) {
            window.location.href = '/event/' + encodeURIComponent(slug) + '?edit=true';
            return;
        }
        try {
            const res = await fetch(
                '/api/event/' + encodeURIComponent(slug) + '/bingo/games/' + gameId + '/join',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customerName: name, deviceId: deviceId() })
                }
            );
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not join');
                return;
            }
            activeGameId = gameId;
            startPlay();
        } catch (e) {
            alert('Could not join game');
        }
    }

    function renderCard(grid, marks) {
        if (!cardEl || !grid) return;
        const headers = ['1–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–90'];
        let html = '<table class="guest-bingo-table"><thead><tr>';
        headers.forEach(function (h) {
            html += '<th>' + h + '</th>';
        });
        html += '</tr></thead><tbody>';
        for (let r = 0; r < 3; r++) {
            html += '<tr>';
            for (let c = 0; c < 9; c++) {
                const n = grid[r][c];
                const marked = marks && marks[r] && marks[r][c];
                if (n == null) {
                    html += '<td class="is-blank"></td>';
                } else {
                    html += '<td class="' + (marked ? 'is-marked' : '') + '">' + n + '</td>';
                }
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        cardEl.innerHTML = html;
    }

    async function refreshPlay() {
        const name = customerName();
        if (!activeGameId || !name) return;
        try {
            const dev = deviceId();
            const url =
                '/api/event/' +
                encodeURIComponent(slug) +
                '/bingo/games/' +
                activeGameId +
                '/play?customerName=' +
                encodeURIComponent(name) +
                '&deviceId=' +
                encodeURIComponent(dev || '');
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 404) {
                    joinPanel.hidden = false;
                    playPanel.hidden = true;
                    loadGames();
                }
                return;
            }
            joinPanel.hidden = true;
            playPanel.hidden = false;
            document.getElementById('guestBingoGameTitle').textContent = data.game.title;
            document.getElementById('guestBingoSerial').textContent = data.card.serial;
            document.getElementById('guestBingoLastBall').textContent =
                data.lastBall != null ? data.lastBall : '—';
            document.getElementById('guestBingoPlayingFor').textContent =
                'Playing for · ' + (data.playingForLabel || '');
            const meta = document.getElementById('guestBingoMeta');
            if (meta) {
                let t = data.active ? (data.paused ? 'Paused — claim check' : 'Live') : 'Waiting to start';
                if (data.phase === 'intro') t = 'Starting soon…';
                meta.textContent = t;
            }
            renderCard(data.card.grid, data.marks);
        } catch (e) {
            /* ignore transient */
        }
    }

    function startPlay() {
        refreshPlay();
        clearInterval(pollTimer);
        pollTimer = setInterval(refreshPlay, 2500);
    }

    document.querySelectorAll('.guest-bingo-claim').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            const name = customerName();
            const claimType = btn.getAttribute('data-claim');
            const resultEl = document.getElementById('guestBingoClaimResult');
            if (!activeGameId || !name) return;
            resultEl.textContent = 'Sending…';
            try {
                const res = await fetch(
                    '/api/event/' + encodeURIComponent(slug) + '/bingo/games/' + activeGameId + '/claim',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customerName: name,
                            claimType: claimType,
                            deviceId: deviceId()
                        })
                    }
                );
                const data = await res.json();
                resultEl.textContent = data.message || (data.valid ? 'Claim sent!' : 'Not yet');
                resultEl.className =
                    'guest-bingo-claim-result small ' + (data.valid ? 'text-success' : 'text-warning');
            } catch (e) {
                resultEl.textContent = 'Could not send claim';
            }
        });
    });

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    document.addEventListener('DOMContentLoaded', function () {
        const name = customerName();
        if (!name) {
            window.location.href = '/event/' + encodeURIComponent(slug) + '?edit=true';
            return;
        }
        if (guestSession && guestSession.registerCheckin) {
            guestSession.registerCheckin(name, slug);
        }
        if (activeGameId) {
            startPlay();
        } else {
            loadGames();
        }
    });
})();
