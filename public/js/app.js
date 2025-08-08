// MobileDJay Main JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const nameSubmitBtn = document.getElementById('nameSubmitBtn');
    const nameInputCard = document.getElementById('nameInputCard');
    const optionsContainer = document.getElementById('optionsContainer');
    const welcomeName = document.getElementById('welcomeName');
    const editNameBtn = document.getElementById('editNameBtn');
    const optionCards = document.querySelectorAll('.option-card');

    // Check if user already has a name stored and show appropriate view
    const storedName = sessionStorage.getItem('customerName');
    const urlParams = new URLSearchParams(window.location.search);
    const editMode = urlParams.get('edit') === 'true';
    
    if (storedName && !editMode) {
        customerNameInput.value = storedName;
        showOptionsView(storedName);
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
            const target = this.dataset.target;
            
            if (!customerName) {
                showError('Please enter your name first');
                showNameView();
                return;
            }
            
            // Navigate to target page with customer name as query parameter
            window.location.href = `/${target}?customerName=${encodeURIComponent(customerName)}`;
        });
    });

    function showOptionsView(customerName) {
        nameInputCard.style.display = 'none';
        welcomeName.textContent = customerName;
        optionsContainer.style.display = 'block';
        optionsContainer.classList.add('fade-in');
    }

    function showNameView() {
        optionsContainer.style.display = 'none';
        nameInputCard.style.display = 'block';
        customerNameInput.focus();
    }

    // Clear session storage when going back to home
    if (window.location.pathname === '/') {
        // Don't clear immediately, wait a bit in case user is navigating
        setTimeout(() => {
            if (window.location.pathname === '/') {
                // Only clear if user hasn't interacted with the page
                if (!storedName) {
                    sessionStorage.removeItem('customerName');
                }
            }
        }, 1000);
    }
});

// Utility function to show loading state
function showLoading(element) {
    element.classList.add('loading');
    element.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
}

// Utility function to hide loading state
function hideLoading(element, originalText) {
    element.classList.remove('loading');
    element.innerHTML = originalText;
}

// Utility function to show success message
function showSuccess(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-success alert-dismissible fade show success-bounce';
    alert.innerHTML = `
        <i class="fas fa-check-circle me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.querySelector('main .container').insertBefore(alert, document.querySelector('main .container').firstChild);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// Utility function to show error message
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
