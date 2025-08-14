// Song Request Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('songSearch');
    const songList = document.getElementById('songList');
    const noSongsFound = document.getElementById('noSongsFound');
    const customerNameInput = document.getElementById('customerName');
    const form = document.getElementById('songRequestForm');

    // Auto-fill customer name from session storage (fallback)
    if (!customerNameInput.value && sessionStorage.getItem('customerName')) {
        customerNameInput.value = sessionStorage.getItem('customerName');
    }

    // Search functionality
    let searchTimeout;
    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const query = this.value.trim();
        
        // Debounce search to avoid too many requests
        searchTimeout = setTimeout(() => {
            searchSongs(query);
        }, 300);
    });

    function searchSongs(query) {
        if (!query) {
            // Show initial message when no query
            songList.innerHTML = `
                <div class="col-12">
                    <div class="text-center text-muted py-4">
                        <i class="fas fa-search fa-3x mb-3"></i>
                        <h5>Search for Songs</h5>
                        <p>Enter at least 3 characters to start searching through our music library</p>
                    </div>
                </div>
            `;
            noSongsFound.style.display = 'none';
            return;
        }

        if (query.length < 3) {
            // Show message to enter at least 3 characters
            songList.innerHTML = `
                <div class="col-12">
                    <div class="text-center text-muted py-4">
                        <i class="fas fa-search fa-2x mb-2"></i>
                        <p>Please enter at least 3 characters to search</p>
                    </div>
                </div>
            `;
            noSongsFound.style.display = 'none';
            return;
        }

        // Show loading state
        songList.style.opacity = '0.6';

        // Make API call to search songs
        fetch(`/api/search/songs?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(songs => {
                displaySongs(songs);
                songList.style.opacity = '1';
            })
            .catch(error => {
                console.error('Search error:', error);
                showError('Failed to search songs. Please try again.');
                songList.style.opacity = '1';
            });
    }

    function displaySongs(songs) {
        if (songs.length === 0) {
            songList.style.display = 'none';
            noSongsFound.style.display = 'block';
            return;
        }

        noSongsFound.style.display = 'none';
        songList.style.display = 'block';
        
        songList.innerHTML = songs.map(song => `
            <div class="col-12 song-item fade-in">
                <div class="song-option" data-song-id="${song.id}">
                    <div class="song-info">
                        <div class="song-title-artist">
                            <strong>${escapeHtml(song.title)}</strong> - ${escapeHtml(song.artist)}
                        </div>
                        <div class="song-album-row">
                            <span class="badge bg-secondary">${escapeHtml(song.genre)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        // Add click event listeners to song options
        document.querySelectorAll('.song-option').forEach(option => {
            option.addEventListener('click', function() {
                // Remove selected class from all options
                document.querySelectorAll('.song-option').forEach(opt => opt.classList.remove('selected'));
                
                // Add selected class to clicked option
                this.classList.add('selected');
                
                // Store the selected song ID
                selectedSongId = this.dataset.songId;
            });
        });
    }

    // Variable to store selected song ID
    let selectedSongId = null;

    // Form submission
    form.addEventListener('submit', function(e) {
        const customerName = customerNameInput.value.trim();

        if (!customerName) {
            e.preventDefault();
            // Redirect back to home page if no customer name
            window.location.href = '/';
            return;
        }

        if (!selectedSongId) {
            e.preventDefault();
            showError('Please select a song.');
            document.querySelector('.scrollable-results').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // Create a hidden input with the selected song ID
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'songId';
        hiddenInput.value = selectedSongId;
        form.appendChild(hiddenInput);

        // Show loading state
        const submitButton = form.querySelector('button[type="submit"]');
        const originalText = submitButton.innerHTML;
        showLoading(submitButton);
    });

    // Check for replies functionality
    if (checkRepliesBtn) {
        console.log('Check replies button found and event listener added');
        checkRepliesBtn.addEventListener('click', function() {
            console.log('Check replies button clicked'); // Debug log
            alert('Button clicked! Testing...'); // Temporary alert for debugging
            
            const customerName = customerNameInput.value.trim() || sessionStorage.getItem('customerName');
            console.log('Customer name:', customerName);
            
            if (!customerName) {
                showError('Please enter your name first.');
                return;
            }

            // Show loading state
            const originalText = checkRepliesBtn.innerHTML;
            checkRepliesBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Checking...';
            checkRepliesBtn.disabled = true;

            console.log('Fetching replies for:', customerName); // Debug log

            fetch(`/api/customer/replies/${encodeURIComponent(customerName)}`)
                .then(response => {
                    console.log('Response received:', response); // Debug log
                    return response.json();
                })
                .then(replies => {
                    console.log('Replies data:', replies); // Debug log
                    showReplies(replies, customerName);
                })
                .catch(error => {
                    console.error('Error fetching replies:', error);
                    showError('Failed to check for replies. Please try again.');
                })
                .finally(() => {
                    checkRepliesBtn.innerHTML = originalText;
                    checkRepliesBtn.disabled = false;
                });
        });
    } else {
        console.error('Check replies button not found');
    }

    // Show replies in a modal-like display
    function showReplies(replies, customerName) {
        // Remove existing replies display
        const existingReplies = document.getElementById('repliesDisplay');
        if (existingReplies) {
            existingReplies.remove();
        }

        if (replies.length === 0) {
            showSuccess('No DJ replies yet. The DJ will respond to your requests when possible!');
            return;
        }

        // Create replies display
        const repliesHtml = `
            <div id="repliesDisplay" class="card mt-4 border-success">
                <div class="card-header bg-success text-white">
                    <h5 class="mb-0">
                        <i class="fas fa-reply me-2"></i>DJ Replies for ${customerName}
                    </h5>
                </div>
                <div class="card-body">
                    ${replies.map(reply => `
                        <div class="alert alert-success border-start border-4 border-success">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="flex-grow-1">
                                    <h6 class="mb-1">
                                        <i class="fas fa-user-tie me-1"></i>DJ Reply
                                        <span class="badge bg-success ms-2">${reply.originalType}</span>
                                    </h6>
                                    <p class="mb-2">${escapeHtml(reply.replyMessage)}</p>
                                    <small class="text-muted">
                                        <i class="fas fa-clock me-1"></i>
                                        ${new Date(reply.timestamp).toLocaleString()}
                                    </small>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    <div class="text-center mt-3">
                        <button type="button" class="btn btn-outline-success" onclick="document.getElementById('repliesDisplay').remove()">
                            <i class="fas fa-times me-2"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Insert after the form
        form.insertAdjacentHTML('afterend', repliesHtml);
        
        // Scroll to replies
        document.getElementById('repliesDisplay').scrollIntoView({ behavior: 'smooth' });
        
        showSuccess(`Found ${replies.length} DJ reply(s) for you!`);
    }

    // Show success message function
    function showSuccess(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-success alert-dismissible fade show';
        alert.innerHTML = `
            <i class="fas fa-check-circle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.querySelector('main .container').insertBefore(alert, document.querySelector('main .container').firstChild);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    // Utility function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Show success message function (from app.js)
    function showError(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show';
        alert.innerHTML = `
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.querySelector('main .container').insertBefore(alert, document.querySelector('main .container').firstChild);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            alert.remove();
        }, 5000);
    }

    function showLoading(element) {
        element.classList.add('loading');
        element.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    }

    // Initialize the page with search prompt
    searchSongs('');
});
