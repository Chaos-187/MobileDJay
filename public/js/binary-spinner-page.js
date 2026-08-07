// Standalone binary spinner page (coin or yes/no) — config on window.MDJ_BINARY_SPINNER_CONFIG
(function () {
    const cfg = window.MDJ_BINARY_SPINNER_CONFIG;
    if (!cfg) return;

    const CONFIG = {
        spinDuration: 4000,
        displayDuration: 8000,
        pollInterval: 1000
    };

    const waitingMessage = document.getElementById('waitingMessage');
    const spinnerSlot = document.getElementById('spinnerSlot');
    const optionsList = document.getElementById('optionsList');
    const winnerDisplay = document.getElementById('winnerDisplay');
    const winnerTitle = document.getElementById('winnerTitle');
    const winnerSub = document.getElementById('winnerSub');
    const spinStatus = document.getElementById('spinStatus');
    const controlPanel = document.getElementById('controlPanel');

    let isSpinning = false;
    let pollInterval;

    const spinSound = new Audio('/sounds/spin.mp3');
    spinSound.volume = 0.5;

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderItem(opt) {
        const mod = opt.modifier ? ' binary-item--' + opt.modifier : '';
        const icon = opt.icon
            ? '<i class="fas ' + opt.icon + ' binary-item-icon"></i>'
            : '';
        return (
            '<div class="binary-item' +
            mod +
            '" data-key="' +
            escapeHtml(opt.key) +
            '">' +
            icon +
            '<div class="binary-item-label">' +
            escapeHtml(opt.label) +
            '</div></div>'
        );
    }

    function optionByKey(key) {
        return cfg.options.find(function (o) {
            return o.key === key;
        });
    }

    function startPolling() {
        pollInterval = setInterval(checkSpinStatus, CONFIG.pollInterval);
    }

    function checkSpinStatus() {
        if (isSpinning) return;
        const slug = window.displayEventSlug;
        if (!slug) return;

        fetch(
            '/api/display/' +
                encodeURIComponent(slug) +
                '/' +
                cfg.apiSegment +
                '/spin-status'
        )
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                if (data.shouldSpin && data.result) {
                    startSpin(data.result);
                    fetch(
                        '/api/display/' +
                            encodeURIComponent(slug) +
                            '/' +
                            cfg.apiSegment +
                            '/clear-spin',
                        { method: 'POST' }
                    );
                }
            })
            .catch(function () {});
    }

    function startSpin(resultKey) {
        if (isSpinning) return;
        isSpinning = true;
        if (spinStatus) spinStatus.textContent = 'Spinning...';
        spinSound.currentTime = 0;
        spinSound.play().catch(function () {});

        waitingMessage.style.display = 'none';
        optionsList.style.display = 'block';

        const targetIndex = MdjBinarySpinner.prepareBinaryList(
            cfg.options,
            resultKey,
            optionsList,
            renderItem
        );

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                MdjBinarySpinner.animateBinarySpin({
                    listEl: optionsList,
                    slotEl: spinnerSlot,
                    targetIndex: targetIndex,
                    spinDuration: CONFIG.spinDuration,
                    onComplete: function () {
                        setTimeout(function () {
                            showWinner(resultKey);
                        }, 800);
                    }
                });
            });
        });
    }

    function showWinner(resultKey) {
        const opt = optionByKey(resultKey);
        if (!opt) return;
        winnerTitle.textContent = opt.label;
        const winnerIconEl = document.querySelector('#winnerDisplay .winner-icon');
        if (winnerIconEl && opt.icon) {
            winnerIconEl.innerHTML = '<i class="fas ' + opt.icon + '"></i>';
        }
        winnerDisplay.classList.remove('winner-result--yes', 'winner-result--no');
        if (resultKey === 'yes') winnerDisplay.classList.add('winner-result--yes');
        if (resultKey === 'no') winnerDisplay.classList.add('winner-result--no');
        if (winnerSub) {
            winnerSub.textContent = cfg.winnerSub || '';
            winnerSub.style.display = cfg.winnerSub ? '' : 'none';
        }
        winnerDisplay.classList.add('show');
        createConfetti();
        if (spinStatus) spinStatus.textContent = 'Done';
        setTimeout(resetSpinner, CONFIG.displayDuration);
    }

    function resetSpinner() {
        winnerDisplay.classList.remove('show', 'winner-result--yes', 'winner-result--no');
        optionsList.style.display = 'none';
        optionsList.style.transition = '';
        waitingMessage.style.display = 'flex';
        isSpinning = false;
        if (spinStatus) spinStatus.textContent = 'Ready';
    }

    function createConfetti() {
        const colors = cfg.confettiColors || ['#ffc107', '#fff', '#4ecdc4'];
        for (let i = 0; i < 120; i++) {
            setTimeout(function () {
                const confetti = document.createElement('div');
                confetti.className =
                    'confetti' + (Math.random() > 0.45 ? ' confetti--round' : '');
                const w = 6 + Math.random() * 12;
                confetti.style.left = Math.random() * 100 + 'vw';
                confetti.style.top = -8 - Math.random() * 20 + 'vh';
                confetti.style.width = w + 'px';
                confetti.style.height =
                    (Math.random() > 0.35 ? w : w * 2.2) + 'px';
                confetti.style.background =
                    colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDuration = 2.2 + Math.random() * 2 + 's';
                document.body.appendChild(confetti);
                setTimeout(function () {
                    confetti.remove();
                }, 4500);
            }, i * 22);
        }
    }

    document.addEventListener('keydown', function (e) {
        switch (e.key.toLowerCase()) {
            case 'h':
                controlPanel.classList.toggle('show');
                break;
            case 'r':
                resetSpinner();
                break;
            case 'f':
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function () {});
                } else {
                    document.exitFullscreen();
                }
                break;
        }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollInterval);
        } else {
            startPolling();
        }
    });

    startPolling();
})();
