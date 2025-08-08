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
