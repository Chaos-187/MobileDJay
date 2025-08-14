// Send Message Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const customerNameInput = document.getElementById('customerName');
    const messageTextarea = document.getElementById('message');
    const charCount = document.getElementById('charCount');
    const form = document.getElementById('messageForm');
    const templateButtons = document.querySelectorAll('.template-btn');

    // Auto-fill customer name from session storage (fallback)
    if (!customerNameInput.value && sessionStorage.getItem('customerName')) {
        customerNameInput.value = sessionStorage.getItem('customerName');
    }

    // Character counter for message textarea
    messageTextarea.addEventListener('input', function() {
        const currentLength = this.value.length;
        charCount.textContent = currentLength;
        
        // Change color based on character count
        if (currentLength > 450) {
            charCount.style.color = '#dc3545'; // Red when approaching limit
        } else if (currentLength > 400) {
            charCount.style.color = '#ffc107'; // Yellow when getting close
        } else {
            charCount.style.color = '#6c757d'; // Default gray
        }
        
        // Update character count on load
        if (currentLength === 0) {
            updateCharCount();
        }
    });

    // Template button functionality
    templateButtons.forEach(button => {
        button.addEventListener('click', function() {
            const template = this.dataset.template;
            messageTextarea.value = template;
            messageTextarea.focus();
            updateCharCount();
            
            // Add visual feedback
            this.classList.add('btn-info');
            this.classList.remove('btn-outline-info');
            
            setTimeout(() => {
                this.classList.remove('btn-info');
                this.classList.add('btn-outline-info');
            }, 1000);
        });
    });

    // Form submission
    form.addEventListener('submit', function(e) {
        const customerName = customerNameInput.value.trim();
        const message = messageTextarea.value.trim();

        if (!customerName) {
            e.preventDefault();
            // Redirect back to home page if no customer name
            window.location.href = '/';
            return;
        }

        if (!message) {
            e.preventDefault();
            showError('Please enter a message.');
            messageTextarea.focus();
            return;
        }

        if (message.length > 500) {
            e.preventDefault();
            showError('Message is too long. Please keep it under 500 characters.');
            messageTextarea.focus();
            return;
        }

        // Show loading state
        const submitButton = form.querySelector('button[type="submit"]');
        showLoading(submitButton);
    });

    function updateCharCount() {
        const currentLength = messageTextarea.value.length;
        charCount.textContent = currentLength;
        
        if (currentLength > 450) {
            charCount.style.color = '#dc3545';
        } else if (currentLength > 400) {
            charCount.style.color = '#ffc107';
        } else {
            charCount.style.color = '#6c757d';
        }
    }

    // Initialize character count
    updateCharCount();

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
        element.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
});
