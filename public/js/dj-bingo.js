/**
 * DJ dashboard — Games tab (Bingo v1; extensible game picker).
 */
(function () {
    const panel = document.getElementById('gamePanelBingo');
    if (!panel) return;

    const isCallerPage = document.body.classList.contains('mdj-bingo-caller-page');

    const els = {
        status: document.getElementById('bingoRunStatus'),
        hubLastBall: document.getElementById('bingoHubLastBall'),
        ballCount: document.getElementById('bingoBallCount'),
        callInterval: document.getElementById('bingoCallInterval'),
        claimBreakSeconds: document.getElementById('bingoClaimBreakSeconds'),
        themeSelect: document.getElementById('bingoThemeSelect'),
        introSeconds: document.getElementById('bingoIntroSeconds'),
        autoCall: document.getElementById('bingoAutoCall'),
        voiceCall: document.getElementById('bingoVoiceCall'),
        skipIntroBtn: document.getElementById('bingoSkipIntroBtn'),
        calledStrip: document.getElementById('bingoCalledStrip'),
        lastBall: document.getElementById('bingoLastBall'),
        cardCount: document.getElementById('bingoCardGenCount'),
        cardBatch: document.getElementById('bingoCardBatch'),
        verifySerial: document.getElementById('bingoVerifySerial'),
        verifyResult: document.getElementById('bingoVerifyResult'),
        batchesList: document.getElementById('bingoBatchesList'),
        targetHint: document.getElementById('bingoTargetHint'),
        adminGrid: document.getElementById('bingoAdminGrid'),
        calledCountMini: document.getElementById('bingoCalledCountMini'),
        pausedHint: document.getElementById('bingoPausedHint'),
        pauseBtn: document.getElementById('bingoPauseBtn'),
        resumeBtn: document.getElementById('bingoResumeBtn'),
        prizeLine: document.getElementById('bingoPrizeLine'),
        prizeTwoLines: document.getElementById('bingoPrizeTwoLines'),
        prizeHouse: document.getElementById('bingoPrizeHouse'),
        gameSelect: document.getElementById('bingoActiveGameSelect'),
        gameMeta: document.getElementById('bingoActiveGameMeta'),
        prizeWinners: document.getElementById('bingoPrizeWinners'),
        gamesList: document.getElementById('bingoGamesList'),
        playersList: document.getElementById('bingoPlayersList'),
        callerPlayerCount: document.getElementById('bingoCallerPlayerCount'),
        winnersModal: document.getElementById('bingoWinnersModal'),
        winnersModalList: document.getElementById('bingoWinnersModalList'),
        winnersModalDismiss: document.getElementById('bingoWinnersModalDismiss'),
        assignName: document.getElementById('bingoAssignName'),
        assignResult: document.getElementById('bingoAssignResult')
    };

    let pollTimer = null;
    let gamesCache = [];
    let eventBingoDefaults = { maxVirtualCards: 1 };
    let selectedGameId = null;
    let wizardStep = 1;
    let createWizardModal = null;
    let editGameModal = null;

    const wizardEls = {
        modal: document.getElementById('bingoCreateGameModal'),
        steps: document.getElementById('bingoWizardSteps'),
        title: document.getElementById('bingoWizardTitle'),
        start: document.getElementById('bingoWizardStart'),
        maxVirtual: document.getElementById('bingoWizardMaxVirtual'),
        maxVirtualHint: document.getElementById('bingoWizardMaxVirtualHint'),
        openJoin: document.getElementById('bingoWizardOpenJoin'),
        cardCount: document.getElementById('bingoWizardCardCount'),
        ballCount: document.getElementById('bingoWizardBallCount'),
        intro: document.getElementById('bingoWizardIntro'),
        interval: document.getElementById('bingoWizardInterval'),
        autoCall: document.getElementById('bingoWizardAutoCall'),
        voiceCall: document.getElementById('bingoWizardVoiceCall'),
        prizeLine: document.getElementById('bingoWizardPrizeLine'),
        prizeTwo: document.getElementById('bingoWizardPrizeTwo'),
        prizeHouse: document.getElementById('bingoWizardPrizeHouse'),
        claimBreak: document.getElementById('bingoWizardClaimBreak'),
        theme: document.getElementById('bingoWizardTheme'),
        review: document.getElementById('bingoWizardReview'),
        error: document.getElementById('bingoWizardError'),
        backBtn: document.getElementById('bingoWizardBackBtn'),
        nextBtn: document.getElementById('bingoWizardNextBtn'),
        createBtn: document.getElementById('bingoWizardCreateBtn')
    };

    const editEls = {
        modal: document.getElementById('bingoEditGameModal'),
        id: document.getElementById('bingoEditGameId'),
        title: document.getElementById('bingoEditTitle'),
        start: document.getElementById('bingoEditStart'),
        maxVirtual: document.getElementById('bingoEditMaxVirtual'),
        ballCount: document.getElementById('bingoEditBallCount'),
        intro: document.getElementById('bingoEditIntro'),
        interval: document.getElementById('bingoEditInterval'),
        autoCall: document.getElementById('bingoEditAutoCall'),
        voiceCall: document.getElementById('bingoEditVoiceCall'),
        prizeLine: document.getElementById('bingoEditPrizeLine'),
        prizeTwo: document.getElementById('bingoEditPrizeTwo'),
        prizeHouse: document.getElementById('bingoEditPrizeHouse'),
        claimBreak: document.getElementById('bingoEditClaimBreak'),
        theme: document.getElementById('bingoEditTheme'),
        error: document.getElementById('bingoEditGameError'),
        saveBtn: document.getElementById('bingoEditGameSaveBtn')
    };
    let adminCells = new Map();
    let adminGridSize = 0;
    let selectedPlayingFor = 'line';
    let adminGridResizeObserver = null;

    const BINGO_THEME_LABELS = {
        default: 'Default',
        christmas: 'Christmas',
        halloween: 'Halloween',
        classic: 'Classic hall',
        'neon-90s': '90s neon',
        wedding: 'Wedding'
    };

    function bingoThemeLabel(id) {
        const t = window.MdjBingoTheme ? window.MdjBingoTheme.normalize(id) : id || 'default';
        return BINGO_THEME_LABELS[t] || t;
    }

    /** Size number text so all cells fit the board area without an inner scrollbar. */
    function fitAdminGridCellFont() {
        if (!isCallerPage) return;
        const wrap = document.querySelector('.mdj-bingo-grid-scroll--caller');
        const grid = els.adminGrid;
        if (!wrap || !grid || !grid.children.length) return;
        const pad = 6;
        const w = wrap.clientWidth - pad;
        const h = wrap.clientHeight - pad;
        if (w < 48 || h < 48) return;
        const cols = window.matchMedia('(max-width: 768px)').matches ? 9 : 10;
        const n = grid.children.length;
        const rows = Math.ceil(n / cols) || 1;
        const gap = 3;
        const cellW = (w - gap * (cols - 1)) / cols;
        const cellH = (h - gap * (rows - 1)) / rows;
        const px = Math.max(8, Math.min(22, Math.min(cellW, cellH) * 0.48));
        grid.style.setProperty('--mdj-bingo-admin-cell-fs', px + 'px');
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))';
    }

    function adminGridScrollEl() {
        if (isCallerPage) return document.querySelector('.mdj-bingo-grid-scroll--caller');
        return document.querySelector('#bingoSubControl .mdj-bingo-grid-scroll');
    }

    function bindAdminGridFit() {
        const wrap = adminGridScrollEl();
        if (!wrap || typeof ResizeObserver === 'undefined') return;
        if (adminGridResizeObserver) adminGridResizeObserver.disconnect();
        adminGridResizeObserver = new ResizeObserver(() => fitAdminGridCellFont());
        adminGridResizeObserver.observe(wrap);
    }

    function slug() {
        return typeof window.mdjGetPromptTargetSlug === 'function' ? window.mdjGetPromptTargetSlug() : null;
    }

    function eventId() {
        return typeof window.mdjGetPromptTargetEventId === 'function' ? window.mdjGetPromptTargetEventId() : null;
    }

    function storageKeyForGame() {
        const eid = eventId();
        return eid ? `mdj_bingo_game_${eid}` : null;
    }

    function getActiveGameId() {
        if (els.gameSelect && els.gameSelect.value) {
            return parseInt(els.gameSelect.value, 10);
        }
        return selectedGameId;
    }

    function persistSelectedGame(id) {
        selectedGameId = id || null;
        const key = storageKeyForGame();
        if (key) {
            if (id) sessionStorage.setItem(key, String(id));
            else sessionStorage.removeItem(key);
        }
    }

    function withGameId(body) {
        const gid = getActiveGameId();
        const out = body ? { ...body } : {};
        if (gid) out.gameId = gid;
        return out;
    }

    function statusLabel(st) {
        const map = {
            preparing: 'Preparing',
            join_open: 'Join open',
            live: 'Live',
            ended: 'Ended'
        };
        return map[st] || st;
    }

    function formatAdvertisedStart(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return String(iso);
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

    function isoToDatetimeLocal(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return (
                d.getFullYear() +
                '-' +
                pad(d.getMonth() + 1) +
                '-' +
                pad(d.getDate()) +
                'T' +
                pad(d.getHours()) +
                ':' +
                pad(d.getMinutes())
            );
        } catch (e) {
            return '';
        }
    }

    function activeGameFromCache() {
        const gid = getActiveGameId();
        return gid ? gamesCache.find((x) => x.id === gid) : null;
    }

    function syncCallerSetupHint(game) {
        const hint = document.getElementById('bingoCallerSetupGameHint');
        if (!hint) return;
        const g = game || activeGameFromCache();
        if (!g) {
            hint.textContent = 'Select a game in the hub or games list first.';
            hint.className = 'small text-warning mb-3';
            return;
        }
        hint.textContent = 'Saving to: ' + g.title;
        hint.className = 'small text-success mb-3';
    }

    function applyGameToCallerSetup(g) {
        if (!g) {
            syncCallerSetupHint();
            return;
        }
        if (els.ballCount) els.ballCount.value = String(g.ballCount || 90);
        if (els.callInterval) {
            els.callInterval.value = String(Math.round((g.callIntervalMs || 5000) / 1000));
        }
        if (els.introSeconds) els.introSeconds.value = String(g.introSeconds != null ? g.introSeconds : 30);
        if (els.claimBreakSeconds) {
            els.claimBreakSeconds.value = String(g.claimBreakSeconds != null ? g.claimBreakSeconds : 10);
        }
        if (els.themeSelect && g.bingoTheme) {
            els.themeSelect.value = window.MdjBingoTheme
                ? window.MdjBingoTheme.normalize(g.bingoTheme)
                : g.bingoTheme;
        }
        if (window.MdjBingoTheme) {
            window.MdjBingoTheme.apply(document.body, g.bingoTheme);
        }
        if (els.autoCall) els.autoCall.checked = !!g.autoCall;
        if (els.voiceCall) els.voiceCall.checked = !!g.voiceCall;
        syncPrizeFields(g.prizes);
        syncCallerSetupHint(g);
        if (els.ballCount) els.ballCount.disabled = g.status === 'live';
    }

    function buildCallerSaveBody() {
        return {
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            claimBreakSeconds: Number(els.claimBreakSeconds?.value) || 10,
            bingoTheme: els.themeSelect?.value || 'default',
            introSeconds: Number(els.introSeconds?.value) || 0,
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            ...getPrizePayload()
        };
    }

    function gameListMeta(g) {
        const bits = [
            statusLabel(g.status),
            `${g.unassignedCards} print free`,
            `${g.assignments} players`
        ];
        if (g.maxVirtualCards != null) bits.push(`max ${g.maxVirtualCards} virtual/guest`);
        const start = formatAdvertisedStart(g.advertisedStartAt);
        if (start) bits.push(`starts ${start}`);
        return bits.join(' · ');
    }

    function syncGameMeta() {
        if (!els.gameMeta) return;
        const gid = getActiveGameId();
        if (!gid) {
            els.gameMeta.textContent = 'No game selected — uses legacy session or whichever game is live.';
            return;
        }
        const g = gamesCache.find((x) => x.id === gid);
        if (!g) {
            els.gameMeta.textContent = '';
            return;
        }
        els.gameMeta.textContent = `${g.title} · ${gameListMeta(g)}`;
    }

    function populateGameSelect() {
        if (!els.gameSelect) return;
        const prev = els.gameSelect.value;
        els.gameSelect.innerHTML = '<option value="">— Legacy / auto live —</option>';
        gamesCache.forEach((g) => {
            const opt = document.createElement('option');
            opt.value = String(g.id);
            opt.textContent = `${g.title} (${statusLabel(g.status)})`;
            els.gameSelect.appendChild(opt);
        });
        const key = storageKeyForGame();
        const stored = key ? sessionStorage.getItem(key) : null;
        if (prev && gamesCache.some((g) => String(g.id) === prev)) {
            els.gameSelect.value = prev;
        } else if (stored && gamesCache.some((g) => String(g.id) === stored)) {
            els.gameSelect.value = stored;
        } else {
            const live = gamesCache.find((g) => g.status === 'live');
            const open = gamesCache.find((g) => g.status === 'join_open');
            if (live) els.gameSelect.value = String(live.id);
            else if (open) els.gameSelect.value = String(open.id);
        }
        persistSelectedGame(els.gameSelect.value ? parseInt(els.gameSelect.value, 10) : null);
        syncGameMeta();
    }

    function renderGamesList() {
        if (!els.gamesList) return;
        if (!gamesCache.length) {
            els.gamesList.innerHTML = '<p class="text-muted mb-0">No games yet — tap <strong>Create game…</strong> above.</p>';
            return;
        }
        const gid = getActiveGameId();
        els.gamesList.innerHTML = gamesCache
            .map((g) => {
                const sel = gid === g.id ? ' is-selected' : '';
                return (
                    `<div class="mdj-bingo-game-row${sel}" data-game-id="${g.id}">` +
                    `<div><strong>${escapeHtml(g.title)}</strong><br><span class="text-muted">${escapeHtml(gameListMeta(g))}</span></div>` +
                    `<div class="mdj-bingo-game-actions">` +
                    (g.status === 'preparing'
                        ? `<button type="button" class="btn btn-outline-success bingo-game-open-join" data-id="${g.id}">Open join</button>`
                        : '') +
                    (g.status === 'join_open' || g.status === 'preparing'
                        ? `<button type="button" class="btn btn-outline-secondary bingo-game-end-join" data-id="${g.id}">Close join</button>`
                        : '') +
                    (g.status !== 'ended'
                        ? `<button type="button" class="btn btn-outline-warning bingo-game-end" data-id="${g.id}">End</button>`
                        : '') +
                    (g.status === 'ended'
                        ? `<button type="button" class="btn btn-outline-success bingo-game-restart" data-id="${g.id}">Restart</button>`
                        : '') +
                    `<button type="button" class="btn btn-outline-secondary bingo-game-edit" data-id="${g.id}">Edit</button>` +
                    `<button type="button" class="btn btn-outline-primary bingo-game-use" data-id="${g.id}">Use</button>` +
                    (g.status === 'ended' || (g.status !== 'live' && (g.assignments || 0) === 0)
                        ? `<button type="button" class="btn btn-outline-danger bingo-game-delete" data-id="${g.id}">Delete</button>`
                        : '') +
                    `</div></div>`
                );
            })
            .join('');
        els.gamesList.querySelectorAll('.bingo-game-open-join').forEach((btn) => {
            btn.addEventListener('click', () => setGameStatus(btn.dataset.id, 'join_open'));
        });
        els.gamesList.querySelectorAll('.bingo-game-end-join').forEach((btn) => {
            btn.addEventListener('click', () => setGameStatus(btn.dataset.id, 'preparing'));
        });
        els.gamesList.querySelectorAll('.bingo-game-end').forEach((btn) => {
            btn.addEventListener('click', () => setGameStatus(btn.dataset.id, 'ended'));
        });
        els.gamesList.querySelectorAll('.bingo-game-use').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (els.gameSelect) els.gameSelect.value = btn.dataset.id;
                persistSelectedGame(parseInt(btn.dataset.id, 10));
                syncGameMeta();
                applyGameToCallerSetup(gamesCache.find((x) => x.id === parseInt(btn.dataset.id, 10)));
                fetchState();
            });
        });
        els.gamesList.querySelectorAll('.bingo-game-edit').forEach((btn) => {
            btn.addEventListener('click', () => openEditGame(parseInt(btn.dataset.id, 10)));
        });
        els.gamesList.querySelectorAll('.bingo-game-restart').forEach((btn) => {
            btn.addEventListener('click', () => restartEndedGame(btn.dataset.id));
        });
        els.gamesList.querySelectorAll('.bingo-game-delete').forEach((btn) => {
            btn.addEventListener('click', () => deletePreparedGame(btn.dataset.id));
        });
    }

    async function restartEndedGame(gameId) {
        const eid = eventId();
        if (!eid) return;
        const g = gamesCache.find((x) => x.id === parseInt(gameId, 10));
        const label = g && g.title ? `"${g.title}"` : 'this game';
        if (
            !confirm(
                `Restart ${label}? Called numbers reset to the start, prizes back to line 1, and join opens on the guest hub. Guest card assignments are kept.`
            )
        ) {
            return;
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gameId}/restart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openJoin: true })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not restart game');
                return;
            }
            if (els.gameSelect) els.gameSelect.value = String(gameId);
            persistSelectedGame(parseInt(gameId, 10));
            await loadGames();
            syncGameMeta();
            fetchState();
        } catch (e) {
            alert('Could not restart game');
        }
    }

    async function deletePreparedGame(gameId) {
        const eid = eventId();
        if (!eid) return;
        const g = gamesCache.find((x) => x.id === parseInt(gameId, 10));
        const label = g && g.title ? `"${g.title}"` : 'this game';
        const endedNote =
            g && g.status === 'ended' && (g.assignments || 0) > 0
                ? ` This will remove ${g.assignments} guest card assignment(s) and all cards in the batch.`
                : '';
        if (
            !confirm(
                `Delete ${label} and all its prepared cards? This cannot be undone.${endedNote}`
            )
        ) {
            return;
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gameId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not delete game');
                return;
            }
            if (getActiveGameId() === parseInt(gameId, 10)) {
                persistSelectedGame(null);
                if (els.gameSelect) els.gameSelect.value = '';
            }
            await loadGames();
            loadBatches();
        } catch (e) {
            alert('Could not delete game');
        }
    }

    async function setGameStatus(gameId, status) {
        const eid = eventId();
        if (!eid) return;
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gameId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (!res.ok) alert(data.error || 'Could not update game');
            else loadGames();
        } catch (e) {
            alert('Could not update game');
        }
    }

    async function loadGames() {
        const eid = eventId();
        if (!eid) {
            gamesCache = [];
            renderGamesList();
            populateGameSelect();
            return;
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games`);
            const data = await res.json();
            gamesCache = data.games || [];
            if (data.eventDefaults?.maxVirtualCards != null) {
                eventBingoDefaults.maxVirtualCards = data.eventDefaults.maxVirtualCards;
            }
            populateGameSelect();
            renderGamesList();
            loadPlayers();
            applyGameToCallerSetup(activeGameFromCache());
        } catch (e) {
            if (els.gamesList) els.gamesList.innerHTML = '<span class="text-danger">Could not load games.</span>';
        }
    }

    function shortCallerSerial(serial) {
        const s = String(serial || '');
        if (s.length <= 14) return s;
        return s.slice(0, 5) + '…' + s.slice(-5);
    }

    function renderCallerPlayersList(players, pendingClaims) {
        if (!els.playersList) return;
        const pendingNames = new Set(
            (pendingClaims || []).map((c) =>
                String(c.customer_name || c.customerName || '')
                    .trim()
                    .toLowerCase()
            )
        );
        const byName = new Map();
        (players || []).forEach((p) => {
            const name = String(p.assignedTo || '').trim() || '—';
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(p.serial);
        });
        const rows = [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
        if (els.callerPlayerCount) {
            const cardTotal = (players || []).length;
            els.callerPlayerCount.textContent = rows.length
                ? rows.length + ' · ' + cardTotal + ' card' + (cardTotal === 1 ? '' : 's')
                : '';
        }
        if (!rows.length) {
            els.playersList.innerHTML = '<p class="mdj-caller-players-empty">No assigned cards yet.</p>';
            return;
        }
        els.playersList.innerHTML = rows
            .map(function (entry) {
                const name = entry[0];
                const serials = entry[1];
                const pending = pendingNames.has(name.toLowerCase());
                const serialHint =
                    serials.length === 1
                        ? escapeHtml(shortCallerSerial(serials[0]))
                        : serials.length + ' cards';
                return (
                    '<div class="mdj-caller-player-row' +
                    (pending ? ' has-pending-claim' : '') +
                    '" role="listitem">' +
                    '<span class="mdj-caller-player-name">' +
                    escapeHtml(name) +
                    (pending ? ' <span class="mdj-caller-player-pending" title="Pending claim">●</span>' : '') +
                    '</span>' +
                    '<span class="mdj-caller-player-meta" title="' +
                    escapeHtml(serials.join(', ')) +
                    '">' +
                    escapeHtml(serialHint) +
                    '</span></div>'
                );
            })
            .join('');
    }

    async function loadPlayers() {
        const eid = eventId();
        const gid = getActiveGameId();
        if (!els.playersList || !eid || !gid) {
            if (els.playersList) {
                els.playersList.innerHTML = isCallerPage
                    ? '<p class="mdj-caller-players-empty">Select a game to see players.</p>'
                    : '<span class="text-muted">Select a game to see players.</span>';
            }
            if (els.callerPlayerCount) els.callerPlayerCount.textContent = '';
            return;
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gid}/players`);
            const data = await res.json();
            const players = data.players || [];
            if (isCallerPage) {
                renderCallerPlayersList(players, data.pendingClaims);
                return;
            }
            if (!players.length) {
                els.playersList.innerHTML = '<span class="text-muted">No assigned cards yet.</span>';
                return;
            }
            els.playersList.innerHTML = players
                .map(
                    (p) =>
                        `<div class="mdj-bingo-game-row"><span><strong>${escapeHtml(p.assignedTo)}</strong></span><span class="text-muted">${escapeHtml(p.serial)}</span></div>`
                )
                .join('');
        } catch (e) {
            els.playersList.innerHTML = isCallerPage
                ? '<p class="mdj-caller-players-empty mdj-caller-players-empty--err">Could not load players.</p>'
                : '<span class="text-danger">Could not load players.</span>';
        }
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    let verifyCallSound = null;

    function playVerifiedCallSoundLocal() {
        if (!verifyCallSound) {
            verifyCallSound = new Audio('/audio/verified_call.mp3');
            verifyCallSound.preload = 'auto';
        }
        try {
            verifyCallSound.currentTime = 0;
            const p = verifyCallSound.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) {
            /* ignore */
        }
    }

    function getSelectedPlayingFor() {
        const active = document.querySelector('.mdj-bingo-playing-for [data-playing-for].active');
        return active?.getAttribute('data-playing-for') || selectedPlayingFor || 'line';
    }

    function getPrizePayload() {
        return {
            prizeLine: (els.prizeLine?.value || '').trim(),
            prizeTwoLines: (els.prizeTwoLines?.value || '').trim(),
            prizeHouse: (els.prizeHouse?.value || '').trim()
        };
    }

    function syncPrizeFields(prizes) {
        if (!prizes) return;
        if (els.prizeLine && prizes.line != null) els.prizeLine.value = prizes.line || '';
        if (els.prizeTwoLines && prizes['two-lines'] != null) els.prizeTwoLines.value = prizes['two-lines'] || '';
        if (els.prizeHouse && prizes.house != null) els.prizeHouse.value = prizes.house || '';
        renderPrizeSummary(prizes);
    }

    function renderPrizeSummary(prizes) {
        const el = document.getElementById('bingoPrizeSummary');
        if (!el) return;
        const p = prizes || {
            line: els.prizeLine?.value,
            'two-lines': els.prizeTwoLines?.value,
            house: els.prizeHouse?.value
        };
        const bits = [
            p.line ? 'Line · ' + p.line : '',
            p['two-lines'] ? '2 · ' + p['two-lines'] : '',
            p.house ? 'House · ' + p.house : ''
        ].filter(Boolean);
        el.textContent = bits.length ? bits.join(' · ') : 'Default prize labels';
    }

    function getVerifyClaimType() {
        const active = document.querySelector('.mdj-bingo-verify-type [data-verify-claim].active');
        const val = active?.getAttribute('data-verify-claim') || 'house';
        const hidden = document.getElementById('bingoVerifyClaimType');
        if (hidden) hidden.value = val;
        return val;
    }

    function syncPlayingForUI(playingFor) {
        selectedPlayingFor = playingFor || 'line';
        document.querySelectorAll('.mdj-bingo-playing-for [data-playing-for]').forEach((btn) => {
            const match = btn.getAttribute('data-playing-for') === selectedPlayingFor;
            btn.classList.toggle('active', match);
        });
    }

    async function setPlayingFor(playingFor) {
        syncPlayingForUI(playingFor);
        const s = slug();
        if (!s) return;
        const data = await apiPut('/games/bingo/config', withGameId({
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            playingFor: selectedPlayingFor,
            introSeconds: Number(els.introSeconds?.value) || 0,
            ...getPrizePayload()
        }));
        if (data?.success && data.state) renderStatus(data.state);
    }

    function updateTargetHint() {
        if (!els.targetHint) return;
        const name =
            typeof window.mdjGetPromptTargetName === 'function' ? window.mdjGetPromptTargetName() : null;
        const s = slug();
        if (!s) {
            els.targetHint.innerHTML =
                '<span class="text-warning"><i class="fas fa-triangle-exclamation me-1"></i>Select an event to run bingo on the display.</span>';
            return;
        }
        els.targetHint.innerHTML = `<span class="text-success"><i class="fas fa-tv me-1"></i>Display: <strong>${name || s}</strong></span>`;
    }

    function buildAdminGrid(ballCount) {
        if (!els.adminGrid) return;
        els.adminGrid.innerHTML = '';
        adminCells.clear();
        adminGridSize = ballCount;
        for (let n = 1; n <= ballCount; n++) {
            const cell = document.createElement('div');
            cell.className = 'mdj-bingo-admin-cell';
            cell.textContent = n;
            cell.dataset.num = String(n);
            els.adminGrid.appendChild(cell);
            adminCells.set(n, cell);
        }
        fitAdminGridCellFont();
    }

    function syncGridCells(cells, called, lastBall) {
        cells.forEach((cell, n) => {
            cell.classList.toggle('is-called', called.has(n));
            cell.classList.toggle('is-last', lastBall === n);
        });
    }

    function syncAdminGrid(state) {
        const ballCount = state.ballCount || 90;
        const called = new Set(state.calledBalls || []);
        const calledCount = (state.calledBalls || []).length;
        if (ballCount !== adminGridSize) buildAdminGrid(ballCount);
        syncGridCells(adminCells, called, state.lastBall);
        if (isCallerPage) fitAdminGridCellFont();
        if (els.calledCountMini) {
            els.calledCountMini.textContent = calledCount + ' / ' + ballCount;
        }
    }

    function syncCallerRunChrome(state) {
        if (!isCallerPage) return;
        const active = !!state.active;
        const paused = !!state.paused;
        const claimBreak = state.phase === 'claim_break';
        const claimPause = paused && state.pausedReason === 'claim';
        const multiClaimGrace = !!(
            claimBreak &&
            (state.pendingGameEnd || state.pendingAdvanceAfterClaim)
        );
        const runPanel = document.querySelector('.mdj-caller-panel--run');
        if (runPanel) {
            runPanel.classList.toggle('is-claim-paused', !!(active && claimPause && !multiClaimGrace));
            runPanel.classList.toggle('is-claim-break', !!(active && claimBreak));
        }
        const ballSpot = document.querySelector('.mdj-caller-ball-spotlight');
        if (ballSpot) {
            ballSpot.classList.toggle('is-claim-paused', !!(active && (claimPause || (paused && state.pausedReason === 'manual'))));
        }
    }

    function syncStartPauseButton(state) {
        const startBtn = document.getElementById('bingoStartBtn');
        if (!startBtn) return;
        const hasSlug = !!slug();
        const active = !!state.active;
        const paused = !!state.paused;
        const inIntro = state.phase === 'intro';
        const claimPause = paused && (state.pausedReason === 'claim' || state.pausedReason === 'manual');
        if (!active) {
            startBtn.dataset.mode = 'start';
            startBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i> Start';
            startBtn.classList.remove('mdj-bingo-btn-pause', 'mdj-bingo-btn-resume');
            startBtn.classList.add('mdj-bingo-btn-go');
            startBtn.disabled = !hasSlug;
        } else if (claimPause) {
            startBtn.dataset.mode = 'resume';
            startBtn.innerHTML = '<i class="fas fa-play-circle" aria-hidden="true"></i> Resume';
            startBtn.classList.remove('mdj-bingo-btn-go', 'mdj-bingo-btn-pause');
            startBtn.classList.add('mdj-bingo-btn-resume');
            startBtn.disabled = !hasSlug;
        } else if (inIntro) {
            startBtn.dataset.mode = 'idle';
            startBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i> Start';
            startBtn.disabled = true;
        } else {
            startBtn.dataset.mode = 'pause';
            startBtn.innerHTML = '<i class="fas fa-pause" aria-hidden="true"></i> Pause';
            startBtn.classList.remove('mdj-bingo-btn-go', 'mdj-bingo-btn-resume');
            startBtn.classList.add('mdj-bingo-btn-pause');
            startBtn.disabled = !hasSlug;
        }
        if (isCallerPage) {
            if (els.pauseBtn) els.pauseBtn.hidden = true;
            if (els.resumeBtn) els.resumeBtn.hidden = true;
        }
    }

    function updateActionButtons(state) {
        const hasSlug = !!slug();
        const active = !!state.active;
        const paused = !!state.paused;
        const byId = (id) => document.getElementById(id);
        syncStartPauseButton(state);
        syncCallerRunChrome(state);
        if (byId('bingoStopBtn')) byId('bingoStopBtn').disabled = !hasSlug || !active;
        const inIntro = state.phase === 'intro';
        const resuming = state.phase === 'resume';
        const claimBreak = state.phase === 'claim_break';
        if (byId('bingoCallBtn'))
            byId('bingoCallBtn').disabled = !hasSlug || !active || paused || inIntro || resuming || claimBreak;
        if (els.skipIntroBtn) els.skipIntroBtn.hidden = !(active && inIntro);
        if (byId('bingoResetCallsBtn')) byId('bingoResetCallsBtn').disabled = !hasSlug || !active;
        if (byId('bingoApplyConfigBtn')) byId('bingoApplyConfigBtn').disabled = !hasSlug;
        if (byId('bingoFlashLineBtn')) byId('bingoFlashLineBtn').disabled = !hasSlug || !active;
        if (byId('bingoFlashTwoLinesBtn')) byId('bingoFlashTwoLinesBtn').disabled = !hasSlug || !active;
        if (byId('bingoFlashHouseBtn')) byId('bingoFlashHouseBtn').disabled = !hasSlug || !active;
        if (byId('bingoVerifyBtn')) byId('bingoVerifyBtn').disabled = !hasSlug;
        if (byId('bingoGenCardsBtn')) byId('bingoGenCardsBtn').disabled = !hasSlug;
        if (els.ballCount) els.ballCount.disabled = active;
        if (els.pauseBtn && !isCallerPage) {
            els.pauseBtn.hidden = !(active && !paused && !inIntro);
        }
        if (els.resumeBtn && !isCallerPage) {
            els.resumeBtn.hidden = !(active && paused && (state.pausedReason === 'claim' || state.pausedReason === 'manual'));
        }
        if (els.pausedHint) {
            const claimPause = paused && state.pausedReason === 'claim';
            const resuming = state.phase === 'resume';
            const showHint = active && (claimPause || paused || claimBreak || resuming);
            els.pausedHint.hidden = !showHint;
            if (showHint && els.pausedHint) {
                const reason = state.pausedReason || 'claim';
                if (resuming) {
                    const sec = state.resumeRemainingSec != null ? state.resumeRemainingSec : '…';
                    const last = state.lastBall != null ? state.lastBall : '—';
                    els.pausedHint.innerHTML =
                        '<i class="fas fa-play-circle"></i> Resuming in <strong>' +
                        sec +
                        's</strong> · last call <strong>' +
                        last +
                        '</strong>';
                } else if (claimBreak && (!paused || state.claimWindowOpen || state.pendingGameEnd || state.pendingAdvanceAfterClaim)) {
                    const sec = state.claimBreakRemainingSec != null ? state.claimBreakRemainingSec : '…';
                    const extra =
                        state.pendingGameEnd || state.pendingAdvanceAfterClaim ? ' — more claims on this prize OK' : '';
                    els.pausedHint.innerHTML =
                        '<i class="fas fa-hourglass-half"></i> Claims open · ' + sec + 's' + extra;
                } else if (claimPause) {
                    els.pausedHint.innerHTML =
                        '<i class="fas fa-hand-paper"></i> <strong>Claim check</strong> — press Resume (Start button)';
                } else if (paused) {
                    els.pausedHint.innerHTML =
                        reason === 'manual'
                            ? '<i class="fas fa-pause-circle"></i> Game paused — press Resume (Start button)'
                            : '<i class="fas fa-pause-circle"></i> Paused';
                }
            }
        }
    }

    function winnersModalHtml(state) {
        const pw = (state && state.prizeWinners) || {};
        const prizes = (state && state.prizes) || {};
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
                const name = pw[r.id] && String(pw[r.id]).trim() ? String(pw[r.id]).trim() : '—';
                return (
                    '<li><span>' +
                    escapeHtml(String(tierLabel)) +
                    '</span><span>' +
                    escapeHtml(name) +
                    '</span></li>'
                );
            })
            .join('');
    }

    let winnersModalOpen = false;

    function syncWinnersModal(state) {
        if (!isCallerPage || !els.winnersModal) return;
        const show = !!(state && state.showWinnersPopup);
        if (show) {
            if (els.winnersModalList) els.winnersModalList.innerHTML = winnersModalHtml(state);
            els.winnersModal.hidden = false;
            winnersModalOpen = true;
        } else if (winnersModalOpen) {
            els.winnersModal.hidden = true;
            winnersModalOpen = false;
        }
    }

    async function dismissWinnersModal() {
        if (!isCallerPage || !els.winnersModal) return;
        const data = await apiPost('/games/bingo/dismiss-winners', {});
        if (data && data.success) {
            els.winnersModal.hidden = true;
            winnersModalOpen = false;
            if (data.state) renderStatus(data.state);
        }
    }

    function renderCalledBalls(state) {
        const ball = state.lastBall != null ? String(state.lastBall) : '—';
        if (els.lastBall) els.lastBall.textContent = ball;
        if (els.hubLastBall) els.hubLastBall.textContent = ball;
    }

    function renderPrizeWinners(state) {
        if (!els.prizeWinners) return;
        const pw = state && state.prizeWinners ? state.prizeWinners : {};
        const prizes = state && state.prizes ? state.prizes : {};
        const rows = [
            { id: 'line', fallback: '1 Line' },
            { id: 'two-lines', fallback: '2 Lines' },
            { id: 'house', fallback: 'House' }
        ];
        els.prizeWinners.innerHTML = rows
            .map(function (r) {
                const tierLabel =
                    (r.id === 'line' && prizes.line) ||
                    (r.id === 'two-lines' && prizes['two-lines']) ||
                    (r.id === 'house' && prizes.house) ||
                    r.fallback;
                const winner = pw[r.id];
                const hasWinner = !!(winner && String(winner).trim());
                return (
                    '<div class="mdj-caller-winner-chip' +
                    (hasWinner ? ' is-won' : '') +
                    '">' +
                    '<span class="mdj-caller-winner-chip__tier">' +
                    escapeHtml(String(tierLabel)) +
                    '</span>' +
                    '<span class="mdj-caller-winner-chip__name">' +
                    (hasWinner ? escapeHtml(String(winner).trim()) : '—') +
                    '</span></div>'
                );
            })
            .join('');
    }

    function renderStatus(state) {
        if (!els.status) return;
        if (!state.active) {
            els.status.textContent = state.showWinnersPopup ? 'Game over' : 'Not running';
            els.status.className = state.showWinnersPopup
                ? 'badge bg-primary mdj-bingo-status-pill'
                : 'badge bg-secondary mdj-bingo-status-pill';
            updateActionButtons(state);
            if (els.voiceCall && state.voiceCall != null) els.voiceCall.checked = !!state.voiceCall;
            renderCalledBalls(state.lastBall != null ? state : { lastBall: null });
            syncAdminGrid(
                state.calledBalls && state.calledBalls.length
                    ? state
                    : { ballCount: Number(els.ballCount?.value) || 90, calledBalls: [], lastBall: null }
            );
            renderPrizeWinners(state);
            syncWinnersModal(state);
            return;
        }
        if (state.phase === 'intro') {
            els.status.textContent = 'Intro · ' + (state.introRemainingSec || 0) + 's';
            els.status.className = 'badge bg-info text-dark mdj-bingo-status-pill';
        } else if (state.phase === 'resume') {
            const lb = state.lastBall != null ? ' · last ' + state.lastBall : '';
            els.status.textContent = 'Resuming · ' + (state.resumeRemainingSec || 0) + 's' + lb;
            els.status.className = 'badge bg-warning text-dark mdj-bingo-status-pill';
        } else if (state.phase === 'claim_break') {
            const sec = state.claimBreakRemainingSec != null ? state.claimBreakRemainingSec : '';
            els.status.textContent = sec ? 'Claims open · ' + sec + 's' : 'Claims open';
            els.status.className = 'badge bg-warning text-dark mdj-bingo-status-pill is-paused';
        } else if (state.paused) {
            els.status.textContent = 'Paused · claim check';
            els.status.className = 'badge bg-warning text-dark mdj-bingo-status-pill is-paused';
        } else if (state.showWinnersPopup) {
            els.status.textContent = 'Game over';
            els.status.className = 'badge bg-primary mdj-bingo-status-pill';
        } else if (state.autoCall) {
            els.status.textContent = 'Live · auto-call';
            els.status.className = 'badge bg-success mdj-bingo-status-pill';
        } else {
            els.status.textContent = 'Live · manual';
            els.status.className = 'badge bg-success mdj-bingo-status-pill';
        }
        updateActionButtons(state);
        if (els.ballCount) els.ballCount.value = state.ballCount;
        if (els.callInterval) els.callInterval.value = Math.round((state.callIntervalMs || 5000) / 1000);
        if (els.autoCall) els.autoCall.checked = !!state.autoCall;
        if (els.voiceCall) els.voiceCall.checked = !!state.voiceCall;
        if (els.introSeconds && state.introSeconds != null && !state.active) {
            els.introSeconds.value = state.introSeconds;
        }
        if (els.claimBreakSeconds && state.claimBreakMs != null) {
            els.claimBreakSeconds.value = String(Math.max(1, Math.round(state.claimBreakMs / 1000)));
        }
        renderCalledBalls(state);
        syncAdminGrid(state);
        if (state.playingFor) syncPlayingForUI(state.playingFor);
        if (state.prizes) syncPrizeFields(state.prizes);
        renderPrizeWinners(state);
        syncWinnersModal(state);
    }

    async function fetchState() {
        const s = slug();
        updateTargetHint();
        if (!s) {
            renderStatus({ active: false, calledBalls: [] });
            return;
        }
        try {
            const gid = getActiveGameId();
            let url = `/api/display/${encodeURIComponent(s)}/games/bingo/state`;
            if (gid) url += `?gameId=${encodeURIComponent(gid)}`;
            const res = await fetch(url);
            const state = await res.json();
            if (state.gameTitle && els.gameMeta) {
                const extra = els.gameMeta.textContent;
                if (!extra || extra.startsWith(state.gameTitle)) {
                    /* meta updated via syncGameMeta */
                }
            }
            renderStatus(state);
            if (isCallerPage) loadPlayers();
            if (!state.active) applyGameToCallerSetup(activeGameFromCache());
        } catch (e) {
            console.error('Bingo state fetch failed', e);
        }
    }

    async function apiPost(path, body) {
        const s = slug();
        if (!s) {
            alert('Select an event first.');
            return null;
        }
        const res = await mdjFetch(`/api/display/${encodeURIComponent(s)}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withGameId(body))
        });
        return res.json();
    }

    async function apiPut(path, body) {
        const s = slug();
        if (!s) return null;
        const res = await mdjFetch(`/api/display/${encodeURIComponent(s)}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withGameId(body))
        });
        return res.json();
    }

    document.getElementById('bingoStartBtn')?.addEventListener('click', async () => {
        const startBtn = document.getElementById('bingoStartBtn');
        const mode = startBtn?.dataset.mode || 'start';
        if (mode === 'pause') {
            const data = await apiPost('/games/bingo/pause');
            if (data?.success && data.state) renderStatus(data.state);
            else if (data?.error) alert(data.error);
            return;
        }
        if (mode === 'resume') {
            const data = await apiPost('/games/bingo/resume');
            if (data?.success && data.state) renderStatus(data.state);
            else if (data?.error) alert(data.error);
            return;
        }
        const data = await apiPost('/games/bingo/start', {
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            claimBreakSeconds: Number(els.claimBreakSeconds?.value) || 10,
            bingoTheme: els.themeSelect?.value || 'default',
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            playingFor: getSelectedPlayingFor(),
            introSeconds: Number(els.introSeconds?.value) || 0,
            ...getPrizePayload()
        });
        if (data?.success) {
            renderStatus(data.state);
            loadGames();
        } else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoSkipIntroBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/skip-intro');
        if (data?.success && data.state) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoStopBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/stop');
        if (data?.success) {
            renderStatus(data.state);
            loadGames();
        }
    });

    document.getElementById('bingoCallBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/call');
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoResetCallsBtn')?.addEventListener('click', async () => {
        if (!confirm('Clear all called balls for this event?')) return;
        const data = await apiPost('/games/bingo/reset-calls');
        if (data?.success) renderStatus(data.state);
    });

    document.getElementById('bingoApplyConfigBtn')?.addEventListener('click', () => saveGameCallerSetup());

    async function persistBingoThemeOnly() {
        const eid = eventId();
        const gid = getActiveGameId();
        if (!eid || !gid || !els.themeSelect) return;
        try {
            await mdjFetch(`/api/events/${eid}/bingo/games/${gid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bingoTheme: els.themeSelect.value || 'default' })
            });
        } catch (e) {
            /* display picks up theme on next poll when saved via Save to game */
        }
    }

    if (els.themeSelect) {
        els.themeSelect.addEventListener('change', function () {
            if (window.MdjBingoTheme) {
                window.MdjBingoTheme.apply(document.body, els.themeSelect.value);
            }
            void persistBingoThemeOnly();
        });
    }

    async function saveGameCallerSetup() {
        const eid = eventId();
        const gid = getActiveGameId();
        if (!eid || !gid) {
            alert('Select a game first.');
            return;
        }
        const body = buildCallerSaveBody();
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const saved = await res.json();
            if (!res.ok) {
                alert(saved.error || 'Could not save game');
                return;
            }
            const data = await apiPut('/games/bingo/config', {
                ...body,
                playingFor: getSelectedPlayingFor()
            });
            if (data?.success) renderStatus(data.state);
            await loadGames();
        } catch (e) {
            alert('Could not save caller setup');
        }
    }

    async function flashClaim(claimType) {
        const data = await apiPost('/games/bingo/claim-flash', { claimType });
        if (data?.success && data.state) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    }

    document.getElementById('bingoResumeBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/resume');
        if (data?.success && data.state) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoPauseBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/pause');
        if (data?.success && data.state) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.querySelectorAll('.mdj-bingo-playing-for [data-playing-for]').forEach((btn) => {
        btn.addEventListener('click', () => setPlayingFor(btn.getAttribute('data-playing-for')));
    });

    let prizeSaveTimer = null;
    function schedulePrizeSave() {
        if (!isCallerPage) return;
        clearTimeout(prizeSaveTimer);
        prizeSaveTimer = setTimeout(() => setPlayingFor(getSelectedPlayingFor()), 450);
    }
    [els.prizeLine, els.prizeTwoLines, els.prizeHouse].forEach((input) => {
        input?.addEventListener('input', function () {
            renderPrizeSummary();
            schedulePrizeSave();
        });
        input?.addEventListener('change', function () {
            renderPrizeSummary();
            schedulePrizeSave();
        });
    });

    document.getElementById('bingoFlashLineBtn')?.addEventListener('click', () => flashClaim('line'));
    document.getElementById('bingoFlashTwoLinesBtn')?.addEventListener('click', () => flashClaim('two-lines'));
    document.getElementById('bingoFlashHouseBtn')?.addEventListener('click', () => flashClaim('house'));

    document.getElementById('bingoVerifyBtn')?.addEventListener('click', async () => {
        const eid = eventId();
        const serial = (els.verifySerial?.value || '').trim();
        const claimType = getVerifyClaimType();
        if (!eid) {
            alert('Select an event first.');
            return;
        }
        if (!serial) {
            alert('Enter the card serial.');
            return;
        }
        els.verifyResult.textContent = 'Checking…';
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(withGameId({ serial, claimType }))
            });
            const data = await res.json();
            if (!res.ok) {
                els.verifyResult.textContent = data.error || 'Verification failed';
                els.verifyResult.className = 'small text-danger';
                return;
            }
            els.verifyResult.textContent = data.valid
                ? `Valid ${data.claimLabel} for serial ${data.serial} — flashed on display.`
                : `Not valid for ${data.claimLabel} (serial ${data.serial}) — flashed on display.`;
            els.verifyResult.className = data.valid ? 'small text-success' : 'small text-warning';
            if (data.valid) playVerifiedCallSoundLocal();
            if (data.state) renderStatus(data.state);
        } catch (e) {
            els.verifyResult.textContent = 'Could not verify.';
            els.verifyResult.className = 'small text-danger';
        }
    });

    document.getElementById('bingoGenCardsBtn')?.addEventListener('click', async () => {
        const eid = eventId();
        if (!eid) {
            alert('Select an event first.');
            return;
        }
        const count = Number(els.cardCount?.value) || 10;
        const batchId = (els.cardBatch?.value || '').trim() || undefined;
        const ballCount = Number(els.ballCount?.value) || 90;
        const gameId = getActiveGameId();
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/cards/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(withGameId({ count, batchId, ballCount }))
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not generate cards');
                return;
            }
            showBingoPrepPanel('cards');
            loadBatches();
            if (data.printUrl) window.open(data.printUrl, '_blank', 'noopener');
        } catch (e) {
            alert('Could not generate cards.');
        }
    });

    async function deleteCardBatch(batchId, cardCount, assigned) {
        const eid = eventId();
        if (!eid) return;
        if (assigned > 0) {
            alert('Some cards in this batch are assigned to guests.');
            return;
        }
        if (
            !confirm(
                `Delete batch "${batchId}" (${cardCount} cards)? This cannot be undone.`
            )
        ) {
            return;
        }
        try {
            const res = await mdjFetch(
                `/api/events/${eid}/bingo/batches/${encodeURIComponent(batchId)}`,
                { method: 'DELETE' }
            );
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not delete batch');
                return;
            }
            loadBatches();
            loadGames();
        } catch (e) {
            alert('Could not delete batch');
        }
    }

    async function loadBatches() {
        const eid = eventId();
        if (!els.batchesList || !eid) return;
        els.batchesList.innerHTML = '<span class="text-muted small">Loading…</span>';
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/batches`);
            const data = await res.json();
            const batches = data.batches || [];
            if (!batches.length) {
                els.batchesList.innerHTML = '<span class="text-muted small">No card batches yet.</span>';
                return;
            }
            els.batchesList.innerHTML = '';
            batches.forEach((b) => {
                const row = document.createElement('div');
                row.className = 'mdj-bingo-batch-row';
                const assigned = Number(b.assigned_count) || 0;
                const assignedNote =
                    assigned > 0
                        ? ` <span class="text-warning">· ${assigned} assigned</span>`
                        : '';
                const info = document.createElement('div');
                info.className = 'mdj-bingo-batch-info';
                info.innerHTML = `<strong>${escapeHtml(b.batch_id)}</strong> <span class="text-muted">(${b.card_count} cards)${assignedNote}</span>`;
                row.appendChild(info);
                const actions = document.createElement('div');
                actions.className = 'mdj-bingo-batch-actions';
                const printBtn = document.createElement('button');
                printBtn.type = 'button';
                printBtn.className = 'btn btn-outline-primary btn-sm mdj-bingo-touch-action';
                printBtn.innerHTML = '<i class="fas fa-print me-1" aria-hidden="true"></i>Print';
                printBtn.addEventListener('click', () => {
                    window.open(`/dj/bingo/${eid}/print?batch=${encodeURIComponent(b.batch_id)}`, '_blank');
                });
                actions.appendChild(printBtn);
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn btn-outline-danger btn-sm mdj-bingo-touch-action';
                delBtn.innerHTML = '<i class="fas fa-trash-alt me-1" aria-hidden="true"></i>Delete';
                delBtn.disabled = assigned > 0;
                delBtn.title =
                    assigned > 0
                        ? 'Cannot delete — some cards are assigned to guests'
                        : 'Remove all cards in this batch';
                delBtn.addEventListener('click', () => deleteCardBatch(b.batch_id, b.card_count, assigned));
                actions.appendChild(delBtn);
                row.appendChild(actions);
                els.batchesList.appendChild(row);
            });
        } catch (e) {
            els.batchesList.innerHTML = '<span class="text-danger small">Could not load batches.</span>';
        }
    }

    document.querySelectorAll('.mdj-bingo-verify-type [data-verify-claim]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mdj-bingo-verify-type [data-verify-claim]').forEach((b) => {
                b.classList.toggle('active', b === btn);
            });
            getVerifyClaimType();
        });
    });

    function showBingoPrepPanel(key) {
        document.querySelectorAll('[data-bingo-prep]').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-bingo-prep') === key);
        });
        document.querySelectorAll('[data-bingo-prep-panel]').forEach((panel) => {
            panel.hidden = panel.getAttribute('data-bingo-prep-panel') !== key;
        });
        if (key === 'cards') loadBatches();
    }

    function bindBingoPrepareTabs() {
        document.querySelectorAll('[data-bingo-prep]').forEach((btn) => {
            btn.addEventListener('click', () => {
                showBingoPrepPanel(btn.getAttribute('data-bingo-prep'));
            });
        });
    }

    function refreshPrepareData() {
        loadBatches();
        loadGames();
    }

    function setWizardStep(step) {
        wizardStep = Math.max(1, Math.min(5, step));
        document.querySelectorAll('[data-wizard-panel]').forEach((panel) => {
            panel.hidden = parseInt(panel.getAttribute('data-wizard-panel'), 10) !== wizardStep;
        });
        wizardEls.steps?.querySelectorAll('[data-wizard-step]').forEach((li) => {
            const n = parseInt(li.getAttribute('data-wizard-step'), 10);
            li.classList.toggle('is-active', n === wizardStep);
            li.classList.toggle('is-done', n < wizardStep);
        });
        if (wizardEls.backBtn) wizardEls.backBtn.hidden = wizardStep <= 1;
        if (wizardEls.nextBtn) wizardEls.nextBtn.hidden = wizardStep >= 5;
        if (wizardEls.createBtn) wizardEls.createBtn.hidden = wizardStep !== 5;
        if (wizardStep === 5) renderWizardReview();
        if (wizardEls.error) {
            wizardEls.error.hidden = true;
            wizardEls.error.textContent = '';
        }
    }

    function defaultWizardTitle() {
        return `Game ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    function resetWizardForm() {
        if (wizardEls.title) wizardEls.title.value = defaultWizardTitle();
        if (wizardEls.start) wizardEls.start.value = '';
        const def = eventBingoDefaults.maxVirtualCards || 1;
        if (wizardEls.maxVirtual) wizardEls.maxVirtual.value = String(def);
        if (wizardEls.maxVirtualHint) {
            wizardEls.maxVirtualHint.textContent = `Event default: ${def} card${def === 1 ? '' : 's'} — change per game here.`;
        }
        if (wizardEls.openJoin) wizardEls.openJoin.checked = true;
        if (wizardEls.cardCount) wizardEls.cardCount.value = '0';
        const balls = Number(els.ballCount?.value) || 90;
        if (wizardEls.ballCount) wizardEls.ballCount.value = String(balls);
        if (wizardEls.intro) wizardEls.intro.value = els.introSeconds?.value || '30';
        if (wizardEls.interval) wizardEls.interval.value = els.callInterval?.value || '5';
        if (wizardEls.autoCall) wizardEls.autoCall.checked = !!els.autoCall?.checked;
        if (wizardEls.voiceCall) wizardEls.voiceCall.checked = !!els.voiceCall?.checked;
        if (wizardEls.prizeLine) wizardEls.prizeLine.value = els.prizeLine?.value || '';
        if (wizardEls.prizeTwo) wizardEls.prizeTwo.value = els.prizeTwoLines?.value || '';
        if (wizardEls.prizeHouse) wizardEls.prizeHouse.value = els.prizeHouse?.value || '';
        if (wizardEls.claimBreak) {
            wizardEls.claimBreak.value = els.claimBreakSeconds?.value || '10';
        }
        if (wizardEls.theme) {
            wizardEls.theme.value = window.MdjBingoTheme
                ? window.MdjBingoTheme.normalize(els.themeSelect?.value || 'default')
                : els.themeSelect?.value || 'default';
        }
        setWizardStep(1);
    }

    function openCreateWizard() {
        const eid = eventId();
        if (!eid) {
            alert('Select an event first.');
            return;
        }
        resetWizardForm();
        if (!createWizardModal && wizardEls.modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            createWizardModal = new bootstrap.Modal(wizardEls.modal);
        }
        createWizardModal?.show();
    }

    function wizardPayload() {
        const title = (wizardEls.title?.value || '').trim() || defaultWizardTitle();
        const cardCount = Number(wizardEls.cardCount?.value) || 0;
        const openJoin = !!wizardEls.openJoin?.checked;
        const ballCount = Number(wizardEls.ballCount?.value) || 90;
        const maxVirtualCards = Number(wizardEls.maxVirtual?.value) || eventBingoDefaults.maxVirtualCards || 1;
        const startRaw = wizardEls.start?.value || '';
        return {
            title,
            cardCount,
            openJoin,
            ballCount,
            maxVirtualCards,
            advertisedStartAt: startRaw || null,
            introSeconds: Number(wizardEls.intro?.value) || 0,
            callIntervalSeconds: Number(wizardEls.interval?.value) || 5,
            autoCall: !!wizardEls.autoCall?.checked,
            voiceCall: !!wizardEls.voiceCall?.checked,
            prizeLine: (wizardEls.prizeLine?.value || '').trim(),
            prizeTwoLines: (wizardEls.prizeTwo?.value || '').trim(),
            prizeHouse: (wizardEls.prizeHouse?.value || '').trim(),
            claimBreakSeconds: Number(wizardEls.claimBreak?.value) || 10,
            bingoTheme: wizardEls.theme?.value || 'default'
        };
    }

    function renderWizardReview() {
        if (!wizardEls.review) return;
        const p = wizardPayload();
        const startLabel = p.advertisedStartAt
            ? formatAdvertisedStart(new Date(p.advertisedStartAt).toISOString()) || p.advertisedStartAt
            : 'Not set';
        wizardEls.review.innerHTML =
            `<dt>Title</dt><dd>${escapeHtml(p.title)}</dd>` +
            `<dt>Advertised start</dt><dd>${escapeHtml(startLabel)}</dd>` +
            `<dt>Max virtual per guest</dt><dd>${escapeHtml(String(p.maxVirtualCards))}</dd>` +
            `<dt>Join on hub</dt><dd>${p.openJoin ? 'Yes — open straight away' : 'No — prepare first'}</dd>` +
            `<dt>Cards to generate</dt><dd>${escapeHtml(String(p.cardCount))}</dd>` +
            `<dt>Balls</dt><dd>${escapeHtml(String(p.ballCount))}</dd>` +
            `<dt>Caller</dt><dd>Intro ${escapeHtml(String(p.introSeconds))}s · every ${escapeHtml(String(p.callIntervalSeconds))}s` +
            `${p.autoCall ? ' · auto' : ''}${p.voiceCall ? ' · voice' : ''}</dd>` +
            `<dt>Claim window</dt><dd>${escapeHtml(String(p.claimBreakSeconds))}s</dd>` +
            `<dt>Theme</dt><dd>${escapeHtml(bingoThemeLabel(p.bingoTheme))}</dd>`;
    }

    function openEditGame(gameId) {
        const g = gamesCache.find((x) => x.id === gameId);
        if (!g || !editEls.modal) return;
        if (editEls.id) editEls.id.value = String(gameId);
        if (editEls.title) editEls.title.value = g.title || '';
        if (editEls.start) editEls.start.value = isoToDatetimeLocal(g.advertisedStartAt);
        if (editEls.maxVirtual) {
            editEls.maxVirtual.value = String(g.maxVirtualCards != null ? g.maxVirtualCards : eventBingoDefaults.maxVirtualCards || 1);
        }
        if (editEls.ballCount) {
            editEls.ballCount.value = String(g.ballCount || 90);
            editEls.ballCount.disabled = g.status === 'live';
        }
        if (editEls.intro) editEls.intro.value = String(g.introSeconds != null ? g.introSeconds : 30);
        if (editEls.interval) editEls.interval.value = String(Math.round((g.callIntervalMs || 5000) / 1000));
        if (editEls.autoCall) editEls.autoCall.checked = !!g.autoCall;
        if (editEls.voiceCall) editEls.voiceCall.checked = !!g.voiceCall;
        if (editEls.prizeLine) editEls.prizeLine.value = g.prizes?.line || '';
        if (editEls.prizeTwo) editEls.prizeTwo.value = g.prizes?.['two-lines'] || '';
        if (editEls.prizeHouse) editEls.prizeHouse.value = g.prizes?.house || '';
        if (editEls.claimBreak) {
            editEls.claimBreak.value = String(g.claimBreakSeconds != null ? g.claimBreakSeconds : 10);
        }
        if (editEls.theme) {
            editEls.theme.value = window.MdjBingoTheme
                ? window.MdjBingoTheme.normalize(g.bingoTheme || 'default')
                : g.bingoTheme || 'default';
        }
        if (editEls.error) {
            editEls.error.hidden = true;
            editEls.error.textContent = '';
        }
        if (!editGameModal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            editGameModal = new bootstrap.Modal(editEls.modal);
        }
        editGameModal?.show();
    }

    async function submitEditGame() {
        const eid = eventId();
        const gameId = editEls.id?.value;
        if (!eid || !gameId) return;
        if (editEls.saveBtn) editEls.saveBtn.disabled = true;
        if (editEls.error) {
            editEls.error.hidden = true;
            editEls.error.textContent = '';
        }
        const body = {
            title: (editEls.title?.value || '').trim(),
            maxVirtualCards: Number(editEls.maxVirtual?.value) || 1,
            advertisedStartAt: editEls.start?.value || null,
            ballCount: Number(editEls.ballCount?.value) || 90,
            introSeconds: Number(editEls.intro?.value) || 0,
            callIntervalSeconds: Number(editEls.interval?.value) || 5,
            autoCall: !!editEls.autoCall?.checked,
            voiceCall: !!editEls.voiceCall?.checked,
            prizeLine: (editEls.prizeLine?.value || '').trim(),
            prizeTwoLines: (editEls.prizeTwo?.value || '').trim(),
            prizeHouse: (editEls.prizeHouse?.value || '').trim(),
            claimBreakSeconds: Number(editEls.claimBreak?.value) || 10,
            bingoTheme: editEls.theme?.value || 'default'
        };
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gameId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) {
                if (editEls.error) {
                    editEls.error.textContent = data.error || 'Could not save';
                    editEls.error.hidden = false;
                }
                return;
            }
            editGameModal?.hide();
            await loadGames();
            if (getActiveGameId() === parseInt(gameId, 10)) {
                applyGameToCallerSetup(data.game);
                fetchState();
            }
        } catch (e) {
            if (editEls.error) {
                editEls.error.textContent = 'Could not save game';
                editEls.error.hidden = false;
            }
        } finally {
            if (editEls.saveBtn) editEls.saveBtn.disabled = false;
        }
    }

    async function submitCreateWizard() {
        const eid = eventId();
        if (!eid) return;
        const p = wizardPayload();
        if (wizardEls.createBtn) wizardEls.createBtn.disabled = true;
        if (wizardEls.error) {
            wizardEls.error.hidden = true;
            wizardEls.error.textContent = '';
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
            const data = await res.json();
            if (!res.ok) {
                if (wizardEls.error) {
                    wizardEls.error.textContent = data.error || 'Could not create game';
                    wizardEls.error.hidden = false;
                }
                return;
            }
            createWizardModal?.hide();
            if (data.printUrl && p.cardCount > 0) window.open(data.printUrl, '_blank', 'noopener');
            await loadGames();
            if (data.game?.id && els.gameSelect) {
                els.gameSelect.value = String(data.game.id);
                persistSelectedGame(data.game.id);
                syncGameMeta();
            }
            if (data.game) applyGameToCallerSetup(data.game);
        } catch (e) {
            if (wizardEls.error) {
                wizardEls.error.textContent = 'Could not create game';
                wizardEls.error.hidden = false;
            }
        } finally {
            if (wizardEls.createBtn) wizardEls.createBtn.disabled = false;
        }
    }

    document.getElementById('bingoOpenCreateWizardBtn')?.addEventListener('click', openCreateWizard);
    wizardEls.nextBtn?.addEventListener('click', () => {
        if (wizardStep < 5) setWizardStep(wizardStep + 1);
    });
    wizardEls.backBtn?.addEventListener('click', () => {
        if (wizardStep > 1) setWizardStep(wizardStep - 1);
    });
    wizardEls.createBtn?.addEventListener('click', submitCreateWizard);
    editEls.saveBtn?.addEventListener('click', submitEditGame);

    document.getElementById('bingoAssignBtn')?.addEventListener('click', async () => {
        const eid = eventId();
        const gid = getActiveGameId();
        const name = (els.assignName?.value || '').trim();
        if (!eid || !gid) {
            alert('Select a game first.');
            return;
        }
        if (!name) {
            alert('Enter a guest name.');
            return;
        }
        if (els.assignResult) els.assignResult.textContent = 'Assigning…';
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gid}/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerName: name })
            });
            const data = await res.json();
            if (!res.ok) {
                if (els.assignResult) {
                    els.assignResult.textContent = data.error || 'Failed';
                    els.assignResult.className = 'small text-danger mb-2';
                }
                return;
            }
            if (els.assignResult) {
                els.assignResult.textContent = `Assigned ${data.card.serial} to ${name}`;
                els.assignResult.className = 'small text-success mb-2';
            }
            loadGames();
        } catch (e) {
            if (els.assignResult) els.assignResult.textContent = 'Could not assign';
        }
    });

    els.gameSelect?.addEventListener('change', () => {
        persistSelectedGame(els.gameSelect.value ? parseInt(els.gameSelect.value, 10) : null);
        syncGameMeta();
        renderGamesList();
        loadPlayers();
        applyGameToCallerSetup(activeGameFromCache());
        fetchState();
    });

    let gridResizeTimer = null;
    window.addEventListener(
        'resize',
        () => {
            if (!isCallerPage) return;
            clearTimeout(gridResizeTimer);
            gridResizeTimer = setTimeout(fitAdminGridCellFont, 120);
        },
        { passive: true }
    );

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(fetchState, 2500);
    }

    function stopPoll() {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    function openPrizesModal() {
        const modal = document.getElementById('bingoPrizesModal');
        if (modal) modal.hidden = false;
    }

    function closePrizesModal() {
        const modal = document.getElementById('bingoPrizesModal');
        if (modal) modal.hidden = true;
    }

    if (isCallerPage) {
        bindAdminGridFit();
        startPoll();
        loadGames();
        renderPrizeSummary();
        requestAnimationFrame(() => requestAnimationFrame(fitAdminGridCellFont));
        els.winnersModalDismiss?.addEventListener('click', dismissWinnersModal);
        document.getElementById('bingoPrizesModalOpen')?.addEventListener('click', openPrizesModal);
        document.getElementById('bingoPrizesModalClose')?.addEventListener('click', closePrizesModal);
        document.getElementById('bingoPrizesModal')?.addEventListener('click', function (e) {
            if (e.target === e.currentTarget) closePrizesModal();
        });
        document.getElementById('bingoPrizesModalSave')?.addEventListener('click', async function () {
            const data = await apiPut('/games/bingo/config', {
                playingFor: getSelectedPlayingFor(),
                ...getPrizePayload()
            });
            if (data?.success) {
                renderStatus(data.state);
                closePrizesModal();
            } else if (data?.error) alert(data.error);
        });
    } else {
        document.getElementById('games-tab')?.addEventListener('shown.bs.tab', () => {
            fetchState();
            refreshPrepareData();
            startPoll();
        });

        document.getElementById('games-tab')?.addEventListener('hidden.bs.tab', () => {
            stopPoll();
        });
    }

    window.addEventListener('mdj-dashboard-event-changed', () => {
        fetchState();
        loadBatches();
        loadGames();
        updateTargetHint();
    });

    if (els.adminGrid) buildAdminGrid(Number(els.ballCount?.value) || 90);
    updateTargetHint();
    fetchState();

    if (!isCallerPage) {
        bindBingoPrepareTabs();
        const gamesPane = document.getElementById('games');
        if (gamesPane?.classList.contains('active') || gamesPane?.classList.contains('show')) {
            refreshPrepareData();
            startPoll();
        }
    }
})();
