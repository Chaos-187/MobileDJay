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
        autoCall: document.getElementById('bingoAutoCall'),
        calledStrip: document.getElementById('bingoCalledStrip'),
        lastBall: document.getElementById('bingoLastBall'),
        cardCount: document.getElementById('bingoCardGenCount'),
        cardBatch: document.getElementById('bingoCardBatch'),
        verifySerial: document.getElementById('bingoVerifySerial'),
        verifyResult: document.getElementById('bingoVerifyResult'),
        batchesList: document.getElementById('bingoBatchesList'),
        targetHint: document.getElementById('bingoTargetHint')
    };

    let pollTimer = null;

    function slug() {
        return typeof window.mdjGetPromptTargetSlug === 'function' ? window.mdjGetPromptTargetSlug() : null;
    }

    function eventId() {
        return typeof window.mdjGetPromptTargetEventId === 'function' ? window.mdjGetPromptTargetEventId() : null;
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

    function updateActionButtons(state) {
        const hasSlug = !!slug();
        const active = !!state.active;
        const byId = (id) => document.getElementById(id);
        if (byId('bingoStartBtn')) byId('bingoStartBtn').disabled = !hasSlug || active;
        if (byId('bingoStopBtn')) byId('bingoStopBtn').disabled = !hasSlug || !active;
        if (byId('bingoCallBtn')) byId('bingoCallBtn').disabled = !hasSlug || !active;
        if (byId('bingoResetCallsBtn')) byId('bingoResetCallsBtn').disabled = !hasSlug || !active;
        if (byId('bingoApplyConfigBtn')) byId('bingoApplyConfigBtn').disabled = !hasSlug;
        if (byId('bingoFlashLineBtn')) byId('bingoFlashLineBtn').disabled = !hasSlug;
        if (byId('bingoFlashTwoLinesBtn')) byId('bingoFlashTwoLinesBtn').disabled = !hasSlug;
        if (byId('bingoFlashHouseBtn')) byId('bingoFlashHouseBtn').disabled = !hasSlug;
        if (byId('bingoVerifyBtn')) byId('bingoVerifyBtn').disabled = !hasSlug;
        if (byId('bingoGenCardsBtn')) byId('bingoGenCardsBtn').disabled = !hasSlug;
        if (els.ballCount) els.ballCount.disabled = active;
    }

    function renderCalledBalls(state) {
        if (!els.calledStrip) return;
        els.calledStrip.innerHTML = '';
        const balls = state.calledBalls || [];
        if (!balls.length) {
            els.calledStrip.innerHTML = '<span class="text-muted small">No balls called yet.</span>';
            return;
        }
        balls.forEach((n, idx) => {
            const chip = document.createElement('span');
            chip.className =
                'mdj-bingo-ball-chip' + (idx === balls.length - 1 ? ' mdj-bingo-ball-chip--last' : '');
            chip.textContent = n;
            els.calledStrip.appendChild(chip);
        });
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
            return;
        }
        els.status.textContent = state.autoCall ? 'Live · auto-call' : 'Live · manual';
        els.status.className = 'badge bg-success mdj-bingo-status-pill';
        updateActionButtons(state);
        if (els.ballCount) els.ballCount.value = state.ballCount;
        if (els.callInterval) els.callInterval.value = Math.round((state.callIntervalMs || 5000) / 1000);
        if (els.autoCall) els.autoCall.checked = !!state.autoCall;
        renderCalledBalls(state);
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
            autoCall: !!els.autoCall?.checked
        });
        if (data?.success) renderStatus(data.state);
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
            autoCall: !!els.autoCall?.checked
        });
        if (data?.success) renderStatus(data.state);
    });

    async function flashClaim(claimType) {
        const data = await apiPost('/games/bingo/claim-flash', { claimType });
        if (!data?.success && data?.error) alert(data.error);
    }

    document.getElementById('bingoFlashLineBtn')?.addEventListener('click', () => flashClaim('line'));
    document.getElementById('bingoFlashTwoLinesBtn')?.addEventListener('click', () => flashClaim('two-lines'));
    document.getElementById('bingoFlashHouseBtn')?.addEventListener('click', () => flashClaim('house'));

    document.getElementById('bingoVerifyBtn')?.addEventListener('click', async () => {
        const eid = eventId();
        const serial = (els.verifySerial?.value || '').trim();
        const claimType = document.getElementById('bingoVerifyClaimType')?.value || 'house';
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
                row.className = 'd-flex justify-content-between align-items-center gap-2 mb-1 flex-wrap';
                row.innerHTML = `<span><code>${b.batch_id}</code> <span class="text-muted">(${b.card_count} cards)</span></span>`;
                const printBtn = document.createElement('button');
                printBtn.type = 'button';
                printBtn.className = 'btn btn-sm btn-outline-primary';
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

    document.querySelectorAll('.mdj-game-tile[data-game]').forEach((tile) => {
        tile.addEventListener('click', () => {
            if (tile.classList.contains('mdj-game-tile--soon')) return;
            const game = tile.dataset.game;
            document.querySelectorAll('.mdj-game-panel').forEach((p) => {
                p.hidden = p.dataset.gamePanel !== game;
            });
            document.querySelectorAll('.mdj-game-tile').forEach((t) => t.classList.remove('is-active'));
            tile.classList.add('is-active');
        });
    });

    function startPoll() {
        clearInterval(pollTimer);
        pollTimer = setInterval(fetchState, 2500);
    }

    document.getElementById('games-tab')?.addEventListener('shown.bs.tab', () => {
        fetchState();
        loadBatches();
        startPoll();
    });

    document.getElementById('games-tab')?.addEventListener('hidden.bs.tab', () => {
        clearInterval(pollTimer);
    });

    window.addEventListener('mdj-dashboard-event-changed', () => {
        fetchState();
        loadBatches();
        updateTargetHint();
    });

    updateTargetHint();
    fetchState();
})();
