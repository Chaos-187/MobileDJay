// DJ Display JavaScript - Full screen animated message display

document.addEventListener('DOMContentLoaded', function() {
    const waitingMessage = document.getElementById('waitingMessage');
    const messageContainer = document.getElementById('messageContainer');
    const messageDisplay = document.getElementById('messageDisplay');
    const messageContent = document.getElementById('messageContent');
    const messageFrom = document.getElementById('messageFrom');
    const controlPanel = document.getElementById('controlPanel');
    const messageStatus = document.getElementById('messageStatus');

    let currentMessageIndex = 0;
    let isDisplayingMessage = false;
    let messageQueue = [];
    let refreshInterval;

    // Configuration
    const CONFIG = {
        messageDisplayTime: 5000, // 5 seconds per message
        refreshInterval: 3000,    // Check for new messages every 3 seconds
        fadeInTime: 500,         // Animation timing
        fadeOutTime: 500
    };

    // Initialize
    function init() {
        startMessagePolling();
        setupKeyboardControls();
        setupMouseActivity();
        
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
        
        // Set message content
        messageContent.textContent = message.message;
        messageFrom.textContent = `- ${message.customerName}`;
        
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
        } else {
            startMessagePolling();
        }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        clearInterval(refreshInterval);
    });

    // Initialize the display
    init();
    animateFloatingIcons();

    // Add welcome message for testing
    setTimeout(() => {
        updateStatus('DJ Message Display ready');
    }, 2000);
});
