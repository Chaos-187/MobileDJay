// Karaoke Spinner JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const waitingMessage = document.getElementById('waitingMessage');
    const songsList = document.getElementById('songsList');
    const spinnerSlot = document.getElementById('spinnerSlot');
    const winnerDisplay = document.getElementById('winnerDisplay');
    const winnerTitle = document.getElementById('winnerTitle');
    const winnerArtist = document.getElementById('winnerArtist');
    const winnerDifficulty = document.getElementById('winnerDifficulty');
    const controlPanel = document.getElementById('controlPanel');
    const spinStatus = document.getElementById('spinStatus');

    let isSpinning = false;
    let pollInterval;
    let allSongs = [];

    // Configuration
    const CONFIG = {
        pollInterval: 1000,        // Check for spin trigger every second
        spinDuration: 9500,        // Total spin animation duration (8 seconds for smooth deceleration)
        displayDuration: 5000      // How long to show winner
    };

    // Audio elements
    const spinSound = new Audio('/audio/spin.mp3');

    // Initialize
    function init() {
        loadKaraokeSongs();
        startPolling();
        setupKeyboardControls();
        
        // Show control panel briefly
        setTimeout(() => {
            controlPanel.classList.add('show');
            setTimeout(() => controlPanel.classList.remove('show'), 3000);
        }, 1000);
    }

    // Load all karaoke songs
    function loadKaraokeSongs() {
        fetch('/api/karaoke/all')
            .then(response => response.json())
            .then(songs => {
                allSongs = songs;
                updateStatus(`${songs.length} karaoke songs loaded`);
            })
            .catch(error => {
                console.error('Error loading karaoke songs:', error);
                updateStatus('Error loading songs');
            });
    }

    // Start polling for spin trigger
    function startPolling() {
        pollInterval = setInterval(checkForSpinTrigger, CONFIG.pollInterval);
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
                console.error('Error checking spin status:', error);
            });
    }

    // Start the spinning animation
    function startSpin(targetSong) {
        if (isSpinning) return;
        
        isSpinning = true;
        updateStatus('Spinning...');

        // Play spin sound
        spinSound.currentTime = 0;
        spinSound.play().catch(error => {
            console.log('Could not play spin sound:', error);
        });

        // Hide waiting message
        waitingMessage.style.display = 'none';
        songsList.style.display = 'block';

        // Prepare the songs list for spinning
        prepareSongsList(targetSong);

        // Animate the spin
        animateSpin(targetSong);
    }

    // Prepare the scrolling songs list
    function prepareSongsList(targetSong) {
        // Create a list with random songs + target song
        const shuffled = [...allSongs].sort(() => Math.random() - 0.5);
        const displaySongs = shuffled.slice(0, 50); // Show 50 random songs
        
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
        // Find the target song's position in the list
        const targetElement = songsList.querySelector(`[data-song-id="${targetSong.id}"]`);
        if (!targetElement) {
            console.error('Target song not found in list');
            return;
        }

        const targetOffset = targetElement.offsetTop;
        const centerOffset = (spinnerSlot.offsetHeight - 300) / 2;
        const finalPosition = -(targetOffset - centerOffset);

        const startTime = Date.now();
        let currentPosition = 0;
        const songHeight = 300;
        
        // Calculate total distance and spins
        const totalDistance = Math.abs(finalPosition);
        const numberOfSongs = Math.floor(totalDistance / songHeight);

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / CONFIG.spinDuration;
            
            if (elapsed >= CONFIG.spinDuration) {
                // Ensure we end exactly at the target
                songsList.style.transform = `translateY(${finalPosition}px)`;
                finishSpin(targetSong);
                return;
            }

            // Easing function: ease-out-cubic for smooth deceleration
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            
            // Calculate current position using easing
            currentPosition = finalPosition * easeOutCubic;
            songsList.style.transform = `translateY(${currentPosition}px)`;

            // Continue animation
            requestAnimationFrame(animate);
        }

        // Reset transform and start animation
        songsList.style.transform = 'translateY(0)';
        songsList.style.transition = 'none';
        requestAnimationFrame(animate);
    }

    // Finish the spin and show winner
    function finishSpin(winner) {
        // The song is already centered from the animation
        // Wait a moment for effect, then show winner overlay
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
        updateStatus('Winner selected!');
        
        // Create confetti
        createConfetti();

        // Hide winner after display duration
        setTimeout(() => {
            resetSpinner();
        }, CONFIG.displayDuration);
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

    // Reset the spinner to waiting state
    function resetSpinner() {
        winnerDisplay.classList.remove('show');
        songsList.style.display = 'none';
        songsList.style.transition = '';
        waitingMessage.style.display = 'flex';
        isSpinning = false;
        updateStatus('Ready for next spin');
    }

    // Update status in control panel
    function updateStatus(status) {
        spinStatus.textContent = status;
    }

    // Setup keyboard controls
    function setupKeyboardControls() {
        document.addEventListener('keydown', function(e) {
            switch(e.key.toLowerCase()) {
                case 'h':
                    controlPanel.classList.toggle('show');
                    break;
                case 'r':
                    resetSpinner();
                    break;
                case 'f':
                    toggleFullscreen();
                    break;
            }
        });
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

    // Utility function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Handle page visibility changes
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(pollInterval);
        } else {
            startPolling();
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        clearInterval(pollInterval);
    });

    // Initialize the spinner
    init();
});