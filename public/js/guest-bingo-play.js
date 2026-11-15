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

    function emptyManualMarks(rows, cols) {
        const r = Number(rows) || 3;
        const c = Number(cols) || 9;
        return Array.from({ length: r }, function () {
            return Array(c).fill(false);
        });
    }

    function isUs75Grid(grid) {
        return !!(grid && grid.length === 5 && grid[0] && grid[0].length === 5);
    }

    const PRIZE_BAR_UK = [
        { id: 'line', label: '1 Line' },
        { id: 'two-lines', label: '2 Lines' },
        { id: 'house', label: 'House' }
    ];
    const PRIZE_BAR_US = [
        { id: 'four-corners', label: '4 Corners' },
        { id: 'line', label: '1 Line' },
        { id: 'two-lines', label: '2 Lines' },
        { id: 'house', label: 'House' }
    ];

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
        if (n === 0) return 'Claim';
        if (n === 1) return '1 to go';
        return n + ' to go';
    }

    function tgSpineLabel(toGo) {
        const n = Number(toGo);
        if (n === 0) return 'CLAIM';
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

    function resolveLastCalledBall(data) {
        if (!data) return null;
        if (data.lastBall != null) return data.lastBall;
        const list = data.calledBalls || [];
        return list.length ? list[list.length - 1] : null;
    }

    function guestBingoCalledCount(data) {
        if (!data) return 0;
        const n = Number(data.calledCount);
        if (Number.isFinite(n) && n > 0) return n;
        const list = data.calledBalls;
        return list && list.length ? list.length : 0;
    }

    function bingoGuestGameRunning(data) {
        if (!data) return false;
        const gameStatus = data.game && data.game.status ? String(data.game.status) : '';
        const phase = data.phase ? String(data.phase) : '';
        const called = guestBingoCalledCount(data);
        return (
            gameStatus === 'live' ||
            gameStatus === 'ended' ||
            !!data.active ||
            !!data.playInProgress ||
            phase === 'intro' ||
            phase === 'resume' ||
            phase === 'calling' ||
            phase === 'claim_break' ||
            !!(data.pendingGameEnd || data.pendingAdvanceAfterClaim) ||
            called > 0
        );
    }

    /**
     * Buy until the DJ starts the caller (`active`); then claim for the rest of the round.
     * Prefer `dockAction` from the play API when present.
     */
    function guestDockAction(data) {
        if (!data) return 'buy';
        const fromApi = data.dockAction != null ? String(data.dockAction) : '';
        if (fromApi === 'buy' || fromApi === 'claim' || fromApi === 'lobby') return fromApi;
        if (guestShouldShowGameOverForGuest(data)) return 'lobby';
        return data.active ? 'claim' : 'buy';
    }

    function bingoGuestPreClaimPlay(data) {
        if (!data || data.showWinnersPopup) return false;
        return guestDockAction(data) === 'buy';
    }

    function guestPlayCardCount(cards, data, stackPayload) {
        if (cards && cards.length) return cards.length;
        if (data && data.allCards && data.allCards.length) return data.allCards.length;
        if (data && data.card && data.card.grid) return 1;
        if (stackPayload && stackPayload.cards && stackPayload.cards.length) return stackPayload.cards.length;
        return 0;
    }

    function ticketsRemaining(cardLimit, currentCount) {
        const limit = Math.max(1, Number(cardLimit) || 1);
        const have = Math.max(0, Number(currentCount) || 0);
        return Math.max(0, limit - have);
    }

    function guestTicketRemaining(data) {
        if (!data) return 0;
        const have =
            data.allCards && data.allCards.length
                ? data.allCards.length
                : data.guestCards && data.guestCards.length
                  ? data.guestCards.length
                  : 0;
        const limit =
            data.cardLimit != null
                ? data.cardLimit
                : data.game && data.game.cardLimit != null
                  ? data.game.cardLimit
                  : null;
        return ticketsRemaining(limit, have);
    }

    /** Pre-caller buy — uses dockAction + canGrabMore; null when play payload not loaded yet. */
    function guestCanBuyTickets(data) {
        if (!data) return null;
        if (guestDockAction(data) !== 'buy') return false;
        if (data.canGrabMore === false) return false;
        if (data.canGrabMore === true) return true;
        return guestTicketRemaining(data) > 0;
    }

    function guestCallerHasStarted(data) {
        if (!data) return false;
        if (data.dockAction === 'claim') return true;
        if (data.callerRunning != null) return !!data.callerRunning;
        if (data.playInProgress != null) return !!data.playInProgress;
        return !!data.active;
    }

    function guestGameStatusEnded(data) {
        return !!(data && data.game && String(data.game.status || '') === 'ended');
    }

    /** Caller has not started — join/intro/waiting, not a finished round. */
    function guestIsWaitingForCaller(data) {
        if (!data) return false;
        if (data.pendingGameEnd) return false;
        const called = guestBingoCalledCount(data);
        if (called > 0 || data.active) return false;
        const phase = String(data.phase || '');
        if (phase === 'calling' || phase === 'claim_break') return false;
        return true;
    }

    function guestShouldShowGameOverForGuest(data) {
        if (!data) return false;
        if (guestIsWaitingForCaller(data)) return false;
        if (data.showWinnersPopup) return true;
        if (guestGameStatusEnded(data)) return true;
        return false;
    }

    function resolveGuestBingoRoot(root) {
        const qRoot = root && typeof root.querySelector === 'function' ? root : null;
        if (qRoot) {
            const inRoot = qRoot.querySelector('[data-bingo-root]') || qRoot.querySelector('.gh-bingo');
            if (inRoot) return inRoot;
        }
        const panel = typeof document !== 'undefined' ? document.getElementById('ghPanelBingo') : null;
        if (panel) {
            return panel.querySelector('[data-bingo-root]') || panel.querySelector('.gh-bingo');
        }
        return typeof document !== 'undefined'
            ? document.querySelector('[data-bingo-root]') || document.querySelector('.gh-bingo')
            : null;
    }

    function resolveGuestBingoPlayRoot(root) {
        if (root && typeof root.querySelector === 'function') {
            const inRoot = root.querySelector('[data-bingo-play]');
            if (inRoot) return inRoot;
        }
        const panel = typeof document !== 'undefined' ? document.getElementById('ghPanelBingo') : null;
        if (panel && panel.querySelector) {
            const inPanel = panel.querySelector('[data-bingo-play]');
            if (inPanel) return inPanel;
        }
        return typeof document !== 'undefined' ? document.querySelector('[data-bingo-play]') : null;
    }

    function ensureGuestBuyBanner(bingoRoot) {
        if (!bingoRoot) bingoRoot = resolveGuestBingoRoot(null);
        if (!bingoRoot) {
            const playOnly = resolveGuestBingoPlayRoot(null);
            bingoRoot = playOnly && playOnly.parentElement ? playOnly.parentElement : null;
        }
        if (!bingoRoot) return null;
        let banner = bingoRoot.querySelector('[data-bingo-buy-banner]');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'guest-bingo-buy-banner';
            banner.setAttribute('data-bingo-buy-banner', '');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-bingo-buy-tickets', '');
            btn.textContent = 'Buy tickets';
            const isHub = !!(bingoRoot.closest && bingoRoot.closest('#ghPanelBingo'));
            btn.className = isHub
                ? 'guest-bingo-play-buy-row__btn gh-btn gh-btn--accent'
                : 'guest-bingo-play-buy-row__btn btn btn-warning btn-lg w-100';
            banner.appendChild(btn);
            const play = bingoRoot.querySelector('[data-bingo-play]');
            if (play) bingoRoot.insertBefore(banner, play);
            else bingoRoot.appendChild(banner);
        }
        return banner;
    }

    function removeLegacyGuestBuyRows(play) {
        if (!play) return;
        play.querySelectorAll('[data-bingo-play-buy-row]').forEach(function (row) {
            row.remove();
        });
    }

    var playBuyTicketsClickHandler = null;

    function wireBuyTicketClick(btn) {
        if (!btn || btn.getAttribute('data-buy-wired') === '1') return;
        btn.setAttribute('data-buy-wired', '1');
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (btn.disabled) return;
            if (playBuyTicketsClickHandler) playBuyTicketsClickHandler();
        });
    }

    function ensureGuestToolbarBuy(play) {
        if (!play) return null;
        removeLegacyGuestBuyRows(play);
        const toolbar = play.querySelector('.guest-bingo-play-toolbar');
        if (!toolbar) return null;
        let main = toolbar.querySelector('.guest-bingo-play-toolbar__main');
        if (!main) {
            main = document.createElement('div');
            main.className = 'guest-bingo-play-toolbar__main';
            const back = toolbar.querySelector('[data-bingo-back-lobby]');
            const settings = toolbar.querySelector('[data-bingo-settings-open]');
            const existingBuy = toolbar.querySelector('[data-bingo-buy-tickets]');
            if (back) main.appendChild(back);
            if (existingBuy) main.appendChild(existingBuy);
            if (settings) main.appendChild(settings);
            toolbar.insertBefore(main, toolbar.firstChild);
        }
        let status = toolbar.querySelector('[data-bingo-meta]');
        if (!status) {
            status = document.createElement('p');
            status.className = 'guest-bingo-play-status gh-bingo-meta guest-bingo-meta';
            status.setAttribute('data-bingo-meta', '');
            status.textContent = 'Waiting to start';
            toolbar.appendChild(status);
        } else {
            status.classList.add('guest-bingo-play-status');
        }
        let btn = toolbar.querySelector('[data-bingo-buy-tickets]');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-bingo-buy-tickets', '');
            btn.textContent = 'Buy tickets';
            const isHub = !!(play.closest && play.closest('.gh-bingo'));
            btn.className = isHub
                ? 'guest-bingo-toolbar-btn guest-bingo-toolbar-btn--buy gh-btn gh-btn--accent'
                : 'guest-bingo-toolbar-btn guest-bingo-toolbar-btn--buy btn btn-warning';
            const settings = main.querySelector('[data-bingo-settings-open]');
            const back = main.querySelector('[data-bingo-back-lobby]');
            if (settings) main.insertBefore(btn, settings);
            else if (back) main.insertBefore(btn, back.nextSibling);
            else main.appendChild(btn);
        }
        wireBuyTicketClick(btn);
        return btn;
    }

    function syncBuyTicketsVisibility(root, data) {
        const bingoRoot = resolveGuestBingoRoot(root);
        const play = resolveGuestBingoPlayRoot(root);
        if (play) ensureGuestToolbarBuy(play);
        const banner = bingoRoot ? bingoRoot.querySelector('[data-bingo-buy-banner]') : null;
        if (banner) {
            banner.hidden = true;
            banner.setAttribute('hidden', '');
        }
        const rem = data ? guestTicketRemaining(data) : 0;
        const canBuyState = guestCanBuyTickets(data);
        const canBuy = canBuyState === true;
        const have =
            data && data.allCards && data.allCards.length
                ? data.allCards.length
                : data && data.guestCards
                  ? data.guestCards.length
                  : 0;
        const label = canBuy
            ? have === 0
                ? rem > 1
                    ? 'Get tickets · ' + rem + ' left'
                    : 'Get tickets'
                : rem > 1
                  ? 'Buy tickets · ' + rem + ' left'
                  : 'Buy tickets'
            : data && guestCallerHasStarted(data)
              ? 'Buy tickets — game started'
              : rem <= 0 && data
                ? 'Buy tickets — limit reached'
                : 'Buy tickets';
        const buyScope = bingoRoot || play || root;
        const qAll =
            buyScope && typeof buyScope.querySelectorAll === 'function'
                ? buyScope.querySelectorAll.bind(buyScope)
                : document.querySelectorAll.bind(document);
        qAll('[data-bingo-buy-tickets]').forEach(function (buyEl) {
            buyEl.hidden = false;
            buyEl.removeAttribute('hidden');
            buyEl.style.display = '';
            if (canBuyState !== null) {
                buyEl.disabled = !canBuy;
                buyEl.classList.toggle('guest-bingo-toolbar-btn--buy-disabled', !canBuy);
                buyEl.classList.toggle('guest-bingo-top-buy--disabled', !canBuy);
            }
            buyEl.textContent = label;
            wireBuyTicketClick(buyEl);
        });
    }

    function renderRecentBalls(trackEl, calledBalls, opts) {
        if (!trackEl) return;
        const list = calledBalls || [];
        /* API order oldest → newest; show last N with latest pinned on the left. */
        const recent = list.slice(-10).reverse();
        if (!recent.length) {
            trackEl.innerHTML = '<span class="guest-bingo-recent-empty">—</span>';
            return;
        }
        trackEl.innerHTML = recent
            .map(function (n, i) {
                const isLatest = i === 0;
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
        requestAnimationFrame(function () {
            trackEl.scrollLeft = 0;
        });
        if (opts && opts.progressEl && opts.calledCount != null && opts.ballCount) {
            opts.progressEl.hidden = false;
            opts.progressEl.textContent = opts.calledCount + ' / ' + opts.ballCount;
        } else if (opts && opts.progressEl) {
            opts.progressEl.hidden = true;
            opts.progressEl.textContent = '';
        }
    }

    function renderPrizeBar(barEl, playingFor, prizeWinners, cardFormat) {
        if (!barEl) return;
        const chips = cardFormat === 'us-75' ? PRIZE_BAR_US : PRIZE_BAR_UK;
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
            lobbyChrome: q('[data-bingo-lobby-chrome]'),
            join: q('[data-bingo-join]'),
            play: q('[data-bingo-play]'),
            playDock: q('[data-bingo-play-dock]'),
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
            buyTickets: q('[data-bingo-buy-tickets]'),
            settingsOpen: q('[data-bingo-settings-open]'),
            backLobby: q('[data-bingo-back-lobby]'),
            intro: q('[data-bingo-intro]'),
            introPrize: q('[data-bingo-intro-prize]'),
            introSec: q('[data-bingo-intro-sec]'),
            introRing: q('[data-bingo-intro-ring]'),
            resume: q('[data-bingo-resume]'),
            resumeBall: q('[data-bingo-resume-ball]'),
            resumeSec: q('[data-bingo-resume-sec]'),
            countdownBar: q('[data-bingo-countdown]'),
            countdownKind: q('[data-bingo-countdown-kind]'),
            countdownSec: q('[data-bingo-countdown-sec]'),
            countdownExtra: q('[data-bingo-countdown-extra]')
        };

        function setPanelHidden(el, hide) {
            if (!el) return;
            if (hide) {
                el.setAttribute('hidden', '');
                el.hidden = true;
            } else {
                el.removeAttribute('hidden');
                el.hidden = false;
            }
        }

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
        let pollDelayMs = 2200;
        let lobbyPollTimer = null;
        let lastLobbyStructFp = '';
        let lastLobbyTimerFp = '';
        let lobbyGamesFirstLoad = true;
        let autoDab = readAutoDab();
        let callerSoundOn = readCallerSound();
        const manualMarksBySerial = Object.create(null);
        let lastStackPayload = null;
        let playingFor = 'line';
        let cardMode = '';
        let cardOrderSerials = [];
        const selfVerifiedClaimKeys = new Set();

        function verifiedClaimKey(tier, serial) {
            return String(tier || '') + '::' + String(serial || '');
        }
        let claimInFlight = false;
        let lastSpokenBall = null;
        let introEndsAtLocal = null;
        let introTotalSec = 30;
        let introTickTimer = null;
        let introEndRefreshInFlight = false;
        let resumeEndsAtLocal = null;

        let buyModalEls = null;
        let settingsModalEls = null;
        let winnersModalEls = null;
        let winnersModalShown = false;
        let winnersDismissedLocally = false;

        function guestShouldShowGameOver(data) {
            if (!data || winnersDismissedLocally) return false;
            if (guestDockAction(data) === 'lobby') return true;
            return guestShouldShowGameOverForGuest(data);
        }

        function hideWinnersModal() {
            if (winnersModalEls) setPanelHidden(winnersModalEls.backdrop, true);
            winnersModalShown = false;
            document.documentElement.classList.remove('guest-bingo-winners-open');
        }

        function applyPlayTheme(data) {
            const theme =
                (data && (data.bingoTheme || (data.game && data.game.bingoTheme))) || 'default';
            if (!window.MdjBingoTheme) return;
            window.MdjBingoTheme.apply(document.body, theme);
            if (els.play) window.MdjBingoTheme.apply(els.play, theme);
            const ghRoot = root.closest && root.closest('.gh-bingo');
            if (ghRoot) window.MdjBingoTheme.apply(ghRoot, theme);
            const ghApp = document.getElementById('ghApp');
            if (ghApp) window.MdjBingoTheme.apply(ghApp, theme);
            const ghMain = document.querySelector('.gh-main');
            if (ghMain) window.MdjBingoTheme.apply(ghMain, theme);
        }

        function ensurePlaySettingsModal() {
            if (settingsModalEls) return settingsModalEls;
            const host =
                typeof document !== 'undefined' && document.body
                    ? document.body
                    : root.querySelector('[data-bingo-root]') ||
                      root.querySelector('[data-bingo-play]') ||
                      root;
            const wrap = document.createElement('div');
            wrap.className = 'guest-bingo-settings-modal';
            wrap.setAttribute('data-bingo-settings-backdrop', '');
            wrap.hidden = true;
            wrap.innerHTML =
                '<div class="guest-bingo-settings-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="guestBingoSettingsTitle">' +
                '<h2 class="guest-bingo-settings-modal__title" id="guestBingoSettingsTitle">Play settings</h2>' +
                '<div class="guest-bingo-play-options guest-bingo-play-options--modal" role="group" aria-label="Play options">' +
                '<label class="guest-bingo-opt">' +
                '<span class="guest-bingo-opt__icon" aria-hidden="true"><i class="fas fa-highlighter"></i></span>' +
                '<span class="guest-bingo-opt__copy"><span class="guest-bingo-opt__title">Auto-dabber</span>' +
                '<span class="guest-bingo-opt__hint">Marks called numbers on your cards</span></span>' +
                '<input class="guest-bingo-opt__input" type="checkbox" data-bingo-auto-dab checked>' +
                '<span class="guest-bingo-opt__switch" aria-hidden="true"></span></label>' +
                '<label class="guest-bingo-opt">' +
                '<span class="guest-bingo-opt__icon" aria-hidden="true"><i class="fas fa-volume-low"></i></span>' +
                '<span class="guest-bingo-opt__copy"><span class="guest-bingo-opt__title">Caller sound</span>' +
                '<span class="guest-bingo-opt__hint">Speak each ball on this phone</span></span>' +
                '<input class="guest-bingo-opt__input" type="checkbox" data-bingo-caller-sound checked>' +
                '<span class="guest-bingo-opt__switch" aria-hidden="true"></span></label></div>' +
                '<button type="button" class="guest-bingo-settings-modal__done gh-btn gh-btn--accent" data-bingo-settings-close>Done</button>' +
                '</div>';
            host.appendChild(wrap);
            settingsModalEls = {
                backdrop: wrap,
                closeBtn: wrap.querySelector('[data-bingo-settings-close]')
            };
            settingsModalEls.closeBtn?.addEventListener('click', closePlaySettingsModal);
            wrap.addEventListener('click', function (ev) {
                if (ev.target === wrap) closePlaySettingsModal();
            });
            return settingsModalEls;
        }

        function openPlaySettingsModal() {
            const modal = ensurePlaySettingsModal();
            modal.backdrop.hidden = false;
            document.documentElement.classList.add('guest-bingo-settings-open');
            const modalAuto = modal.backdrop.querySelector('[data-bingo-auto-dab]');
            const modalSound = modal.backdrop.querySelector('[data-bingo-caller-sound]');
            if (modalAuto) modalAuto.checked = autoDab;
            if (modalSound) modalSound.checked = callerSoundOn;
            wireSettingsInputs(modal.backdrop);
        }

        function closePlaySettingsModal() {
            if (settingsModalEls) settingsModalEls.backdrop.hidden = true;
            document.documentElement.classList.remove('guest-bingo-settings-open');
        }

        function wireSettingsInputs(scope) {
            const host = scope || root;
            const autoEl = host.querySelector('[data-bingo-auto-dab]');
            const soundEl = host.querySelector('[data-bingo-caller-sound]');
            if (autoEl && !autoEl.dataset.wired) {
                autoEl.dataset.wired = '1';
                autoEl.checked = autoDab;
                autoEl.addEventListener('change', function () {
                    autoDab = !!autoEl.checked;
                    writeAutoDab(autoDab);
                    syncSettingsToggles();
                    if (!autoDab) {
                        manualMarksBySerial = Object.create(null);
                        cardOrderSerials = (
                            lastStackPayload && lastStackPayload.cards
                                ? lastStackPayload.cards.map((c) => c.serial)
                                : cardOrderSerials
                        );
                    }
                    if (lastStackPayload) {
                        let ordered = stabilizeCardOrder(lastStackPayload.cards);
                        if (lastStackPayload.data) {
                            ordered = enrichCardsProgress(
                                ordered,
                                lastStackPayload.calledBalls,
                                lastStackPayload.data
                            );
                        }
                        lastStackPayload.cards = ordered;
                        renderCardStack(ordered, lastStackPayload.calledBalls, activeSerial);
                        if (lastStackPayload.data) {
                            updateCallUi(ordered, activeSerial, lastStackPayload.data);
                        }
                    }
                });
            }
            if (soundEl && !soundEl.dataset.wired) {
                soundEl.dataset.wired = '1';
                soundEl.checked = callerSoundOn;
                soundEl.addEventListener('change', function () {
                    callerSoundOn = !!soundEl.checked;
                    writeCallerSound(callerSoundOn);
                    syncSettingsToggles();
                });
            }
        }

        function syncSettingsToggles() {
            qq('[data-bingo-auto-dab]').forEach(function (el) {
                el.checked = autoDab;
            });
            qq('[data-bingo-caller-sound]').forEach(function (el) {
                el.checked = callerSoundOn;
            });
        }

        function guestModalHost() {
            if (typeof document === 'undefined') return root;
            return (
                document.getElementById('ghApp') ||
                document.body ||
                root.querySelector('[data-bingo-root]') ||
                root
            );
        }

        function ensureBuyTicketsModal() {
            if (buyModalEls) return buyModalEls;
            const host = guestModalHost();
            const wrap = document.createElement('div');
            wrap.className = 'guest-bingo-buy-modal';
            wrap.setAttribute('data-bingo-buy-backdrop', '');
            wrap.hidden = true;
            wrap.innerHTML =
                '<div class="guest-bingo-buy-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="guestBingoBuyTitle">' +
                '<h2 class="guest-bingo-buy-modal__title" id="guestBingoBuyTitle">Buy tickets</h2>' +
                '<p class="guest-bingo-buy-modal__lede" data-bingo-buy-lede>Choose how many virtual cards to add on this phone.</p>' +
                '<div class="guest-bingo-buy-modal__qty">' +
                '<button type="button" class="guest-bingo-buy-modal__step" data-bingo-buy-less aria-label="Fewer tickets">−</button>' +
                '<input type="number" class="guest-bingo-buy-modal__input" data-bingo-buy-qty min="1" max="99" value="1" inputmode="numeric" autocomplete="off">' +
                '<button type="button" class="guest-bingo-buy-modal__step" data-bingo-buy-more aria-label="More tickets">+</button>' +
                '</div>' +
                '<p class="guest-bingo-buy-modal__hint" data-bingo-buy-hint></p>' +
                '<p class="guest-bingo-buy-modal__err" data-bingo-buy-err hidden></p>' +
                '<div class="guest-bingo-buy-modal__actions">' +
                '<button type="button" class="guest-bingo-buy-modal__cancel" data-bingo-buy-cancel>Cancel</button>' +
                '<button type="button" class="guest-bingo-buy-modal__confirm gh-btn gh-btn--accent" data-bingo-buy-confirm>Get tickets</button>' +
                '</div></div>';
            host.appendChild(wrap);
            buyModalEls = {
                backdrop: wrap,
                qty: wrap.querySelector('[data-bingo-buy-qty]'),
                hint: wrap.querySelector('[data-bingo-buy-hint]'),
                err: wrap.querySelector('[data-bingo-buy-err]'),
                less: wrap.querySelector('[data-bingo-buy-less]'),
                more: wrap.querySelector('[data-bingo-buy-more]'),
                cancel: wrap.querySelector('[data-bingo-buy-cancel]'),
                confirm: wrap.querySelector('[data-bingo-buy-confirm]')
            };
            let pendingGameId = null;
            let pendingBuyMore = false;

            function closeBuyModal() {
                wrap.hidden = true;
                wrap.setAttribute('hidden', '');
                document.documentElement.classList.remove('guest-bingo-buy-open');
                pendingGameId = null;
                pendingBuyMore = false;
                if (buyModalEls.err) {
                    buyModalEls.err.hidden = true;
                    buyModalEls.err.textContent = '';
                }
            }

            function syncQtyBounds(max) {
                const m = Math.max(1, max);
                if (buyModalEls.qty) {
                    buyModalEls.qty.max = String(m);
                    buyModalEls.qty.min = '1';
                    let v = parseInt(buyModalEls.qty.value, 10);
                    if (!Number.isFinite(v) || v < 1) v = 1;
                    if (v > m) v = m;
                    buyModalEls.qty.value = String(v);
                }
                if (buyModalEls.hint) {
                    buyModalEls.hint.textContent =
                        'You can add up to ' + m + ' ticket' + (m === 1 ? '' : 's') + ' for this game.';
                }
            }

            wrap.addEventListener('click', function (e) {
                if (e.target === wrap) closeBuyModal();
            });

            buyModalEls.cancel.addEventListener('click', closeBuyModal);

            buyModalEls.less.addEventListener('click', function () {
                const max = parseInt(buyModalEls.qty.max, 10) || 1;
                let v = parseInt(buyModalEls.qty.value, 10) || 1;
                v = Math.max(1, v - 1);
                buyModalEls.qty.value = String(v);
            });

            buyModalEls.more.addEventListener('click', function () {
                const max = parseInt(buyModalEls.qty.max, 10) || 1;
                let v = parseInt(buyModalEls.qty.value, 10) || 1;
                v = Math.min(max, v + 1);
                buyModalEls.qty.value = String(v);
            });

            buyModalEls.confirm.addEventListener('click', async function () {
                if (!pendingGameId) return;
                const qty = parseInt(buyModalEls.qty.value, 10) || 1;
                buyModalEls.confirm.disabled = true;
                if (buyModalEls.err) buyModalEls.err.hidden = true;
                const result = await purchaseVirtualTickets(pendingGameId, qty, pendingBuyMore);
                buyModalEls.confirm.disabled = false;
                if (!result.ok) {
                    if (buyModalEls.err) {
                        buyModalEls.err.hidden = false;
                        buyModalEls.err.textContent = result.error || 'Could not get tickets';
                    }
                    return;
                }
                closeBuyModal();
            });

            buyModalEls.open = function (gameId, remaining, options) {
                pendingGameId = gameId;
                pendingBuyMore = !!(options && options.buyMore);
                const max = Math.max(1, remaining);
                syncQtyBounds(max);
                buyModalEls.qty.value = String(Math.min(max, max > 2 ? 2 : 1));
                wrap.removeAttribute('hidden');
                wrap.hidden = false;
                document.documentElement.classList.add('guest-bingo-buy-open');
            };

            return buyModalEls;
        }

        function openBuyTicketsModal(gameId, remaining, options) {
            if (!opts.customerName()) return { ok: false, error: 'Enter your name on the hub first' };
            if (remaining <= 0) return { ok: false, error: 'No more tickets available for this game' };
            const modal = ensureBuyTicketsModal();
            modal.open(gameId, remaining, options || {});
            return { ok: true };
        }

        function ensureWinnersModal() {
            if (winnersModalEls) return winnersModalEls;
            const host =
                (typeof document !== 'undefined' && document.getElementById('ghApp')) ||
                (typeof document !== 'undefined' && document.body) ||
                root;
            const wrap = document.createElement('div');
            wrap.className = 'guest-bingo-winners-modal';
            wrap.setAttribute('data-bingo-winners-backdrop', '');
            wrap.hidden = true;
            wrap.innerHTML =
                '<div class="guest-bingo-winners-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="guestBingoWinnersTitle">' +
                '<p class="guest-bingo-winners-modal__icon" aria-hidden="true"><i class="fas fa-trophy"></i></p>' +
                '<h2 class="guest-bingo-winners-modal__title" id="guestBingoWinnersTitle">Game over</h2>' +
                '<p class="guest-bingo-winners-modal__lede">Winners this game</p>' +
                '<ul class="guest-bingo-winners-modal__list" data-bingo-winners-list></ul>' +
                '<button type="button" class="guest-bingo-winners-modal__ok gh-btn gh-btn--accent" data-bingo-winners-close>OK</button>' +
                '</div>';
            host.appendChild(wrap);
            winnersModalEls = {
                backdrop: wrap,
                list: wrap.querySelector('[data-bingo-winners-list]'),
                close: wrap.querySelector('[data-bingo-winners-close]')
            };
            winnersModalEls.close.addEventListener('click', function () {
                dismissWinnersModal();
            });
            wrap.addEventListener('click', function (e) {
                if (e.target === wrap) dismissWinnersModal();
            });
            return winnersModalEls;
        }

        function winnersListHtml(data) {
            const pw = (data && data.prizeWinners) || {};
            const prizes = (data && data.prizes) || {};
            const rows = [
                { id: 'line', fallback: '1 Line' },
                { id: 'two-lines', fallback: '2 Lines' },
                { id: 'house', fallback: 'Full house' }
            ];
            return rows
                .map(function (r) {
                    const tierLabel =
                        (r.id === 'line' && prizes.line) ||
                        (r.id === 'two-lines' && prizes['two-lines']) ||
                        (r.id === 'house' && prizes.house) ||
                        r.fallback;
                    const name = pw[r.id] && String(pw[r.id]).trim() ? String(pw[r.id]).trim() : '';
                    const hasWinner = !!name;
                    return (
                        '<li class="guest-bingo-winners-modal__row' +
                        (hasWinner ? ' is-won' : ' is-empty') +
                        '">' +
                        '<span class="guest-bingo-winners-modal__tier">' +
                        escapeHtml(String(tierLabel)) +
                        '</span>' +
                        '<span class="guest-bingo-winners-modal__name">' +
                        escapeHtml(hasWinner ? name : 'No winner') +
                        '</span></li>'
                    );
                })
                .join('');
        }

        function syncWinnersModal(data) {
            if (winnersModalShown && !winnersDismissedLocally) {
                const modal = ensureWinnersModal();
                if (data) modal.list.innerHTML = winnersListHtml(data);
                setPanelHidden(modal.backdrop, false);
                document.documentElement.classList.add('guest-bingo-winners-open');
                return;
            }
            if (!guestShouldShowGameOver(data)) {
                if (winnersDismissedLocally) hideWinnersModal();
                return;
            }
            const modal = ensureWinnersModal();
            modal.list.innerHTML = winnersListHtml(data);
            setPanelHidden(modal.backdrop, false);
            document.documentElement.classList.add('guest-bingo-winners-open');
            winnersModalShown = true;
        }

        async function dismissWinnersModal() {
            winnersDismissedLocally = true;
            if (!activeGameId) {
                hideWinnersModal();
                return;
            }
            try {
                await fetch(
                    '/api/event/' +
                        encodeURIComponent(slug) +
                        '/bingo/games/' +
                        activeGameId +
                        '/dismiss-winners',
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
                );
            } catch (e) {
                /* ignore */
            }
            hideWinnersModal();
        }

        function guestHasTicketsForGame(data, gameId) {
            if (!data || !gameId) return false;
            const gid = data.game && data.game.id != null ? data.game.id : activeGameId;
            if (gid !== gameId) return false;
            return guestPlayCardCount(null, data, lastStackPayload) > 0;
        }

        function openBuyFromPlayUi() {
            if (!activeGameId) return;
            const tryOpen = function () {
                const data = playDataForDock();
                const rem = data ? guestTicketRemaining(data) : 0;
                if (data && guestCallerHasStarted(data)) {
                    if (els.claimResult) {
                        els.claimResult.textContent =
                            'Extra tickets are only available before the game starts';
                    }
                    return;
                }
                if (rem <= 0) {
                    if (els.claimResult) {
                        els.claimResult.textContent = 'No more tickets available for this game';
                    }
                    return;
                }
                const buyMore = guestHasTicketsForGame(data, activeGameId);
                const opened = openBuyTicketsModal(activeGameId, rem, { buyMore: buyMore });
                if (opened && opened.ok === false && opened.error && els.claimResult) {
                    els.claimResult.textContent = opened.error;
                }
            };
            if (!playDataForDock()) {
                refreshPlay().then(tryOpen);
                return;
            }
            tryOpen();
        }

        playBuyTicketsClickHandler = openBuyFromPlayUi;

        if (els.backLobby) {
            els.backLobby.addEventListener('click', function () {
                backToLobby();
            });
        }

        wireSettingsInputs(root);
        if (els.settingsOpen) {
            els.settingsOpen.addEventListener('click', openPlaySettingsModal);
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

        function maybeAnnounceBall(data) {
            if (!callerSoundOn || !data) return;
            if (!data.active || data.phase === 'intro' || data.phase === 'resume') return;
            if (data.paused && data.pausedReason === 'claim') return;
            if (data.lastBall == null) return;
            if (data.lastBall === lastSpokenBall) return;
            lastSpokenBall = data.lastBall;
            const theme =
                (data && (data.bingoTheme || (data.game && data.game.bingoTheme))) || 'default';
            if (window.MdjBingoTheme && typeof window.MdjBingoTheme.announceCalledBall === 'function') {
                window.MdjBingoTheme.announceCalledBall(theme, data.lastBall, speakBallNumber);
            } else {
                speakBallNumber(data.lastBall);
            }
        }

        function stopCountdownTick() {
            if (introTickTimer) {
                clearInterval(introTickTimer);
                introTickTimer = null;
            }
        }

        function ensureCountdownTick() {
            if (introTickTimer) return;
            introTickTimer = setInterval(function () {
                if (!introEndsAtLocal && !resumeEndsAtLocal) {
                    stopCountdownTick();
                    return;
                }
                if (lastStackPayload && lastStackPayload.data) {
                    if (introEndsAtLocal) paintGuestIntro(lastStackPayload.data);
                    if (resumeEndsAtLocal) paintGuestResume(lastStackPayload.data);
                    paintGuestCountdownBar(lastStackPayload.data);
                    if (
                        introEndsAtLocal &&
                        guestIntroRemainingMs(lastStackPayload.data) <= 0 &&
                        !introEndRefreshInFlight
                    ) {
                        introEndRefreshInFlight = true;
                        introEndsAtLocal = null;
                        refreshPlay().finally(function () {
                            introEndRefreshInFlight = false;
                        });
                    }
                }
            }, 250);
        }

        function paintGuestCountdownBar(data) {
            if (!els.countdownBar) return;
            const introOn = !!(
                data &&
                data.phase === 'intro' &&
                (data.active || guestIntroRemainingMs(data) > 0)
            );
            const resumeOn = !!(
                data &&
                data.phase === 'resume' &&
                (data.active || guestResumeRemainingMs(data) > 0)
            );
            if (!introOn && !resumeOn) {
                setPanelHidden(els.countdownBar, true);
                els.countdownBar.classList.remove('guest-bingo-countdown-bar--resume');
                return;
            }
            setPanelHidden(els.countdownBar, false);
            if (resumeOn) {
                els.countdownBar.classList.add('guest-bingo-countdown-bar--resume');
                if (els.countdownKind) els.countdownKind.textContent = 'Resuming';
                const sec = Math.max(0, Math.ceil(guestResumeRemainingMs(data) / 1000));
                if (els.countdownSec) els.countdownSec.textContent = String(sec > 0 ? sec : 0);
                const lb = resolveLastCalledBall(data);
                if (els.countdownExtra) {
                    els.countdownExtra.textContent = lb != null ? 'Last call · ' + lb : '';
                }
            } else {
                els.countdownBar.classList.remove('guest-bingo-countdown-bar--resume');
                if (els.countdownKind) els.countdownKind.textContent = 'Starting soon';
                const sec = Math.max(0, Math.ceil(guestIntroRemainingMs(data) / 1000));
                if (els.countdownSec) els.countdownSec.textContent = String(sec > 0 ? sec : 0);
                if (els.countdownExtra) {
                    const label = data.playingForLabel || data.playingFor || '';
                    els.countdownExtra.textContent = label ? 'Playing for · ' + label : '';
                }
            }
        }

        function bingoPlayRoot() {
            if (els.play) return els.play;
            return root.querySelector('[data-bingo-play]');
        }

        function setPlayIntroMode(on) {
            const playRoot = bingoPlayRoot();
            if (playRoot) playRoot.classList.toggle('guest-bingo--intro', !!on);
            if (els.playDock) els.playDock.classList.toggle('guest-bingo--intro', !!on);
            const ghRoot = root.querySelector && root.querySelector('[data-bingo-root]');
            if (ghRoot) ghRoot.classList.toggle('guest-bingo--intro', !!on);
            if (els.intro) {
                if (on) els.intro.removeAttribute('hidden');
                else els.intro.setAttribute('hidden', '');
            }
            if (!on && els.introRing) {
                els.introRing.removeAttribute('data-ring-init');
            }
        }

        function setPlayResumeMode(on) {
            const playRoot = bingoPlayRoot();
            if (playRoot) playRoot.classList.toggle('guest-bingo--resume', !!on);
            if (els.playDock) els.playDock.classList.toggle('guest-bingo--resume', !!on);
            const ghRoot = root.querySelector && root.querySelector('[data-bingo-root]');
            if (ghRoot) ghRoot.classList.toggle('guest-bingo--resume', !!on);
            if (els.resume) {
                if (on) els.resume.removeAttribute('hidden');
                else els.resume.setAttribute('hidden', '');
            }
        }

        function guestResumeRemainingMs(data) {
            if (!data) return 0;
            if (resumeEndsAtLocal) {
                return Math.max(0, resumeEndsAtLocal - Date.now());
            }
            if (data.resumeRemainingMs != null) {
                return Math.max(0, data.resumeRemainingMs);
            }
            if (data.resumeRemainingSec != null) {
                return Math.max(0, data.resumeRemainingSec * 1000);
            }
            return 0;
        }

        function guestIntroRemainingMs(data) {
            if (!data) return 0;
            if (introEndsAtLocal) {
                return Math.max(0, introEndsAtLocal - Date.now());
            }
            if (data.introRemainingMs != null) {
                return Math.max(0, data.introRemainingMs);
            }
            if (data.introRemainingSec != null) {
                return Math.max(0, data.introRemainingSec * 1000);
            }
            return 0;
        }

        function paintGuestIntro(data) {
            if (!els.intro) return;
            const remainingMs = guestIntroRemainingMs(data);
            const sec = remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0;
            if (els.introSec) els.introSec.textContent = String(sec);
            paintGuestCountdownBar(data);
            if (els.introRing) {
                if (!els.introRing.getAttribute('data-ring-init')) {
                    els.introRing.style.strokeDasharray = String(GUEST_INTRO_RING_LEN);
                    els.introRing.setAttribute('data-ring-init', '1');
                }
                const totalMs = Math.max(1, (introTotalSec || 30) * 1000);
                const progress = remainingMs > 0 ? remainingMs / totalMs : 0;
                els.introRing.style.strokeDashoffset = String(GUEST_INTRO_RING_LEN * (1 - progress));
            }
            if (els.introPrize) {
                els.introPrize.textContent =
                    'Playing for · ' + (data.playingForLabel || data.playingFor || '1 Line');
            }
        }

        function syncGuestIntro(data) {
            const showIntro = !!(
                data &&
                data.phase === 'intro' &&
                (data.active || guestIntroRemainingMs(data) > 0)
            );
            if (showIntro) {
                if (data.introSeconds > 0) introTotalSec = data.introSeconds;
                if (data.introRemainingMs != null && data.introRemainingMs >= 0) {
                    introEndsAtLocal = Date.now() + data.introRemainingMs;
                } else if (data.introRemainingSec != null && data.introRemainingSec >= 0) {
                    introEndsAtLocal = Date.now() + data.introRemainingSec * 1000;
                } else if (!introEndsAtLocal && introTotalSec > 0) {
                    introEndsAtLocal = Date.now() + introTotalSec * 1000;
                }
                setPlayIntroMode(true);
                paintGuestIntro(data);
                ensureCountdownTick();
            } else {
                introEndsAtLocal = null;
                setPlayIntroMode(false);
                if (!resumeEndsAtLocal) stopCountdownTick();
                if (lastStackPayload && lastStackPayload.data) paintGuestCountdownBar(lastStackPayload.data);
            }
        }

        function paintGuestResume(data) {
            if (!els.resume) return;
            const lb = resolveLastCalledBall(data);
            if (els.resumeBall) {
                els.resumeBall.textContent = lb != null ? String(lb) : '—';
            }
            const remainingMs = guestResumeRemainingMs(data);
            if (els.resumeSec) {
                const sec = remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0;
                els.resumeSec.textContent = String(sec);
            }
            paintGuestCountdownBar(data);
        }

        function syncGuestResume(data) {
            const showResume = !!(
                data &&
                data.phase === 'resume' &&
                (data.active || guestResumeRemainingMs(data) > 0)
            );
            if (showResume) {
                if (data.resumeRemainingMs != null && data.resumeRemainingMs >= 0) {
                    resumeEndsAtLocal = Date.now() + data.resumeRemainingMs;
                } else if (data.resumeRemainingSec != null && data.resumeRemainingSec >= 0) {
                    resumeEndsAtLocal = Date.now() + data.resumeRemainingSec * 1000;
                } else if (!resumeEndsAtLocal) {
                    resumeEndsAtLocal = Date.now() + 5000;
                }
                setPlayResumeMode(true);
                paintGuestResume(data);
                ensureCountdownTick();
            } else {
                resumeEndsAtLocal = null;
                setPlayResumeMode(false);
                if (!introEndsAtLocal) stopCountdownTick();
                if (lastStackPayload && lastStackPayload.data) paintGuestCountdownBar(lastStackPayload.data);
            }
        }

        function claimCardSerial(cards) {
            const list = cards && cards.length ? cards : [];
            if (!list.length) return activeSerial;
            if (activeSerial) {
                const activeCard = list.find(function (c) {
                    return c.serial === activeSerial;
                });
                if (activeCard && cardToGo(activeCard) === 0) return activeCard.serial;
            }
            const ready = list.find(function (c) {
                return cardToGo(c) === 0;
            });
            if (ready) return ready.serial;
            const focused = list.find(function (c) {
                return c.serial === activeSerial;
            });
            return focused ? focused.serial : list[0].serial;
        }

        function syncDockPrimaryAction(data, cards) {
            const callBtn = q('[data-bingo-call]');
            if (!callBtn) return;
            els.callBtn = callBtn;
            const dock = q('[data-bingo-play-dock]');
            if (dock) {
                els.playDock = dock;
                dock.classList.remove('guest-bingo--dock-buy');
                dock.classList.add('guest-bingo--dock-claim');
            }

            const phase = data && data.phase ? String(data.phase) : '';
            const label = (data && data.playingForLabel) || 'prize';
            const showLobby =
                guestShouldShowGameOver(data) || guestDockAction(data) === 'lobby';

            callBtn.classList.remove('guest-bingo-dock-btn--buy', 'guest-bingo-dock-btn--lobby');

            if (showLobby) {
                callBtn.setAttribute('data-dock-mode', 'lobby');
                callBtn.textContent = 'Back to lobby';
                callBtn.disabled = false;
                callBtn.classList.add('guest-bingo-dock-btn--lobby');
                callBtn.classList.remove('guest-bingo-call--ready');
                return;
            }

            callBtn.setAttribute('data-dock-mode', 'claim');
            if (phase === 'intro') {
                const sec =
                    data.introRemainingSec != null
                        ? data.introRemainingSec
                        : Math.max(0, Math.ceil(guestIntroRemainingMs(data) / 1000));
                callBtn.textContent = 'Claim — starts in ' + sec + 's';
            } else if (phase === 'resume') {
                callBtn.textContent = 'Claim — resuming soon';
            } else {
                callBtn.textContent = 'Claim — ' + label;
            }
            callBtn.classList.remove('guest-bingo-call--ready');
        }

        function syncCallButtonDisabled(data) {
            if (!els.callBtn) return;
            const mode = els.callBtn.getAttribute('data-dock-mode');
            if (mode === 'buy' || mode === 'lobby') return;
            const pf = data.playingFor || playingFor || 'line';
            const claimSerial = claimCardSerial(
                lastStackPayload && lastStackPayload.cards ? lastStackPayload.cards : []
            );
            const tierVerified = selfVerifiedClaimKeys.has(verifiedClaimKey(pf, claimSerial));
            const claimsOpen =
                data.active &&
                data.phase !== 'intro' &&
                data.phase !== 'resume' &&
                (!data.paused ||
                    data.pausedReason === 'claim' ||
                    data.pausedReason === 'claim_window' ||
                    data.phase === 'claim_break' ||
                    data.claimWindowOpen ||
                    data.pendingGameEnd ||
                    data.pendingAdvanceAfterClaim);
            const baseDisabled = !claimsOpen || claimInFlight || tierVerified;
            els.callBtn.disabled = baseDisabled;
            qq('[data-bingo-claim]').forEach(function (btn) {
                const ct = btn.getAttribute('data-claim');
                btn.disabled = baseDisabled || ct !== pf;
            });
        }

        function manualMarksFor(serial, grid) {
            const key = String(serial || '');
            const g = grid || null;
            const rows = g ? g.length : 3;
            const cols = g && g[0] ? g[0].length : 9;
            if (!manualMarksBySerial[key]) manualMarksBySerial[key] = emptyManualMarks(rows, cols);
            return manualMarksBySerial[key];
        }

        function effectiveMarkedCalledBalls(item, calledBalls) {
            const called = new Set(calledBalls || []);
            if (!item || !item.grid) return [];
            if (autoDab) return calledBalls || [];
            const manual = manualMarksFor(item.serial, item.grid);
            const out = [];
            const rows = item.grid.length;
            const cols = item.grid[0] ? item.grid[0].length : 9;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const n = item.grid[r][c];
                    if (n != null && called.has(n) && manual[r][c]) out.push(n);
                }
            }
            return out;
        }

        function guestProgressTowardClaim(grid, calledBalls, playingFor, prizeLabel, cardFormat) {
            if (!grid) return { toGo: null, label: '' };
            if (cardFormat === 'us-75' || isUs75Grid(grid)) {
                const pf = String(playingFor || 'four-corners');
                const prize =
                    prizeLabel && String(prizeLabel).trim()
                        ? String(prizeLabel).trim()
                        : pf === 'four-corners'
                          ? 'four corners'
                          : pf === 'two-lines'
                            ? 'two lines'
                            : pf === 'house'
                              ? 'full house'
                              : 'a line';
                const calledSet = new Set(calledBalls || []);
                const corners = [
                    [0, 0],
                    [0, 4],
                    [4, 0],
                    [4, 4]
                ];
                const marked = function (r, c) {
                    if (r === 2 && c === 2) return true;
                    const n = grid[r][c];
                    return n != null && calledSet.has(n);
                };
                if (pf === 'four-corners') {
                    const need = corners.filter(function (pair) {
                        return !marked(pair[0], pair[1]);
                    }).length;
                    return {
                        toGo: need,
                        label:
                            need === 0
                                ? (prize !== 'four corners' ? prize + ' — claim!' : 'Four corners — claim!')
                                : need === 1
                                  ? '1 to go for ' + prize
                                  : need + ' to go for ' + prize
                    };
                }
            }
            const calledSet = new Set(calledBalls || []);
            const rowNeeds = [0, 1, 2].map(function (r) {
                let need = 0;
                for (let c = 0; c < 9; c++) {
                    const n = grid[r][c];
                    if (n != null && !calledSet.has(n)) need++;
                }
                return need;
            });
            const completedRows = rowNeeds.filter(function (n) {
                return n === 0;
            }).length;
            const sorted = rowNeeds.slice().sort(function (a, b) {
                return a - b;
            });
            const pf = String(playingFor || 'line');
            const prize =
                prizeLabel && String(prizeLabel).trim()
                    ? String(prizeLabel).trim()
                    : pf === 'two-lines'
                      ? 'two lines'
                      : pf === 'house'
                        ? 'full house'
                        : 'a line';
            let toGo = 0;
            let label = '';
            if (pf === 'line') {
                toGo = sorted[0];
                if (completedRows >= 1) {
                    label = prize !== 'a line' ? prize + ' — claim!' : 'Line — claim!';
                    toGo = 0;
                } else if (toGo === 1) label = '1 to go for ' + prize;
                else label = toGo + ' to go for ' + prize;
            } else if (pf === 'two-lines') {
                if (completedRows >= 2) {
                    toGo = 0;
                    label = prize !== 'two lines' ? prize + ' — claim!' : 'Two lines — claim!';
                } else if (completedRows === 1) {
                    const incompleteNeeds = rowNeeds.filter(function (n) {
                        return n > 0;
                    });
                    toGo = incompleteNeeds.length ? Math.min.apply(null, incompleteNeeds) : 0;
                    label = toGo === 1 ? '1 to go for ' + prize : toGo + ' to go for ' + prize;
                } else {
                    toGo = sorted[0] + sorted[1];
                    label = toGo === 1 ? '1 to go for ' + prize : toGo + ' to go for ' + prize;
                }
            } else {
                toGo = rowNeeds.reduce(function (a, b) {
                    return a + b;
                }, 0);
                if (toGo === 0) label = prize !== 'full house' ? prize + ' — claim!' : 'Full house — claim!';
                else if (toGo === 1) label = '1 to go for ' + prize;
                else label = toGo + ' to go for ' + prize;
            }
            return { toGo: toGo, label: label };
        }

        function enrichCardsProgress(cards, calledBalls, data) {
            if (autoDab || !cards || !cards.length) return cards || [];
            const pf = (data && data.playingFor) || 'line';
            const prizeLabel = (data && data.playingForLabel) || '';
            const fmt = (data && data.cardFormat) || (data && data.game && data.game.cardFormat) || 'uk-90';
            return cards.map(function (c) {
                const balls = effectiveMarkedCalledBalls(c, calledBalls);
                const p = guestProgressTowardClaim(c.grid, balls, pf, prizeLabel, fmt);
                return Object.assign({}, c, { progress: p, toGo: p.toGo, progressLabel: p.label });
            });
        }

        function cardToGo(item) {
            const t = item.progress && item.progress.toGo != null ? item.progress.toGo : item.toGo;
            return Number(t);
        }

        function serialAttrEsc(serial) {
            const s = String(serial || '');
            return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        }

        function marksForCard(item) {
            if (autoDab && item.marks) return item.marks;
            if (!item.grid) return item.marks;
            const manual = manualMarksFor(item.serial, item.grid);
            return item.grid.map((row, r) =>
                row.map((n, c) => {
                    if (n == null) return null;
                    return manual[r][c];
                })
            );
        }

        function buildCardTableHtml(grid, marks, calledBalls) {
            const called = calledBalls || [];
            const us75 = isUs75Grid(grid);
            const headers = us75
                ? ['B', 'I', 'N', 'G', 'O']
                : ['1–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–90'];
            const rows = us75 ? 5 : 3;
            const cols = us75 ? 5 : 9;
            let html =
                '<table class="guest-bingo-table' +
                (us75 ? ' guest-bingo-table--us75' : '') +
                '"><thead><tr>';
            headers.forEach(function (h) {
                const colClass =
                    us75 && h.length === 1 ? ' guest-bingo-col-' + h.toLowerCase() : '';
                html += '<th class="guest-bingo-col-head' + colClass + '" scope="col">' + h + '</th>';
            });
            html += '</tr></thead><tbody>';
            for (let r = 0; r < rows; r++) {
                html += '<tr>';
                for (let c = 0; c < cols; c++) {
                    const n = grid[r][c];
                    const marked = marks && marks[r] && marks[r][c];
                    if (n == null) {
                        const free = us75 && r === 2 && c === 2;
                        html +=
                            '<td class="' +
                            (free ? 'is-free' : 'is-blank') +
                            '">' +
                            (free ? '<span class="guest-bingo-free">FREE</span>' : '') +
                            '</td>';
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
            syncDockPrimaryAction(data, cards);
            if (!els.callBtn) return;
            const dockMode = els.callBtn.getAttribute('data-dock-mode');
            if (dockMode === 'lobby') return;
            const list = cards && cards.length ? cards : [];
            const anyReady = list.some(function (c) {
                return cardToGo(c) === 0;
            });
            if (anyReady && data.active) {
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
                    const us75 = isUs75Grid(item.grid);
                    return (
                        '<article class="guest-bingo-ticket guest-bingo-card-wrap guest-bingo-card-wrap--stacked ' +
                        (us75 ? 'guest-bingo-ticket--us75 ' : '') +
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
                if (!autoDab) wireManualCells(gridEl, item, calledBalls, cards);
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

        function wireManualCells(gridEl, item, calledBalls, allCards) {
            if (autoDab || !gridEl) return;
            gridEl.querySelectorAll('[data-cell-r]').forEach(function (td) {
                td.addEventListener('click', function () {
                    const r = parseInt(td.getAttribute('data-cell-r'), 10);
                    const c = parseInt(td.getAttribute('data-cell-c'), 10);
                    const ball = parseInt(td.getAttribute('data-ball'), 10);
                    if ((calledBalls || []).indexOf(ball) === -1) return;
                    const manual = manualMarksFor(item.serial, item.grid);
                    manual[r][c] = !manual[r][c];
                    const payload = lastStackPayload;
                    const data = payload && payload.data ? payload.data : null;
                    const cards = allCards || (payload && payload.cards) || [];
                    const enriched = enrichCardsProgress(cards, calledBalls, data);
                    if (payload) {
                        lastStackPayload.cards = enriched;
                    }
                    renderCardStack(enriched, calledBalls, activeSerial);
                    if (data) updateCallUi(enriched, activeSerial, data);
                });
            });
        }

        function stopLobbyPoll() {
            if (lobbyPollTimer) {
                clearTimeout(lobbyPollTimer);
                lobbyPollTimer = null;
            }
        }

        function lobbyGameBadge(g) {
            let badgeMod = 'is-open';
            let badgeText = 'Open';
            if (g.bingoPhase === 'intro') {
                badgeMod = 'is-prep';
                badgeText = 'Starting';
            } else if (g.bingoPhase === 'resume') {
                badgeMod = 'is-prep';
                badgeText = 'Resuming';
            } else if (g.playInProgress || g.status === 'live') {
                badgeMod = 'is-live';
                badgeText = 'Live';
            }
            return { mod: badgeMod, text: badgeText };
        }

        function lobbyGameSubtitle(g) {
            const hasCards = (g.guestCardCount || 0) > 0;
            const ticketCount = Number(g.guestCardCount || 0);
            let subtitle = '';
            if (!hasCards) {
                subtitle = 'Tap to get tickets on this phone';
            } else if (g.bingoPhase === 'intro') {
                subtitle = 'Starting in ' + (g.introRemainingSec || '…') + 's · tap to see countdown';
            } else if (g.bingoPhase === 'resume') {
                subtitle = 'Back in ' + (g.resumeRemainingSec || '…') + 's · tap to continue';
            } else if (g.playInProgress) {
                subtitle =
                    ticketCount + ' ticket' + (ticketCount === 1 ? '' : 's') + ' · game in progress';
            } else if (g.canGrabMore) {
                subtitle = ticketCount + ' ticket' + (ticketCount === 1 ? '' : 's') + ' · you can buy more';
            } else {
                subtitle = ticketCount + ' ticket' + (ticketCount === 1 ? '' : 's');
            }
            const startLine = g.advertisedStartAt
                ? formatAdvertisedStart(g.advertisedStartAt) || g.advertisedStartAt
                : '';
            if (startLine && !g.playInProgress && g.bingoPhase !== 'intro' && g.bingoPhase !== 'resume') {
                subtitle += (subtitle ? ' · ' : '') + 'Starts ' + startLine;
            }
            return subtitle;
        }

        function lobbyStructFingerprint(games) {
            return JSON.stringify(
                (games || []).map(function (g) {
                    return {
                        id: g.id,
                        status: g.status,
                        guestCardCount: g.guestCardCount,
                        bingoPhase: g.bingoPhase,
                        playInProgress: g.playInProgress,
                        canGrabMore: g.canGrabMore,
                        title: g.title,
                        guestBestToGo: g.guestBestToGo,
                        guestBestLabel: g.guestBestLabel,
                        advertisedStartAt: g.advertisedStartAt
                    };
                })
            );
        }

        function lobbyTimerFingerprint(games) {
            return JSON.stringify(
                (games || []).map(function (g) {
                    return {
                        id: g.id,
                        introRemainingSec: g.introRemainingSec,
                        resumeRemainingSec: g.resumeRemainingSec
                    };
                })
            );
        }

        function patchLobbyGameTimers(games) {
            let missing = false;
            (games || []).forEach(function (g) {
                const block = els.gamesList.querySelector('[data-bingo-game-block="' + g.id + '"]');
                if (!block) {
                    missing = true;
                    return;
                }
                const meta = block.querySelector('.gh-bingo-game-pick__meta');
                if (meta) meta.textContent = lobbyGameSubtitle(g);
                const badge = lobbyGameBadge(g);
                const badgeEl = block.querySelector('.gh-bingo-game-pick__badge');
                if (badgeEl) {
                    badgeEl.textContent = badge.text;
                    badgeEl.className = 'gh-bingo-game-pick__badge ' + badge.mod;
                }
            });
            return !missing;
        }

        function lobbyGameRowHtml(g) {
            const hasCards = (g.guestCardCount || 0) > 0;
            const ticketCount = Number(g.guestCardCount || 0);
            const badge = lobbyGameBadge(g);
            const subtitle = lobbyGameSubtitle(g);
            const tier = g.guestBestToGo != null ? toGoTierClass(g.guestBestToGo) : '';
            const progressChip =
                hasCards && g.guestBestToGo != null && g.playInProgress
                    ? '<span class="gh-bingo-game-pick__chip guest-bingo-game-togo ' +
                      tier +
                      '">' +
                      escapeHtml(g.guestBestLabel || g.guestBestToGo + ' to go') +
                      '</span>'
                    : '';
            const cta = hasCards ? 'Continue' : 'Get tickets';
            const ctaIcon = hasCards ? 'fa-circle-play' : 'fa-ticket';
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
                '" data-card-limit="' +
                Number(g.cardLimit) +
                '" data-guest-card-count="' +
                ticketCount +
                '">' +
                '<span class="gh-bingo-game-pick__head">' +
                '<span class="gh-bingo-game-pick__title">' +
                escapeHtml(g.title) +
                '</span>' +
                '<span class="gh-bingo-game-pick__badge ' +
                badge.mod +
                '">' +
                escapeHtml(badge.text) +
                '</span></span>' +
                '<span class="gh-bingo-game-pick__meta">' +
                escapeHtml(subtitle) +
                '</span>' +
                progressChip +
                '<span class="gh-bingo-game-pick__foot">' +
                '<span class="gh-bingo-game-pick__cta"><i class="fas ' +
                ctaIcon +
                '" aria-hidden="true"></i>' +
                escapeHtml(cta) +
                '</span>' +
                '<i class="fas fa-chevron-right gh-bingo-game-pick__chev" aria-hidden="true"></i></span>' +
                '</button>' +
                (hasCards && g.canGrabMore && !g.playInProgress
                    ? '<button type="button" class="gh-bingo-lobby-more" data-bingo-lobby-buy="' +
                      g.id +
                      '" data-card-limit="' +
                      Number(g.cardLimit) +
                      '" data-guest-card-count="' +
                      ticketCount +
                      '">Buy more tickets</button>'
                    : '') +
                '</div>'
            );
        }

        function bindLobbyGameButtons() {
            if (!els.gamesList) return;
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
                        const rem = ticketsRemaining(
                            btn.getAttribute('data-card-limit'),
                            btn.getAttribute('data-guest-card-count')
                        );
                        openBuyTicketsModal(gid, rem, { buyMore: false });
                    }
                });
            });
            els.gamesList.querySelectorAll('[data-bingo-lobby-buy]').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const gid = parseInt(btn.getAttribute('data-bingo-lobby-buy'), 10);
                    const rem = ticketsRemaining(
                        btn.getAttribute('data-card-limit'),
                        btn.getAttribute('data-guest-card-count')
                    );
                    openBuyTicketsModal(gid, rem, { buyMore: true });
                });
            });
        }

        function lobbyPollIntervalMs() {
            if (!els.gamesList) return 4000;
            const blocks = els.gamesList.querySelectorAll('[data-bingo-game-block]');
            for (let i = 0; i < blocks.length; i++) {
                const badge = blocks[i].querySelector('.gh-bingo-game-pick__badge');
                if (badge && badge.classList.contains('is-prep')) return 1500;
            }
            return 4000;
        }

        function scheduleLobbyPoll() {
            stopLobbyPoll();
            if (els.play && !els.play.hidden) return;
            const delay = lobbyPollIntervalMs();
            lobbyPollTimer = setTimeout(function () {
                lobbyPollTimer = null;
                if (els.play && !els.play.hidden) return;
                loadGames({ silent: true }).finally(function () {
                    scheduleLobbyPoll();
                });
            }, delay);
        }

        function startLobbyPoll() {
            scheduleLobbyPoll();
        }

        function showJoin() {
            setPanelHidden(els.lobbyChrome, false);
            if (!els.lobbyChrome) setPanelHidden(els.join, false);
            setPanelHidden(els.play, true);
            setPanelHidden(els.playDock, true);
            setPanelHidden(els.countdownBar, true);
            const banner = root.querySelector('[data-bingo-buy-banner]');
            setPanelHidden(banner, true);
            startLobbyPoll();
        }

        function showPlay() {
            setPanelHidden(els.lobbyChrome, true);
            if (!els.lobbyChrome) setPanelHidden(els.join, true);
            setPanelHidden(els.play, false);
            setPanelHidden(els.playDock, false);
            setLobbyPref(false);
            stopLobbyPoll();
            const bingoRoot = resolveGuestBingoRoot(root);
            if (bingoRoot) ensureGuestBuyBanner(bingoRoot);
            syncBuyTicketsVisibility(root, lastStackPayload && lastStackPayload.data ? lastStackPayload.data : null);
        }

        function backToLobby() {
            stopPoll();
            stopCountdownTick();
            introEndsAtLocal = null;
            resumeEndsAtLocal = null;
            setPlayIntroMode(false);
            setPlayResumeMode(false);
            setLobbyPref(true);
            if (els.claimResult) els.claimResult.textContent = '';
            selfVerifiedClaimKeys.clear();
            cardOrderSerials = [];
            winnersDismissedLocally = false;
            hideWinnersModal();
            showJoin();
            lastLobbyStructFp = '';
            lastLobbyTimerFp = '';
            lobbyGamesFirstLoad = true;
            loadGames();
        }

        async function loadGames(options) {
            const silent = !!(options && options.silent);
            if (!els.gamesList) return;
            if (!silent && lobbyGamesFirstLoad) {
                els.gamesList.innerHTML = '<p class="gh-bingo-muted">Loading games…</p>';
            }
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
                    lastLobbyStructFp = '';
                    lastLobbyTimerFp = '';
                    els.gamesList.innerHTML =
                        '<p class="gh-bingo-muted">No games open yet — the DJ will open join when ready.</p>';
                    lobbyGamesFirstLoad = false;
                    return;
                }

                const structFp = lobbyStructFingerprint(data.games);
                const timerFp = lobbyTimerFingerprint(data.games);

                if (
                    silent &&
                    structFp === lastLobbyStructFp &&
                    timerFp !== lastLobbyTimerFp &&
                    patchLobbyGameTimers(data.games)
                ) {
                    lastLobbyTimerFp = timerFp;
                    return;
                }
                if (silent && structFp === lastLobbyStructFp && timerFp === lastLobbyTimerFp) {
                    return;
                }

                els.gamesList.innerHTML = data.games.map(lobbyGameRowHtml).join('');
                bindLobbyGameButtons();
                lastLobbyStructFp = structFp;
                lastLobbyTimerFp = timerFp;
                lobbyGamesFirstLoad = false;

                if (activeGameId) {
                    const mine = data.games.find(function (g) {
                        return g.id === activeGameId;
                    });
                    if (
                        mine &&
                        (mine.bingoPhase === 'intro' || mine.bingoPhase === 'resume') &&
                        (mine.guestCardCount || 0) > 0
                    ) {
                        setLobbyPref(false);
                        if (els.play && els.play.hidden) {
                            startPlay();
                        }
                    }
                }
            } catch (e) {
                els.gamesList.innerHTML = '<p class="gh-bingo-danger">Could not load games.</p>';
            }
        }

        async function purchaseVirtualTickets(gameId, quantity, buyMore) {
            const name = opts.customerName();
            if (!name) return { ok: false, error: 'name' };
            const dev = opts.deviceId();
            if (!dev) {
                return { ok: false, error: 'This device could not be identified — refresh the hub and try again' };
            }
            const qty = Math.max(1, Number(quantity) || 1);
            const pathSegment = buyMore ? 'add-tickets' : 'join';
            let res;
            try {
                res = await fetch(
                    '/api/event/' +
                        encodeURIComponent(slug) +
                        '/bingo/games/' +
                        gameId +
                        '/' +
                        pathSegment,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customerName: name,
                            deviceId: dev,
                            quantity: qty
                        })
                    }
                );
            } catch (e) {
                return { ok: false, error: 'Network error — check your connection and try again' };
            }
            let data = {};
            const bodyText = await res.text();
            if (bodyText) {
                try {
                    data = JSON.parse(bodyText);
                } catch (parseErr) {
                    return {
                        ok: false,
                        error: res.ok
                            ? 'Unexpected server response'
                            : 'Could not get tickets (HTTP ' + res.status + ')'
                    };
                }
            }
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
            const alreadyOnPlay = els.play && !els.play.hidden;
            if (alreadyOnPlay) {
                await refreshPlay();
                loadGames({ silent: true });
            } else {
                startPlay();
            }
            return { ok: true };
        }

        async function joinVirtual(gameId, quantity) {
            const havePlay = guestHasTicketsForGame(playDataForDock(), gameId);
            return purchaseVirtualTickets(gameId, quantity, havePlay);
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
                if (data.phase === 'intro' || data.phase === 'resume') {
                    setLobbyPref(false);
                }
                showPlay();
                applyPlayTheme(data);
                playingFor =
                    data.playingFor ||
                    ((data.cardFormat || (data.game && data.game.cardFormat)) === 'us-75'
                        ? 'four-corners'
                        : 'line');
                if (els.gameTitle) {
                    els.gameTitle.textContent =
                        (data.game && data.game.title) || data.title || 'Bingo';
                }
                if (els.lastBall) els.lastBall.textContent = data.lastBall != null ? data.lastBall : '—';
                renderRecentBalls(els.recentBalls, data.calledBalls, {
                    progressEl: els.callProgress,
                    calledCount: data.calledCount,
                    ballCount: data.ballCount
                });
                renderPrizeBar(
                    els.prizeBar,
                    data.playingFor,
                    data.prizeWinners,
                    data.cardFormat || (data.game && data.game.cardFormat)
                );
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
                stackCards = enrichCardsProgress(stackCards, data.calledBalls, data);
                if (stackCards.length) {
                    const readySerial = claimCardSerial(stackCards);
                    if (readySerial) activeSerial = readySerial;
                }
                if (activeSerial && stackCards.every((c) => c.serial !== activeSerial)) {
                    activeSerial = data.card && data.card.serial ? data.card.serial : stackCards[0]?.serial;
                } else if (!activeSerial && data.card) {
                    activeSerial = data.card.serial;
                }
                lastStackPayload = { cards: stackCards, calledBalls: data.calledBalls || [], data: data };
                syncGuestResume(data);
                syncGuestIntro(data);
                renderCardStack(stackCards, data.calledBalls, activeSerial);
                syncBuyTicketsVisibility(root, data);
                updateCallUi(stackCards, activeSerial, data);
                maybeAnnounceBall(data);
                syncWinnersModal(data);
                if (els.meta) {
                    let t = data.active ? (data.paused ? 'Paused' : 'Live') : 'Waiting to start';
                    if (data.showWinnersPopup) {
                        t = 'Game over';
                    } else if (data.phase === 'claim_break') {
                        t = 'Claims open · ' + (data.claimBreakRemainingSec || '') + 's';
                    } else if (data.paused) {
                        t =
                            data.pausedReason === 'manual'
                                ? 'Paused — game on hold'
                                : 'Paused — claim check';
                    }
                    if (data.phase === 'intro') {
                        const introSec =
                            data.introRemainingSec != null
                                ? data.introRemainingSec
                                : Math.max(1, Math.ceil(guestIntroRemainingMs(data) / 1000));
                        t = 'Starting in ' + introSec + 's';
                    }
                    else if (data.phase === 'resume') {
                        const lb = resolveLastCalledBall(data);
                        const resumeSec =
                            data.resumeRemainingSec != null
                                ? data.resumeRemainingSec
                                : Math.max(1, Math.ceil(guestResumeRemainingMs(data) / 1000));
                        t =
                            'Resuming · ' +
                            resumeSec +
                            's' +
                            (lb != null ? ' · last ' + lb : '');
                    }
                    els.meta.textContent = t;
                }
                updatePollCadence(data);
            } catch (e) {
                /* keep dock in sync if partial render failed */
                if (lastStackPayload && lastStackPayload.data) {
                    try {
                        updateCallUi(
                            lastStackPayload.cards || [],
                            activeSerial,
                            lastStackPayload.data
                        );
                    } catch (e2) {
                        /* ignore */
                    }
                }
            }
        }

        function startPlay() {
            winnersDismissedLocally = false;
            showPlay();
            refreshPlay();
            startPoll();
        }

        function startPoll() {
            clearInterval(pollTimer);
            pollDelayMs = 2200;
            pollTimer = setInterval(refreshPlay, pollDelayMs);
        }

        function updatePollCadence(data) {
            let wantMs = 2800;
            if (data && data.active) wantMs = 650;
            else if (data && (data.phase === 'intro' || data.phase === 'resume')) wantMs = 650;
            if (!pollTimer) return;
            if (wantMs === pollDelayMs) return;
            pollDelayMs = wantMs;
            clearInterval(pollTimer);
            pollTimer = setInterval(refreshPlay, pollDelayMs);
        }

        function stopPoll() {
            clearInterval(pollTimer);
            pollTimer = null;
            pollDelayMs = 2200;
            stopCountdownTick();
        }

        async function sendClaim(claimType) {
            const name = opts.customerName();
            const resultEl = els.claimResult;
            const playData = lastStackPayload && lastStackPayload.data ? lastStackPayload.data : null;
            if (!activeGameId || !name) return;
            if (playData && bingoGuestPreClaimPlay(playData)) {
                if (resultEl) {
                    resultEl.textContent = 'Wait for the game to start before claiming';
                    resultEl.className =
                        (resultEl.classList.contains('guest-bingo-claim-result')
                            ? 'guest-bingo-claim-result '
                            : 'gh-bingo-claim-result ') + 'is-warn';
                }
                return;
            }
            const dev = opts.deviceId();
            if (!dev) {
                if (resultEl) {
                    resultEl.textContent = 'Refresh the hub and try again';
                    resultEl.className =
                        (resultEl.classList.contains('guest-bingo-claim-result')
                            ? 'guest-bingo-claim-result '
                            : 'gh-bingo-claim-result ') + 'is-warn';
                }
                return;
            }
            const tier = claimType || playingFor || (playData && playData.playingFor) || 'line';
            const cardsForClaim =
                lastStackPayload && lastStackPayload.cards ? lastStackPayload.cards : [];
            const serialForClaim = claimCardSerial(cardsForClaim) || activeSerial;
            if (selfVerifiedClaimKeys.has(verifiedClaimKey(tier, serialForClaim)) || claimInFlight) return;
            claimInFlight = true;
            const cardsSnap = lastStackPayload && lastStackPayload.cards ? lastStackPayload.cards : [];
            syncCallButtonDisabled(
                playData || { active: true, playingFor: tier, phase: 'calling' }
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
                            deviceId: dev,
                            serial: serialForClaim || undefined
                        })
                    }
                );
                let data = null;
                try {
                    data = await res.json();
                } catch (parseErr) {
                    if (resultEl) resultEl.textContent = 'Could not send claim — try again';
                    return;
                }
                if (!res.ok) {
                    if (resultEl) {
                        resultEl.textContent = data.error || data.message || 'Could not send claim';
                        resultEl.className =
                            (resultEl.classList.contains('guest-bingo-claim-result')
                                ? 'guest-bingo-claim-result '
                                : 'gh-bingo-claim-result ') + 'is-warn';
                    }
                    return;
                }
                if (resultEl) {
                    resultEl.textContent =
                        data.message || (data.valid ? 'Claim sent to the DJ!' : 'Not yet — keep dabbing');
                    resultEl.className =
                        (resultEl.classList.contains('guest-bingo-claim-result')
                            ? 'guest-bingo-claim-result '
                            : 'gh-bingo-claim-result ') + (data.valid ? 'is-ok' : 'is-warn');
                }
                if (data.verified) {
                    selfVerifiedClaimKeys.add(verifiedClaimKey(tier, serialForClaim));
                    if (data.playingFor) playingFor = data.playingFor;
                    if (data.showWinnersPopup || data.gameEnded) {
                        const merged = Object.assign({}, playData || {}, data, {
                            showWinnersPopup: !!data.showWinnersPopup,
                            prizeWinners: data.prizeWinners || (playData && playData.prizeWinners)
                        });
                        syncWinnersModal(merged);
                    }
                    refreshPlay();
                } else if (data.alreadyVerified) {
                    selfVerifiedClaimKeys.add(verifiedClaimKey(tier, serialForClaim));
                }
            } catch (e) {
                if (resultEl) resultEl.textContent = 'Could not send claim — check your connection';
            } finally {
                claimInFlight = false;
                if (lastStackPayload && lastStackPayload.data) {
                    updateCallUi(cardsSnap, activeSerial, lastStackPayload.data);
                }
            }
        }

        function playDataForDock() {
            return lastStackPayload && lastStackPayload.data ? lastStackPayload.data : null;
        }

        function handleDockCallButtonClick(btn) {
            if (!btn) return;
            els.callBtn = btn;
            const mode = btn.getAttribute('data-dock-mode');
            if (mode === 'lobby') {
                backToLobby();
                return;
            }
            sendClaim(playingFor);
        }

        function dockClickInScope(btn) {
            if (!btn) return false;
            if (root.contains(btn)) return true;
            const playDock = q('[data-bingo-play-dock]');
            return !!(playDock && playDock.contains(btn));
        }

        (root.addEventListener ? root : document).addEventListener('click', function (e) {
            const buyBtn =
                e.target && e.target.closest ? e.target.closest('[data-bingo-buy-tickets]') : null;
            if (buyBtn && (root.contains(buyBtn) || buyBtn.closest('[data-bingo-root]'))) {
                e.preventDefault();
                openBuyFromPlayUi();
                return;
            }
            const btn = e.target && e.target.closest ? e.target.closest('[data-bingo-call]') : null;
            if (!dockClickInScope(btn)) return;
            handleDockCallButtonClick(btn);
        });

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

        function ensurePlayBuyUi(data) {
            syncBuyTicketsVisibility(
                root,
                data != null
                    ? data
                    : lastStackPayload && lastStackPayload.data
                      ? lastStackPayload.data
                      : null
            );
        }

        ensurePlayBuyUi(null);

        return {
            loadGames,
            joinVirtual,
            linkPaper,
            startPlay,
            startPoll,
            stopPoll,
            refreshPlay,
            ensurePlayBuyUi,
            openBuyTickets: openBuyFromPlayUi,
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
        escapeHtml,
        ensureGuestToolbarBuy,
        ensureGuestBuyBanner,
        syncBuyTicketsVisibility
    };
})(typeof window !== 'undefined' ? window : global);