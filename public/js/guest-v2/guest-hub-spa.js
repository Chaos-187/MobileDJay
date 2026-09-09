/**
 * Guest Hub SPA — single-page guest experience at /event/:slug/v2
 */
(function (global) {
    'use strict';

    var cfg = global.GuestHubConfig || {};
    var slug = cfg.eventSlug || global.eventSlug || '';
    var guestSession = global.MdjGuestSession;
    var djName = cfg.djName || global.djName || 'DJ';

    var state = {
        tab: 'home',
        musicMode: 'songs',
        guestName: '',
        selectedSongId: null,
        selectedKaraokeId: null,
        chatPoll: null,
        lastTimelineKey: '',
        npTrack: null
    };

    var els = {};

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        els.app = document.getElementById('ghApp');
        if (!els.app) return;

        if (!cfg.showOptionDesc) document.body.classList.add('gh-no-desc');

        state.guestName = getStoredName();
        renderShell();

        if (!state.guestName) {
            showGate();
        } else {
            hideGate();
            onGuestReady();
        }

        bindGlobalEvents();
    }

    /* ── Storage ── */

    function getStoredName() {
        return guestSession ? guestSession.getGuestName(slug) : (sessionStorage.getItem('customerName') || '').trim();
    }

    function rememberName(name) {
        state.guestName = name;
        if (guestSession) guestSession.setGuestName(slug, name);
        else sessionStorage.setItem('customerName', name);
    }

    /* ── Shell render ── */

    function renderShell() {
        var f = cfg.features || {};
        var navItems = buildNavItems(f);

        els.app.innerHTML =
            '<div id="ghGate" class="gh-gate" hidden>' + gateHtml() + '</div>' +
            '<header class="gh-header">' +
                '<div class="gh-header__row">' +
                    '<p class="gh-header__event">' + esc(cfg.eventName) + '</p>' +
                    '<button type="button" id="ghNamePill" class="gh-header__pill" hidden>' +
                        'Hi, <strong id="ghNameLabel"></strong>' +
                    '</button>' +
                '</div>' +
            '</header>' +
            '<main class="gh-main">' +
                '<section id="ghPanelHome" class="gh-panel is-active">' + homePanelHtml(f) + '</section>' +
                (f.songs || f.karaoke ? '<section id="ghPanelMusic" class="gh-panel">' + musicPanelHtml(f) + '</section>' : '') +
                (f.messages ? '<section id="ghPanelChat" class="gh-panel">' + chatPanelHtml() + '</section>' : '') +
                '<section id="ghPanelMore" class="gh-panel">' + morePanelHtml(f) + '</section>' +
            '</main>' +
            '<nav class="gh-nav" aria-label="Guest hub">' + navItems + '</nav>' +
            '<div id="ghSheetBackdrop" class="gh-sheet-backdrop"></div>' +
            '<div id="ghTipSheet" class="gh-sheet">' +
                '<div class="gh-sheet__panel">' +
                    '<h2 class="gh-sheet__title"><i class="fas fa-heart me-2"></i>Tip the DJ</h2>' +
                    '<p class="gh-sheet__sub">Choose a payment method</p>' +
                    '<div id="ghTipOptions"></div>' +
                '</div>' +
            '</div>';

        cacheElements();
        bindShellEvents(f);
    }

    function buildNavItems(f) {
        var items = [
            navBtn('home', 'fa-house', 'Home')
        ];
        if (f.songs || f.karaoke) items.push(navBtn('music', 'fa-compact-disc', 'Music'));
        if (f.messages) items.push(navBtn('chat', 'fa-comment-dots', 'Chat', 'ghChatBadge'));
        items.push(navBtn('more', 'fa-ellipsis', 'More'));
        return items.join('');
    }

    function navBtn(id, icon, label, badgeId) {
        var active = id === 'home' ? ' is-active' : '';
        var badge = badgeId
            ? '<span id="' + badgeId + '" class="gh-nav__badge" hidden>0</span>'
            : '';
        return '<button type="button" class="gh-nav__btn' + active + '" data-tab="' + id + '">' +
            badge + '<i class="fas ' + icon + '"></i><span>' + label + '</span></button>';
    }

    function gateHtml() {
        return '<div class="gh-gate__inner">' +
            '<span class="gh-gate__badge"><i class="fas fa-sparkles"></i> Guest Hub</span>' +
            '<h1 class="gh-gate__title">' + esc(cfg.eventName) + '</h1>' +
            '<p class="gh-gate__sub">Enter your name once — then request songs, chat with the DJ, and join the fun.</p>' +
            '<div class="gh-gate__field">' +
                '<input type="text" id="ghGateInput" class="gh-input" placeholder="Your name…" maxlength="50" autocomplete="name" enterkeyhint="go">' +
                '<button type="button" id="ghGateSubmit" class="gh-btn gh-btn--accent gh-btn--icon" aria-label="Continue">' +
                    '<i class="fas fa-arrow-right"></i>' +
                '</button>' +
            '</div>' +
            '<p class="gh-hint">Your name is unique for this event on this device.</p>' +
            '<div id="ghGateError" class="gh-error" hidden role="alert"></div>' +
        '</div>';
    }

    function homePanelHtml(f) {
        var actions = '';
        if (f.songs) actions += actionTile('songs', 'fa-music', 'Song request', 'Search the library', 'music');
        if (f.karaoke) actions += actionTile('karaoke', 'fa-microphone', 'Karaoke', 'Grab the mic', 'music');
        if (f.messages) actions += actionTile('chat', 'fa-comment-dots', 'Messages', 'Chat with the DJ', 'chat');
        if (f.photos) actions += actionTile('camera', 'fa-camera', 'Event Cam', 'Snap for the album', 'camera');

        return '<div class="gh-vinyl-wrap">' +
                '<div id="ghVinyl" class="gh-vinyl">' +
                    '<div class="gh-vinyl__disc"></div>' +
                    '<img id="ghNpArt" class="gh-vinyl__art" alt="" hidden>' +
                    '<div id="ghNpIcon" class="gh-vinyl__icon"><i class="fas fa-compact-disc"></i></div>' +
                '</div>' +
                '<p id="ghNpLabel" class="gh-vinyl__label" hidden>Now playing</p>' +
                '<h2 id="ghNpTitle" class="gh-vinyl__title">' + esc(cfg.eventName) + '</h2>' +
                '<p id="ghNpArtist" class="gh-vinyl__artist">Tap an action below to get started</p>' +
            '</div>' +
            (actions ? '<p class="gh-grid-label">Quick actions</p><div class="gh-action-grid">' + actions + '</div>' : '');
    }

    function actionTile(mode, icon, title, desc, tab) {
        var iconClass = mode === 'karaoke' ? 'karaoke' : mode === 'chat' ? 'chat' : mode === 'camera' ? 'cam' : 'songs';
        return '<button type="button" class="gh-action" data-action="' + mode + '" data-tab="' + tab + '">' +
            '<span class="gh-action__icon gh-action__icon--' + iconClass + '"><i class="fas ' + icon + '"></i></span>' +
            '<span class="gh-action__title">' + esc(title) + '</span>' +
            (cfg.showOptionDesc ? '<span class="gh-action__desc">' + esc(desc) + '</span>' : '') +
        '</button>';
    }

    function musicPanelHtml(f) {
        var seg = '';
        if (f.songs && f.karaoke) {
            seg = '<div class="gh-segment">' +
                '<button type="button" class="gh-segment__btn is-active" data-music="songs">Songs</button>' +
                '<button type="button" class="gh-segment__btn" data-music="karaoke">Karaoke</button>' +
            '</div>';
        } else if (f.karaoke) {
            state.musicMode = 'karaoke';
        }

        var tracks = cfg.showTracksPlayed
            ? '<details class="gh-tracks" id="ghTracks"><summary><i class="fas fa-list-ul me-2"></i>Recently played</summary><ul id="ghTracksList"><li>Loading…</li></ul></details>'
            : '';

        return seg + tracks +
            '<div class="gh-search"><i class="fas fa-search"></i>' +
                '<input type="search" id="ghMusicSearch" placeholder="Search at least 3 characters…" autocomplete="off" enterkeyhint="search">' +
            '</div>' +
            '<div id="ghMusicResults" class="gh-results">' +
                '<div class="gh-empty"><i class="fas fa-music"></i><p>Search to find tracks</p></div>' +
            '</div>' +
            '<div id="ghMusicSubmit" class="gh-sticky-submit" hidden>' +
                '<button type="button" id="ghSubmitRequest" class="gh-btn gh-btn--accent">' +
                    '<i class="fas fa-paper-plane"></i> Submit request' +
                '</button>' +
            '</div>';
    }

    function chatPanelHtml() {
        return '<div class="gh-chat guest-chat-shell">' +
            '<div id="ghChatThread" class="guest-chat-thread" role="log" aria-live="polite">' +
                '<div class="guest-chat-thread__empty"><i class="fas fa-spinner fa-spin"></i><p class="mb-0">Loading…</p></div>' +
            '</div>' +
            '<div class="guest-chat-composer">' +
                '<div class="guest-chat-composer__toolbar">' +
                    '<label class="guest-chat-composer__privacy" for="ghDjOnly">' +
                        '<input class="form-check-input" type="checkbox" id="ghDjOnly" value="1">' +
                        '<span><i class="fas fa-user-lock me-1"></i>DJ only</span>' +
                    '</label>' +
                    '<span id="ghCharCount" class="guest-chat-composer__char">0/500</span>' +
                '</div>' +
                '<div class="guest-chat-composer__row">' +
                    '<div id="ghChatInput" class="guest-chat-composer__input" contenteditable="true" role="textbox" ' +
                        'aria-label="Type a message" data-placeholder="Message the DJ…"></div>' +
                    '<button type="button" id="ghChatSend" class="guest-chat-composer__send" aria-label="Send">' +
                        '<i class="fas fa-paper-plane"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function morePanelHtml(f) {
        var items = '';
        if (f.photos) {
            items += moreItem('button', 'camera', 'fa-camera', 'Event Cam', 'Take a photo for the album');
        }
        if (f.tips && cfg.tipLinks && cfg.tipLinks.length) {
            items += moreItem('button', 'tips', 'fa-heart', 'Tip the DJ', 'Show your appreciation');
        }
        items += moreItem('button', 'rename', 'fa-user-pen', 'Change name', 'Use a different display name');
        items += '<a class="gh-more-item" href="/event/' + escAttr(slug) + '">' +
            '<span class="gh-more-item__icon"><i class="fas fa-arrow-left"></i></span>' +
            '<span class="gh-more-item__body">' +
                '<p class="gh-more-item__title">Classic guest page</p>' +
                '<p class="gh-more-item__sub">Switch to the original layout</p>' +
            '</span>' +
            '<i class="fas fa-chevron-right" style="color:var(--gh-muted);font-size:0.8rem"></i>' +
        '</a>';

        return '<div class="gh-more-list">' + items + '</div>' +
            '<p class="gh-footer-note">&copy; ' + new Date().getFullYear() + ' EYUP EVENTS UK LTD</p>';
    }

    function moreItem(tag, action, icon, title, sub) {
        return '<' + tag + ' type="button" class="gh-more-item" data-more="' + action + '">' +
            '<span class="gh-more-item__icon"><i class="fas ' + icon + '"></i></span>' +
            '<span class="gh-more-item__body">' +
                '<p class="gh-more-item__title">' + esc(title) + '</p>' +
                '<p class="gh-more-item__sub">' + esc(sub) + '</p>' +
            '</span>' +
            '<i class="fas fa-chevron-right" style="color:var(--gh-muted);font-size:0.8rem"></i>' +
        '</' + tag + '>';
    }

    function cacheElements() {
        els.gate = document.getElementById('ghGate');
        els.gateInput = document.getElementById('ghGateInput');
        els.gateSubmit = document.getElementById('ghGateSubmit');
        els.gateError = document.getElementById('ghGateError');
        els.namePill = document.getElementById('ghNamePill');
        els.nameLabel = document.getElementById('ghNameLabel');
        els.navBtns = els.app.querySelectorAll('.gh-nav__btn');
        els.panels = {
            home: document.getElementById('ghPanelHome'),
            music: document.getElementById('ghPanelMusic'),
            chat: document.getElementById('ghPanelChat'),
            more: document.getElementById('ghPanelMore')
        };
        els.vinyl = document.getElementById('ghVinyl');
        els.npArt = document.getElementById('ghNpArt');
        els.npIcon = document.getElementById('ghNpIcon');
        els.npLabel = document.getElementById('ghNpLabel');
        els.npTitle = document.getElementById('ghNpTitle');
        els.npArtist = document.getElementById('ghNpArtist');
        els.musicSearch = document.getElementById('ghMusicSearch');
        els.musicResults = document.getElementById('ghMusicResults');
        els.musicSubmit = document.getElementById('ghMusicSubmit');
        els.submitRequest = document.getElementById('ghSubmitRequest');
        els.chatThread = document.getElementById('ghChatThread');
        els.chatInput = document.getElementById('ghChatInput');
        els.chatSend = document.getElementById('ghChatSend');
        els.djOnly = document.getElementById('ghDjOnly');
        els.charCount = document.getElementById('ghCharCount');
        els.chatBadge = document.getElementById('ghChatBadge');
        els.tipSheet = document.getElementById('ghTipSheet');
        els.tipBackdrop = document.getElementById('ghSheetBackdrop');
        els.tipOptions = document.getElementById('ghTipOptions');
        els.tracks = document.getElementById('ghTracks');
        els.tracksList = document.getElementById('ghTracksList');
    }

    /* ── Events ── */

    function bindGlobalEvents() {
        var camClose = document.getElementById('ghCameraClose');
        var camOverlay = document.getElementById('ghCameraOverlay');
        if (camClose) {
            camClose.addEventListener('click', function () {
                camOverlay.hidden = true;
                document.getElementById('ghCameraFrame').src = 'about:blank';
            });
        }
    }

    function bindShellEvents(f) {
        if (els.gateSubmit) {
            els.gateSubmit.addEventListener('click', submitGateName);
            els.gateInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') submitGateName();
            });
        }

        if (els.namePill) {
            els.namePill.addEventListener('click', function () {
                showGate(state.guestName);
            });
        }

        els.navBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                setTab(btn.getAttribute('data-tab'));
            });
        });

        els.app.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.getAttribute('data-action');
                var tab = btn.getAttribute('data-tab');
                if (action === 'camera') openCamera();
                else if (tab === 'music') {
                    state.musicMode = action === 'karaoke' ? 'karaoke' : 'songs';
                    setTab('music');
                    syncMusicSegment();
                } else if (tab === 'chat') setTab('chat');
            });
        });

        els.app.querySelectorAll('[data-more]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.getAttribute('data-more');
                if (action === 'camera') openCamera();
                else if (action === 'tips') openTipSheet();
                else if (action === 'rename') showGate(state.guestName);
            });
        });

        if (els.musicSearch) {
            var searchTimer;
            els.musicSearch.addEventListener('input', function () {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(runMusicSearch, 300);
            });
        }

        if (els.submitRequest) {
            els.submitRequest.addEventListener('click', submitMusicRequest);
        }

        els.app.querySelectorAll('[data-music]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.musicMode = btn.getAttribute('data-music');
                state.selectedSongId = null;
                state.selectedKaraokeId = null;
                syncMusicSegment();
                runMusicSearch();
            });
        });

        if (els.chatSend) els.chatSend.addEventListener('click', sendChatMessage);
        if (els.chatInput) {
            els.chatInput.addEventListener('input', updateCharCount);
            els.chatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                }
            });
        }

        if (els.tipBackdrop) {
            els.tipBackdrop.addEventListener('click', closeTipSheet);
        }

        if (els.tracks) {
            els.tracks.addEventListener('toggle', function () {
                if (els.tracks.open) loadTracksPlayed();
            });
        }
    }

    /* ── Name gate ── */

    function showGate(prefill) {
        if (!els.gate) return;
        els.gate.hidden = false;
        els.gateInput.value = prefill || '';
        els.gateError.hidden = true;
        setTimeout(function () { els.gateInput.focus(); }, 100);
    }

    function hideGate() {
        if (els.gate) els.gate.hidden = true;
    }

    async function submitGateName() {
        var name = els.gateInput.value.trim();
        if (!name) {
            showGateError('Please enter your name');
            return;
        }
        showGateError('');
        els.gateSubmit.disabled = true;
        try {
            if (guestSession && slug) {
                var result = await guestSession.registerCheckin(name);
                if (!result.ok && result.data && result.data.error === 'name_taken') {
                    showGateError(result.data.message || 'That name is already in use.');
                    els.gateInput.focus();
                    return;
                }
            }
            rememberName(name);
            hideGate();
            updateNameUI();
            onGuestReady();
        } finally {
            els.gateSubmit.disabled = false;
        }
    }

    function showGateError(msg) {
        if (!msg) {
            els.gateError.hidden = true;
            els.gateError.textContent = '';
            return;
        }
        els.gateError.hidden = false;
        els.gateError.textContent = msg;
    }

    function updateNameUI() {
        if (els.nameLabel) els.nameLabel.textContent = state.guestName;
        if (els.namePill) els.namePill.hidden = !state.guestName;
    }

    function onGuestReady() {
        updateNameUI();
        if (guestSession && slug) guestSession.registerCheckin(state.guestName);
        startNowPlaying();
        if (cfg.features && cfg.features.messages) {
            loadChatTimeline(true);
            startChatPoll();
            pollUnreadBadge();
        }
    }

    /* ── Tabs ── */

    function setTab(tab) {
        state.tab = tab;
        els.navBtns.forEach(function (btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab);
        });
        Object.keys(els.panels).forEach(function (key) {
            if (els.panels[key]) {
                els.panels[key].classList.toggle('is-active', key === tab);
            }
        });
        if (tab === 'chat' && cfg.features && cfg.features.messages) {
            loadChatTimeline(true);
        }
    }

    /* ── Now playing ── */

    function startNowPlaying() {
        fetchNowPlaying();
        setInterval(fetchNowPlaying, 3000);
    }

    async function fetchNowPlaying() {
        try {
            var url = '/api/now-playing' + (slug ? '?eventSlug=' + encodeURIComponent(slug) : '');
            var res = await fetch(url);
            var data = await res.json();
            if (data.title) {
                var key = data.title + '|' + (data.artist || '');
                if (key !== state.npTrack) {
                    state.npTrack = key;
                    if (els.npLabel) els.npLabel.hidden = false;
                    if (els.npTitle) els.npTitle.textContent = data.title;
                    if (els.npArtist) els.npArtist.textContent = data.artist || '';
                    if (data.artwork && els.npArt) {
                        els.npArt.src = data.artwork;
                        els.npArt.hidden = false;
                        if (els.npIcon) els.npIcon.hidden = true;
                    } else {
                        if (els.npArt) els.npArt.hidden = true;
                        if (els.npIcon) els.npIcon.hidden = false;
                    }
                    if (els.vinyl) els.vinyl.classList.add('is-playing');
                }
            } else {
                state.npTrack = null;
                if (els.npLabel) els.npLabel.hidden = true;
                if (els.npTitle) els.npTitle.textContent = cfg.eventName;
                if (els.npArtist) els.npArtist.textContent = 'Tap an action below to get started';
                if (els.npArt) els.npArt.hidden = true;
                if (els.npIcon) els.npIcon.hidden = false;
                if (els.vinyl) els.vinyl.classList.remove('is-playing');
            }
        } catch (e) { /* ignore */ }
    }

    /* ── Music search & submit ── */

    function syncMusicSegment() {
        els.app.querySelectorAll('[data-music]').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-music') === state.musicMode);
        });
        if (els.musicSearch) {
            els.musicSearch.placeholder = state.musicMode === 'karaoke'
                ? 'Search karaoke (3+ chars)…'
                : 'Search songs (3+ chars)…';
        }
        if (els.musicSubmit) els.musicSubmit.hidden = true;
    }

    function runMusicSearch() {
        if (!els.musicSearch || !els.musicResults) return;
        var q = els.musicSearch.value.trim();
        if (!q) {
            els.musicResults.innerHTML = '<div class="gh-empty"><i class="fas fa-search"></i><p>Start typing to search</p></div>';
            if (els.musicSubmit) els.musicSubmit.hidden = true;
            return;
        }
        if (q.length < 3) {
            els.musicResults.innerHTML = '<div class="gh-empty"><p>Enter at least 3 characters</p></div>';
            if (els.musicSubmit) els.musicSubmit.hidden = true;
            return;
        }
        var endpoint = state.musicMode === 'karaoke' ? '/api/search/karaoke' : '/api/search/songs';
        fetch(endpoint + '?q=' + encodeURIComponent(q))
            .then(function (r) { return r.json(); })
            .then(renderMusicResults)
            .catch(function () {
                toast('Search failed. Try again.', 'error');
            });
    }

    function renderMusicResults(items) {
        if (!items.length) {
            els.musicResults.innerHTML = '<div class="gh-empty"><i class="fas fa-face-frown"></i><p>No matches found</p></div>';
            if (els.musicSubmit) els.musicSubmit.hidden = true;
            return;
        }
        els.musicResults.innerHTML = items.map(function (item) {
            var id = item.id;
            var selected = (state.musicMode === 'karaoke' ? state.selectedKaraokeId : state.selectedSongId) == id;
            var badge = state.musicMode === 'karaoke' && item.difficulty
                ? '<span class="gh-result__badge">' + esc(item.difficulty) + '</span>'
                : (item.genre ? '<span class="gh-result__badge">' + esc(item.genre) + '</span>' : '');
            return '<button type="button" class="gh-result' + (selected ? ' is-selected' : '') + '" data-id="' + escAttr(id) + '">' +
                '<div class="gh-result__main">' +
                    '<p class="gh-result__title">' + esc(item.title) + '</p>' +
                    '<p class="gh-result__sub">' + esc(item.artist || '') + '</p>' +
                '</div>' + badge +
            '</button>';
        }).join('');

        els.musicResults.querySelectorAll('.gh-result').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                if (state.musicMode === 'karaoke') state.selectedKaraokeId = id;
                else state.selectedSongId = id;
                els.musicResults.querySelectorAll('.gh-result').forEach(function (b) {
                    b.classList.toggle('is-selected', b.getAttribute('data-id') === id);
                });
                if (els.musicSubmit) els.musicSubmit.hidden = false;
            });
        });
    }

    function submitMusicRequest() {
        var isKaraoke = state.musicMode === 'karaoke';
        var id = isKaraoke ? state.selectedKaraokeId : state.selectedSongId;
        if (!id) {
            toast('Select a track first', 'error');
            return;
        }
        var endpoint = isKaraoke ? '/submit-karaoke-request' : '/submit-song-request';
        var body = new URLSearchParams();
        body.set('customerName', state.guestName);
        body.set('eventSlug', slug);
        body.set(isKaraoke ? 'karaokeId' : 'songId', id);

        els.submitRequest.disabled = true;
        fetch(endpoint, { method: 'POST', body: body })
            .then(function (r) {
                if (!r.ok) throw new Error('Request failed');
                toast(isKaraoke ? 'Karaoke request sent!' : 'Song request sent!', 'success');
                state.selectedSongId = null;
                state.selectedKaraokeId = null;
                if (els.musicSubmit) els.musicSubmit.hidden = true;
                if (els.musicSearch) els.musicSearch.value = '';
                els.musicResults.innerHTML = '<div class="gh-empty"><i class="fas fa-check-circle"></i><p>Request submitted — the DJ will see it soon</p></div>';
            })
            .catch(function () {
                toast('Could not submit. Try again.', 'error');
            })
            .finally(function () {
                els.submitRequest.disabled = false;
            });
    }

    function loadTracksPlayed() {
        if (!els.tracksList || !slug) return;
        fetch('/api/event/' + encodeURIComponent(slug) + '/tracks-played')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var tracks = Array.isArray(data) ? data : (data.tracks || []);
                if (!tracks.length) {
                    els.tracksList.innerHTML = '<li>Nothing played yet</li>';
                    return;
                }
                els.tracksList.innerHTML = tracks.slice(0, 15).map(function (t) {
                    return '<li><strong>' + esc(t.title || t.track || 'Unknown') + '</strong>' +
                        (t.artist ? ' — ' + esc(t.artist) : '') + '</li>';
                }).join('');
            })
            .catch(function () {
                els.tracksList.innerHTML = '<li>Could not load</li>';
            });
    }

    /* ── Chat ── */

    function activityUrl() {
        if (guestSession) return guestSession.activityUrl(state.guestName, slug);
        var base = '/api/customer/activity/' + encodeURIComponent(state.guestName);
        return slug ? base + '?eventSlug=' + encodeURIComponent(slug) : base;
    }

    function loadChatTimeline(scrollBottom) {
        if (!els.chatThread) return;
        fetch(activityUrl())
            .then(function (r) {
                if (!r.ok) throw new Error('fail');
                return r.json();
            })
            .then(function (data) {
                var items = data.items || buildLegacyItems(data);
                renderChat(items, scrollBottom);
            })
            .catch(function () {
                els.chatThread.innerHTML = '<div class="guest-chat-thread__empty"><i class="fas fa-exclamation-triangle"></i><p>Could not load messages</p></div>';
            });
    }

    function buildLegacyItems(data) {
        var items = [];
        (data.messages || data.guestMessages || []).forEach(function (m) { items.push(Object.assign({ kind: 'message' }, m)); });
        (data.replies || []).forEach(function (r) { items.push(Object.assign({ kind: 'reply' }, r)); });
        (data.requests || []).forEach(function (r) { items.push(Object.assign({ kind: 'request' }, r)); });
        items.sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
        return items;
    }

    function timelineKey(items) {
        if (!items.length) return 'empty';
        var last = items[items.length - 1];
        return items.length + ':' + last.kind + ':' + last.id + ':' + last.timestamp;
    }

    function renderChat(items, scrollBottom) {
        var key = timelineKey(items);
        if (key === state.lastTimelineKey && !scrollBottom) return;
        state.lastTimelineKey = key;

        if (!items.length) {
            els.chatThread.innerHTML = '<div class="guest-chat-thread__empty"><i class="fas fa-comments"></i>' +
                '<h5 class="mb-2">Say hi to the DJ</h5><p class="mb-0 small">Your messages and request updates appear here.</p></div>';
            return;
        }
        els.chatThread.innerHTML = items.map(renderChatItem).join('');
        if (scrollBottom !== false) els.chatThread.scrollTop = els.chatThread.scrollHeight;
    }

    function renderChatItem(item) {
        if (item.kind === 'message') return renderGuestMsg(item);
        if (item.kind === 'reply') return renderDjMsg(item);
        if (item.kind === 'request') return renderReqMsg(item);
        return '';
    }

    function renderGuestMsg(item) {
        return '<div class="guest-chat-row guest-chat-row--out"><div class="guest-chat-bubble guest-chat-bubble--out">' +
            '<div class="guest-chat-bubble__head"><span>You</span></div>' +
            '<div class="guest-chat-bubble__body">' + (item.body || item.textMessage || '') + '</div>' +
            '<span class="guest-chat-bubble__meta">' + fmtTime(item.timestamp) + '</span></div></div>';
    }

    function renderDjMsg(item) {
        return '<div class="guest-chat-row guest-chat-row--in"><div class="guest-chat-bubble guest-chat-bubble--in">' +
            '<div class="guest-chat-bubble__head"><i class="fas fa-user-tie"></i><span>' + esc(djName) + '</span></div>' +
            '<div class="guest-chat-bubble__body">' + esc(item.body || item.replyMessage || '') + '</div>' +
            '<span class="guest-chat-bubble__meta">' + fmtTime(item.timestamp) + '</span></div></div>';
    }

    function renderReqMsg(item) {
        var label = (item.type || '').indexOf('karaoke') !== -1 ? 'Karaoke' : 'Song';
        return '<div class="guest-chat-row guest-chat-row--out"><div class="guest-chat-bubble guest-chat-bubble--request">' +
            '<div class="guest-chat-bubble__head"><span>You requested · ' + label + '</span></div>' +
            '<div class="guest-chat-bubble__body">"' + esc(item.title || 'Unknown') + '"' +
            (item.artist ? ' by ' + esc(item.artist) : '') + '</div>' +
            '<span class="guest-chat-bubble__meta">' + fmtTime(item.timestamp) + '</span></div></div>';
    }

    function sendChatMessage() {
        if (!els.chatInput) return;
        var text = (els.chatInput.innerText || '').trim();
        if (!text) {
            toast('Type a message first', 'error');
            return;
        }
        if (text.length > 500) {
            toast('Message too long (500 max)', 'error');
            return;
        }
        var html = esc(text).replace(/\n/g, '<br>');
        fetch('/api/customer/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerName: state.guestName,
                message: html,
                messageText: text,
                eventSlug: slug,
                djOnly: els.djOnly && els.djOnly.checked
            })
        })
            .then(function (r) {
                return r.json().then(function (d) {
                    if (!r.ok) throw new Error(d.error || 'Send failed');
                    return d;
                });
            })
            .then(function () {
                els.chatInput.innerHTML = '';
                updateCharCount();
                if (els.djOnly) els.djOnly.checked = false;
                state.lastTimelineKey = '';
                loadChatTimeline(true);
            })
            .catch(function (err) {
                toast(err.message || 'Send failed', 'error');
            });
    }

    function updateCharCount() {
        if (!els.charCount || !els.chatInput) return;
        var len = (els.chatInput.innerText || '').length;
        els.charCount.textContent = len + '/500';
    }

    function startChatPoll() {
        if (state.chatPoll) clearInterval(state.chatPoll);
        state.chatPoll = setInterval(function () {
            if (state.tab === 'chat') loadChatTimeline(false);
        }, 15000);
    }

    function pollUnreadBadge() {
        function check() {
            if (!els.chatBadge) return;
            var url = guestSession
                ? guestSession.repliesUrl(state.guestName, slug)
                : '/api/customer/replies/' + encodeURIComponent(state.guestName);
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var count = (data && data.unreadCount) || 0;
                    els.chatBadge.textContent = String(count);
                    els.chatBadge.hidden = count <= 0;
                })
                .catch(function () {});
        }
        check();
        setInterval(check, 15000);
    }

    /* ── Tips sheet ── */

    var tipProviders = {
        stripe: { label: 'Stripe', icon: 'fa-credit-card', color: '#635bff' },
        paypal: { label: 'PayPal', icon: 'fa-paypal', color: '#0070ba' },
        revolut: { label: 'Revolut', icon: 'fa-wallet', color: '#0075eb' },
        bank: { label: 'Bank transfer', icon: 'fa-building-columns', color: '#64748b' },
        other: { label: 'Tip', icon: 'fa-heart', color: '#ff3366' }
    };

    function openTipSheet() {
        if (!els.tipOptions || !cfg.tipLinks) return;
        els.tipOptions.innerHTML = cfg.tipLinks.map(function (link) {
            var meta = tipProviders[link.provider] || tipProviders.other;
            return '<a class="gh-tip-btn" href="' + escAttr(link.url) + '" target="_blank" rel="noopener" style="background:' + meta.color + '">' +
                '<i class="fab ' + meta.icon + '"></i> ' + esc(meta.label) + '</a>';
        }).join('');
        els.tipSheet.classList.add('is-open');
        els.tipBackdrop.classList.add('is-open');
    }

    function closeTipSheet() {
        els.tipSheet.classList.remove('is-open');
        els.tipBackdrop.classList.remove('is-open');
    }

    /* ── Camera ── */

    function openCamera() {
        var overlay = document.getElementById('ghCameraOverlay');
        var frame = document.getElementById('ghCameraFrame');
        if (!overlay || !frame) return;
        var url = '/event/' + encodeURIComponent(slug) + '/camera?customerName=' + encodeURIComponent(state.guestName);
        frame.src = url;
        overlay.hidden = false;
    }

    /* ── Utils ── */

    function toast(msg, type) {
        var host = document.getElementById('ghToastHost');
        if (!host) return;
        var el = document.createElement('div');
        el.className = 'gh-toast gh-toast--' + (type || 'info');
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(function () { el.remove(); }, 4000);
    }

    function fmtTime(ts) {
        try {
            return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch (e) { return ''; }
    }

    function esc(text) {
        var d = document.createElement('div');
        d.textContent = text == null ? '' : String(text);
        return d.innerHTML;
    }

    function escAttr(text) {
        return esc(text).replace(/"/g, '&quot;');
    }
})(typeof window !== 'undefined' ? window : globalThis);
