// DJ Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const refreshBtn = document.getElementById('refreshBtn');
    const clearAllRequests = document.getElementById('clearAllRequests');
    const markAllDisplayed = document.getElementById('markAllDisplayed');
    const replyModal = new bootstrap.Modal(document.getElementById('replyModal'));
    const replyForm = document.getElementById('replyForm');
    const sendReplyBtn = document.getElementById('sendReplyBtn');

    // Auto-refresh every 30 seconds
    let autoRefreshInterval;
    
    function startAutoRefresh() {
        autoRefreshInterval = setInterval(() => {
            refreshData();
        }, 30000); // 30 seconds
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }
    }

    // Refresh functionality
    refreshBtn.addEventListener('click', function() {
        refreshData(true); // Show visual feedback for manual refresh
    });

    function refreshData(showFeedback = false) {
        const icon = refreshBtn.querySelector('i');
        
        if (showFeedback) {
            icon.classList.add('auto-refresh');
        }
        
        // Fetch fresh data instead of reloading page
        fetch('/api/dj/dashboard-data')
            .then(response => response.json())
            .then(data => {
                updateDashboard(data);
                if (showFeedback) {
                    showAlert('Dashboard refreshed', 'success');
                }
            })
            .catch(error => {
                console.error('Error refreshing data:', error);
                if (showFeedback) {
                    showAlert('Failed to refresh dashboard', 'danger');
                }
            })
            .finally(() => {
                if (showFeedback) {
                    setTimeout(() => {
                        icon.classList.remove('auto-refresh');
                    }, 500);
                }
            });
    }

    // Legacy refresh function for backward compatibility
    function refreshPage() {
        refreshData(true);
    }

    // Update dashboard content with fresh data
    function updateDashboard(data) {
        // Update request counts
        updateRequestCount(data.requests.length);
        
        // Update requests list
        const requestsList = document.getElementById('requestsList');
        if (data.requests.length === 0) {
            showEmptyRequestsMessage();
        } else {
            requestsList.innerHTML = data.requests.map(request => createRequestCard(request)).join('');
        }
        
        // Update messages list
        const messagesList = document.getElementById('messagesList');
        if (data.messages.length === 0) {
            messagesList.innerHTML = `
                <div class="card text-center">
                    <div class="card-body py-5">
                        <i class="fas fa-envelope fa-3x text-muted mb-3"></i>
                        <h5 class="text-muted">No messages yet</h5>
                        <p class="text-muted">Customer messages will appear here</p>
                    </div>
                </div>
            `;
        } else {
            messagesList.innerHTML = data.messages.map(message => createMessageCard(message)).join('');
        }
    }

    // Create request card HTML
    function createRequestCard(request) {
        // Normalize type and song data (API returns request.song on server-side render)
        const requestType = request.type || (request.song && request.song.type) || 'song';
        const isKaraoke = requestType === 'karaoke' || requestType === 'karaoke-request';
        const cardClass = isKaraoke ? 'karaoke-request' : 'song-request';
        const icon = isKaraoke ? 'microphone' : 'music';
        const color = isKaraoke ? 'warning' : 'success';

        // Prefer request.song fields when present (matches server-side rendering)
        const title = request.song ? (request.song.title || request.songTitle || request.title) : (request.title || request.songTitle || 'Unknown Title');
        const artist = request.song ? (request.song.artist || request.artist || '') : (request.artist || '');
        const difficulty = request.song ? request.song.difficulty : request.difficulty;

        return `
            <div class="card mb-3 request-card ${cardClass}" data-request-id="${request.id}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <div class="d-flex align-items-center mb-2">
                                <i class="fas fa-${icon} text-${color} me-2"></i>
                                <h6 class="mb-0">${escapeHtml(request.customerName)}</h6>
                                <span class="badge bg-${color} ms-2">${isKaraoke ? 'Karaoke' : 'Song'}</span>
                            </div>
                            <div class="request-details">
                                <strong>${escapeHtml(title)}</strong>
                                ${artist ? `<br><small class="text-muted">by ${escapeHtml(artist)}</small>` : ''}
                                ${difficulty ? `<br><span class="badge bg-secondary">${escapeHtml(difficulty)}</span>` : ''}
                            </div>
                            <div class="request-timestamp">
                                <i class="fas fa-clock me-1"></i>
                                ${new Date(request.timestamp).toLocaleString()}
                            </div>
                        </div>
                        <div class="ms-3">
                            <button class="btn btn-outline-primary btn-sm reply-request mb-1" 
                                    data-customer-name="${escapeHtml(request.customerName)}" 
                                    data-original-type="${requestType}" 
                                    data-request-id="${request.id}">
                                <i class="fas fa-reply me-1"></i>Reply
                            </button>
                            <button class="btn btn-outline-danger btn-sm remove-request" 
                                    data-request-id="${request.id}">
                                <i class="fas fa-trash me-1"></i>Remove
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Create message card HTML
    function createMessageCard(message) {
        const isNew = !message.displayed;
        
        return `
            <div class="card mb-3 ${isNew ? '' : 'bg-light'}" data-message-id="${message.id}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <div class="d-flex align-items-center mb-2">
                                <i class="fas fa-envelope text-info me-2"></i>
                                <h6 class="mb-0">${escapeHtml(message.customerName)}</h6>
                                ${isNew ? '<span class="badge bg-danger ms-2">New</span>' : ''}
                            </div>
                            <div class="message-preview">
                                ${escapeHtml(message.message)}
                            </div>
                            <div class="request-timestamp">
                                <i class="fas fa-clock me-1"></i>
                                ${new Date(message.timestamp).toLocaleString()}
                            </div>
                        </div>
                        <div class="ms-3">
                            <button class="btn btn-outline-primary btn-sm reply-message mb-1" 
                                    data-customer-name="${escapeHtml(message.customerName)}" 
                                    data-original-type="message" 
                                    data-message-id="${message.id}">
                                <i class="fas fa-reply me-1"></i>Reply
                            </button>
                            ${isNew ? `
                                <button class="btn btn-outline-secondary btn-sm mark-displayed" 
                                        data-message-id="${message.id}">
                                    <i class="fas fa-check me-1"></i>Mark Displayed
                                </button>
                            ` : ''}
                        </div>
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

    // Remove individual request
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('remove-request') || e.target.closest('.remove-request')) {
            const button = e.target.classList.contains('remove-request') ? e.target : e.target.closest('.remove-request');
            const requestId = button.dataset.requestId;
            
            if (confirm('Are you sure you want to remove this request?')) {
                removeRequest(requestId);
            }
        }
        
        // Handle reply to request
        if (e.target.classList.contains('reply-request') || e.target.closest('.reply-request')) {
            const button = e.target.classList.contains('reply-request') ? e.target : e.target.closest('.reply-request');
            openReplyModal(
                button.dataset.customerName,
                button.dataset.originalType,
                button.dataset.requestId
            );
        }
        
        // Handle reply to message
        if (e.target.classList.contains('reply-message') || e.target.closest('.reply-message')) {
            const button = e.target.classList.contains('reply-message') ? e.target : e.target.closest('.reply-message');
            openReplyModal(
                button.dataset.customerName,
                button.dataset.originalType,
                button.dataset.messageId
            );
        }
    });

    // Clear all requests
    clearAllRequests.addEventListener('click', function() {
        const requestCount = document.querySelectorAll('.request-card').length;
        if (requestCount === 0) {
            showAlert('No requests to clear', 'info');
            return;
        }

        if (confirm(`Are you sure you want to clear all ${requestCount} requests?`)) {
            const requestCards = document.querySelectorAll('.request-card');
            requestCards.forEach(card => {
                const requestId = card.dataset.requestId;
                removeRequest(requestId, false); // Don't show individual alerts
            });
            showAlert('All requests cleared', 'success');
            updateRequestCount(0);
        }
    });

    // Mark individual message as displayed
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('mark-displayed') || e.target.closest('.mark-displayed')) {
            const button = e.target.classList.contains('mark-displayed') ? e.target : e.target.closest('.mark-displayed');
            const messageId = button.dataset.messageId;
            markMessageDisplayed(messageId);
        }
    });

    // Mark all messages as displayed
    markAllDisplayed.addEventListener('click', function() {
        const unreadMessages = document.querySelectorAll('[data-message-id] .mark-displayed');
        if (unreadMessages.length === 0) {
            showAlert('No new messages to mark', 'info');
            return;
        }

        unreadMessages.forEach(button => {
            const messageId = button.dataset.messageId;
            markMessageDisplayed(messageId, false); // Don't show individual alerts
        });
        showAlert('All messages marked as displayed', 'success');
    });

    // Remove request function
    function removeRequest(requestId, showAlert = true) {
        fetch(`/api/dj/request/${requestId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const requestCard = document.querySelector(`[data-request-id="${requestId}"]`);
                if (requestCard) {
                    // Animate removal
                    requestCard.style.transition = 'all 0.3s ease';
                    requestCard.style.transform = 'translateX(100%)';
                    requestCard.style.opacity = '0';
                    
                    setTimeout(() => {
                        requestCard.remove();
                        updateRequestCount();
                        
                        // Check if no requests left
                        if (document.querySelectorAll('.request-card').length === 0) {
                            showEmptyRequestsMessage();
                        }
                    }, 300);
                }
                
                if (showAlert) {
                    showAlert('Request removed', 'success');
                }
            }
        })
        .catch(error => {
            console.error('Error removing request:', error);
            if (showAlert) {
                showAlert('Failed to remove request', 'danger');
            }
        });
    }

    // Mark message as displayed
    function markMessageDisplayed(messageId, showAlertMsg = true) {
        fetch(`/api/dj/message/${messageId}/mark-displayed`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const messageCard = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageCard) {
                    messageCard.classList.add('bg-light');
                    const button = messageCard.querySelector('.mark-displayed');
                    const badge = messageCard.querySelector('.badge');
                    
                    if (button) button.remove();
                    if (badge) badge.remove();
                }
                
                if (showAlertMsg) {
                    showAlert('Message marked as displayed', 'success');
                }
            }
        })
        .catch(error => {
            console.error('Error marking message:', error);
            if (showAlertMsg) {
                showAlert('Failed to mark message', 'danger');
            }
        });
    }

    // Open reply modal
    function openReplyModal(customerName, originalType, originalId) {
        document.getElementById('replyCustomerName').textContent = customerName;
        document.getElementById('replyCustomerNameInput').value = customerName;
        document.getElementById('replyOriginalType').value = originalType;
        document.getElementById('replyOriginalId').value = originalId;
        document.getElementById('replyMessage').value = '';
        
        replyModal.show();
        
        // Focus on textarea
        setTimeout(() => {
            document.getElementById('replyMessage').focus();
        }, 300);
    }

    // Send reply
    sendReplyBtn.addEventListener('click', function() {
        const formData = new FormData(replyForm);
        const replyData = {
            customerName: formData.get('customerName'),
            replyMessage: formData.get('replyMessage'),
            originalType: formData.get('originalType'),
            originalId: formData.get('originalId')
        };

        if (!replyData.replyMessage.trim()) {
            showAlert('Please enter a reply message', 'warning');
            return;
        }

        // Show loading state
        const originalText = sendReplyBtn.innerHTML;
        sendReplyBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';
        sendReplyBtn.disabled = true;

        fetch('/api/dj/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(replyData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showAlert(`Reply sent to ${replyData.customerName}!`, 'success');
                replyModal.hide();
                
                // Reset form
                replyForm.reset();
            } else {
                showAlert('Failed to send reply', 'danger');
            }
        })
        .catch(error => {
            console.error('Error sending reply:', error);
            showAlert('Failed to send reply', 'danger');
        })
        .finally(() => {
            // Reset button
            sendReplyBtn.innerHTML = originalText;
            sendReplyBtn.disabled = false;
        });
    });

    // Handle Enter key in reply textarea (Ctrl+Enter to send)
    document.getElementById('replyMessage').addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            sendReplyBtn.click();
        }
    });

    // Update request count
    function updateRequestCount(count = null) {
        const requestCount = count !== null ? count : document.querySelectorAll('.request-card').length;
        const countElement = document.getElementById('requestCount');
        if (countElement) {
            countElement.textContent = requestCount;
        }
    }

    // Show empty requests message
    function showEmptyRequestsMessage() {
        const requestsList = document.getElementById('requestsList');
        requestsList.innerHTML = `
            <div class="card text-center">
                <div class="card-body py-5">
                    <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">No requests yet</h5>
                    <p class="text-muted">Customer requests will appear here</p>
                </div>
            </div>
        `;
    }

    // Show alert function
    function showAlert(message, type = 'info') {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        alert.style.cssText = 'top: 20px; right: 20px; z-index: 1050; min-width: 300px;';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alert);
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 3000);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === 'r' || e.key === 'R') {
            refreshPage();
        } else if (e.key === 'c' || e.key === 'C') {
            clearAllRequests.click();
        } else if (e.key === 'm' || e.key === 'M') {
            markAllDisplayed.click();
        }
    });

    // Start auto-refresh
    startAutoRefresh();

    // Stop auto-refresh when page is hidden
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            stopAutoRefresh();
        } else {
            startAutoRefresh();
        }
    });

    // Show keyboard shortcuts on load
    setTimeout(() => {
        showAlert('Keyboard shortcuts: R = Refresh, C = Clear All, M = Mark All Displayed. Click Reply buttons to respond to customers!', 'info');
    }, 2000);
});
