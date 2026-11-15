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

    function bingoGuestGameRunning(data) {
        if (!data) return false;
        const gameStatus = data.game && data.game.status ? String(data.game.status) : '';
        const phase = data.phase ? String(data.phase) : '';
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
            (data.calledCount != null && data.calledCount > 0)
        );
    }

    function bingoGuestPreClaimPlay(data) {
        if (!data || data.showWinnersPopup) return false;
        const phase = String(data.phase || '');
        if (phase === 'intro' || phase === 'resume') return true;
        if (!data.active) return true;
        if ((data.calledCount || 0) === 0 && phase !== 'calling' && phase !== 'claim_break') return true;
        return false;
    }

    function guestTicketRemaining(data) {
        if (!data) return 0;
        const have = data.allCards && data.allCards.length ? data.allCards.length : 0;
        return ticketsRemaining(data.cardLimit, have);
    }

    function guestGameStatusEnded(data) {
        return !!(data && data.game && String(data.game.status || '') === 'ended');
    }

    function syncBuyTicketsVisibility(buyEl, data) {
        if (!buyEl) return;
        buyEl.hidden = true;
        buyEl.setAttribute('hidden', '');
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
        let resumeEndsAtLocal = null;

        let buyModalEls = null;
        let settingsModalEls = null;
        let winnersModalEls = null;
        let winnersModalShown = false;
        let winnersDismissedLocally = false;

        function guestShouldShowGameOver(data) {
            if (!data || winnersDismissedLocally) return false;
            if (data.showWinnersPopup) return true;
            if (guestGameStatusEnded(data)) return true;
            return false;
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

        function ticketsRemaining(cardLimit, currentCount) {
            const limit = Math.max(1, Number(cardLimit) || 1);
            const have = Math.max(0, Number(currentCount) || 0);
            return Math.max(0, limit - have);
        }

        function ensureBuyTicketsModal() {
            if (buyModalEls) return buyModalEls;
            const host =
                typeof document !== 'undefined' && document.body
                    ? document.body
                    : root.querySelector('[data-bingo-root]') ||
                      root.querySelector('[data-bingo-play]') ||
                      root;
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

            function closeBuyModal() {
                wrap.hidden = true;
                pendingGameId = null;
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
                const result = await joinVirtual(pendingGameId, qty);
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

            buyModalEls.open = function (gameId, remaining) {
                pendingGameId = gameId;
                const max = Math.max(1, remaining);
                syncQtyBounds(max);
                buyModalEls.qty.value = String(Math.min(max, max > 2 ? 2 : 1));
                wrap.hidden = false;
            };

            return buyModalEls;
        }

        function openBuyTicketsModal(gameId, remaining) {
            if (!opts.customerName()) return { ok: false, error: 'Enter your name on the hub first' };
            if (remaining <= 0) return { ok: false, error: 'No more tickets available for this game' };
            const modal = ensureBuyTicketsModal();
            modal.open(gameId, remaining);
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

        if (els.buyTickets) {
            els.buyTickets.addEventListener('click', function () {
                if (!activeGameId) return;
                const data = lastStackPayload && lastStackPayload.data ? lastStackPayload.data : null;
                const have =
                    data && data.allCards
                        ? data.allCards.length
                        : data && data.guestCards
                          ? data.guestCards.length
                          : 0;
                const rem = data ? ticketsRemaining(data.cardLimit, have) : 1;
                openBuyTicketsModal(activeGameId, rem);
            });
        }

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
            if (!els.callBtn) return;
            const list = cards && cards.length ? cards : [];
            els.callBtn.classList.remove('guest-bingo-dock-btn--buy', 'guest-bingo-dock-btn--lobby');

            if (guestShouldShowGameOver(data)) {
                els.callBtn.setAttribute('data-dock-mode', 'lobby');
                els.callBtn.textContent = 'Back to lobby';
                els.callBtn.disabled = false;
                els.callBtn.classList.add('guest-bingo-dock-btn--lobby');
                els.callBtn.classList.remove('guest-bingo-call--ready');
                if (els.playDock) {
                    els.playDock.classList.add('guest-bingo--dock-buy');
                }
                return;
            }

            const preClaim = bingoGuestPreClaimPlay(data);
            const rem = guestTicketRemaining(data);
            const canBuy = !!(data && data.canGrabMore && rem > 0);
            const buyMode = preClaim || (!list.length && canBuy);

            if (els.playDock) {
                els.playDock.classList.toggle('guest-bingo--dock-buy', !!buyMode);
            }

            if (buyMode) {
                els.callBtn.setAttribute('data-dock-mode', 'buy');
                els.callBtn.classList.remove('guest-bingo-call--ready');
                if (canBuy) {
                    if (!list.length) {
                        els.callBtn.textContent = rem > 1 ? 'Get tickets · ' + rem + ' left' : 'Get tickets';
                    } else {
                        els.callBtn.textContent = rem > 1 ? 'Buy tickets · ' + rem + ' left' : 'Buy tickets';
                    }
                    els.callBtn.disabled = false;
                    els.callBtn.classList.add('guest-bingo-dock-btn--buy');
                } else {
                    els.callBtn.textContent =
                        data && data.phase === 'intro'
                            ? 'Starting soon'
                            : data && data.phase === 'resume'
                              ? 'Resuming soon'
                              : 'Waiting to start';
                    els.callBtn.disabled = true;
                }
                return;
            }

            els.callBtn.setAttribute('data-dock-mode', 'claim');
            const label = (data && data.playingForLabel) || 'prize';
            els.callBtn.textContent = 'Claim — ' + label;
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

        function manualMarksFor(serial) {
            const key = String(serial || '');
            if (!manualMarksBySerial[key]) manualMarksBySerial[key] = emptyManualMarks();
            return manualMarksBySerial[key];
        }

        function effectiveMarkedCalledBalls(item, calledBalls) {
            const called = new Set(calledBalls || []);
            if (!item || !item.grid) return [];
            if (autoDab) return calledBalls || [];
            const manual = manualMarksFor(item.serial);
            const out = [];
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 9; c++) {
                    const n = item.grid[r][c];
                    if (n != null && called.has(n) && manual[r][c]) out.push(n);
                }
            }
            return out;
        }

        function guestProgressTowardClaim(grid, calledBalls, playingFor, prizeLabel) {
            if (!grid) return { toGo: null, label: '' };
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
            return cards.map(function (c) {
                const balls = effectiveMarkedCalledBalls(c, calledBalls);
                const p = guestProgressTowardClaim(c.grid, balls, pf, prizeLabel);
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
            if (!els.callBtn) return;
            syncDockPrimaryAction(data, cards);
            const dockMode = els.callBtn.getAttribute('data-dock-mode');
            if (dockMode === 'buy' || dockMode === 'lobby') return;
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
                    const manual = manualMarksFor(item.serial);
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
                clearInterval(lobbyPollTimer);
                lobbyPollTimer = null;
            }
        }

        function startLobbyPoll() {
            if (lobbyPollTimer) return;
            lobbyPollTimer = setInterval(function () {
                if (els.play && !els.play.hidden) {
                    stopLobbyPoll();
                    return;
                }
                loadGames();
            }, 1000);
        }

        function showJoin() {
            setPanelHidden(els.lobbyChrome, false);
            if (!els.lobbyChrome) setPanelHidden(els.join, false);
            setPanelHidden(els.play, true);
            setPanelHidden(els.playDock, true);
            setPanelHidden(els.countdownBar, true);
            startLobbyPoll();
        }

        function showPlay() {
            setPanelHidden(els.lobbyChrome, true);
            if (!els.lobbyChrome) setPanelHidden(els.join, true);
            setPanelHidden(els.play, false);
            setPanelHidden(els.playDock, false);
            setLobbyPref(false);
            stopLobbyPoll();
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
                        const ticketCount = Number(g.guestCardCount || 0);
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
                        let subtitle = '';
                        if (!hasCards) {
                            subtitle = 'Tap to get tickets on this phone';
                        } else if (g.bingoPhase === 'intro') {
                            subtitle = 'Starting in ' + (g.introRemainingSec || '…') + 's · tap to see countdown';
                        } else if (g.bingoPhase === 'resume') {
                            subtitle = 'Back in ' + (g.resumeRemainingSec || '…') + 's · tap to continue';
                        } else if (g.playInProgress) {
                            subtitle =
                                ticketCount +
                                ' ticket' +
                                (ticketCount === 1 ? '' : 's') +
                                ' · game in progress';
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
                            badgeMod +
                            '">' +
                            escapeHtml(badgeText) +
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
                            const rem = ticketsRemaining(
                                btn.getAttribute('data-card-limit'),
                                btn.getAttribute('data-guest-card-count')
                            );
                            openBuyTicketsModal(gid, rem);
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
                        openBuyTicketsModal(gid, rem);
                    });
                });

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

        async function joinVirtual(gameId, quantity) {
            const name = opts.customerName();
            if (!name) return { ok: false, error: 'name' };
            const qty = Math.max(1, Number(quantity) || 1);
            try {
                const res = await fetch(
                    '/api/event/' + encodeURIComponent(slug) + '/bingo/games/' + gameId + '/join',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customerName: name,
                            deviceId: opts.deviceId(),
                            quantity: qty
                        })
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
                if (data.phase === 'intro' || data.phase === 'resume') {
                    setLobbyPref(false);
                }
                showPlay();
                applyPlayTheme(data);
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
                syncBuyTicketsVisibility(els.buyTickets, data);
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
                /* ignore transient */
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
            const wantMs =
                data && (data.phase === 'intro' || data.phase === 'resume') ? 600 : 2200;
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
            if (els.callBtn && els.callBtn.getAttribute('data-dock-mode') === 'buy') return;
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

        if (els.callBtn) {
            els.callBtn.addEventListener('click', function () {
                const mode = els.callBtn.getAttribute('data-dock-mode');
                if (mode === 'lobby') {
                    backToLobby();
                    return;
                }
                if (mode === 'buy') {
                    if (!activeGameId || els.callBtn.disabled) return;
                    const data = lastStackPayload && lastStackPayload.data ? lastStackPayload.data : null;
                    const rem = guestTicketRemaining(data);
                    if (!data || !data.canGrabMore || rem <= 0) return;
                    openBuyTicketsModal(activeGameId, rem);
                    return;
                }
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