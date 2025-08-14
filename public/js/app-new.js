// MobileDJay Main JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const nameSubmitBtn = document.getElementById('nameSubmitBtn');
    const nameInputCard = document.getElementById('nameInputCard');
    const optionsContainer = document.getElementById('optionsContainer');
    const welcomeName = document.getElementById('welcomeName');
    const editNameBtn = document.getElementById('editNameBtn');
    const optionCards = document.querySelectorAll('.option-card');
    const repliesBellBtn = document.getElementById('repliesBellBtn');
    const repliesBadge = document.getElementById('repliesBadge');
    const repliesScreen = document.getElementById('repliesScreen');
    const backToMenuBtn = document.getElementById('backToMenuBtn');
    const refreshRepliesBtn = document.getElementById('refreshRepliesBtn');
    const chatMessages = document.getElementById('chatMessages');
    const repliesCustomerName = document.getElementById('repliesCustomerName');

    // Check if user already has a name stored and show appropriate view
    const storedName = sessionStorage.getItem('customerName');
    const urlParams = new URLSearchParams(window.location.search);
    const editMode = urlParams.get('edit') === 'true';
    
    if (storedName && !editMode) {
        customerNameInput.value = storedName;
        showOptionsView(storedName);
        // Check for replies and update bell
        checkForReplies(storedName);
    } else if (storedName && editMode) {
        // User wants to edit their name
        customerNameInput.value = storedName;
        showNameView();
        customerNameInput.select(); // Select all text for easy editing
        // Clear the edit parameter from URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Handle name submission
    nameSubmitBtn.addEventListener('click', function() {
        const customerName = customerNameInput.value.trim();
        
        if (!customerName) {
            showError('Please enter your name');
            customerNameInput.focus();
            return;
        }

        // Store name and show options
        sessionStorage.setItem('customerName', customerName);
        showOptionsView(customerName);
        // Check for replies and update bell
        checkForReplies(customerName);
    });

    // Handle Enter key in name input
    customerNameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            nameSubmitBtn.click();
        }
    });

    // Handle edit name button click
    if (editNameBtn) {
        editNameBtn.addEventListener('click', function() {
            showNameView();
            customerNameInput.select(); // Select all text for easy editing
        });
    }

    // Handle option card clicks
    optionCards.forEach(card => {
        card.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            
            if (!customerName) {
                showError('Please enter your name first');
                showNameView();
                return;
            }
            
            const target = this.dataset.target;
            
            // Navigate to target page with customer name as query parameter
            window.location.href = `/${target}?customerName=${encodeURIComponent(customerName)}`;
        });
    });

    // Handle bell icon click
    if (repliesBellBtn) {
        repliesBellBtn.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            
            if (!customerName) {
                showError('Please enter your name first');
                showNameView();
                return;
            }
            
            showRepliesScreen(customerName);
        });
    }

    // Handle back to menu button
    if (backToMenuBtn) {
        backToMenuBtn.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            if (customerName) {
                showOptionsView(customerName);
            } else {
                showNameView();
            }
        });
    }

    // Handle refresh replies button
    if (refreshRepliesBtn) {
        refreshRepliesBtn.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            if (customerName) {
                loadReplies(customerName);
            }
        });
    }

    function showOptionsView(customerName) {
        nameInputCard.style.display = 'none';
        repliesScreen.style.display = 'none';
        welcomeName.textContent = customerName;
        optionsContainer.style.display = 'block';
        optionsContainer.classList.add('fade-in');
        // Show bell icon when options are visible
        if (repliesBellBtn) {
            repliesBellBtn.style.display = 'block';
        }
    }

    function showNameView() {
        optionsContainer.style.display = 'none';
        repliesScreen.style.display = 'none';
        nameInputCard.style.display = 'block';
        customerNameInput.focus();
        // Hide bell icon when on name entry
        if (repliesBellBtn) {
            repliesBellBtn.style.display = 'none';
        }
    }

    function showRepliesScreen(customerName) {
        optionsContainer.style.display = 'none';
        nameInputCard.style.display = 'none';
        repliesScreen.style.display = 'block';
        repliesCustomerName.textContent = customerName;
        loadReplies(customerName);
    }

    function checkForReplies(customerName) {
        fetch(`/api/customer/replies/${encodeURIComponent(customerName)}`)
            .then(response => response.json())
            .then(replies => {
                updateBellIcon(replies.length);
            })
            .catch(error => {
                console.error('Error checking replies:', error);
            });
    }

    function updateBellIcon(replyCount) {
        if (repliesBadge) {
            if (replyCount > 0) {
                repliesBadge.textContent = replyCount;
                repliesBadge.style.display = 'block';
                // Add a subtle animation to the bell
                repliesBellBtn.classList.add('text-warning');
            } else {
                repliesBadge.style.display = 'none';
                repliesBellBtn.classList.remove('text-warning');
            }
        }
    }

    function loadReplies(customerName) {
        // Show loading state in chat
        chatMessages.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-spinner fa-spin fa-2x mb-3"></i>
                <p>Loading your conversation...</p>
            </div>
        `;

        // Disable refresh button
        refreshRepliesBtn.disabled = true;
        const originalText = refreshRepliesBtn.innerHTML;
        refreshRepliesBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Loading...';

        fetch(`/api/customer/replies/${encodeURIComponent(customerName)}`)
            .then(response => response.json())
            .then(replies => {
                displayChatMessages(replies, customerName);
                updateBellIcon(replies.length);
            })
            .catch(error => {
                console.error('Error fetching replies:', error);
                showError('Failed to load messages. Please try again.');
                chatMessages.innerHTML = `
                    <div class="text-center py-4 text-muted">
                        <i class="fas fa-exclamation-triangle fa-2x mb-3"></i>
                        <p>Failed to load messages. Please try again.</p>
                    </div>
                `;
            })
            .finally(() => {
                // Reset refresh button
                refreshRepliesBtn.disabled = false;
                refreshRepliesBtn.innerHTML = originalText;
            });
    }

    function displayChatMessages(replies, customerName) {
        if (replies.length === 0) {
            chatMessages.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-comments fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">No messages yet</h5>
                    <p class="text-muted">The DJ will reply to your requests and messages here.</p>
                </div>
            `;
            return;
        }

        const messagesHtml = replies.map(reply => createChatBubble(reply)).join('');
        chatMessages.innerHTML = messagesHtml;
        
        // Scroll to bottom of chat
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function createChatBubble(reply) {
        const timestamp = new Date(reply.timestamp).toLocaleString();
        const isFromDJ = true; // All replies are from DJ
        
        return `
            <div class="mb-3">
                <div class="d-flex ${isFromDJ ? 'justify-content-start' : 'justify-content-end'}">
                    <div class="chat-bubble ${isFromDJ ? 'from-dj' : 'from-customer'}" style="max-width: 80%;">
                        <div class="d-flex align-items-center mb-1">
                            <i class="fas fa-user-tie me-2 text-warning"></i>
                            <strong class="text-warning">DJ Chaos</strong>
                            <span class="badge bg-secondary ms-2 small">${reply.originalType}</span>
                        </div>
                        <p class="mb-1">${escapeHtml(reply.replyMessage)}</p>
                        <small class="text-muted">
                            <i class="fas fa-clock me-1"></i>
                            ${timestamp}
                        </small>
                    </div>
                </div>
            </div>
        `;
    }

    // Utility function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Show error message function
    function showError(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show position-fixed';
        alert.style.cssText = 'top: 20px; left: 50%; transform: translateX(-50%); z-index: 9999; min-width: 300px;';
        alert.innerHTML = `
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alert);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    // Periodically check for new replies when on options view
    let replyCheckInterval;
    
    function startReplyChecking(customerName) {
        // Clear any existing interval
        if (replyCheckInterval) {
            clearInterval(replyCheckInterval);
        }
        
        // Check every 30 seconds
        replyCheckInterval = setInterval(() => {
            if (optionsContainer.style.display === 'block') {
                checkForReplies(customerName);
            }
        }, 30000);
    }
    
    function stopReplyChecking() {
        if (replyCheckInterval) {
            clearInterval(replyCheckInterval);
            replyCheckInterval = null;
        }
    }

    // Start reply checking if we have a customer name
    if (storedName && !editMode) {
        startReplyChecking(storedName);
    }

    // Update reply checking when name changes
    const originalShowOptionsView = showOptionsView;
    showOptionsView = function(customerName) {
        originalShowOptionsView(customerName);
        startReplyChecking(customerName);
    };

    // Stop checking when leaving the page
    window.addEventListener('beforeunload', stopReplyChecking);
});
