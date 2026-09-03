// Guest Spinner JavaScript — same flow as karaoke-spinner.js, event guests only

document.addEventListener('DOMContentLoaded', function () {
    const waitingMessage = document.getElementById('waitingMessage');
    const guestsList = document.getElementById('guestsList');
    const spinnerSlot = document.getElementById('spinnerSlot');
    const winnerDisplay = document.getElementById('winnerDisplay');
    const winnerTitle = document.getElementById('winnerTitle');
    const winnerArtist = document.getElementById('winnerArtist');
    const controlPanel = document.getElementById('controlPanel');
    const spinStatus = document.getElementById('spinStatus');

    let isSpinning = false;
    let pollInterval;
    let allGuests = [];

    const CONFIG = {
        pollInterval: 1000,
        spinDuration: 9500,
        displayDuration: 5000
    };

    const spinSound = new Audio('/audio/spin.mp3');

    function init() {
        loadEventGuests();
        startPolling();
        setupKeyboardControls();
        setTimeout(() => {
            controlPanel.classList.add('show');
            setTimeout(() => controlPanel.classList.remove('show'), 3000);
        }, 1000);
    }

    function getEventSlugFromPage() {
        if (window.displayEventSlug) return window.displayEventSlug;
        try {
            const params = new URLSearchParams(window.location.search);
            const q = params.get('event') || params.get('eventSlug');
            return q ? String(q).trim() : null;
        } catch {
            return null;
        }
    }

    function loadEventGuests() {
        const slug = getEventSlugFromPage();
        if (!slug) {
            updateStatus('Add ?event=slug to the URL');
            return;
        }
        fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/guests')
            .then((response) => response.json())
            .then((data) => {
                allGuests = Array.isArray(data.guests) ? data.guests : [];
                updateStatus(allGuests.length + ' guests loaded for event');
            })
            .catch(() => updateStatus('Error loading guests'));
    }

    function startPolling() {
        pollInterval = setInterval(checkForSpinTrigger, CONFIG.pollInterval);
    }

    function checkForSpinTrigger() {
        if (isSpinning) return;
        const slug = getEventSlugFromPage();
        if (!slug) return;

        fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/spin-status')
            .then((response) => response.json())
            .then((data) => {
                if (data.shouldSpin && data.selectedGuest) {
                    startSpin(data.selectedGuest);
                    fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/clear-spin', {
                        method: 'POST'
                    });
                }
            })
            .catch((err) => console.error('Error checking guest spin status:', err));
    }

    function guestStatsLine(g) {
        const parts = [];
        if (g.requestCount) parts.push(g.requestCount + ' request' + (g.requestCount === 1 ? '' : 's'));
        if (g.messageCount) parts.push(g.messageCount + ' message' + (g.messageCount === 1 ? '' : 's'));
        return parts.join(' · ');
    }

    function startSpin(targetGuest) {
        if (isSpinning) return;
        isSpinning = true;
        updateStatus('Spinning...');

        spinSound.currentTime = 0;
        spinSound.play().catch(() => {});

        waitingMessage.style.display = 'none';
        guestsList.style.display = 'block';

        const targetIndex = prepareGuestsList(targetGuest);
        animateSpin(targetIndex, targetGuest);
    }

    function prepareGuestsList(targetGuest) {
        const pool = allGuests.length ? [...allGuests] : [targetGuest];
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        let displayGuests = [];
        while (displayGuests.length < 50) {
            displayGuests = displayGuests.concat(shuffled);
        }
        displayGuests = displayGuests.slice(0, 50);
        const targetIndex = Math.max(displayGuests.length - 5, 0);
        displayGuests.splice(targetIndex, 0, targetGuest);

        guestsList.innerHTML = displayGuests
            .map((g, i) => {
                const stats = guestStatsLine(g);
                return `
            <div class="guest-item" data-guest-index="${i}">
                <div class="guest-name">${escapeHtml(g.customerName)}</div>
                ${stats ? `<div class="guest-stats">${escapeHtml(stats)}</div>` : ''}
            </div>`;
            })
            .join('');
        guestsList.style.transform = 'translateY(0)';
        return targetIndex;
    }

    function animateSpin(targetIndex, targetGuest) {
        const items = guestsList.querySelectorAll('.guest-item');
        const targetElement = items[targetIndex];
        if (!targetElement) {
            finishSpin(targetGuest);
            return;
        }

        const targetOffset = targetElement.offsetTop;
        const centerOffset = (spinnerSlot.offsetHeight - 300) / 2;
        const finalPosition = -(targetOffset - centerOffset);
        const startTime = Date.now();

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / CONFIG.spinDuration;
            if (elapsed >= CONFIG.spinDuration) {
                guestsList.style.transform = `translateY(${finalPosition}px)`;
                finishSpin(targetGuest);
                return;
            }
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            guestsList.style.transform = `translateY(${finalPosition * easeOutCubic}px)`;
            requestAnimationFrame(animate);
        }

        guestsList.style.transform = 'translateY(0)';
        guestsList.style.transition = 'none';
        requestAnimationFrame(animate);
    }

    function finishSpin(winner) {
        setTimeout(() => showWinner(winner), 800);
    }

    function showWinner(guest) {
        winnerTitle.textContent = guest.customerName;
        const sub = guestStatsLine(guest);
        winnerArtist.textContent = sub;
        winnerArtist.style.display = sub ? '' : 'none';
        winnerDisplay.classList.add('show');
        updateStatus('Guest selected!');
        createConfetti();
        setTimeout(() => resetSpinner(), CONFIG.displayDuration);
    }

    function resetSpinner() {
        winnerDisplay.classList.remove('show');
        guestsList.style.display = 'none';
        guestsList.style.transition = '';
        waitingMessage.style.display = 'flex';
        isSpinning = false;
        loadEventGuests();
        updateStatus('Ready for next spin');
    }

    function updateStatus(status) {
        spinStatus.textContent = status;
    }

    function createConfetti() {
        const colors = ['#7986cb', '#5c6bc0', '#ffd54f', '#4ecdc4', '#e1bee7', '#fff'];
        for (let i = 0; i < 140; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti' + (Math.random() > 0.45 ? ' confetti--round' : '');
                const w = 6 + Math.random() * 12;
                confetti.style.left = Math.random() * 100 + 'vw';
                confetti.style.top = (-8 - Math.random() * 20) + 'vh';
                confetti.style.width = w + 'px';
                confetti.style.height = (Math.random() > 0.35 ? w : w * 2.2) + 'px';
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDuration = (2.2 + Math.random() * 2) + 's';
                confetti.style.animationDelay = Math.random() * 0.45 + 's';
                document.body.appendChild(confetti);
                setTimeout(() => confetti.remove(), 4500);
            }, i * 22);
        }
    }

    function setupKeyboardControls() {
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
                        document.documentElement.requestFullscreen().catch(() => {});
                    } else {
                        document.exitFullscreen();
                    }
                    break;
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearInterval(pollInterval);
        } else {
            startPolling();
        }
    });

    window.addEventListener('beforeunload', function () {
        clearInterval(pollInterval);
    });

    init();
});
