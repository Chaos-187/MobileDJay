// Karaoke Request Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('karaokeSearch');
    const karaokeList = document.getElementById('karaokeList');
    const noKaraokeFound = document.getElementById('noKaraokeFound');
    const customerNameInput = document.getElementById('customerName');
    const form = document.getElementById('karaokeRequestForm');

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
            searchKaraoke(query);
        }, 300);
    });

    function searchKaraoke(query) {
        if (!query) {
            // Clear results and show instruction message when no query
            karaokeList.innerHTML = '';
            karaokeList.style.display = 'none';
            noKaraokeFound.innerHTML = '<i class="fas fa-search fa-2x mb-2"></i><p>Start typing to search for karaoke songs...</p>';
            noKaraokeFound.style.display = 'block';
            return;
        }

        if (query.length < 3) {
            // Show instruction message for short queries
            karaokeList.innerHTML = '';
            karaokeList.style.display = 'none';
            noKaraokeFound.innerHTML = '<i class="fas fa-info-circle me-2"></i>Please enter at least 3 characters to search karaoke songs.';
            noKaraokeFound.style.display = 'block';
            return;
        }

        // Show loading state
        karaokeList.style.opacity = '0.6';
        noKaraokeFound.style.display = 'none';

        // Make API call to search karaoke
        fetch(`/api/search/karaoke?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(karaoke => {
                displayKaraoke(karaoke);
                karaokeList.style.opacity = '1';
            })
            .catch(error => {
                console.error('Search error:', error);
                showError('Failed to search karaoke songs. Please try again.');
                karaokeList.style.opacity = '1';
            });
    }

    function displayKaraoke(karaoke) {
        if (karaoke.length === 0) {
            karaokeList.style.display = 'none';
            noKaraokeFound.innerHTML = '<i class="fas fa-search me-2"></i>No karaoke songs found matching your search. Try different keywords.';
            noKaraokeFound.style.display = 'block';
            return;
        }

        noKaraokeFound.style.display = 'none';
        karaokeList.style.display = 'block';
        
        karaokeList.innerHTML = karaoke.map(song => {
            const difficultyColor = song.difficulty === 'Easy' ? 'success' : 
                                   song.difficulty === 'Medium' ? 'warning' : 'danger';
            
            return `
                <div class="col-12 karaoke-item fade-in">
                    <div class="karaoke-option" data-karaoke-id="${song.id}">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="karaoke-info">
                                <div class="karaoke-title-artist">
                                    <strong>${escapeHtml(song.title)}</strong>
                                </div>
                                <div class="karaoke-artist">
                                    by ${escapeHtml(song.artist)}
                                </div>
                            </div>
                            <span class="badge bg-${difficultyColor}">
                                ${escapeHtml(song.difficulty)}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Add click event listeners to karaoke options
        document.querySelectorAll('.karaoke-option').forEach(option => {
            option.addEventListener('click', function() {
                // Remove selected class from all options
                document.querySelectorAll('.karaoke-option').forEach(opt => opt.classList.remove('selected'));
                
                // Add selected class to clicked option
                this.classList.add('selected');
                
                // Store the selected karaoke ID
                selectedKaraokeId = this.dataset.karaokeId;
            });
        });
    }

    // Variable to store selected karaoke ID
    let selectedKaraokeId = null;

    // Form submission
    form.addEventListener('submit', function(e) {
        const customerName = customerNameInput.value.trim();

        if (!customerName) {
            e.preventDefault();
            // Redirect back to home page if no customer name
            window.location.href = '/';
            return;
        }

        if (!selectedKaraokeId) {
            e.preventDefault();
            showError('Please select a karaoke song.');
            document.querySelector('.scrollable-results').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // Create a hidden input with the selected karaoke ID
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'karaokeId';
        hiddenInput.value = selectedKaraokeId;
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

    // Show error message function
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
});
