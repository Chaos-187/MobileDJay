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
        } else {
            startMessagePolling();
            startSpinnerPolling();
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        clearInterval(refreshInterval);
        clearInterval(spinPollInterval);
    });

    // Initialize the display
    init();
    animateFloatingIcons();

    // Add welcome message for testing
    setTimeout(() => {
        updateStatus('DJ Message Display ready');
    }, 2000);

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

        fetch('/api/karaoke/spin-status')
            .then(response => response.json())
            .then(data => {
                if (data.shouldSpin && data.selectedSong) {
                    startSpin(data.selectedSong);
                    // Clear the trigger
                    fetch('/api/karaoke/clear-spin', { method: 'POST' });
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
        const colors = ['#ffc107', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];
        
        for (let i = 0; i < 100; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + 'vw';
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 0.5 + 's';
                document.body.appendChild(confetti);
                
                setTimeout(() => confetti.remove(), 3000);
            }, i * 30);
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
});
