/**
 * Shared guest bingo UI logic (standalone page + Guest Hub v2).
 */
(function (global) {
    'use strict';

    const AUTO_DAB_KEY = 'mdj_bingo_auto_dab';

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    function readAutoDab() {
        try {
            const v = localStorage.getItem(AUTO_DAB_KEY);
            if (v === '0') return false;
        } catch (e) {
            /* ignore */
        }
        return true;
    }

    function writeAutoDab(on) {
        try {
            localStorage.setItem(AUTO_DAB_KEY, on ? '1' : '0');
        } catch (e) {
            /* ignore */
        }
    }

    function emptyManualMarks() {
        return [
            [false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false]
        ];
    }

    const TOGO_CLASSES = [
        'guest-bingo-togo--ready',
        'guest-bingo-togo--1',
        'guest-bingo-togo--2',
        'guest-bingo-togo--3'
    ];

    function toGoTierClass(toGo) {
        const n = Number(toGo);
        if (n === 0) return 'guest-bingo-togo--ready';
        if (n === 1) return 'guest-bingo-togo--1';
        if (n === 2) return 'guest-bingo-togo--2';
        if (n >= 3) return 'guest-bingo-togo--3';
        return '';
    }

    function applyToGoClasses(el, toGo) {
        if (!el) return;
        TOGO_CLASSES.forEach((c) => el.classList.remove(c));
        const tier = toGoTierClass(toGo);
        if (tier) el.classList.add(tier);
    }

    function shortSerial(serial) {
        const s = String(serial || '');
        if (s.length <= 10) return s;
        return s.slice(0, 4) + '…' + s.slice(-4);
    }

    function formatAdvertisedStart(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return '';
        }
    }

    /**
     * @param {object} opts
     * @param {string} opts.slug
     * @param {() => string} opts.customerName
     * @param {() => string|null} opts.deviceId
     * @param {HTMLElement} opts.root — scope for querySelector (panel or document)
     * @param {number|null} [opts.initialGameId]
     */
    function createGuestBingoPlay(opts) {
        const slug = opts.slug;
        const root = opts.root || document;
        const q = (sel) => root.querySelector(sel);
        const qq = (sel) => root.querySelectorAll(sel);

        const els = {
            join: q('[data-bingo-join]'),
            play: q('[data-bingo-play]'),
            gamesList: q('[data-bingo-games-list]'),
            gameTitle: q('[data-bingo-game-title]'),
            meta: q('[data-bingo-meta]'),
            serial: q('[data-bingo-serial]'),
            cardWrap: q('[data-bingo-card-wrap]'),
            card: q('[data-bingo-card]'),
            lastBall: q('[data-bingo-last-ball]'),
            progress: q('[data-bingo-progress]'),
            playingFor: q('[data-bingo-playing-for]'),
            autoDab: q('[data-bingo-auto-dab]'),
            callBtn: q('[data-bingo-call]'),
            claimResult: q('[data-bingo-claim-result]'),
            paperSerial: q('[data-bingo-paper-serial]'),
            paperLinkBtn: q('[data-bingo-paper-link]'),
            cardPicks: q('[data-bingo-card-picks]'),
            togoBlock: q('[data-bingo-togo-block]'),
            grabAnother: q('[data-bingo-grab-another]'),
            backLobby: q('[data-bingo-back-lobby]')
        };

        const LOBBY_KEY = 'mdj_bingo_lobby_' + slug;

        function readLobbyPref() {
            try {
                return sessionStorage.getItem(LOBBY_KEY) === '1';
            } catch (e) {
                return false;
            }
        }

        function setLobbyPref(inLobby) {
            try {
                if (inLobby) sessionStorage.setItem(LOBBY_KEY, '1');
                else sessionStorage.removeItem(LOBBY_KEY);
            } catch (e) {
                /* ignore */
            }
        }

        let activeGameId = opts.initialGameId || null;
        let activeSerial = null;
        let pollTimer = null;
        let autoDab = readAutoDab();
        let manualMarks = emptyManualMarks();
        let lastGrid = null;
        let lastCalled = [];
        let playingFor = 'line';
        let cardMode = '';

        if (els.grabAnother) {
            els.grabAnother.addEventListener('click', function () {
                if (activeGameId) joinVirtual(activeGameId);
            });
        }

        if (els.backLobby) {
            els.backLobby.addEventListener('click', function () {
                backToLobby();
            });
        }

        if (els.autoDab) {
            els.autoDab.checked = autoDab;
            els.autoDab.addEventListener('change', function () {
                autoDab = !!els.autoDab.checked;
                writeAutoDab(autoDab);
                if (lastGrid) renderCard(lastGrid, lastCalled, null);
            });
        }

        function showJoin() {
            if (els.join) els.join.hidden = false;
            if (els.play) els.play.hidden = true;
        }

        function showPlay() {
            if (els.join) els.join.hidden = true;
            if (els.play) els.play.hidden = false;
            setLobbyPref(false);
        }

        function backToLobby() {
            stopPoll();
            setLobbyPref(true);
            if (els.claimResult) els.claimResult.textContent = '';
            showJoin();
            loadGames();
        }

        function renderCardPicks(guestCards, currentSerial) {
            if (!els.cardPicks) return;
            if (!guestCards || guestCards.length <= 1) {
                els.cardPicks.hidden = true;
                els.cardPicks.innerHTML = '';
                return;
            }
            els.cardPicks.hidden = false;
            els.cardPicks.innerHTML =
                '<p class="guest-bingo-card-picks__label">Your cards (closest first)</p>' +
                guestCards
                    .map(function (gc) {
                        const tier = toGoTierClass(gc.toGo);
                        const active = gc.serial === currentSerial ? ' is-active' : '';
                        const label =
                            gc.toGo === 0
                                ? 'Call!'
                                : gc.toGo === 1
                                  ? '1 to go'
                                  : gc.toGo + ' to go';
                        return (
                            '<button type="button" class="guest-bingo-card-pick ' +
                            tier +
                            active +
                            '" data-pick-serial="' +
                            escapeHtml(gc.serial) +
                            '">' +
                            '<span class="guest-bingo-card-pick__short">' +
                            escapeHtml(shortSerial(gc.serial)) +
                            '</span>' +
                            '<span class="guest-bingo-card-pick__togo">' +
                            escapeHtml(label) +
                            '</span></button>'
                        );
                    })
                    .join('');
            els.cardPicks.querySelectorAll('[data-pick-serial]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    activeSerial = btn.getAttribute('data-pick-serial');
                    manualMarks = emptyManualMarks();
                    refreshPlay();
                });
            });
        }

        function effectiveMarks(serverMarks) {
            if (autoDab && serverMarks) return serverMarks;
            if (!lastGrid) return serverMarks;
            return lastGrid.map((row, r) =>
                row.map((n, c) => {
                    if (n == null) return null;
                    if (autoDab && serverMarks && serverMarks[r]) return serverMarks[r][c];
                    return manualMarks[r][c];
                })
            );
        }

        function renderCard(grid, calledBalls, serverMarks) {
            if (!els.card || !grid) return;
            lastGrid = grid;
            lastCalled = calledBalls || [];
            const marks = effectiveMarks(serverMarks);
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
                        const called = lastCalled.indexOf(n) !== -1;
                        const dabClass = marked ? ' is-marked' : '';
                        const canTap = !autoDab ? ' guest-bingo-cell--manual' : '';
                        html +=
                            '<td class="' +
                            dabClass +
                            canTap +
                            '" data-cell-r="' +
                            r +
                            '" data-cell-c="' +
                            c +
                            '" data-ball="' +
                            n +
                            '">' +
                            (!autoDab && marked ? '<span class="guest-bingo-dab" aria-hidden="true"></span>' : '') +
                            '<span class="guest-bingo-num">' +
                            n +
                            '</span></td>';
                    }
                }
                html += '</tr>';
            }
            html += '</tbody></table>';
            els.card.innerHTML = html;
            if (!autoDab) {
                els.card.querySelectorAll('[data-cell-r]').forEach(function (td) {
                    td.addEventListener('click', function () {
                        const r = parseInt(td.getAttribute('data-cell-r'), 10);
                        const c = parseInt(td.getAttribute('data-cell-c'), 10);
                        const ball = parseInt(td.getAttribute('data-ball'), 10);
                        if (lastCalled.indexOf(ball) === -1) return;
                        manualMarks[r][c] = !manualMarks[r][c];
                        renderCard(lastGrid, lastCalled, null);
                    });
                });
            }
        }

        async function loadGames() {
            if (!els.gamesList) return;
            els.gamesList.innerHTML = '<p class="gh-bingo-muted">Loading games…</p>';
            try {
                const name = opts.customerName();
                const dev = opts.deviceId();
                let gamesUrl = '/api/event/' + encodeURIComponent(slug) + '/bingo/games';
                if (name && dev) {
                    gamesUrl +=
                        '?customerName=' +
                        encodeURIComponent(name) +
                        '&deviceId=' +
                        encodeURIComponent(dev);
                }
                const res = await fetch(gamesUrl);
                const data = await res.json();
                if (!data.enabled) {
                    els.gamesList.innerHTML = '<p class="gh-bingo-warn">Bingo is not enabled for this event.</p>';
                    return;
                }
                if (!data.games.length) {
                    els.gamesList.innerHTML =
                        '<p class="gh-bingo-muted">No games open yet — the DJ will open join when ready.</p>';
                    return;
                }
                els.gamesList.innerHTML = data.games
                    .map(function (g) {
                        const slots =
                            g.slotsRemaining > 0 ? g.slotsRemaining + ' virtual cards left' : 'Virtual cards full';
                        const startLine = g.advertisedStartAt
                            ? formatAdvertisedStart(g.advertisedStartAt) || g.advertisedStartAt
                            : '';
                        const hasCards = (g.guestCardCount || 0) > 0;
                        const tier = g.guestBestToGo != null ? toGoTierClass(g.guestBestToGo) : '';
                        const progressChip =
                            g.guestBestToGo != null
                                ? '<span class="guest-bingo-game-togo ' +
                                  tier +
                                  '">' +
                                  escapeHtml(g.guestBestLabel || g.guestBestToGo + ' to go') +
                                  '</span>'
                                : '';
                        const cta = hasCards
                            ? g.canGrabMore
                                ? 'Play · grab another card'
                                : 'Continue playing'
                            : 'Grab virtual card';
                        return (
                            '<div class="gh-bingo-game-block" data-bingo-game-block="' +
                            g.id +
                            '">' +
                            '<button type="button" class="gh-bingo-game-pick ' +
                            tier +
                            '" data-game-id="' +
                            g.id +
                            '" data-has-cards="' +
                            (hasCards ? '1' : '0') +
                            '">' +
                            '<span class="gh-bingo-game-pick__title">' +
                            escapeHtml(g.title) +
                            '</span>' +
                            '<span class="gh-bingo-game-pick__meta">' +
                            escapeHtml(String(g.status).replace('_', ' ')) +
                            ' · ' +
                            slots +
                            (startLine ? ' · Starts ' + escapeHtml(startLine) : '') +
                            '</span>' +
                            (progressChip ? '<span class="gh-bingo-game-pick__progress">' + progressChip + '</span>' : '') +
                            '<span class="gh-bingo-game-pick__cta"><i class="fas fa-mobile-screen me-1"></i>' +
                            escapeHtml(cta) +
                            '</span>' +
                            '</button>' +
                            '<div class="gh-bingo-paper-row">' +
                            '<input type="text" class="gh-input gh-bingo-serial-input" data-paper-for="' +
                            g.id +
                            '" placeholder="Paper serial" maxlength="32" autocomplete="off" inputmode="text">' +
                            '<button type="button" class="gh-btn gh-btn--outline gh-bingo-paper-btn" data-paper-link="' +
                            g.id +
                            '">Link paper</button>' +
                            '</div></div>'
                        );
                    })
                    .join('');

                els.gamesList.querySelectorAll('.gh-bingo-game-pick').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const gid = parseInt(btn.getAttribute('data-game-id'), 10);
                        if (btn.getAttribute('data-has-cards') === '1') {
                            activeGameId = gid;
                            activeSerial = null;
                            manualMarks = emptyManualMarks();
                            try {
                                sessionStorage.setItem('mdj_bingo_game_' + slug, String(gid));
                            } catch (err) {
                                /* ignore */
                            }
                            startPlay();
                        } else {
                            joinVirtual(gid);
                        }
                    });
                });
                els.gamesList.querySelectorAll('[data-paper-link]').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const gid = parseInt(btn.getAttribute('data-paper-link'), 10);
                        const input = els.gamesList.querySelector('[data-paper-for="' + gid + '"]');
                        linkPaper(gid, input ? input.value : '');
                    });
                });
            } catch (e) {
                els.gamesList.innerHTML = '<p class="gh-bingo-danger">Could not load games.</p>';
            }
        }

        async function joinVirtual(gameId) {
            const name = opts.customerName();
            if (!name) return { ok: false, error: 'name' };
            try {
                const res = await fetch(
                    '/api/event/' + encodeURIComponent(slug) + '/bingo/games/' + gameId + '/join',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ customerName: name, deviceId: opts.deviceId() })
                    }
                );
                const data = await res.json();
                if (!res.ok) {
                    return { ok: false, error: data.error || 'Could not join' };
                }
                activeGameId = gameId;
                activeSerial = data.serial || null;
                cardMode = 'virtual';
                manualMarks = emptyManualMarks();
                try {
                    sessionStorage.setItem('mdj_bingo_game_' + slug, String(gameId));
                } catch (err) {
                    /* ignore */
                }
                startPlay();
                return { ok: true };
            } catch (e) {
                return { ok: false, error: 'Could not join game' };
            }
        }

        async function linkPaper(gameId, serial) {
            const name = opts.customerName();
            if (!name) return { ok: false, error: 'name' };
            const trimmed = String(serial || '').trim();
            if (!trimmed) return { ok: false, error: 'Enter the serial printed on your card' };
            try {
                const res = await fetch(
                    '/api/event/' + encodeURIComponent(slug) + '/bingo/games/' + gameId + '/link-card',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customerName: name,
                            deviceId: opts.deviceId(),
                            serial: trimmed
                        })
                    }
                );
                const data = await res.json();
                if (!res.ok) {
                    return { ok: false, error: data.error || 'Could not link card' };
                }
                activeGameId = gameId;
                cardMode = 'paper';
                manualMarks = emptyManualMarks();
                try {
                    sessionStorage.setItem('mdj_bingo_game_' + slug, String(gameId));
                } catch (err) {
                    /* ignore */
                }
                startPlay();
                return { ok: true };
            } catch (e) {
                return { ok: false, error: 'Could not link card' };
            }
        }

        async function refreshPlay() {
            const name = opts.customerName();
            if (!activeGameId || !name) return;
            try {
                let url =
                    '/api/event/' +
                    encodeURIComponent(slug) +
                    '/bingo/games/' +
                    activeGameId +
                    '/play?customerName=' +
                    encodeURIComponent(name) +
                    '&deviceId=' +
                    encodeURIComponent(opts.deviceId() || '');
                if (activeSerial) {
                    url += '&serial=' + encodeURIComponent(activeSerial);
                }
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 404) {
                        stopPoll();
                        showJoin();
                        loadGames();
                    }
                    return;
                }
                showPlay();
                playingFor = data.playingFor || 'line';
                if (els.gameTitle) els.gameTitle.textContent = data.game.title;
                if (els.serial) {
                    const mode =
                        cardMode === 'paper'
                            ? 'Paper · '
                            : cardMode === 'virtual'
                              ? 'Virtual · '
                              : '';
                    els.serial.textContent = mode + data.card.serial;
                }
                if (els.lastBall) els.lastBall.textContent = data.lastBall != null ? data.lastBall : '—';
                if (els.playingFor)
                    els.playingFor.textContent = 'Playing for · ' + (data.playingForLabel || '');
                activeSerial = data.card && data.card.serial ? data.card.serial : activeSerial;
                renderCardPicks(data.guestCards, activeSerial);
                if (els.grabAnother) {
                    els.grabAnother.hidden = !data.canGrabMore;
                }
                if (els.progress) {
                    const p = data.progress;
                    if (p && p.label) {
                        els.progress.textContent = p.label;
                        els.progress.dataset.toGo = String(p.toGo);
                    } else {
                        els.progress.textContent = '—';
                        delete els.progress.dataset.toGo;
                    }
                }
                const toGo = data.progress ? Number(data.progress.toGo) : NaN;
                applyToGoClasses(els.togoBlock, toGo);
                applyToGoClasses(els.cardWrap, toGo);
                if (els.callBtn && toGo === 0) {
                    els.callBtn.classList.add('guest-bingo-call--ready');
                } else if (els.callBtn) {
                    els.callBtn.classList.remove('guest-bingo-call--ready');
                }
                if (els.meta) {
                    let t = data.active ? (data.paused ? 'Paused' : 'Live') : 'Waiting to start';
                    if (data.paused) {
                        t =
                            data.pausedReason === 'manual'
                                ? 'Paused — game on hold'
                                : 'Paused — claim check';
                    }
                    if (data.phase === 'intro') t = 'Starting soon…';
                    els.meta.textContent = t;
                }
                if (els.callBtn) {
                    const label = data.playingForLabel || 'prize';
                    els.callBtn.textContent = 'Call — ' + label;
                    els.callBtn.disabled = !data.active || !!data.paused;
                }
                renderCard(data.card.grid, data.calledBalls, data.marks);
            } catch (e) {
                /* ignore transient */
            }
        }

        function startPlay() {
            showPlay();
            refreshPlay();
            startPoll();
        }

        function startPoll() {
            clearInterval(pollTimer);
            pollTimer = setInterval(refreshPlay, 2200);
        }

        function stopPoll() {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        async function sendClaim(claimType) {
            const name = opts.customerName();
            const resultEl = els.claimResult;
            if (!activeGameId || !name) return;
            if (resultEl) resultEl.textContent = 'Sending…';
            try {
                const res = await fetch(
                    '/api/event/' +
                        encodeURIComponent(slug) +
                        '/bingo/games/' +
                        activeGameId +
                        '/claim',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customerName: name,
                            claimType: claimType || playingFor,
                            deviceId: opts.deviceId(),
                            serial: activeSerial
                        })
                    }
                );
                const data = await res.json();
                if (resultEl) {
                    resultEl.textContent =
                        data.message || (data.valid ? 'Claim sent to the DJ!' : 'Not yet — keep dabbing');
                    resultEl.className =
                        (resultEl.classList.contains('guest-bingo-claim-result')
                            ? 'guest-bingo-claim-result '
                            : 'gh-bingo-claim-result ') + (data.valid ? 'is-ok' : 'is-warn');
                }
                if (data.verified) {
                    refreshPlay();
                }
            } catch (e) {
                if (resultEl) resultEl.textContent = 'Could not send claim';
            }
        }

        if (els.callBtn) {
            els.callBtn.addEventListener('click', function () {
                sendClaim(playingFor);
            });
        }

        qq('[data-bingo-claim]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                sendClaim(btn.getAttribute('data-claim'));
            });
        });

        if (els.paperLinkBtn && els.paperSerial) {
            els.paperLinkBtn.addEventListener('click', function () {
                if (!activeGameId) return;
                linkPaper(activeGameId, els.paperSerial.value).then(function (r) {
                    if (!r.ok && r.error) alert(r.error);
                });
            });
        }

        return {
            loadGames,
            joinVirtual,
            linkPaper,
            startPlay,
            startPoll,
            stopPoll,
            refreshPlay,
            getActiveGameId: function () {
                return activeGameId;
            },
            setActiveGameId: function (id) {
                activeGameId = id;
            },
            showJoin,
            showPlay,
            backToLobby,
            prefersLobby: readLobbyPref
        };
    }

    global.MdjGuestBingoPlay = {
        create: createGuestBingoPlay,
        escapeHtml
    };
})(typeof window !== 'undefined' ? window : global);