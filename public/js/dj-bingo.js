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
        pausedHint: document.getElementById('bingoPausedHint'),
        resumeBtn: document.getElementById('bingoResumeBtn'),
        gameSelect: document.getElementById('bingoActiveGameSelect'),
        gameMeta: document.getElementById('bingoActiveGameMeta'),
        gamesList: document.getElementById('bingoGamesList'),
        playersList: document.getElementById('bingoPlayersList'),
        newGameTitle: document.getElementById('bingoNewGameTitle'),
        newGameCards: document.getElementById('bingoNewGameCards'),
        newGameOpenJoin: document.getElementById('bingoNewGameOpenJoin'),
        assignName: document.getElementById('bingoAssignName'),
        assignResult: document.getElementById('bingoAssignResult')
    };

    let pollTimer = null;
    let gamesCache = [];
    let selectedGameId = null;
    let adminCells = new Map();
    let adminGridSize = 0;
    let selectedPlayingFor = 'line';
    let adminGridResizeObserver = null;

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
        const px = Math.max(7, Math.min(15, Math.min(cellW, cellH) * 0.42));
        grid.style.setProperty('--mdj-bingo-admin-cell-fs', px + 'px');
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
        els.gameMeta.textContent = `${g.title} · ${statusLabel(g.status)} · ${g.unassignedCards ?? '?'} cards free · ${g.assignments ?? 0} assigned`;
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
            els.gamesList.innerHTML = '<p class="text-muted mb-0">No games yet — create one below.</p>';
            return;
        }
        const gid = getActiveGameId();
        els.gamesList.innerHTML = gamesCache
            .map((g) => {
                const sel = gid === g.id ? ' is-selected' : '';
                return (
                    `<div class="mdj-bingo-game-row${sel}" data-game-id="${g.id}">` +
                    `<div><strong>${escapeHtml(g.title)}</strong><br><span class="text-muted">${statusLabel(g.status)} · ${g.unassignedCards} free · ${g.assignments} players</span></div>` +
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
                    `<button type="button" class="btn btn-outline-primary bingo-game-use" data-id="${g.id}">Use</button>` +
                    (g.status !== 'live' && (g.assignments || 0) === 0
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
                fetchState();
            });
        });
        els.gamesList.querySelectorAll('.bingo-game-delete').forEach((btn) => {
            btn.addEventListener('click', () => deletePreparedGame(btn.dataset.id));
        });
    }

    async function deletePreparedGame(gameId) {
        const eid = eventId();
        if (!eid) return;
        const g = gamesCache.find((x) => x.id === parseInt(gameId, 10));
        const label = g && g.title ? `"${g.title}"` : 'this game';
        if (
            !confirm(
                `Delete ${label} and all its prepared cards? This cannot be undone.`
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
            populateGameSelect();
            renderGamesList();
            loadPlayers();
        } catch (e) {
            if (els.gamesList) els.gamesList.innerHTML = '<span class="text-danger">Could not load games.</span>';
        }
    }

    async function loadPlayers() {
        const eid = eventId();
        const gid = getActiveGameId();
        if (!els.playersList || !eid || !gid) {
            if (els.playersList) els.playersList.innerHTML = '<span class="text-muted">Select a game to see players.</span>';
            return;
        }
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games/${gid}/players`);
            const data = await res.json();
            const players = data.players || [];
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
            els.playersList.innerHTML = '<span class="text-danger">Could not load players.</span>';
        }
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    function getSelectedPlayingFor() {
        const active = document.querySelector('.mdj-bingo-playing-for [data-playing-for].active');
        return active?.getAttribute('data-playing-for') || selectedPlayingFor || 'line';
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
            introSeconds: Number(els.introSeconds?.value) || 0
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

    function syncAdminGrid(state) {
        const ballCount = state.ballCount || 90;
        if (ballCount !== adminGridSize) buildAdminGrid(ballCount);
        const called = new Set(state.calledBalls || []);
        adminCells.forEach((cell, n) => {
            cell.classList.toggle('is-called', called.has(n));
            cell.classList.toggle('is-last', state.lastBall === n);
        });
    }

    function updateActionButtons(state) {
        const hasSlug = !!slug();
        const active = !!state.active;
        const paused = !!state.paused;
        const byId = (id) => document.getElementById(id);
        if (byId('bingoStartBtn')) byId('bingoStartBtn').disabled = !hasSlug || active;
        if (byId('bingoStopBtn')) byId('bingoStopBtn').disabled = !hasSlug || !active;
        const inIntro = state.phase === 'intro';
        if (byId('bingoCallBtn')) byId('bingoCallBtn').disabled = !hasSlug || !active || paused || inIntro;
        if (els.skipIntroBtn) els.skipIntroBtn.hidden = !(active && inIntro);
        if (byId('bingoResetCallsBtn')) byId('bingoResetCallsBtn').disabled = !hasSlug || !active;
        if (byId('bingoApplyConfigBtn')) byId('bingoApplyConfigBtn').disabled = !hasSlug;
        if (byId('bingoFlashLineBtn')) byId('bingoFlashLineBtn').disabled = !hasSlug || !active;
        if (byId('bingoFlashTwoLinesBtn')) byId('bingoFlashTwoLinesBtn').disabled = !hasSlug || !active;
        if (byId('bingoFlashHouseBtn')) byId('bingoFlashHouseBtn').disabled = !hasSlug || !active;
        if (byId('bingoVerifyBtn')) byId('bingoVerifyBtn').disabled = !hasSlug;
        if (byId('bingoGenCardsBtn')) byId('bingoGenCardsBtn').disabled = !hasSlug;
        if (els.ballCount) els.ballCount.disabled = active;
        if (els.resumeBtn) {
            els.resumeBtn.hidden = !(active && paused);
        }
        if (els.pausedHint) {
            els.pausedHint.hidden = !(active && paused);
        }
    }

    function renderCalledBalls(state) {
        const ball = state.lastBall != null ? String(state.lastBall) : '—';
        if (els.lastBall) els.lastBall.textContent = ball;
        if (els.hubLastBall) els.hubLastBall.textContent = ball;
    }

    function renderStatus(state) {
        if (!els.status) return;
        if (!state.active) {
            els.status.textContent = 'Not running';
            els.status.className = 'badge bg-secondary mdj-bingo-status-pill';
            updateActionButtons(state);
            if (els.voiceCall && state.voiceCall != null) els.voiceCall.checked = !!state.voiceCall;
            renderCalledBalls({ lastBall: null });
            syncAdminGrid({ ballCount: Number(els.ballCount?.value) || 90, calledBalls: [], lastBall: null });
            return;
        }
        if (state.phase === 'intro') {
            els.status.textContent = 'Intro · ' + (state.introRemainingSec || 0) + 's';
            els.status.className = 'badge bg-info text-dark mdj-bingo-status-pill';
        } else if (state.paused) {
            els.status.textContent = 'Paused · claim check';
            els.status.className = 'badge bg-warning text-dark mdj-bingo-status-pill is-paused';
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
        renderCalledBalls(state);
        syncAdminGrid(state);
        if (state.playingFor) syncPlayingForUI(state.playingFor);
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
        const data = await apiPost('/games/bingo/start', {
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            playingFor: getSelectedPlayingFor(),
            introSeconds: Number(els.introSeconds?.value) || 0
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

    document.getElementById('bingoApplyConfigBtn')?.addEventListener('click', async () => {
        const data = await apiPut('/games/bingo/config', {
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            playingFor: getSelectedPlayingFor(),
            introSeconds: Number(els.introSeconds?.value) || 0
        });
        if (data?.success) renderStatus(data.state);
    });

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

    document.querySelectorAll('.mdj-bingo-playing-for [data-playing-for]').forEach((btn) => {
        btn.addEventListener('click', () => setPlayingFor(btn.getAttribute('data-playing-for')));
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

    document.getElementById('bingoCreateGameBtn')?.addEventListener('click', async () => {
        const eid = eventId();
        if (!eid) {
            alert('Select an event first.');
            return;
        }
        const title = (els.newGameTitle?.value || '').trim() || `Game ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const cardCount = Number(els.newGameCards?.value) || 0;
        const openJoin = !!els.newGameOpenJoin?.checked;
        const ballCount = Number(els.ballCount?.value) || 90;
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/games`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, cardCount, openJoin, ballCount })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not create game');
                return;
            }
            if (els.newGameTitle) els.newGameTitle.value = '';
            if (data.printUrl) window.open(data.printUrl, '_blank', 'noopener');
            await loadGames();
            if (data.game?.id && els.gameSelect) {
                els.gameSelect.value = String(data.game.id);
                persistSelectedGame(data.game.id);
                syncGameMeta();
            }
        } catch (e) {
            alert('Could not create game');
        }
    });

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

    if (isCallerPage) {
        bindAdminGridFit();
        startPoll();
        loadGames();
        requestAnimationFrame(() => requestAnimationFrame(fitAdminGridCellFont));
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
