// Guest chat — WhatsApp-style message thread with inline GIF support

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const messageInput = document.getElementById('messageInput');
    const messageHidden = document.getElementById('message');
    const messageTextHidden = document.getElementById('messageText');
    const charCount = document.getElementById('charCount');
    const form = document.getElementById('messageForm');
    const sendBtn = document.getElementById('sendBtn');
    const djOnlyCheckbox = document.getElementById('djOnly');
    const chatMessages = document.getElementById('chatMessages');

    if (!messageInput || !chatMessages) {
        console.error('Guest chat: required elements missing');
        return;
    }

    let pollInterval = null;
    let lastTimelineKey = '';
    let isSending = false;
    let compositionData = '';

    const guestSession = window.MdjGuestSession;

    const customerName = getCustomerName();
    if (!customerName) {
        window.location.href = window.eventSlug ? `/event/${window.eventSlug}` : '/';
        return;
    }

    if (customerNameInput && !customerNameInput.value) {
        customerNameInput.value = customerName;
    }
    if (guestSession) {
        guestSession.setGuestName(window.eventSlug, customerName);
    } else {
        sessionStorage.setItem('customerName', customerName);
    }

    initializeInlineGifSystem();
    loadTimeline(true);
    startPolling();

    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            sendMessage();
        });
    }

    messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    window.addEventListener('beforeunload', function() {
        if (pollInterval) clearInterval(pollInterval);
    });

    function getCustomerName() {
        const fromInput = customerNameInput ? customerNameInput.value.trim() : '';
        if (fromInput) return fromInput;
        if (guestSession) return guestSession.getGuestName(window.eventSlug);
        return (sessionStorage.getItem('customerName') || '').trim();
    }

    function activityUrl() {
        if (guestSession) return guestSession.activityUrl(customerName, window.eventSlug);
        const base = `/api/customer/activity/${encodeURIComponent(customerName)}`;
        return window.eventSlug
            ? `${base}?eventSlug=${encodeURIComponent(window.eventSlug)}`
            : base;
    }

    function loadTimeline(scrollToBottom) {
        fetch(activityUrl())
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to load');
                return response.json();
            })
            .then(function(data) {
                const items = data.items || buildItemsFromLegacy(data);
                renderTimeline(items, scrollToBottom);
            })
            .catch(function(err) {
                console.error('Error loading timeline:', err);
                chatMessages.innerHTML = `
                    <div class="guest-chat-thread__empty">
                        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
                        <p class="mb-0">Could not load messages. Pull to refresh or try again.</p>
                    </div>`;
            });
    }

    function buildItemsFromLegacy(data) {
        const items = [];
        const guestMsgs = data.messages || data.guestMessages || [];
        guestMsgs.forEach(function(m) { items.push(Object.assign({ kind: 'message' }, m)); });
        (data.replies || []).forEach(function(r) { items.push(Object.assign({ kind: 'reply' }, r)); });
        (data.requests || []).forEach(function(r) { items.push(Object.assign({ kind: 'request' }, r)); });
        items.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
        return items;
    }

    function timelineKey(items) {
        if (!items.length) return 'empty';
        const last = items[items.length - 1];
        return items.length + ':' + last.kind + ':' + last.id + ':' + last.timestamp;
    }

    function renderTimeline(items, scrollToBottom) {
        const key = timelineKey(items);
        if (key === lastTimelineKey && !scrollToBottom) return;
        lastTimelineKey = key;

        if (!items.length) {
            chatMessages.innerHTML = `
                <div class="guest-chat-thread__empty">
                    <i class="fas fa-comments" aria-hidden="true"></i>
                    <h5 class="mb-2">Say hi to the DJ</h5>
                    <p class="mb-0 small">Your messages appear here. Song requests and DJ replies show up in this thread too.</p>
                </div>`;
            return;
        }

        chatMessages.innerHTML = items.map(renderItem).join('');
        if (scrollToBottom !== false) {
            scrollChatToBottom();
        }
    }

    function renderItem(item) {
        if (item.kind === 'message') return renderGuestMessage(item);
        if (item.kind === 'reply') return renderDjReply(item);
        if (item.kind === 'request') return renderRequest(item);
        return '';
    }

    function renderGuestMessage(item) {
        const body = item.body || item.textMessage || '';
        const when = formatTime(item.timestamp);
        const privateBadge = item.private
            ? '<span class="badge bg-dark ms-1" style="font-size:0.65rem"><i class="fas fa-user-lock me-1"></i>Private</span>'
            : '';

        return `
            <div class="guest-chat-row guest-chat-row--out" data-id="${escapeAttr(item.id)}">
                <div class="guest-chat-bubble guest-chat-bubble--out">
                    <div class="guest-chat-bubble__head">
                        <span>You</span>${privateBadge}
                    </div>
                    <div class="guest-chat-bubble__body">${body}</div>
                    <span class="guest-chat-bubble__meta">${when}</span>
                </div>
            </div>`;
    }

    function renderDjReply(item) {
        const when = formatTime(item.timestamp);
        const typeBadge = item.originalType
            ? `<span class="badge bg-secondary ms-1" style="font-size:0.65rem">${escapeHtml(item.originalType)}</span>`
            : '';
        const directBadge = item.direct
            ? '<span class="badge bg-dark ms-1" style="font-size:0.65rem"><i class="fas fa-user-lock me-1"></i>Just for you</span>'
            : '';

        return `
            <div class="guest-chat-row guest-chat-row--in" data-id="${escapeAttr(item.id)}">
                <div class="guest-chat-bubble guest-chat-bubble--in">
                    <div class="guest-chat-bubble__head">
                        <i class="fas fa-user-tie" aria-hidden="true"></i>
                        <span>${escapeHtml(window.djName || 'DJ')}</span>${typeBadge}${directBadge}
                    </div>
                    <div class="guest-chat-bubble__body">${escapeHtml(item.body || item.replyMessage || '')}</div>
                    <span class="guest-chat-bubble__meta">${when}</span>
                </div>
            </div>`;
    }

    function renderRequest(item) {
        const when = formatTime(item.timestamp);
        const isKaraoke = (item.type || '').indexOf('karaoke') !== -1;
        const icon = isKaraoke ? 'microphone' : 'music';
        const label = isKaraoke ? 'Karaoke' : 'Song';
        const title = escapeHtml(item.title || 'Unknown');
        const artist = item.artist ? ' by ' + escapeHtml(item.artist) : '';
        const note = item.message || item.note
            ? `<p class="mb-1 small fst-italic">"${escapeHtml(item.message || item.note)}"</p>`
            : '';

        return `
            <div class="guest-chat-row guest-chat-row--out" data-id="${escapeAttr(item.id)}">
                <div class="guest-chat-bubble guest-chat-bubble--request">
                    <div class="guest-chat-bubble__head">
                        <i class="fas fa-${icon}" aria-hidden="true"></i>
                        <span>You requested</span>
                        <span class="badge bg-secondary ms-1" style="font-size:0.65rem">${label}</span>
                    </div>
                    <div class="guest-chat-bubble__body">
                        <p class="mb-1">"${title}"${artist}</p>
                        ${note}
                    </div>
                    <span class="guest-chat-bubble__meta">${when}</span>
                </div>
            </div>`;
    }

    function sendMessage() {
        if (isSending) return;

        if (document.activeElement === messageInput) {
            messageInput.blur();
        }

        window.requestAnimationFrame(function() {
            updateContent();
            const htmlContent = getNormalizedHtmlContent();
            const textContent = getNormalizedTextContent();

            if (!htmlContent || (!textContent && !htmlContent.includes('<img'))) {
                showToast('Please enter a message or add some media.', 'error');
                messageInput.focus();
                return;
            }

            if (textContent.length > 500) {
                showToast('Message is too long. Keep it under 500 characters.', 'error');
                messageInput.focus();
                return;
            }

            isSending = true;
            if (sendBtn) sendBtn.disabled = true;

            const payload = {
                customerName: customerName,
                message: htmlContent,
                messageText: textContent,
                eventSlug: window.eventSlug || '',
                djOnly: djOnlyCheckbox && djOnlyCheckbox.checked
            };

            fetch('/api/customer/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function(response) {
                    return response.json().then(function(data) {
                        if (!response.ok) throw new Error(data.error || 'Send failed');
                        return data;
                    });
                })
                .then(function() {
                    messageInput.innerHTML = '';
                    updateContent();
                    if (djOnlyCheckbox) djOnlyCheckbox.checked = false;
                    lastTimelineKey = '';
                    loadTimeline(true);
                    messageInput.focus();
                })
                .catch(function(err) {
                    showToast(err.message || 'Failed to send. Please try again.', 'error');
                })
                .finally(function() {
                    isSending = false;
                    if (sendBtn) sendBtn.disabled = false;
                });
        });
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(function() {
            loadTimeline(false);
        }, 15000);
    }

    function scrollChatToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function formatTime(ts) {
        try {
            return new Date(ts).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch (e) {
            return '';
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function escapeAttr(text) {
        return escapeHtml(text).replace(/"/g, '&quot;');
    }

    function showToast(message, type) {
        const existing = document.querySelector('.guest-chat-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'guest-chat-toast guest-chat-toast--' + (type || 'info');
        toast.setAttribute('role', 'alert');
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(function() {
            toast.remove();
        }, type === 'error' ? 5000 : 3500);
    }

    // ---------- Inline GIF / rich content (GBoard, paste) ----------

    function initializeInlineGifSystem() {
        messageInput.addEventListener('input', updateContent);
        messageInput.addEventListener('beforeinput', handleBeforeInput);
        messageInput.addEventListener('paste', handlePaste);
        messageInput.addEventListener('compositionstart', handleCompositionStart);
        messageInput.addEventListener('compositionupdate', handleCompositionUpdate);
        messageInput.addEventListener('compositionend', handleCompositionEnd);
        updateContent();
    }

    function handleBeforeInput(e) {
        if (e.inputType === 'insertCompositionText' || e.inputType === 'insertText') return;
        if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') return;
        if (e.data && (e.data.includes('http') || e.data.includes('data:'))) {
            setTimeout(processRichContent, 10);
        }
    }

    function handleCompositionStart() {
        compositionData = '';
    }

    function handleCompositionUpdate(e) {
        compositionData = e.data || '';
    }

    function handleCompositionEnd(e) {
        const finalData = e.data || compositionData;
        if (finalData && (finalData.includes('http') || finalData.includes('data:'))) {
            setTimeout(processRichContent, 50);
        }
    }

    function handlePaste(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let hasFiles = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                hasFiles = true;
                const file = item.getAsFile();
                if (file) insertImageInline(file);
            }
        }

        if (!hasFiles) {
            setTimeout(processRichContent, 10);
        }
    }

    function processRichContent() {
        const content = messageInput.innerHTML;
        const urlPattern = /(https?:\/\/[^\s<>"]+\.(gif|jpg|jpeg|png|webp))/gi;
        const tenorPattern = /(https?:\/\/tenor\.com\/[^\s<>"]+)/gi;
        const giphyPattern = /(https?:\/\/giphy\.com\/[^\s<>"]+)/gi;

        let modified = false;
        let newContent = content;

        newContent = newContent.replace(urlPattern, function(match, url) {
            modified = true;
            return insertMediaUrlInline(url);
        });

        newContent = newContent.replace(tenorPattern, function(match, url) {
            modified = true;
            const tenorId = url.split('/').pop();
            return insertMediaUrlInline('https://tenor.com/view/' + tenorId + '.gif');
        });

        newContent = newContent.replace(giphyPattern, function(match, url) {
            modified = true;
            const giphyId = url.split('/').pop().split('-').pop();
            return insertMediaUrlInline('https://i.giphy.com/media/' + giphyId + '/giphy.gif');
        });

        if (modified) {
            messageInput.innerHTML = newContent;
            updateContent();
        }
    }

    function insertImageInline(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'inline-media';
            img.alt = file.name;

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

    function insertMediaUrlInline(url) {
        return '<img src="' + url + '" class="inline-media" alt="Inline media" loading="lazy">';
    }

    function updateContent() {
        const htmlContent = getNormalizedHtmlContent();
        const textContent = getNormalizedTextContent();

        if (messageHidden) messageHidden.value = htmlContent;
        if (messageTextHidden) messageTextHidden.value = textContent;

        if (charCount) {
            charCount.textContent = textContent.length + '/500';
            charCount.classList.remove('is-warn', 'is-over');
            if (textContent.length > 500) {
                charCount.classList.add('is-over');
            } else if (textContent.length > 450) {
                charCount.classList.add('is-warn');
            }
        }
    }

    function getNormalizedHtmlContent() {
        const html = (messageInput.innerHTML || '').trim();
        if (!html || html === '<br>' || html === '<div><br></div>') return '';
        return html;
    }

    function getNormalizedTextContent() {
        return (messageInput.textContent || messageInput.innerText || '').replace(/\u00a0/g, ' ').trim();
    }
});
