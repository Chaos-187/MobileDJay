// Send Message - Inline GIF System for Android GBoard

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const messageInput = document.getElementById('messageInput');
    const messageHidden = document.getElementById('message');
    const charCount = document.getElementById('charCount');
    const form = document.getElementById('messageForm');
    const clearBtn = document.getElementById('clearBtn');

    // Check if required elements exist
    if (!messageInput) {
        console.error('messageInput element not found');
        return;
    }

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
        const htmlContent = messageInput.innerHTML;
        const textContent = messageInput.textContent || messageInput.innerText || '';
        const hasMedia = htmlContent.includes('<img') || htmlContent.includes('data:image');
        
        // Store HTML content for server processing
        if (messageHidden) {
            messageHidden.value = htmlContent;
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
        form.addEventListener('submit', function(e) {
            const customerName = customerNameInput ? customerNameInput.value.trim() : '';
            const htmlContent = messageInput.innerHTML;
            const textContent = messageInput.textContent || messageInput.innerText || '';

            if (!customerName) {
                e.preventDefault();
                window.location.href = '/';
                return;
            }

            if (!htmlContent || (!textContent && !htmlContent.includes('<img'))) {
                e.preventDefault();
                showError('Please enter a message or add some media.');
                messageInput.focus();
                return;
            }

            if (textContent.length > 500) {
                e.preventDefault();
                showError('Message text is too long. Please keep it under 500 characters.');
                messageInput.focus();
                return;
            }

            // Show loading state
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                showLoading(submitButton);
            }
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
});
