/**
 * Guest Hub v2 — landing page (name, menu, now playing, tips).
 */
(function (global) {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var cfg = global.GuestV2Config || {};
        var slug = cfg.eventSlug || global.eventSlug || '';
        var v2Base = cfg.v2Base || '';
        var guestSession = global.MdjGuestSession;

        var nameCard = document.getElementById('gv2NameCard');
        var menuSection = document.getElementById('gv2MenuSection');
        var nameInput = document.getElementById('gv2CustomerName');
        var nameSubmit = document.getElementById('gv2NameSubmit');
        var editNameBtn = document.getElementById('gv2EditName');
        var welcomeName = document.getElementById('gv2WelcomeName');
        var errorEl = document.getElementById('gv2Error');
        var menuItems = document.querySelectorAll('.gv2-menu-item[data-href]');
        var tipCard = document.getElementById('gv2TipCard');
        var messagesBtn = document.getElementById('gv2MessagesBtn');
        var messagesBadge = document.getElementById('gv2MessagesBadge');

        if (!nameInput || !nameSubmit || !nameCard || !menuSection) return;

        function showError(msg) {
            if (!errorEl) return;
            if (!msg) {
                errorEl.hidden = true;
                errorEl.textContent = '';
                return;
            }
            errorEl.hidden = false;
            errorEl.textContent = msg;
        }

        function getStoredName() {
            return guestSession ? guestSession.getGuestName(slug) : sessionStorage.getItem('customerName') || '';
        }

        function rememberName(name) {
            if (guestSession) guestSession.setGuestName(slug, name);
            else sessionStorage.setItem('customerName', name);
        }

        function showMenu(name) {
            nameCard.hidden = true;
            menuSection.hidden = false;
            document.body.classList.add('gv2-menu-visible');
            if (welcomeName) welcomeName.textContent = name;
            if (messagesBtn) messagesBtn.hidden = !cfg.enableMessages;
            if (guestSession && slug) guestSession.registerCheckin(name);
            pollReplies(name);
        }

        function showNameForm(prefill) {
            nameCard.hidden = false;
            menuSection.hidden = true;
            document.body.classList.remove('gv2-menu-visible');
            if (prefill) nameInput.value = prefill;
            nameInput.focus();
        }

        async function submitName() {
            var name = nameInput.value.trim();
            if (!name) {
                showError('Please enter your name');
                nameInput.focus();
                return;
            }
            showError('');
            nameSubmit.disabled = true;
            try {
                if (guestSession && slug) {
                    var result = await guestSession.registerCheckin(name);
                    if (!result.ok && result.data && result.data.error === 'name_taken') {
                        showError(result.data.message || 'That name is already in use. Please choose another.');
                        nameInput.focus();
                        nameInput.select();
                        return;
                    }
                }
                rememberName(name);
                showMenu(name);
            } finally {
                nameSubmit.disabled = false;
            }
        }

        function navigateWithName(href) {
            var name = getStoredName();
            if (!name) {
                showError('Please enter your name first');
                showNameForm('');
                return;
            }
            var sep = href.indexOf('?') >= 0 ? '&' : '?';
            global.location.href = href + sep + 'customerName=' + encodeURIComponent(name);
        }

        nameSubmit.addEventListener('click', submitName);
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submitName();
        });

        if (editNameBtn) {
            editNameBtn.addEventListener('click', function () {
                showNameForm(getStoredName());
            });
        }

        menuItems.forEach(function (item) {
            item.addEventListener('click', function () {
                navigateWithName(item.getAttribute('data-href'));
            });
        });

        if (tipCard) {
            tipCard.addEventListener('click', function () {
                var raw = tipCard.getAttribute('data-tip-links');
                if (!raw) return;
                try {
                    var links = JSON.parse(raw);
                    showTipModal(links);
                } catch (e) {
                    /* ignore */
                }
            });
        }

        var tipProviders = {
            stripe: { label: 'Stripe', icon: 'fa-credit-card', color: '#635bff', textColor: '#fff' },
            paypal: { label: 'PayPal', icon: 'fa-paypal', color: '#0070ba', textColor: '#fff' },
            revolut: { label: 'Revolut', icon: 'fa-wallet', color: '#0075eb', textColor: '#fff' },
            bank: { label: 'Bank transfer', icon: 'fa-building-columns', color: '#64748b', textColor: '#fff' },
            other: { label: 'Tip', icon: 'fa-hand-holding-dollar', color: '#6366f1', textColor: '#fff' }
        };

        function showTipModal(links) {
            var modalEl = document.getElementById('gv2TipModal');
            var optionsEl = document.getElementById('gv2TipLinksOptions');
            if (!modalEl || !optionsEl || !global.bootstrap) return;
            optionsEl.innerHTML = '';
            links.forEach(function (link) {
                var meta = tipProviders[link.provider] || tipProviders.other;
                var btn = document.createElement('a');
                btn.className = 'gv2-btn gv2-btn--primary w-100 mb-2';
                btn.href = link.url;
                btn.target = '_blank';
                btn.rel = 'noopener noreferrer';
                btn.style.background = meta.color;
                btn.innerHTML = '<i class="fab ' + meta.icon + ' me-2"></i>' + meta.label;
                optionsEl.appendChild(btn);
            });
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }

        var replyTimer = null;
        function pollReplies(name) {
            if (!cfg.enableMessages || !name) return;
            function check() {
                var url = guestSession
                    ? guestSession.repliesUrl(name, slug)
                    : '/api/customer/replies/' + encodeURIComponent(name);
                fetch(url)
                    .then(function (r) {
                        return r.json();
                    })
                    .then(function (data) {
                        var count = (data && data.unreadCount) || 0;
                        if (messagesBadge) {
                            messagesBadge.textContent = String(count);
                            messagesBadge.hidden = count <= 0;
                        }
                    })
                    .catch(function () {});
            }
            check();
            if (replyTimer) clearInterval(replyTimer);
            replyTimer = setInterval(function () {
                check();
            }, 15000);
        }

        /* Now playing */
        var heroSection = document.getElementById('gv2Hero');
        var nowPlayingSection = document.getElementById('gv2NowPlaying');
        var lastTrack = null;

        async function fetchNowPlaying() {
            if (!nowPlayingSection) return;
            try {
                var url = '/api/now-playing';
                if (slug) url += '?eventSlug=' + encodeURIComponent(slug);
                var response = await fetch(url);
                var data = await response.json();
                var titleEl = document.getElementById('gv2NpTitle');
                var artistEl = document.getElementById('gv2NpArtist');
                var artEl = document.getElementById('gv2NpArt');
                var iconEl = document.getElementById('gv2NpIcon');
                if (data.title) {
                    var trackKey = data.title + '|' + (data.artist || '');
                    if (trackKey !== lastTrack) {
                        lastTrack = trackKey;
                        if (titleEl) titleEl.textContent = data.title;
                        if (artistEl) artistEl.textContent = data.artist || '';
                        if (data.artwork && artEl) {
                            artEl.src = data.artwork;
                            artEl.hidden = false;
                            if (iconEl) iconEl.hidden = true;
                        } else {
                            if (artEl) artEl.hidden = true;
                            if (iconEl) iconEl.hidden = false;
                        }
                        if (heroSection) heroSection.hidden = true;
                        nowPlayingSection.hidden = false;
                    }
                } else {
                    if (heroSection) heroSection.hidden = false;
                    nowPlayingSection.hidden = true;
                    lastTrack = null;
                }
            } catch (e) {
                /* ignore */
            }
        }

        fetchNowPlaying();
        setInterval(fetchNowPlaying, 3000);

        var stored = getStoredName();
        var editMode = new URLSearchParams(global.location.search).get('edit') === 'true';
        if (stored && !editMode) {
            nameInput.value = stored;
            showMenu(stored);
        } else if (stored && editMode) {
            nameInput.value = stored;
            showNameForm(stored);
            global.history.replaceState({}, document.title, v2Base || global.location.pathname);
        } else {
            showNameForm('');
        }
    });
})(typeof window !== 'undefined' ? window : globalThis);
