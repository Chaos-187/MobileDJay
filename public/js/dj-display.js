// DJ Display JavaScript - Full screen animated message display

document.addEventListener('DOMContentLoaded', function() {
    const waitingMessage = document.getElementById('waitingMessage');
    const messageContainer = document.getElementById('messageContainer');
    const messageDisplay = document.getElementById('messageDisplay');
    const messageContent = document.getElementById('messageContent');
    const messageFrom = document.getElementById('messageFrom');
    const controlPanel = document.getElementById('controlPanel');
    const messageStatus = document.getElementById('messageStatus');
    const spinnerStatus = document.getElementById('spinnerStatus');

    // Spinner elements
    const spinnerOverlay = document.getElementById('spinnerOverlay');
    const spinnerSlot = document.getElementById('spinnerSlot');
    const spinnerWaiting = document.getElementById('spinnerWaiting');
    const songsList = document.getElementById('songsList');
    const winnerDisplay = document.getElementById('winnerDisplay');
    const winnerTitle = document.getElementById('winnerTitle');
    const winnerArtist = document.getElementById('winnerArtist');
    const winnerDifficulty = document.getElementById('winnerDifficulty');

    let currentMessageIndex = 0;
    let isDisplayingMessage = false;
    let messageQueue = [];
    let refreshInterval;

    // Spinner state
    let isSpinning = false;
    let spinPollInterval;
    let allKaraokeSongs = [];

    // Configuration
    const CONFIG = {
        messageDisplayTime: 5000, // 5 seconds per message
        refreshInterval: 3000,    // Check for new messages every 3 seconds
        fadeInTime: 500,         // Animation timing
        fadeOutTime: 500,
        // Spinner config
        spinPollInterval: 1000,    // Check for spin trigger every second
        spinDuration: 9500,        // Total spin animation duration
        winnerDisplayDuration: 5000 // How long to show winner
    };

    // Audio for spinner
    let spinSound;
    try {
        spinSound = new Audio('/audio/spin.mp3');
    } catch (e) {
        console.log('Could not load spin sound');
    }

    // Initialize
    function init() {
        startMessagePolling();
        setupKeyboardControls();
        setupMouseActivity();
        
        // Initialize spinner
        loadKaraokeSongs();
        startSpinnerPolling();
        loadEventGuestsForSpinner();
        startGuestSpinnerPolling();
        startCoinSpinnerPolling();
        startYesNoSpinnerPolling();
        
        // Show control panel briefly on load
        setTimeout(() => {
            controlPanel.classList.add('show');
            setTimeout(() => {
                controlPanel.classList.remove('show');
            }, 3000);
        }, 1000);
    }

    // Start polling for new messages
    function startMessagePolling() {
        refreshInterval = setInterval(fetchMessages, CONFIG.refreshInterval);
        fetchMessages(); // Initial fetch
    }

    // Fetch new messages from API
    function fetchMessages() {
        fetch('/api/dj/messages')
            .then(response => response.json())
            .then(messages => {
                if (messages.length > 0) {
                    messageQueue = [...messageQueue, ...messages];
                    updateStatus(`${messageQueue.length} message(s) in queue`);
                    
                    if (!isDisplayingMessage) {
                        displayNextMessage();
                    }
                } else {
                    updateStatus('Waiting for messages...');
                }
            })
            .catch(error => {
                console.error('Error fetching messages:', error);
                updateStatus('Connection error');
            });
    }

    // Display next message in queue
    function displayNextMessage() {
        if (messageQueue.length === 0 || isDisplayingMessage) {
            return;
        }

        isDisplayingMessage = true;
        const message = messageQueue.shift();

        // Hide waiting message
        waitingMessage.style.display = 'none';
        
        // Set message content - use innerHTML for rich content
        // Check hasMedia flag first, then check for HTML tags in message
        if (message.hasMedia || (message.message && message.message.includes('<'))) {
            // Rich HTML content - use message field which contains sanitized HTML
            messageContent.innerHTML = message.message || message.textMessage;
        } else if (message.message && message.message.trim()) {
            // Plain text content with actual message
            messageContent.textContent = message.message;
        } else {
            // Fallback to textMessage
            messageContent.textContent = message.textMessage || 'No message content';
        }
        messageFrom.textContent = `- ${message.customerName}`;
        
        // Add special styling for messages with media
        if (message.hasMedia) {
            messageDisplay.classList.add('has-media');
            messageDisplay.querySelector('.message-icon i').className = 'fas fa-images';
        } else {
            messageDisplay.classList.remove('has-media');
        }
        
        // Style differently for replies
        if (message.isReply) {
            messageDisplay.classList.add('reply');
            messageDisplay.querySelector('.message-icon i').className = 'fas fa-reply';
        } else {
            messageDisplay.classList.remove('reply');
            messageDisplay.querySelector('.message-icon i').className = 'fas fa-envelope';
        }
        
        // Show message container
        messageContainer.style.display = 'flex';
        
        // Animate in
        setTimeout(() => {
            messageDisplay.classList.add('show');
        }, 50);

        updateStatus(`Displaying ${message.isReply ? 'DJ reply' : 'message'} from ${message.customerName}`);

        // Mark message as displayed
        markMessageAsDisplayed(message.id);

        // Show replies longer (7 seconds vs 5 seconds)
        const displayTime = message.isReply ? 7000 : CONFIG.messageDisplayTime;
        
        // Hide message after display time
        setTimeout(() => {
            hideCurrentMessage();
        }, displayTime);
    }

    // Hide current message
    function hideCurrentMessage() {
        messageDisplay.classList.remove('show');
        messageDisplay.classList.add('hide');

        setTimeout(() => {
            messageContainer.style.display = 'none';
            messageDisplay.classList.remove('hide');
            
            // Check if we should show waiting message
            if (messageQueue.length === 0) {
                waitingMessage.style.display = 'block';
                updateStatus('Waiting for messages...');
            }
            
            isDisplayingMessage = false;
            
            // Display next message if available
            if (messageQueue.length > 0) {
                setTimeout(displayNextMessage, 1000);
            }
        }, CONFIG.fadeOutTime);
    }

    // Mark message as displayed on server
    function markMessageAsDisplayed(messageId) {
        fetch(`/api/dj/message/${messageId}/mark-displayed`, {
            method: 'POST'
        })
        .catch(error => {
            console.error('Error marking message as displayed:', error);
        });
    }

    // Update status in control panel
    function updateStatus(status) {
        messageStatus.textContent = status;
    }

    // Setup keyboard controls
    function setupKeyboardControls() {
        document.addEventListener('keydown', function(e) {
            switch(e.key.toLowerCase()) {
                case 'h':
                    toggleControlPanel();
                    break;
                case 'n':
                case 'arrowright':
                    skipToNextMessage();
                    break;
                case 'escape':
                    hideCurrentMessage();
                    break;
                case 'r':
                    fetchMessages();
                    break;
                case 'f':
                    toggleFullscreen();
                    break;
            }
        });
    }

    // Setup mouse activity detection
    function setupMouseActivity() {
        let mouseTimer;
        
        document.addEventListener('mousemove', function() {
            document.body.style.cursor = 'default';
            controlPanel.style.opacity = '0.7';
            
            clearTimeout(mouseTimer);
            mouseTimer = setTimeout(() => {
                document.body.style.cursor = 'none';
                controlPanel.style.opacity = '0';
            }, 3000);
        });
    }

    // Toggle control panel visibility
    function toggleControlPanel() {
        controlPanel.classList.toggle('show');
    }

    // Skip to next message
    function skipToNextMessage() {
        if (isDisplayingMessage) {
            hideCurrentMessage();
        } else if (messageQueue.length > 0) {
            displayNextMessage();
        }
    }

    // Toggle fullscreen
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('Error entering fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    // Create floating animation for background icons
    function animateFloatingIcons() {
        const icons = document.querySelectorAll('.floating-icon');
        icons.forEach((icon, index) => {
            // Randomize position and animation delay
            const randomTop = Math.random() * 80 + 10; // 10-90%
            const randomLeft = Math.random() * 80 + 10; // 10-90%
            const randomDelay = Math.random() * 6; // 0-6 seconds
            
            icon.style.top = randomTop + '%';
            icon.style.left = randomLeft + '%';
            icon.style.animationDelay = randomDelay + 's';
        });
    }

    // Enhanced error handling
    window.addEventListener('error', function(e) {
        console.error('Display error:', e.error);
        updateStatus('Display error occurred');
    });

    // Handle page visibility changes
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(refreshInterval);
            clearInterval(spinPollInterval);
            if (typeof guestSpinPollInterval !== 'undefined' && guestSpinPollInterval) {
                clearInterval(guestSpinPollInterval);
            }
            if (typeof coinSpinPollInterval !== 'undefined' && coinSpinPollInterval) {
                clearInterval(coinSpinPollInterval);
            }
            if (typeof yesNoSpinPollInterval !== 'undefined' && yesNoSpinPollInterval) {
                clearInterval(yesNoSpinPollInterval);
            }
        } else {
            startMessagePolling();
            startSpinnerPolling();
            if (typeof startGuestSpinnerPolling === 'function') {
                startGuestSpinnerPolling();
            }
            if (typeof startCoinSpinnerPolling === 'function') {
                startCoinSpinnerPolling();
            }
            if (typeof startYesNoSpinnerPolling === 'function') {
                startYesNoSpinnerPolling();
            }
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        clearInterval(refreshInterval);
        clearInterval(spinPollInterval);
        if (typeof guestSpinPollInterval !== 'undefined' && guestSpinPollInterval) {
            clearInterval(guestSpinPollInterval);
        }
        if (typeof coinSpinPollInterval !== 'undefined' && coinSpinPollInterval) {
            clearInterval(coinSpinPollInterval);
        }
        if (typeof yesNoSpinPollInterval !== 'undefined' && yesNoSpinPollInterval) {
            clearInterval(yesNoSpinPollInterval);
        }
    });

    // (init runs after spinner modules — see bottom of file)

    // ============================================
    // KARAOKE SPINNER FUNCTIONALITY
    // ============================================

    // Load all karaoke songs for spinner
    function loadKaraokeSongs() {
        fetch('/api/karaoke/all')
            .then(response => response.json())
            .then(songs => {
                allKaraokeSongs = songs;
                updateSpinnerStatus(`${songs.length} songs loaded`);
            })
            .catch(error => {
                console.error('Error loading karaoke songs:', error);
                updateSpinnerStatus('Error loading songs');
            });
    }

    // Start polling for spin trigger
    function startSpinnerPolling() {
        spinPollInterval = setInterval(checkForSpinTrigger, CONFIG.spinPollInterval);
    }

    // Check if DJ triggered a spin
    function checkForSpinTrigger() {
        if (isSpinning) return;
        const slug = window.displayEventSlug;
        if (!slug) return;

        fetch('/api/display/' + encodeURIComponent(slug) + '/karaoke/spin-status')
            .then(response => response.json())
            .then(data => {
                if (data.shouldSpin && data.selectedSong) {
                    startSpin(data.selectedSong);
                    fetch('/api/display/' + encodeURIComponent(slug) + '/karaoke/clear-spin', {
                        method: 'POST'
                    });
                }
            })
            .catch(error => {
                // Silently ignore - might not have spinner API
            });
    }

    // Start the spinning animation
    function startSpin(targetSong) {
        if (isSpinning) return;
        
        isSpinning = true;
        updateSpinnerStatus('Spinning...');

        // Play spin sound if available
        if (spinSound) {
            spinSound.currentTime = 0;
            spinSound.play().catch(e => console.log('Could not play spin sound'));
        }

        // Show spinner overlay
        spinnerOverlay.classList.add('active');
        
        // Hide waiting, show songs list
        spinnerWaiting.style.display = 'none';
        songsList.style.display = 'block';

        // Prepare and animate
        prepareSongsList(targetSong);
        animateSpin(targetSong);
    }

    // Prepare the scrolling songs list
    function prepareSongsList(targetSong) {
        // Create a list with random songs + target song
        const shuffled = [...allKaraokeSongs].sort(() => Math.random() - 0.5);
        const displaySongs = shuffled.slice(0, 50);
        
        // Insert target song near the end for dramatic effect
        const targetIndex = displaySongs.length - 5;
        displaySongs.splice(targetIndex, 0, targetSong);

        // Render the songs
        songsList.innerHTML = displaySongs.map(song => `
            <div class="song-item" data-song-id="${song.id}">
                <div class="song-title">${escapeHtml(song.title)}</div>
                <div class="song-artist">by ${escapeHtml(song.artist)}</div>
                <div class="song-difficulty">${escapeHtml(song.difficulty || 'Medium')}</div>
            </div>
        `).join('');

        // Reset position
        songsList.style.transform = 'translateY(0)';
    }

    // Animate the spinning effect
    function animateSpin(targetSong) {
        const targetElement = songsList.querySelector(`[data-song-id="${targetSong.id}"]`);
        if (!targetElement) {
            console.error('Target song not found in list');
            resetSpinner();
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
                songsList.style.transform = `translateY(${finalPosition}px)`;
                finishSpin(targetSong);
                return;
            }

            // Easing function: ease-out-cubic for smooth deceleration
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            const currentPosition = finalPosition * easeOutCubic;
            songsList.style.transform = `translateY(${currentPosition}px)`;

            requestAnimationFrame(animate);
        }

        songsList.style.transform = 'translateY(0)';
        songsList.style.transition = 'none';
        requestAnimationFrame(animate);
    }

    // Finish the spin and show winner
    function finishSpin(winner) {
        setTimeout(() => {
            showWinner(winner);
        }, 800);
    }

    // Show the winner with confetti
    function showWinner(song) {
        winnerTitle.textContent = song.title;
        winnerArtist.textContent = `by ${song.artist}`;
        winnerDifficulty.textContent = song.difficulty || 'Medium';
        
        winnerDisplay.classList.add('show');
        updateSpinnerStatus('Winner selected!');
        
        // Create confetti
        createConfetti();

        // Hide winner after display duration
        setTimeout(() => {
            resetSpinner();
        }, CONFIG.winnerDisplayDuration);
    }

    // Create confetti animation
    function createConfetti() {
        const colors = ['#ffc107', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#fff'];

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

    // Reset the spinner to hidden state
    function resetSpinner() {
        winnerDisplay.classList.remove('show');
        spinnerOverlay.classList.remove('active');
        songsList.style.display = 'none';
        songsList.style.transition = '';
        spinnerWaiting.style.display = 'flex';
        isSpinning = false;
        updateSpinnerStatus('Ready');
    }

    // Update spinner status
    function updateSpinnerStatus(status) {
        if (spinnerStatus) {
            spinnerStatus.textContent = 'Spinner: ' + status;
        }
    }

    // Escape HTML for spinner
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================
    // GUEST SPINNER (same wheel UX as karaoke)
    // ============================================
    const guestSpinnerOverlay = document.getElementById('guestSpinnerOverlay');
    const guestSpinnerSlot = document.getElementById('guestSpinnerSlot');
    const guestSpinnerWaiting = document.getElementById('guestSpinnerWaiting');
    const guestsList = document.getElementById('guestsList');
    const guestWinnerDisplay = document.getElementById('guestWinnerDisplay');
    const guestWinnerName = document.getElementById('guestWinnerName');
    const guestWinnerSub = document.getElementById('guestWinnerSub');

    let isGuestSpinning = false;
    let guestSpinPollInterval;
    let allEventGuests = [];

    function loadEventGuestsForSpinner() {
        const slug = window.displayEventSlug;
        if (!slug) return;
        fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/guests')
            .then((response) => response.json())
            .then((data) => {
                allEventGuests = Array.isArray(data.guests) ? data.guests : [];
            })
            .catch((err) => console.error('Error loading event guests:', err));
    }

    function startGuestSpinnerPolling() {
        if (!guestSpinnerOverlay) return;
        guestSpinPollInterval = setInterval(checkForGuestSpinTrigger, CONFIG.spinPollInterval);
    }

    function checkForGuestSpinTrigger() {
        if (isGuestSpinning) return;
        const slug = window.displayEventSlug;
        if (!slug) return;

        fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/spin-status')
            .then((response) => response.json())
            .then((data) => {
                if (data.shouldSpin && data.selectedGuest) {
                    if (
                        !allEventGuests.some(
                            (g) => g.id === data.selectedGuest.id
                        )
                    ) {
                        allEventGuests = allEventGuests.concat([data.selectedGuest]);
                    }
                    startGuestSpin(data.selectedGuest);
                    fetch('/api/display/' + encodeURIComponent(slug) + '/guest-spinner/clear-spin', {
                        method: 'POST'
                    });
                }
            })
            .catch(() => {});
    }

    function guestStatsLine(g) {
        const parts = [];
        if (g.requestCount) parts.push(g.requestCount + ' request' + (g.requestCount === 1 ? '' : 's'));
        if (g.messageCount) parts.push(g.messageCount + ' message' + (g.messageCount === 1 ? '' : 's'));
        return parts.join(' · ');
    }

    function startGuestSpin(targetGuest) {
        if (isGuestSpinning || !guestSpinnerOverlay || !guestsList) return;
        isGuestSpinning = true;

        if (spinSound) {
            spinSound.currentTime = 0;
            spinSound.play().catch(() => {});
        }

        guestSpinnerOverlay.classList.add('active');
        guestSpinnerWaiting.style.display = 'none';
        guestsList.style.display = 'block';

        const targetIndex = prepareGuestsList(targetGuest);
        // Allow layout before measuring scroll positions (same tick as karaoke)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                animateGuestSpin(targetGuest, targetIndex);
            });
        });
    }

    function prepareGuestsList(targetGuest) {
        const pool = allEventGuests.length ? [...allEventGuests] : [targetGuest];
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
                <div class="guest-item-name">${escapeHtml(g.customerName)}</div>
                ${stats ? `<div class="guest-item-stats">${escapeHtml(stats)}</div>` : ''}
            </div>`;
            })
            .join('');
        guestsList.style.transform = 'translateY(0)';
        return targetIndex;
    }

    function animateGuestSpin(targetGuest, targetIndex) {
        const items = guestsList.querySelectorAll('.guest-item');
        const targetElement =
            items[targetIndex] ||
            guestsList.querySelector(`[data-guest-index="${targetIndex}"]`);
        if (!targetElement || !guestSpinnerSlot) {
            resetGuestSpinner();
            return;
        }

        const targetOffset = targetElement.offsetTop;
        const centerOffset = (guestSpinnerSlot.offsetHeight - 300) / 2;
        const finalPosition = -(targetOffset - centerOffset);
        const startTime = Date.now();

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / CONFIG.spinDuration;
            if (elapsed >= CONFIG.spinDuration) {
                guestsList.style.transform = `translateY(${finalPosition}px)`;
                finishGuestSpin(targetGuest);
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

    function finishGuestSpin(winner) {
        setTimeout(() => showGuestWinner(winner), 800);
    }

    function showGuestWinner(guest) {
        if (guestWinnerName) guestWinnerName.textContent = guest.customerName;
        if (guestWinnerSub) {
            const sub = guestStatsLine(guest);
            guestWinnerSub.textContent = sub;
            guestWinnerSub.style.display = sub ? '' : 'none';
        }
        if (guestWinnerDisplay) guestWinnerDisplay.classList.add('show');
        createConfetti();
        setTimeout(() => resetGuestSpinner(), CONFIG.winnerDisplayDuration);
    }

    function resetGuestSpinner() {
        if (guestWinnerDisplay) guestWinnerDisplay.classList.remove('show');
        if (guestSpinnerOverlay) guestSpinnerOverlay.classList.remove('active');
        if (guestsList) {
            guestsList.style.display = 'none';
            guestsList.style.transition = '';
        }
        if (guestSpinnerWaiting) guestSpinnerWaiting.style.display = 'flex';
        isGuestSpinning = false;
        loadEventGuestsForSpinner();
    }

    // ============================================
    // BINARY SPINNERS (coin + yes/no)
    // ============================================
    const COIN_SPINNER_OPTIONS = [
        { key: 'heads', label: 'Heads', icon: 'fa-face-smile', modifier: 'heads' },
        { key: 'tails', label: 'Tails', icon: 'fa-feather', modifier: 'tails' }
    ];
    const YESNO_SPINNER_OPTIONS = [
        { key: 'yes', label: 'Yes', icon: 'fa-thumbs-up', modifier: 'yes' },
        { key: 'no', label: 'No', icon: 'fa-thumbs-down', modifier: 'no' }
    ];

    function renderBinaryItemHtml(opt) {
        const mod = opt.modifier ? ' binary-item--' + opt.modifier : '';
        const icon = opt.icon
            ? `<i class="fas ${opt.icon} binary-item-icon"></i>`
            : '';
        return `<div class="binary-item${mod}" data-key="${escapeHtml(opt.key)}">${icon}<div class="binary-item-label">${escapeHtml(opt.label)}</div></div>`;
    }

    function binaryOptionByKey(options, key) {
        return options.find((o) => o.key === key);
    }

    function createBinarySpinnerController(cfg) {
        let isActive = false;
        let pollInterval;

        function startPolling() {
            if (!cfg.overlay) return null;
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(checkTrigger, CONFIG.spinPollInterval);
            return pollInterval;
        }

        function checkTrigger() {
            if (isActive) return;
            const slug = window.displayEventSlug;
            if (!slug) return;

            fetch(
                '/api/display/' +
                    encodeURIComponent(slug) +
                    '/' +
                    cfg.apiSegment +
                    '/spin-status'
            )
                .then((r) => r.json())
                .then((data) => {
                    if (data.shouldSpin && data.result) {
                        runSpin(data.result);
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
                .catch(() => {});
        }

        function runSpin(resultKey) {
            if (isActive || !cfg.overlay || !cfg.listEl || !MdjBinarySpinner) return;
            isActive = true;

            if (spinSound) {
                spinSound.currentTime = 0;
                spinSound.play().catch(() => {});
            }

            cfg.overlay.classList.add('active');
            cfg.waitingEl.style.display = 'none';
            cfg.listEl.style.display = 'block';

            const targetIndex = MdjBinarySpinner.prepareBinaryList(
                cfg.options,
                resultKey,
                cfg.listEl,
                renderBinaryItemHtml
            );

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    MdjBinarySpinner.animateBinarySpin({
                        listEl: cfg.listEl,
                        slotEl: cfg.slotEl,
                        targetIndex,
                        spinDuration: CONFIG.spinDuration,
                        onComplete: () => {
                            setTimeout(() => showWinner(resultKey), 800);
                        }
                    });
                });
            });
        }

        function showWinner(resultKey) {
            const opt = binaryOptionByKey(cfg.options, resultKey);
            if (!opt || !cfg.winnerEl) return;
            if (cfg.winnerTitleEl) cfg.winnerTitleEl.textContent = opt.label;
            if (cfg.winnerIconEl && opt.icon) {
                cfg.winnerIconEl.innerHTML = `<i class="fas ${opt.icon}"></i>`;
            }
            if (cfg.winnerEl) {
                cfg.winnerEl.classList.remove('winner-result--yes', 'winner-result--no');
                if (resultKey === 'yes') cfg.winnerEl.classList.add('winner-result--yes');
                if (resultKey === 'no') cfg.winnerEl.classList.add('winner-result--no');
            }
            cfg.winnerEl.classList.add('show');
            createConfetti();
            setTimeout(reset, CONFIG.winnerDisplayDuration);
        }

        function reset() {
            if (cfg.winnerEl) {
                cfg.winnerEl.classList.remove('show', 'winner-result--yes', 'winner-result--no');
            }
            if (cfg.overlay) cfg.overlay.classList.remove('active');
            if (cfg.listEl) {
                cfg.listEl.style.display = 'none';
                cfg.listEl.style.transition = '';
            }
            if (cfg.waitingEl) cfg.waitingEl.style.display = 'flex';
            isActive = false;
        }

        return { startPolling, reset };
    }

    const coinSpinner = createBinarySpinnerController({
        apiSegment: 'coin-spinner',
        options: COIN_SPINNER_OPTIONS,
        overlay: document.getElementById('coinSpinnerOverlay'),
        slotEl: document.getElementById('coinSpinnerSlot'),
        waitingEl: document.getElementById('coinSpinnerWaiting'),
        listEl: document.getElementById('coinOptionsList'),
        winnerEl: document.getElementById('coinWinnerDisplay'),
        winnerTitleEl: document.getElementById('coinWinnerTitle'),
        winnerIconEl: document.getElementById('coinWinnerIcon')
    });

    const yesNoSpinner = createBinarySpinnerController({
        apiSegment: 'yesno-spinner',
        options: YESNO_SPINNER_OPTIONS,
        overlay: document.getElementById('yesNoSpinnerOverlay'),
        slotEl: document.getElementById('yesNoSpinnerSlot'),
        waitingEl: document.getElementById('yesNoSpinnerWaiting'),
        listEl: document.getElementById('yesNoOptionsList'),
        winnerEl: document.getElementById('yesNoWinnerDisplay'),
        winnerTitleEl: document.getElementById('yesNoWinnerTitle'),
        winnerIconEl: document.getElementById('yesNoWinnerIcon')
    });

    let coinSpinPollInterval;
    let yesNoSpinPollInterval;

    function startCoinSpinnerPolling() {
        if (coinSpinner && coinSpinner.startPolling) {
            coinSpinPollInterval = coinSpinner.startPolling();
        }
    }

    function startYesNoSpinnerPolling() {
        if (yesNoSpinner && yesNoSpinner.startPolling) {
            yesNoSpinPollInterval = yesNoSpinner.startPolling();
        }
    }

    // ============================================
    // PHOTO SHOWCASE (DJ pushes a guest photo to this display)
    // ============================================
    const photoShowcaseOverlay = document.getElementById('photoShowcaseOverlay');
    const photoShowcaseFrame = document.getElementById('photoShowcaseFrame');
    const photoShowcaseImg = document.getElementById('photoShowcaseImg');
    const photoShowcaseBanner = document.getElementById('photoShowcaseBanner');
    const photoShowcaseCaption = document.getElementById('photoShowcaseCaption');
    const photoShowcaseAmbient = document.getElementById('photoShowcaseAmbient');

    const PHOTO_SHOWCASE_TIME = 12000; // how long the photo stays up
    let photoShowcasePollInterval;
    let isShowingPhoto = false;
    let ambientTimer = null;

    // Full-screen ambience per banner style, runs while the photo is up
    function startAmbient(style) {
        stopAmbient();
        if (style === 'party') {
            const colors = ['#ff6b6b', '#ffb340', '#ffe45c', '#6bff8f', '#6be7ff', '#b06bff'];
            ambientTimer = setInterval(() => {
                const piece = document.createElement('div');
                piece.className = 'showcase-confetti';
                piece.style.left = Math.random() * 100 + 'vw';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
                piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
                photoShowcaseAmbient.appendChild(piece);
                setTimeout(() => piece.remove(), 5000);
            }, 180);
        } else if (style === 'neon') {
            const orbColors = ['rgba(255,0,230,0.4)', 'rgba(107,231,255,0.4)', 'rgba(176,107,255,0.35)'];
            const spots = [
                { left: '-12vmin', top: '-12vmin' }, { right: '-12vmin', top: '-12vmin' },
                { left: '-12vmin', bottom: '-12vmin' }, { right: '-12vmin', bottom: '-12vmin' },
                { left: '40vw', top: '-18vmin' }, { left: '40vw', bottom: '-18vmin' }
            ];
            spots.forEach((pos, i) => {
                const orb = document.createElement('div');
                orb.className = 'neon-orb';
                Object.assign(orb.style, pos);
                orb.style.background = `radial-gradient(circle, ${orbColors[i % orbColors.length]}, transparent 70%)`;
                orb.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
                orb.style.animationDelay = (Math.random() * 1.5) + 's';
                photoShowcaseAmbient.appendChild(orb);
            });
        } else if (style === 'elegant') {
            ambientTimer = setInterval(() => {
                const mote = document.createElement('div');
                mote.className = 'gold-mote';
                mote.style.left = Math.random() * 100 + 'vw';
                const size = 4 + Math.random() * 6;
                mote.style.width = size + 'px';
                mote.style.height = size + 'px';
                mote.style.animationDuration = (5 + Math.random() * 4) + 's';
                photoShowcaseAmbient.appendChild(mote);
                setTimeout(() => mote.remove(), 10000);
            }, 350);
        }
        // minimal: intentionally no ambience
    }

    function stopAmbient() {
        if (ambientTimer) {
            clearInterval(ambientTimer);
            ambientTimer = null;
        }
        photoShowcaseAmbient.innerHTML = '';
    }

    function startPhotoShowcasePolling() {
        if (!window.displayEventSlug || !photoShowcaseOverlay) return;
        photoShowcasePollInterval = setInterval(checkForPhotoShowcase, 2000);
    }

    function checkForPhotoShowcase() {
        if (isShowingPhoto) return;
        fetch(`/api/display/${encodeURIComponent(window.displayEventSlug)}/photo-showcase`)
            .then(res => res.json())
            .then(data => {
                if (data && data.photo) {
                    // Acknowledge immediately so it isn't shown twice
                    fetch(`/api/display/${encodeURIComponent(window.displayEventSlug)}/photo-showcase/clear`, { method: 'POST' });
                    showPhotoShowcase(data);
                }
            })
            .catch(() => { /* transient network error — keep polling */ });
    }

    function showPhotoShowcase(data) {
        isShowingPhoto = true;
        const photo = data.photo;

        photoShowcaseImg.src = photo.url;
        const style = ['party', 'neon', 'elegant', 'minimal'].includes(data.bannerStyle) ? data.bannerStyle : 'party';
        photoShowcaseBanner.className = 'photo-showcase-banner banner-' + style;
        photoShowcaseOverlay.classList.remove('style-party', 'style-neon', 'style-elegant', 'style-minimal');
        photoShowcaseOverlay.classList.add('style-' + style);
        const who = photo.customerName || 'A guest';
        if (data.slideshow) {
            photoShowcaseBanner.innerHTML = `<i class="fas fa-camera-retro me-2"></i>Photo Memories`;
        } else {
            photoShowcaseBanner.innerHTML = `<i class="fas fa-camera me-2"></i>${escapeHtml(who)}'s Photo!`;
        }
        photoShowcaseCaption.innerHTML = photo.caption
            ? `"${escapeHtml(photo.caption)}" — <span class="who">${escapeHtml(who)}</span>`
            : `Shared by <span class="who">${escapeHtml(who)}</span>`;

        // Sprinkle sparkles around the frame (not for the minimal style)
        photoShowcaseFrame.querySelectorAll('.photo-sparkle').forEach(s => s.remove());
        if (style !== 'minimal') {
            const sparkleIcons = ['fa-star', 'fa-star', 'fa-certificate', 'fa-star-of-life'];
            for (let i = 0; i < 10; i++) {
                const sparkle = document.createElement('i');
                sparkle.className = `fas ${sparkleIcons[i % sparkleIcons.length]} photo-sparkle`;
                sparkle.style.fontSize = `${14 + Math.random() * 22}px`;
                sparkle.style.left = `${-4 + Math.random() * 108}%`;
                sparkle.style.top = `${-4 + Math.random() * 108}%`;
                sparkle.style.animationDelay = `${Math.random() * 1.6}s`;
                photoShowcaseFrame.appendChild(sparkle);
            }
        }

        photoShowcaseOverlay.classList.remove('closing');
        photoShowcaseOverlay.classList.add('active');
        startAmbient(style);

        setTimeout(hidePhotoShowcase, PHOTO_SHOWCASE_TIME);
    }

    function hidePhotoShowcase() {
        if (!isShowingPhoto) return;
        photoShowcaseOverlay.classList.add('closing');
        setTimeout(() => {
            photoShowcaseOverlay.classList.remove('active', 'closing');
            stopAmbient();
            photoShowcaseImg.src = '';
            isShowingPhoto = false;
        }, 520);
    }

    // Allow Escape to dismiss the photo early (matches message behavior)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isShowingPhoto) hidePhotoShowcase();
    });

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(photoShowcasePollInterval);
        } else {
            startPhotoShowcasePolling();
        }
    });

    startPhotoShowcasePolling();

    // ============================================
    // DJ SCREEN PROMPTS (animated announcements from the dashboard)
    // ============================================
    const screenPromptOverlay = document.getElementById('screenPromptOverlay');
    const screenPromptAmbient = document.getElementById('screenPromptAmbient');
    const screenPromptCard = document.getElementById('screenPromptCard');
    const screenPromptIcon = document.getElementById('screenPromptIcon');
    const screenPromptTitle = document.getElementById('screenPromptTitle');
    const screenPromptSub = document.getElementById('screenPromptSub');
    const promptCameraFlash = document.getElementById('promptCameraFlash');

    const PROMPT_DISPLAY_TIME = 6500;
    let screenPromptPollInterval;
    let isShowingPrompt = false;
    let promptAmbientTimer = null;
    let promptHideTimer = null;
    let lastShownPromptKey = null;

    function getPromptPollSlug() {
        return window.displayEventSlug || 'global';
    }

    function startPromptAmbient(style) {
        stopPromptAmbient();
        if (style === 'great-moves') {
            promptAmbientTimer = setInterval(() => {
                const star = document.createElement('i');
                star.className = 'fas fa-star prompt-star-burst';
                star.style.left = (20 + Math.random() * 60) + 'vw';
                star.style.top = (20 + Math.random() * 60) + 'vh';
                screenPromptAmbient.appendChild(star);
                setTimeout(() => star.remove(), 1400);
            }, 280);
        } else if (style === 'dance-floor') {
            for (let i = 0; i < 12; i++) {
                const light = document.createElement('div');
                light.className = 'prompt-floor-light';
                light.style.left = (i * 8.5) + 'vw';
                light.style.animationDelay = (i * 0.1) + 's';
                screenPromptAmbient.appendChild(light);
            }
        } else if (style === 'slow-dance') {
            promptAmbientTimer = setInterval(() => {
                const heart = document.createElement('i');
                heart.className = 'fas fa-heart prompt-heart';
                heart.style.left = Math.random() * 100 + 'vw';
                heart.style.bottom = '-20px';
                heart.style.fontSize = (1.2 + Math.random() * 2) + 'rem';
                heart.style.animationDuration = (4 + Math.random() * 3) + 's';
                screenPromptAmbient.appendChild(heart);
                setTimeout(() => heart.remove(), 8000);
            }, 400);
        } else if (style === 'applause') {
            const colors = ['#ffd700', '#ffb340', '#ff6b6b', '#fff8dc', '#daa520'];
            promptAmbientTimer = setInterval(() => {
                const piece = document.createElement('div');
                piece.className = 'prompt-applause-confetti';
                piece.style.left = Math.random() * 100 + 'vw';
                piece.style.top = '-10px';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
                piece.style.animationDuration = (2 + Math.random() * 2) + 's';
                screenPromptAmbient.appendChild(piece);
                setTimeout(() => piece.remove(), 5000);
            }, 120);
        } else if (style === 'selfie') {
            if (promptCameraFlash) {
                promptCameraFlash.classList.add('flash');
                setTimeout(() => promptCameraFlash.classList.remove('flash'), 400);
                promptAmbientTimer = setInterval(() => {
                    promptCameraFlash.classList.add('flash');
                    setTimeout(() => promptCameraFlash.classList.remove('flash'), 400);
                }, 2200);
            }
        }
    }

    function stopPromptAmbient() {
        if (promptAmbientTimer) {
            clearInterval(promptAmbientTimer);
            promptAmbientTimer = null;
        }
        if (screenPromptAmbient) screenPromptAmbient.innerHTML = '';
    }

    function startScreenPromptPolling() {
        if (!screenPromptOverlay) return;
        if (screenPromptPollInterval) {
            clearInterval(screenPromptPollInterval);
        }
        screenPromptPollInterval = setInterval(checkForScreenPrompt, 1500);
    }

    function checkForScreenPrompt() {
        if (isShowingPrompt) return;
        const slug = getPromptPollSlug();
        fetch(`/api/display/${encodeURIComponent(slug)}/prompt`)
            .then(res => res.json())
            .then(data => {
                if (!data || !data.prompt) return;

                // Belt-and-braces: skip if we already showed this exact trigger
                const promptKey = `${data.prompt.id}-${data.timestamp || 0}`;
                if (promptKey === lastShownPromptKey) return;
                lastShownPromptKey = promptKey;

                showScreenPrompt(data.prompt);
            })
            .catch(() => {});
    }

    function showScreenPrompt(prompt) {
        if (!screenPromptOverlay || isShowingPrompt) return;
        isShowingPrompt = true;

        if (promptHideTimer) {
            clearTimeout(promptHideTimer);
            promptHideTimer = null;
        }

        const style = prompt.style || 'great-moves';
        screenPromptOverlay.className = 'screen-prompt-overlay style-' + style;
        screenPromptIcon.innerHTML = `<i class="fas ${prompt.icon || 'fa-star'}"></i>`;
        screenPromptTitle.textContent = prompt.label || 'Announcement';
        screenPromptSub.textContent = prompt.subtext || '';

        screenPromptOverlay.classList.remove('closing');
        screenPromptOverlay.classList.add('active');
        startPromptAmbient(style);

        promptHideTimer = setTimeout(hideScreenPrompt, PROMPT_DISPLAY_TIME);
    }

    function hideScreenPrompt() {
        if (!isShowingPrompt) return;
        if (promptHideTimer) {
            clearTimeout(promptHideTimer);
            promptHideTimer = null;
        }
        screenPromptOverlay.classList.add('closing');
        setTimeout(() => {
            screenPromptOverlay.classList.remove('active', 'closing');
            screenPromptOverlay.className = 'screen-prompt-overlay';
            stopPromptAmbient();
            isShowingPrompt = false;
        }, 500);
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isShowingPrompt) hideScreenPrompt();
    });

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(screenPromptPollInterval);
        } else {
            startScreenPromptPolling();
        }
    });

    startScreenPromptPolling();

    // Initialize after karaoke + guest spinner modules are registered
    init();
    animateFloatingIcons();
    setTimeout(() => {
        updateStatus('DJ Message Display ready');
    }, 2000);
});
