/**
 * DJ dashboard — Games tab (Bingo v1; extensible game picker).
 */
(function () {
    const panel = document.getElementById('gamePanelBingo');
    if (!panel) return;

    const els = {
        status: document.getElementById('bingoRunStatus'),
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
        resumeBtn: document.getElementById('bingoResumeBtn')
    };

    let pollTimer = null;
    let adminCells = new Map();
    let adminGridSize = 0;
    let selectedPlayingFor = 'line';
    let adminGridResizeObserver = null;

    function setGamesDashboardFocus(on) {
        document.body.classList.toggle('mdj-dashboard-games-focus', !!on);
        if (on) {
            requestAnimationFrame(() => {
                fitAdminGridCellFont();
            });
        }
    }

    /** Size number text so all 90 cells fit the board area without an inner scrollbar (Games focus layout). */
    function fitAdminGridCellFont() {
        if (!document.body.classList.contains('mdj-dashboard-games-focus')) return;
        const wrap = document.querySelector('#bingoSubControl .mdj-bingo-grid-scroll');
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

    function bindAdminGridFit() {
        const wrap = document.querySelector('#bingoSubControl .mdj-bingo-grid-scroll');
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
        const data = await apiPut('/games/bingo/config', {
            ballCount: Number(els.ballCount?.value) || 90,
            callIntervalSeconds: Number(els.callInterval?.value) || 5,
            autoCall: !!els.autoCall?.checked,
            voiceCall: !!els.voiceCall?.checked,
            playingFor: selectedPlayingFor,
            introSeconds: Number(els.introSeconds?.value) || 0
        });
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
        if (els.lastBall) {
            els.lastBall.textContent = state.lastBall != null ? String(state.lastBall) : '—';
        }
    }

    function renderStatus(state) {
        if (!els.status) return;
        if (!state.active) {
            els.status.textContent = 'Not running';
            els.status.className = 'badge bg-secondary mdj-bingo-status-pill';
            updateActionButtons(state);
            if (els.voiceCall && state.voiceCall != null) els.voiceCall.checked = !!state.voiceCall;
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
            const res = await fetch(`/api/display/${encodeURIComponent(s)}/games/bingo/state`);
            const state = await res.json();
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
            body: body ? JSON.stringify(body) : undefined
        });
        return res.json();
    }

    async function apiPut(path, body) {
        const s = slug();
        if (!s) return null;
        const res = await mdjFetch(`/api/display/${encodeURIComponent(s)}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
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
        if (data?.success) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoSkipIntroBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/skip-intro');
        if (data?.success && data.state) renderStatus(data.state);
        else if (data?.error) alert(data.error);
    });

    document.getElementById('bingoStopBtn')?.addEventListener('click', async () => {
        const data = await apiPost('/games/bingo/stop');
        if (data?.success) renderStatus(data.state);
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
                body: JSON.stringify({ serial, claimType })
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
        try {
            const res = await mdjFetch(`/api/events/${eid}/bingo/cards/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count, batchId, ballCount })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not generate cards');
                return;
            }
            loadBatches();
            if (data.printUrl) window.open(data.printUrl, '_blank', 'noopener');
        } catch (e) {
            alert('Could not generate cards.');
        }
    });

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
                row.innerHTML = `<span><strong>${b.batch_id}</strong> <span class="text-muted">(${b.card_count})</span></span>`;
                const printBtn = document.createElement('button');
                printBtn.type = 'button';
                printBtn.className = 'btn btn-outline-primary';
                printBtn.textContent = 'Print';
                printBtn.addEventListener('click', () => {
                    window.open(`/dj/bingo/${eid}/print?batch=${encodeURIComponent(b.batch_id)}`, '_blank');
                });
                row.appendChild(printBtn);
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

    document.getElementById('bingoSubPrepare-tab')?.addEventListener('shown.bs.tab', loadBatches);

    document.getElementById('bingoSubControl-tab')?.addEventListener('shown.bs.tab', () => {
        fitAdminGridCellFont();
    });

    let gamesFocusResizeTimer = null;
    window.addEventListener(
        'resize',
        () => {
            if (!document.body.classList.contains('mdj-dashboard-games-focus')) return;
            clearTimeout(gamesFocusResizeTimer);
            gamesFocusResizeTimer = setTimeout(fitAdminGridCellFont, 120);
        },
        { passive: true }
    );

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(fetchState, 2500);
    }

    document.getElementById('games-tab')?.addEventListener('shown.bs.tab', () => {
        setGamesDashboardFocus(true);
        bindAdminGridFit();
        fetchState();
        if (document.getElementById('bingoSubPrepare')?.classList.contains('active')) loadBatches();
        startPoll();
        requestAnimationFrame(() => requestAnimationFrame(fitAdminGridCellFont));
    });

    document.getElementById('games-tab')?.addEventListener('hidden.bs.tab', () => {
        setGamesDashboardFocus(false);
        if (adminGridResizeObserver) {
            adminGridResizeObserver.disconnect();
            adminGridResizeObserver = null;
        }
        clearInterval(pollTimer);
    });

    window.addEventListener('mdj-dashboard-event-changed', () => {
        fetchState();
        loadBatches();
        updateTargetHint();
    });

    buildAdminGrid(Number(els.ballCount?.value) || 90);
    updateTargetHint();
    fetchState();

    const gamesPane = document.getElementById('games');
    if (gamesPane?.classList.contains('active') || gamesPane?.classList.contains('show')) {
        setGamesDashboardFocus(true);
        bindAdminGridFit();
        requestAnimationFrame(() => requestAnimationFrame(fitAdminGridCellFont));
    }
})();
