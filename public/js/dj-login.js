(function () {
    const form = document.getElementById('djLoginForm');
    const errEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const nextUrl = window.__MDJ_LOGIN_NEXT__ || '/dj';

    function showError(msg) {
        if (!errEl) return;
        errEl.textContent = msg;
        errEl.classList.remove('d-none');
    }

    function turnstileToken() {
        const input = form && form.querySelector('input[name="cf-turnstile-response"]');
        return input && input.value ? input.value : null;
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errEl.classList.add('d-none');
        submitBtn.disabled = true;
        try {
            const body = {
                email: document.getElementById('loginEmail').value.trim(),
                password: document.getElementById('loginPassword').value
            };
            const ts = turnstileToken();
            if (ts) body.cf_turnstile_response = ts;

            const res = await fetch('/dj/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showError(data.error || 'Sign in failed');
                if (window.turnstile && typeof window.turnstile.reset === 'function') {
                    try { window.turnstile.reset(); } catch (_) {}
                }
                return;
            }
            window.location.href = nextUrl.startsWith('/') ? nextUrl : '/dj';
        } catch (_) {
            showError('Network error — try again');
        } finally {
            submitBtn.disabled = false;
        }
    });
})();
