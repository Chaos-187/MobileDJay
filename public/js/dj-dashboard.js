// DJ Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const refreshBtn = document.getElementById('refreshBtn');
    const clearAllRequests = document.getElementById('clearAllRequests');
    const markAllDisplayed = document.getElementById('markAllDisplayed');
    const spinKaraokeBtn = document.getElementById('spinKaraoke');
    const triggerSpinBtn = document.getElementById('triggerSpinBtn');
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

    // Trigger Spin button handler
    if (triggerSpinBtn) {
        triggerSpinBtn.addEventListener('click', function() {
            triggerKaraokeSpin();
        });
    }

    // Trigger karaoke spin
    function triggerKaraokeSpin() {
        const btn = triggerSpinBtn;
        const originalContent = btn.innerHTML;
        
        // Show loading state
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Spinning...';
        
        fetch('/api/karaoke/trigger-spin', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showAlert(`Spin triggered! Selected: "${data.song.title}" by ${data.song.artist}`, 'success');
                    // Refresh to show the new request
                    setTimeout(() => refreshData(false), 1000);
                } else {
                    showAlert(data.error || 'Failed to trigger spin', 'danger');
                }
            })
            .catch(error => {
                console.error('Error triggering spin:', error);
                showAlert('Failed to trigger spin', 'danger');
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            });
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
        
        // Update requests list — newest first, same as the server-rendered page
        const requestsList = document.getElementById('requestsList');
        if (data.requests.length === 0) {
            showEmptyRequestsMessage();
        } else {
            const sortedRequests = data.requests.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            requestsList.innerHTML = sortedRequests.map(request => createRequestCard(request)).join('');
        }
        
        // Update messages list — newest first, same as the server-rendered page
        const messagesList = document.getElementById('messagesList');
        if (data.messages.length === 0) {
            messagesList.innerHTML = `
                <div class="card text-center">
                    <div class="card-body py-4">
                        <i class="fas fa-comments fa-2x text-muted mb-2"></i>
                        <p class="text-muted mb-0">No messages</p>
                    </div>
                </div>
            `;
        } else {
            const sortedMessages = data.messages.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            messagesList.innerHTML = sortedMessages.map(message => createMessageCard(message)).join('');
        }

        document.dispatchEvent(new CustomEvent('mdj-dashboard-refreshed'));
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

        // Markup mirrors the server-rendered card in dj-dashboard.ejs so a
        // refresh doesn't change how the list looks.
        const genre = request.song ? request.song.genre : request.genre;
        const typeKey = isKaraoke ? 'karaoke' : 'song';
        return `
            <div class="card request-card ${typeKey}-request mb-3" data-request-id="${request.id}" data-event-id="${request.eventId || ''}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <div class="d-flex align-items-center mb-2 flex-wrap gap-1">
                                <span class="badge bg-${color} me-1">
                                    <i class="fas fa-${icon} me-1"></i>${typeKey.toUpperCase()}
                                </span>
                                ${request.eventName ? `<span class="badge bg-dark me-1" title="Event">${escapeHtml(request.eventName)}</span>` : ''}
                                <strong class="me-2">${escapeHtml(request.customerName)}</strong>
                                <span class="request-timestamp">${new Date(request.timestamp).toLocaleString()}</span>
                            </div>
                            <h6 class="card-title mb-1">
                                "${escapeHtml(title)}" by ${escapeHtml(artist || 'Unknown')}
                            </h6>
                            ${genre ? `<span class="badge bg-secondary me-2">${escapeHtml(genre)}</span>` : ''}
                            ${difficulty ? `<span class="badge bg-info">${escapeHtml(difficulty)}</span>` : ''}
                            ${request.message ? `
                                <div class="message-preview">
                                    <small><strong>Message:</strong> ${escapeHtml(request.message)}</small>
                                </div>
                            ` : ''}
                        </div>
                        <button class="btn btn-outline-danger btn-sm ms-3 remove-request" 
                                data-request-id="${request.id}">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="btn btn-outline-primary btn-sm ms-2 reply-request" 
                                data-customer-name="${escapeHtml(request.customerName)}"
                                data-request-id="${request.id}"
                                data-original-type="request">
                            <i class="fas fa-reply"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Create message card HTML — mirrors the server-rendered card in
    // dj-dashboard.ejs so a refresh doesn't change how the list looks.
    // message.message is sanitized server-side, so it's safe to render as HTML
    // (needed for messages with inline media).
    function createMessageCard(message) {
        const needsReply = !!message.needsReply;
        const name = escapeHtml(message.customerName);
        const nameAttr = escapeAttr(message.customerName);
        
        return `
            <div class="card mb-2${needsReply ? ' message-needs-reply' : (!message.displayed ? '' : ' bg-light')}" data-message-id="${message.id}" data-event-id="${message.eventId || ''}" data-needs-reply="${needsReply ? '1' : '0'}">
                <div class="card-body py-2 message-card-body">
                    <div class="message-card-top">
                        <div class="message-card-meta">
                            <div class="d-flex align-items-center mb-1 flex-wrap gap-1">
                                <strong class="me-1">${name}</strong>
                                ${message.eventName ? `<span class="badge bg-dark" title="Event">${escapeHtml(message.eventName)}</span>` : ''}
                                ${needsReply ? '<span class="badge bg-primary">Awaiting reply</span>' : ''}
                                ${message.private ? '<span class="badge bg-purple-pill" title="Not shown on the display screen"><i class="fas fa-user-lock me-1"></i>DJ Only</span>' : ''}
                            </div>
                            <small class="text-muted d-block">
                                <i class="fas fa-clock me-1"></i>
                                ${new Date(message.timestamp).toLocaleString()}
                            </small>
                        </div>
                        <div class="message-card-actions">
                            ${!message.displayed ? `
                                <button class="btn btn-outline-primary btn-sm mark-displayed" 
                                        data-message-id="${message.id}"
                                        title="Mark displayed">
                                    <i class="fas fa-check"></i>
                                </button>
                            ` : ''}
                            <button class="btn btn-success btn-sm reply-message" 
                                    data-customer-name="${nameAttr}"
                                    data-message-id="${message.id}"
                                    data-original-type="message"
                                    title="Reply">
                                <i class="fas fa-reply"></i>
                            </button>
                        </div>
                    </div>
                    <div class="message-text small">${message.message}</div>
                    <div class="message-card-actions-bottom">
                        <button class="btn btn-success btn-sm reply-message" 
                                data-customer-name="${nameAttr}"
                                data-message-id="${message.id}"
                                data-original-type="message">
                            <i class="fas fa-reply me-1"></i>Reply to ${name}
                        </button>
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

    function escapeAttr(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
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
        const unreadMessages = document.querySelectorAll('#messagesList > .card .mark-displayed');
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
                const messageCard = document.querySelector(`#messagesList > .card[data-message-id="${messageId}"]`);
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

    document.addEventListener('mdj-open-reply', function(e) {
        const { customerName, originalType, originalId } = e.detail || {};
        if (customerName) {
            openReplyModal(customerName, originalType || 'message', originalId || '');
        }
    });

    // Direct toggle updates the visibility hint under the reply box
    const replyDirectToggle = document.getElementById('replyDirect');
    const replyVisibilityHint = document.getElementById('replyVisibilityHint');
    if (replyDirectToggle && replyVisibilityHint) {
        replyDirectToggle.addEventListener('change', function() {
            replyVisibilityHint.textContent = this.checked
                ? 'Sent privately to the guest\u2019s phone only'
                : 'This message will be displayed on the public message screen';
        });
    }

    // Send reply
    sendReplyBtn.addEventListener('click', function() {
        const formData = new FormData(replyForm);
        const replyData = {
            customerName: formData.get('customerName'),
            replyMessage: formData.get('replyMessage'),
            originalType: formData.get('originalType'),
            originalId: formData.get('originalId'),
            direct: replyDirectToggle ? replyDirectToggle.checked : false
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
                showAlert(replyData.direct
                    ? `Direct reply sent to ${replyData.customerName} (not shown on display)`
                    : `Reply sent to ${replyData.customerName}!`, 'success');
                replyModal.hide();
                
                // Reset form (including the direct toggle and its hint)
                replyForm.reset();
                if (replyDirectToggle) {
                    replyDirectToggle.checked = false;
                    replyDirectToggle.dispatchEvent(new Event('change'));
                }
                refreshData();
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

    // Spin Karaoke button handler
    if (spinKaraokeBtn) {
        spinKaraokeBtn.addEventListener('click', function() {
            const originalHtml = spinKaraokeBtn.innerHTML;
            spinKaraokeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Spinning...';
            spinKaraokeBtn.disabled = true;
            
            fetch('/api/karaoke/trigger-spin', {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showAlert(`Karaoke spinner triggered! Selected: "${data.song.title}" by ${data.song.artist}`, 'success');
                } else {
                    showAlert('Error triggering karaoke spinner', 'danger');
                }
            })
            .catch(error => {
                console.error('Error triggering spinner:', error);
                showAlert('Error triggering karaoke spinner', 'danger');
            })
            .finally(() => {
                setTimeout(() => {
                    spinKaraokeBtn.innerHTML = originalHtml;
                    spinKaraokeBtn.disabled = false;
                }, 2000);
            });
        });
    }

    // Show keyboard shortcuts on load
    setTimeout(() => {
        showAlert('Keyboard shortcuts: R = Refresh, C = Clear All, M = Mark All Displayed. Click Reply buttons to respond to customers!', 'info');
    }, 2000);
});
