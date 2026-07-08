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
    const mainContainer = document.querySelector('main.container');

    // This script is shared across pages; only run full logic on the landing page.
    if (!customerNameInput || !nameSubmitBtn || !nameInputCard || !optionsContainer || !welcomeName) {
        return;
    }

    // Check if user already has a name stored and show appropriate view
    const storedName = sessionStorage.getItem('customerName');
    const urlParams = new URLSearchParams(window.location.search);
    const editMode = urlParams.get('edit') === 'true';
    
    if (storedName && !editMode) {
        customerNameInput.value = storedName;
        showOptionsView(storedName);
        registerGuestCheckin(storedName);
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
        registerGuestCheckin(customerName);
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
            
            // Tip card with payment links
            const tipLinksData = this.dataset.tipLinks;
            if (tipLinksData) {
                try {
                    const links = JSON.parse(tipLinksData);
                    if (links.length === 1) {
                        window.open(links[0].url, '_blank', 'noopener,noreferrer');
                    } else if (links.length > 1) {
                        showTipModal(links);
                    }
                } catch(e) {
                    console.error('Error parsing tip links:', e);
                }
                return;
            }
            
            // External link (e.g. legacy single tip link)
            const href = this.dataset.href;
            if (href) {
                window.open(href, '_blank', 'noopener,noreferrer');
                return;
            }
            
            const target = this.dataset.target;
            
            // Navigate to target page with customer name as query parameter.
            // The target may already include the event path (e.g., event/abc123/song-request)
            // and may already carry a query string (e.g., photo?camera=1).
            const sep = target.includes('?') ? '&' : '?';
            window.location.href = `/${target}${sep}customerName=${encodeURIComponent(customerName)}`;
        });
    });

    // Tip modal
    const providerMeta = {
        stripe: { label: 'Stripe', icon: 'fa-credit-card', color: '#635bff', textColor: '#fff' },
        square: { label: 'Square', icon: 'fa-square', color: '#006aff', textColor: '#fff' },
        venmo: { label: 'Venmo', icon: 'fa-v', color: '#008cff', textColor: '#fff' },
        cashapp: { label: 'Cash App', icon: 'fa-dollar-sign', color: '#00d632', textColor: '#fff' },
        paypal: { label: 'PayPal', icon: 'fa-p', color: '#ffc43a', textColor: '#003087' },
        other: { label: 'Pay', icon: 'fa-link', color: '#6b7280', textColor: '#fff' }
    };

    function showTipModal(links) {
        const container = document.getElementById('tipLinksOptions');
        if (!container) return;
        container.innerHTML = '';
        links.forEach(link => {
            const meta = providerMeta[link.provider] || providerMeta.other;
            const btn = document.createElement('a');
            btn.href = link.url;
            btn.target = '_blank';
            btn.rel = 'noopener noreferrer';
            btn.className = 'btn btn-lg tip-link-btn';
            btn.style.cssText = `background: ${meta.color}; color: ${meta.textColor}; border: none;`;
            btn.innerHTML = `<i class="fas ${meta.icon} me-2"></i>${link.label || meta.label}`;
            container.appendChild(btn);
        });
        const modal = new bootstrap.Modal(document.getElementById('tipModal'));
        modal.show();
    }

    // Handle bell icon click
    if (repliesBellBtn) {
        repliesBellBtn.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            
            if (!customerName) {
                showError('Please enter your name first');
                showNameView();
                return;
            }
            
            if (repliesScreen && repliesScreen.style.display === 'block') {
                hideRepliesScreen();
            } else {
                showRepliesScreen(customerName);
            }
        });
    }

    // Handle back to menu button
    if (backToMenuBtn) {
        backToMenuBtn.addEventListener('click', function() {
            const customerName = sessionStorage.getItem('customerName');
            hideRepliesScreen();
            if (customerName && welcomeName) {
                welcomeName.textContent = customerName;
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
        // Show navbar profile and bell when options are visible
        if (editNameBtn) {
            editNameBtn.style.display = 'inline-flex';
        }
        if (repliesBellBtn) {
            repliesBellBtn.style.display = 'block';
        }
    }

    function showNameView() {
        optionsContainer.style.display = 'none';
        repliesScreen.style.display = 'none';
        nameInputCard.style.display = 'block';
        customerNameInput.focus();
        // Hide navbar actions when on name entry
        if (editNameBtn) {
            editNameBtn.style.display = 'none';
        }
        if (repliesBellBtn) {
            repliesBellBtn.style.display = 'none';
        }
    }

    function showRepliesScreen(customerName) {
        if (mainContainer) mainContainer.style.display = 'none';
        repliesScreen.style.display = 'block';
        if (repliesCustomerName) repliesCustomerName.textContent = customerName;
        if (repliesBellBtn) {
            repliesBellBtn.setAttribute('aria-pressed', 'true');
            repliesBellBtn.classList.remove('btn-outline-light');
            repliesBellBtn.classList.add('btn-light');
        }
        loadReplies(customerName);
    }

    function hideRepliesScreen() {
        repliesScreen.style.display = 'none';
        if (mainContainer) mainContainer.style.display = 'block';
        if (repliesBellBtn) {
            repliesBellBtn.setAttribute('aria-pressed', 'false');
            repliesBellBtn.classList.remove('btn-light');
            repliesBellBtn.classList.add('btn-outline-light');
        }
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

        const activityUrl = `/api/customer/activity/${encodeURIComponent(customerName)}` +
            (window.eventSlug ? `?eventSlug=${encodeURIComponent(window.eventSlug)}` : '');
        fetch(activityUrl)
            .then(response => response.json())
            .then(data => {
                displayChatMessages(data.replies || [], data.requests || []);
                updateBellIcon((data.replies || []).length);
            })
            .catch(error => {
                console.error('Error fetching activity:', error);
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

    function displayChatMessages(replies, requests) {
        // Merge DJ replies and the guest's own requests into one timeline
        const items = [
            ...replies.map(r => ({ kind: 'reply', timestamp: r.timestamp, data: r })),
            ...requests.map(r => ({ kind: 'request', timestamp: r.timestamp, data: r }))
        ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (items.length === 0) {
            chatMessages.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-comments fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">Nothing here yet</h5>
                    <p class="text-muted">Your song and karaoke requests will show here, along with the DJ's replies.</p>
                </div>
            `;
            return;
        }

        chatMessages.innerHTML = items
            .map(item => item.kind === 'reply' ? createChatBubble(item.data) : createRequestBubble(item.data))
            .join('');
        
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
                            <strong class="text-warning">${escapeHtml(window.djName || 'DJ')}</strong>
                            <span class="badge bg-secondary ms-2 small">${reply.originalType}</span>
                            ${reply.direct ? '<span class="badge bg-dark ms-1 small" title="Sent only to you"><i class="fas fa-user-lock me-1"></i>Just for you</span>' : ''}
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

    // Bubble for the guest's own song/karaoke request (right-hand side)
    function createRequestBubble(request) {
        const timestamp = new Date(request.timestamp).toLocaleString();
        const isKaraoke = (request.type || '').indexOf('karaoke') !== -1;
        const icon = isKaraoke ? 'microphone' : 'music';
        const label = isKaraoke ? 'Karaoke' : 'Song';
        
        return `
            <div class="mb-3">
                <div class="d-flex justify-content-end">
                    <div class="chat-bubble from-customer" style="max-width: 80%;">
                        <div class="d-flex align-items-center mb-1">
                            <i class="fas fa-${icon} me-2"></i>
                            <strong>You requested</strong>
                            <span class="badge bg-secondary ms-2 small">${label}</span>
                        </div>
                        <p class="mb-1">"${escapeHtml(request.title || 'Unknown')}"${request.artist ? ' by ' + escapeHtml(request.artist) : ''}</p>
                        ${request.message ? `<p class="mb-1 small fst-italic">"${escapeHtml(request.message)}"</p>` : ''}
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
    function registerGuestCheckin(customerName) {
        if (!window.eventSlug || !customerName) return;
        fetch(`/api/event/${encodeURIComponent(window.eventSlug)}/guest-checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerName })
        }).catch(() => {});
    }

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
