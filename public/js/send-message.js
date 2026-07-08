// Send Message - Inline GIF System for Android GBoard

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const messageInput = document.getElementById('messageInput');
    const messageHidden = document.getElementById('message');
    const messageTextHidden = document.getElementById('messageText');
    const charCount = document.getElementById('charCount');
    const form = document.getElementById('messageForm');
    const clearBtn = document.getElementById('clearBtn');

    // Replies screen elements
    const repliesBellBtn = document.getElementById('repliesBellBtn');
    const repliesBadge = document.getElementById('repliesBadge');
    const repliesScreen = document.getElementById('repliesScreen');
    const refreshRepliesBtn = document.getElementById('refreshRepliesBtn');
    const chatMessages = document.getElementById('chatMessages');
    const repliesCustomerName = document.getElementById('repliesCustomerName');
    const mainContainer = document.querySelector('main.container');
    const backToMessageBtn = document.getElementById('backToMessageBtn');
    // Declared early to avoid TDZ when initializeReplies() runs.
    let replyCheckInterval;

    // Check if required elements exist
    if (!messageInput) {
        console.error('messageInput element not found');
        return;
    }

    // Initialize replies functionality
    initializeReplies();

    // Auto-fill customer name from session storage
    if (customerNameInput && !customerNameInput.value && sessionStorage.getItem('customerName')) {
        customerNameInput.value = sessionStorage.getItem('customerName');
    }

    // Initialize inline GIF system
    initializeInlineGifSystem();

    // Initialize inline GIF system for contenteditable
    function initializeInlineGifSystem() {
        if (!messageInput) return;

        // Set up event listeners for contenteditable
        messageInput.addEventListener('input', updateContent);
        messageInput.addEventListener('beforeinput', handleBeforeInput);
        messageInput.addEventListener('paste', handlePaste);
        messageInput.addEventListener('compositionstart', handleCompositionStart);
        messageInput.addEventListener('compositionupdate', handleCompositionUpdate);
        messageInput.addEventListener('compositionend', handleCompositionEnd);
        
        // Initialize content
        updateContent();
    }

    // Handle beforeinput for rich content insertion
    function handleBeforeInput(e) {
        console.log('beforeinput event:', e.inputType, e.data);
        
        if (e.inputType === 'insertCompositionText' || e.inputType === 'insertText') {
            // Let composition events handle this
            return;
        }
        
        if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
            // Handle in paste/drop events
            return;
        }
        
        // Handle any rich content insertions
        if (e.data && (e.data.includes('http') || e.data.includes('data:'))) {
            setTimeout(() => {
                processRichContent();
            }, 10);
        }
    }

    // Handle composition events (for mobile keyboards)
    let compositionData = '';
    
    function handleCompositionStart(e) {
        console.log('Composition start:', e.data);
        compositionData = '';
    }
    
    function handleCompositionUpdate(e) {
        console.log('Composition update:', e.data);
        compositionData = e.data || '';
    }
    
    function handleCompositionEnd(e) {
        console.log('Composition end:', e.data);
        const finalData = e.data || compositionData;
        
        // Check if composition included media URLs
        if (finalData && (finalData.includes('http') || finalData.includes('data:'))) {
            setTimeout(() => {
                processRichContent();
            }, 50);
        }
    }

    // Handle paste events with rich content
    function handlePaste(e) {
        console.log('Paste event triggered');
        
        // Check for files in clipboard
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let hasFiles = false;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                hasFiles = true;
                const file = item.getAsFile();
                if (file) {
                    insertImageInline(file);
                }
            }
        }
        
        // If no files, check for URLs after paste
        if (!hasFiles) {
            setTimeout(() => {
                processRichContent();
            }, 10);
        }
    }

    // Process rich content (URLs, embeds, etc.)
    function processRichContent() {
        const content = messageInput.innerHTML;
        
        // Look for image URLs in the content
        const urlPattern = /(https?:\/\/[^\s<>"]+\.(gif|jpg|jpeg|png|webp))/gi;
        const tenorPattern = /(https?:\/\/tenor\.com\/[^\s<>"]+)/gi;
        const giphyPattern = /(https?:\/\/giphy\.com\/[^\s<>"]+)/gi;
        
        let modified = false;
        let newContent = content;
        
        // Replace image URLs with inline images
        newContent = newContent.replace(urlPattern, (match, url) => {
            modified = true;
            return insertMediaUrlInline(url);
        });
        
        // Handle Tenor URLs
        newContent = newContent.replace(tenorPattern, (match, url) => {
            modified = true;
            // Extract GIF URL from Tenor
            const tenorId = url.split('/').pop();
            const gifUrl = `https://tenor.com/view/${tenorId}.gif`;
            return insertMediaUrlInline(gifUrl);
        });
        
        // Handle Giphy URLs
        newContent = newContent.replace(giphyPattern, (match, url) => {
            modified = true;
            // Convert Giphy URL to direct GIF
            const giphyId = url.split('/').pop().split('-').pop();
            const gifUrl = `https://i.giphy.com/media/${giphyId}/giphy.gif`;
            return insertMediaUrlInline(gifUrl);
        });
        
        if (modified) {
            messageInput.innerHTML = newContent;
            updateContent();
            showInfo('Media detected and added inline! 🎉');
        }
    }

    // Insert image file inline
    function insertImageInline(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'inline-media';
            img.alt = file.name;
            img.title = file.name;
            
            // Insert at current cursor position or at the end
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.insertNode(img);
                range.collapse(false);
            } else {
                messageInput.appendChild(img);
            }
            
            updateContent();
        };
        reader.readAsDataURL(file);
    }

    // Insert media URL inline
    function insertMediaUrlInline(url) {
        return `<img src="${url}" class="inline-media" alt="Inline media" loading="lazy">`;
    }

    // Content update handler for contenteditable
    function updateContent() {
        const htmlContent = getNormalizedHtmlContent();
        const textContent = getNormalizedTextContent();
        const hasMedia = htmlContent.includes('<img') || htmlContent.includes('data:image');
        
        // Store HTML content for server processing
        if (messageHidden) {
            messageHidden.value = htmlContent;
        }
        if (messageTextHidden) {
            messageTextHidden.value = textContent;
        }
        
        // Update character counter
        if (charCount) {
            charCount.textContent = textContent.length;
            
            // Update character count color
            if (textContent.length > 450) {
                charCount.style.color = '#dc3545';
            } else if (textContent.length > 400) {
                charCount.style.color = '#ffc107';
            } else {
                charCount.style.color = '#6c757d';
            }
        }
        
        // Save customer name to session storage
        if (customerNameInput && customerNameInput.value) {
            sessionStorage.setItem('customerName', customerNameInput.value);
        }
    }

    // Clear button handler
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to clear your message?')) {
                messageInput.innerHTML = '';
                updateContent();
                messageInput.focus();
            }
        });
    }

    // Form submission handler
    if (form) {
        let isProgrammaticSubmit = false;
        form.addEventListener('submit', function(e) {
            if (isProgrammaticSubmit) {
                return;
            }
            e.preventDefault();

            // On some mobile/IME keyboards, composition text commits on blur.
            if (document.activeElement === messageInput) {
                messageInput.blur();
            }

            window.requestAnimationFrame(() => {
            const customerName = customerNameInput ? customerNameInput.value.trim() : '';
            // Force a final sync for mobile/IME keyboards before submit.
            updateContent();
            const htmlContent = getNormalizedHtmlContent();
            const textContent = getNormalizedTextContent();

            if (!customerName) {
                window.location.href = '/';
                return;
            }

            if (!htmlContent || (!textContent && !htmlContent.includes('<img'))) {
                showError('Please enter a message or add some media.');
                messageInput.focus();
                return;
            }

            if (textContent.length > 500) {
                showError('Message text is too long. Please keep it under 500 characters.');
                messageInput.focus();
                return;
            }

            // Ensure hidden field is synced before form submits
            if (messageHidden) {
                messageHidden.value = htmlContent || textContent;
            }
            if (messageTextHidden) {
                messageTextHidden.value = textContent;
            }

            // Show loading state
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                showLoading(submitButton);
            }
            isProgrammaticSubmit = true;
            form.submit();
            });
        });
    }

    // Initialize
    messageInput.focus();

    // Utility functions
    function showError(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show';
        alert.innerHTML = `
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.querySelector('main .container').insertBefore(alert, document.querySelector('main .container').firstChild);
        
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    function showInfo(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-info alert-dismissible fade show';
        alert.innerHTML = `
            <i class="fas fa-info-circle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.querySelector('main .container').insertBefore(alert, document.querySelector('main .container').firstChild);
        
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 4000);
    }

    function showLoading(element) {
        element.classList.add('loading');
        element.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    function getNormalizedHtmlContent() {
        if (!messageInput) return '';
        const html = (messageInput.innerHTML || '').trim();
        // Treat editor placeholders/empty markup as empty content.
        if (!html || html === '<br>' || html === '<div><br></div>') {
            return '';
        }
        return html;
    }

    function getNormalizedTextContent() {
        if (!messageInput) return '';
        return (messageInput.textContent || messageInput.innerText || '').replace(/\u00a0/g, ' ').trim();
    }

    // ============================================
    // Replies Screen Functionality
    // ============================================
    
    function initializeReplies() {
        const customerName = customerNameInput ? customerNameInput.value : sessionStorage.getItem('customerName');
        
        // Check for replies on load
        if (customerName) {
            checkForReplies(customerName);
        }
        
        // Handle bell icon click
        if (repliesBellBtn) {
            repliesBellBtn.addEventListener('click', function() {
                const name = customerNameInput ? customerNameInput.value : sessionStorage.getItem('customerName');
                
                if (!name) {
                    showError('Please enter your name first');
                    return;
                }
                
                // Toggle between message form and replies screen
                if (repliesScreen.style.display === 'block') {
                    hideRepliesScreen();
                } else {
                    showRepliesScreen(name);
                }
            });
        }
        
        // Handle refresh replies button
        if (refreshRepliesBtn) {
            refreshRepliesBtn.addEventListener('click', function() {
                const name = customerNameInput ? customerNameInput.value : sessionStorage.getItem('customerName');
                if (name) {
                    loadReplies(name);
                }
            });
        }
        
        // Handle back to message button
        if (backToMessageBtn) {
            backToMessageBtn.addEventListener('click', function() {
                hideRepliesScreen();
            });
        }
        
        // Start periodic reply checking
        if (customerName) {
            startReplyChecking(customerName);
        }
    }
    
    function showRepliesScreen(customerName) {
        if (mainContainer) mainContainer.style.display = 'none';
        if (repliesScreen) repliesScreen.style.display = 'block';
        if (repliesCustomerName) repliesCustomerName.textContent = customerName;
        
        // Update bell button appearance
        if (repliesBellBtn) {
            repliesBellBtn.setAttribute('aria-pressed', 'true');
            repliesBellBtn.classList.remove('btn-outline-light');
            repliesBellBtn.classList.add('btn-light');
        }
        
        loadReplies(customerName);
    }
    
    function hideRepliesScreen() {
        if (repliesScreen) repliesScreen.style.display = 'none';
        if (mainContainer) mainContainer.style.display = 'block';
        
        // Update bell button appearance
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
                if (repliesBellBtn) {
                    repliesBellBtn.classList.add('text-warning');
                }
            } else {
                repliesBadge.style.display = 'none';
                if (repliesBellBtn) {
                    repliesBellBtn.classList.remove('text-warning');
                }
            }
        }
    }
    
    function loadReplies(customerName) {
        // Show loading state in chat
        if (chatMessages) {
            chatMessages.innerHTML = `
                <div class="text-center py-4">
                    <i class="fas fa-spinner fa-spin fa-2x mb-3"></i>
                    <p>Loading your conversation...</p>
                </div>
            `;
        }

        // Disable refresh button
        if (refreshRepliesBtn) {
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
                    if (chatMessages) {
                        chatMessages.innerHTML = `
                            <div class="text-center py-4 text-muted">
                                <i class="fas fa-exclamation-triangle fa-2x mb-3"></i>
                                <p>Failed to load messages. Please try again.</p>
                            </div>
                        `;
                    }
                })
                .finally(() => {
                    // Reset refresh button
                    refreshRepliesBtn.disabled = false;
                    refreshRepliesBtn.innerHTML = originalText;
                });
        }
    }
    
    function displayChatMessages(replies, customerName) {
        if (!chatMessages) return;
        
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
        
        return `
            <div class="mb-3">
                <div class="d-flex justify-content-start">
                    <div class="chat-bubble from-dj" style="max-width: 80%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 16px; border-radius: 18px 18px 18px 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <div class="d-flex align-items-center mb-1">
                            <i class="fas fa-user-tie me-2" style="color: #ffc107;"></i>
                            <strong style="color: #ffc107;">${escapeHtmlReply(window.djName || 'DJ')}</strong>
                            <span class="badge bg-secondary ms-2 small">${escapeHtmlReply(reply.originalType)}</span>
                        </div>
                        <p class="mb-1">${escapeHtmlReply(reply.replyMessage)}</p>
                        <small style="opacity: 0.8;">
                            <i class="fas fa-clock me-1"></i>
                            ${timestamp}
                        </small>
                    </div>
                </div>
            </div>
        `;
    }
    
    function escapeHtmlReply(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Periodically check for new replies
    function startReplyChecking(customerName) {
        // Clear any existing interval
        if (replyCheckInterval) {
            clearInterval(replyCheckInterval);
        }
        
        // Check every 30 seconds
        replyCheckInterval = setInterval(() => {
            checkForReplies(customerName);
        }, 30000);
    }
    
    // Stop checking when leaving the page
    window.addEventListener('beforeunload', function() {
        if (replyCheckInterval) {
            clearInterval(replyCheckInterval);
        }
    });
});
