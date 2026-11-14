/**
 * Shared guest bingo UI logic (standalone page + Guest Hub v2).
 */
(function (global) {
    'use strict';

    const AUTO_DAB_KEY = 'mdj_bingo_auto_dab';
    const CALLER_SOUND_KEY = 'mdj_bingo_caller_sound';
    const GUEST_INTRO_RING_LEN = 326.7;

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

    function readCallerSound() {
        try {
            const v = localStorage.getItem(CALLER_SOUND_KEY);
            if (v === '0') return false;
        } catch (e) {
            /* ignore */
        }
        return true;
    }

    function writeCallerSound(on) {
        try {
            localStorage.setItem(CALLER_SOUND_KEY, on ? '1' : '0');
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

    function compactToGoLabel(p) {
        if (!p || p.toGo == null) return '—';
        const n = Number(p.toGo);
        if (n === 0) return 'Call!';
        if (n === 1) return '1 to go';
        return n + ' to go';
    }

    function tgSpineLabel(toGo) {
        const n = Number(toGo);
        if (n === 0) return 'WIN';
        if (n === 1) return '1TG';
        if (n === 2) return '2TG';
        if (n === 3) return '3TG';
        return n + 'TG';
    }

    function tgSpineClass(toGo) {
        const n = Number(toGo);
        if (n === 0) return 'guest-bingo-tg-spine--win';
        if (n === 1) return 'guest-bingo-tg-spine--1';
        if (n === 2) return 'guest-bingo-tg-spine--2';
        if (n === 3) return 'guest-bingo-tg-spine--3';
        return 'guest-bingo-tg-spine--far';
    }

    function renderRecentBalls(trackEl, calledBalls, opts) {
        if (!trackEl) return;
        const list = calledBalls || [];
        const recent = list.slice(-8);
        if (!recent.length) {
            trackEl.innerHTML = '<span class="guest-bingo-recent-empty">—</span>';
            return;
        }
        trackEl.innerHTML = recent
            .map(function (n, i) {
                const isLatest = i === recent.length - 1;
                return (
                    '<span class="guest-bingo-callball' +
                    (isLatest ? ' guest-bingo-callball--latest' : '') +
                    '"' +
                    (isLatest ? ' aria-current="true"' : '') +
                    '>' +
                    escapeHtml(String(n)) +
                    '</span>'
                );
            })
            .join('');
        if (opts && opts.progressEl && opts.calledCount != null && opts.ballCount) {
            opts.progressEl.hidden = false;
            opts.progressEl.textContent = opts.calledCount + '/' + opts.ballCount;
        } else if (opts && opts.progressEl) {
            opts.progressEl.hidden = true;
        }
    }

    function renderPrizeBar(barEl, playingFor, prizeWinners) {
        if (!barEl) return;
        const chips = [
            { id: 'line', label: '1 Line' },
            { id: 'two-lines', label: '2 Lines' },
            { id: 'house', label: 'House' }
        ];
        const pf = String(playingFor || 'line');
        const winners = prizeWinners || {};
        barEl.innerHTML = chips
            .map(function (c) {
                const w = winners[c.id];
                const winnerLine = w
                    ? '<span class="guest-bingo-prize-winner" title="Winner">' + escapeHtml(w) + '</span>'
                    : '<span class="guest-bingo-prize-winner guest-bingo-prize-winner--empty" aria-hidden="true"></span>';
                return (
                    '<div class="guest-bingo-prize-col' +
                    (pf === c.id ? ' is-active' : '') +
                    '">' +
                    '<span class="guest-bingo-prize-chip' +
                    (pf === c.id ? ' is-active' : '') +
                    '">' +
                    escapeHtml(c.label) +
                    '</span>' +
                    winnerLine +
                    '</div>'
                );
            })
            .join('');
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
            lastBall: q('[data-bingo-last-ball]'),
            playingFor: q('[data-bingo-playing-for]'),
            autoDab: q('[data-bingo-auto-dab]'),
            callerSound: q('[data-bingo-caller-sound]'),
            callBtn: q('[data-bingo-call]'),
            claimResult: q('[data-bingo-claim-result]'),
            paperSerial: q('[data-bingo-paper-serial]'),
            paperLinkBtn: q('[data-bingo-paper-link]'),
            recentBalls: q('[data-bingo-recent-balls]'),
            callProgress: q('[data-bingo-call-progress]'),
            prizeBar: q('[data-bingo-prize-bar]'),
            cardStack: q('[data-bingo-cards-stack]'),
            grabAnother: q('[data-bingo-grab-another]'),
            backLobby: q('[data-bingo-back-lobby]'),
            intro: q('[data-bingo-intro]'),
            introPrize: q('[data-bingo-intro-prize]'),
            introSec: q('[data-bingo-intro-sec]'),
            introRing: q('[data-bingo-intro-ring]')
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
        let callerSoundOn = readCallerSound();
        const manualMarksBySerial = Object.create(null);
        let lastStackPayload = null;
        let playingFor = 'line';
        let cardMode = '';
        let cardOrderSerials = [];
        const selfVerifiedTiers = new Set();
        let claimInFlight = false;
        let lastSpokenBall = null;
        let introEndsAtLocal = null;
        let introTotalSec = 30;
        let introTickTimer = null;

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
                if (!autoDab) {
                    cardOrderSerials = (lastStackPayload && lastStackPayload.cards
                        ? lastStackPayload.cards.map((c) => c.serial)
                        : cardOrderSerials);
                }
                if (lastStackPayload) {
                    const ordered = stabilizeCardOrder(lastStackPayload.cards);
                    lastStackPayload.cards = ordered;
                    renderCardStack(ordered, lastStackPayload.calledBalls, activeSerial);
                }
            });
        }

        if (els.callerSound) {
            els.callerSound.checked = callerSoundOn;
            els.callerSound.addEventListener('change', function () {
                callerSoundOn = !!els.callerSound.checked;
                writeCallerSound(callerSoundOn);
            });
        }

        function stabilizeCardOrder(cards) {
            const list = cards || [];
            if (!list.length) return list;
            if (autoDab) {
                return list.slice().sort(function (a, b) {
                    const aToGo = Number(
                        a.progress && a.progress.toGo != null ? a.progress.toGo : a.toGo != null ? a.toGo : 999
                    );
                    const bToGo = Number(
                        b.progress && b.progress.toGo != null ? b.progress.toGo : b.toGo != null ? b.toGo : 999
                    );
                    if (aToGo !== bToGo) return aToGo - bToGo;
                    return (a.assignOrder || 0) - (b.assignOrder || 0);
                });
            }
            list.forEach(function (c) {
                if (c.serial && cardOrderSerials.indexOf(c.serial) === -1) {
                    cardOrderSerials.push(c.serial);
                }
            });
            cardOrderSerials = cardOrderSerials.filter(function (s) {
                return list.some((c) => c.serial === s);
            });
            const bySerial = Object.create(null);
            list.forEach(function (c) {
                bySerial[c.serial] = c;
            });
            return cardOrderSerials.map(function (s) {
                return bySerial[s];
            }).filter(Boolean);
        }

        function speakBallNumber(num) {
            if (global.MdjBingoCallerVoice && typeof global.MdjBingoCallerVoice.speak === 'function') {
                global.MdjBingoCallerVoice.speak(num);
            }
        }

        function maybeAnnounceBall(data) {
            if (!callerSoundOn || !data) return;
            if (!data.active || data.phase === 'intro' || data.paused) return;
            if (data.lastBall == null) return;
            if (data.lastBall === lastSpokenBall) return;
            lastSpokenBall = data.lastBall;
            speakBallNumber(data.lastBall);
        }

        function stopIntroTick() {
            if (introTickTimer) {
                clearInterval(introTickTimer);
                introTickTimer = null;
            }
        }

        function ensureIntroTick() {
            if (introTickTimer) return;
            introTickTimer = setInterval(function () {
                if (!introEndsAtLocal) {
                    stopIntroTick();
                    return;
                }
                if (lastStackPayload && lastStackPayload.data) {
                    paintGuestIntro(lastStackPayload.data);
                }
            }, 350);
        }

        function setPlayIntroMode(on) {
            if (els.play) els.play.classList.toggle('guest-bingo--intro', !!on);
            if (els.intro) {
                if (on) els.intro.removeAttribute('hidden');
                else els.intro.setAttribute('hidden', '');
            }
        }

        function paintGuestIntro(data) {
            if (!els.intro || !introEndsAtLocal) return;
            const remainingMs = Math.max(0, introEndsAtLocal - Date.now());
            const sec = Math.ceil(remainingMs / 1000);
            if (els.introSec) els.introSec.textContent = String(sec);
            if (els.introRing && introTotalSec > 0) {
                const progress = remainingMs / (introTotalSec * 1000);
                els.introRing.style.strokeDashoffset = String(GUEST_INTRO_RING_LEN * (1 - progress));
            }
            if (els.introPrize) {
                els.introPrize.textContent =
                    'Playing for · ' + (data.playingForLabel || data.playingFor || '1 Line');
            }
        }

        function syncGuestIntro(data) {
            const showIntro = !!(data && data.active && data.phase === 'intro');
            if (showIntro) {
                if (data.introSeconds) introTotalSec = data.introSeconds;
                if (data.introRemainingMs != null) {
                    introEndsAtLocal = Date.now() + data.introRemainingMs;
                }
                setPlayIntroMode(true);
                paintGuestIntro(data);
                ensureIntroTick();
            } else {
                introEndsAtLocal = null;
                stopIntroTick();
                setPlayIntroMode(false);
            }
        }

        function claimCardSerial(cards) {
            const list = cards && cards.length ? cards : [];
            if (!list.length) return activeSerial;
            if (autoDab) {
                const ready = list.find(function (c) {
                    const t = Number(c.progress && c.progress.toGo != null ? c.progress.toGo : c.toGo);
                    return t === 0;
                });
                if (ready) return ready.serial;
                return list[0].serial;
            }
            const focused = list.find(function (c) {
                return c.serial === activeSerial;
            });
            return focused ? focused.serial : list[0].serial;
        }

        function syncCallButtonDisabled(data) {
            if (!els.callBtn) return;
            const pf = data.playingFor || playingFor || 'line';
            const tierVerified = selfVerifiedTiers.has(pf);
            const baseDisabled = !data.active || claimInFlight || tierVerified;
            els.callBtn.disabled = baseDisabled;
            qq('[data-bingo-claim]').forEach(function (btn) {
                const ct = btn.getAttribute('data-claim');
                btn.disabled = baseDisabled || ct !== pf;
            });
        }

        function manualMarksFor(serial) {
            const key = String(serial || '');
            if (!manualMarksBySerial[key]) manualMarksBySerial[key] = emptyManualMarks();
            return manualMarksBySerial[key];
        }

        function serialAttrEsc(serial) {
            const s = String(serial || '');
            return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        }

        function marksForCard(item) {
            if (autoDab && item.marks) return item.marks;
            if (!item.grid) return item.marks;
            const manual = manualMarksFor(item.serial);
            return item.grid.map((row, r) =>
                row.map((n, c) => {
                    if (n == null) return null;
                    return manual[r][c];
                })
            );
        }

        function buildCardTableHtml(grid, marks, calledBalls) {
            const called = calledBalls || [];
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
            return html;
        }

        function updateCallUi(cards, focusSerial, data) {
            const item = (cards || []).find((c) => c.serial === focusSerial) || (cards || [])[0];
            if (!item || !els.callBtn) return;
            const claimSerial = claimCardSerial(cards);
            const claimItem =
                (cards || []).find(function (c) {
                    return c.serial === claimSerial;
                }) || item;
            const toGo = Number(
                claimItem.progress ? claimItem.progress.toGo : claimItem.toGo
            );
            if (toGo === 0 && data.active && !els.callBtn.disabled) {
                els.callBtn.classList.add('guest-bingo-call--ready');
            } else {
                els.callBtn.classList.remove('guest-bingo-call--ready');
            }
            syncCallButtonDisabled(data);
        }

        function renderCardStack(allCards, calledBalls, focusSerial) {
            if (!els.cardStack) return;
            const cards = allCards && allCards.length ? allCards : [];
            if (!cards.length) {
                els.cardStack.innerHTML = '<p class="gh-bingo-muted guest-bingo-stack-empty">No card loaded.</p>';
                return;
            }
            let focus = focusSerial;
            if (!focus || !cards.some((c) => c.serial === focus)) {
                focus = cards[0].serial;
            }
            activeSerial = focus;
            const modeLabel =
                cardMode === 'paper' ? 'Paper' : cardMode === 'virtual' ? 'Virtual' : '';

            els.cardStack.innerHTML = cards
                .map(function (item) {
                    const toGoN = item.progress ? item.progress.toGo : item.toGo;
                    const tier = toGoTierClass(toGoN);
                    const isActive = item.serial === focus;
                    const prog = item.progress || { toGo: item.toGo, label: item.progressLabel };
                    const spineClass = tgSpineClass(toGoN);
                    const spineLabel = tgSpineLabel(toGoN);
                    return (
                        '<article class="guest-bingo-ticket guest-bingo-card-wrap guest-bingo-card-wrap--stacked ' +
                        tier +
                        (isActive ? ' is-active-card' : '') +
                        '" data-bingo-card-wrap data-card-serial="' +
                        escapeHtml(item.serial) +
                        '">' +
                        '<div class="guest-bingo-ticket__body">' +
                        '<p class="guest-bingo-ticket__serial" title="' +
                        escapeHtml(item.serial) +
                        '">' +
                        (modeLabel ? '<span class="guest-bingo-ticket__mode">' + escapeHtml(modeLabel) + '</span> ' : '') +
                        escapeHtml(shortSerial(item.serial)) +
                        '</p>' +
                        '<div class="guest-bingo-ticket__grid guest-bingo-card-grid gh-bingo-card" data-bingo-card-grid data-card-serial="' +
                        escapeHtml(item.serial) +
                        '" aria-label="Bingo card"></div>' +
                        '</div>' +
                        '<div class="guest-bingo-tg-spine ' +
                        spineClass +
                        '" title="' +
                        escapeHtml(prog.label || '') +
                        '" aria-label="' +
                        escapeHtml(prog.label || spineLabel) +
                        '">' +
                        '<span class="guest-bingo-tg-spine__text">' +
                        escapeHtml(spineLabel) +
                        '</span></div>' +
                        '</article>'
                    );
                })
                .join('');

            cards.forEach(function (item) {
                const gridEl = els.cardStack.querySelector(
                    '[data-bingo-card-grid][data-card-serial="' + serialAttrEsc(item.serial) + '"]'
                );
                if (!gridEl || !item.grid) return;
                const marks = marksForCard(item);
                gridEl.innerHTML = buildCardTableHtml(item.grid, marks, calledBalls);
                if (!autoDab) wireManualCells(gridEl, item, calledBalls);
            });

            els.cardStack.querySelectorAll('[data-bingo-card-wrap]').forEach(function (wrap) {
                wrap.addEventListener('click', function (e) {
                    if (e.target.closest('[data-cell-r]')) return;
                    const ser = wrap.getAttribute('data-card-serial');
                    if (ser && ser !== activeSerial) {
                        activeSerial = ser;
                        renderCardStack(cards, calledBalls, activeSerial);
                        if (lastStackPayload && lastStackPayload.data) {
                            updateCallUi(cards, activeSerial, lastStackPayload.data);
                        }
                    }
                });
            });
        }

        function wireManualCells(gridEl, item, calledBalls) {
            if (autoDab || !gridEl) return;
            gridEl.querySelectorAll('[data-cell-r]').forEach(function (td) {
                td.addEventListener('click', function () {
                    const r = parseInt(td.getAttribute('data-cell-r'), 10);
                    const c = parseInt(td.getAttribute('data-cell-c'), 10);
                    const ball = parseInt(td.getAttribute('data-ball'), 10);
                    if ((calledBalls || []).indexOf(ball) === -1) return;
                    const manual = manualMarksFor(item.serial);
                    manual[r][c] = !manual[r][c];
                    gridEl.innerHTML = buildCardTableHtml(item.grid, marksForCard(item), calledBalls);
                    wireManualCells(gridEl, item, calledBalls);
                });
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
            stopIntroTick();
            introEndsAtLocal = null;
            setPlayIntroMode(false);
            setLobbyPref(true);
            if (els.claimResult) els.claimResult.textContent = '';
            selfVerifiedTiers.clear();
            cardOrderSerials = [];
            showJoin();
            loadGames();
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
                        const hasCards = (g.guestCardCount || 0) > 0;
                        const slots = hasCards
                            ? g.playInProgress
                                ? 'Game in progress'
                                : g.canGrabMore
                                  ? 'More virtual cards available'
                                  : 'Max virtual cards for this game'
                            : 'Virtual card on your phone — created when you join';
                        const startLine = g.advertisedStartAt
                            ? formatAdvertisedStart(g.advertisedStartAt) || g.advertisedStartAt
                            : '';
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
                if (els.lastBall) els.lastBall.textContent = data.lastBall != null ? data.lastBall : '—';
                renderRecentBalls(els.recentBalls, data.calledBalls, {
                    progressEl: els.callProgress,
                    calledCount: data.calledCount,
                    ballCount: data.ballCount
                });
                renderPrizeBar(els.prizeBar, data.playingFor, data.prizeWinners);
                if (els.playingFor)
                    els.playingFor.textContent = 'Playing for · ' + (data.playingForLabel || '');
                let stackCards =
                    data.allCards && data.allCards.length
                        ? data.allCards
                        : data.card && data.card.grid
                          ? [
                                {
                                    serial: data.card.serial,
                                    grid: data.card.grid,
                                    marks: data.marks,
                                    progress: data.progress,
                                    toGo: data.progress ? data.progress.toGo : null,
                                    progressLabel: data.progress ? data.progress.label : null
                                }
                            ]
                          : [];
                stackCards = stabilizeCardOrder(stackCards);
                if (autoDab && stackCards.length) {
                    const readySerial = claimCardSerial(stackCards);
                    if (readySerial) activeSerial = readySerial;
                }
                if (activeSerial && stackCards.every((c) => c.serial !== activeSerial)) {
                    activeSerial = data.card && data.card.serial ? data.card.serial : stackCards[0]?.serial;
                } else if (!activeSerial && data.card) {
                    activeSerial = data.card.serial;
                }
                lastStackPayload = { cards: stackCards, calledBalls: data.calledBalls || [], data: data };
                renderCardStack(stackCards, data.calledBalls, activeSerial);
                if (els.grabAnother) {
                    const inProgress =
                        !!data.active ||
                        data.phase === 'intro' ||
                        (data.calledCount != null && data.calledCount > 0);
                    els.grabAnother.hidden = !data.canGrabMore || inProgress;
                }
                updateCallUi(stackCards, activeSerial, data);
                syncGuestIntro(data);
                maybeAnnounceBall(data);
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
                }
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
            stopIntroTick();
        }

        async function sendClaim(claimType) {
            const name = opts.customerName();
            const resultEl = els.claimResult;
            if (!activeGameId || !name) return;
            const tier = claimType || playingFor;
            if (selfVerifiedTiers.has(tier) || claimInFlight) return;
            const cardsForClaim =
                lastStackPayload && lastStackPayload.cards ? lastStackPayload.cards : [];
            const serialForClaim = claimCardSerial(cardsForClaim) || activeSerial;
            claimInFlight = true;
            syncCallButtonDisabled(
                lastStackPayload && lastStackPayload.data ? lastStackPayload.data : { active: true, playingFor: tier }
            );
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
                            claimType: tier,
                            deviceId: opts.deviceId(),
                            serial: serialForClaim
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
                    selfVerifiedTiers.add(tier);
                    if (data.playingFor) playingFor = data.playingFor;
                    refreshPlay();
                } else if (data.alreadyVerified) {
                    selfVerifiedTiers.add(tier);
                }
            } catch (e) {
                if (resultEl) resultEl.textContent = 'Could not send claim';
            } finally {
                claimInFlight = false;
                if (lastStackPayload && lastStackPayload.data) {
                    syncCallButtonDisabled(lastStackPayload.data);
                }
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