/**
 * Authenticated fetch for DJ portal pages (cookie session).
 */
(function () {
    function loginRedirect() {
        const next = window.location.pathname + window.location.search;
        window.location.href = '/dj/login?next=' + encodeURIComponent(next);
    }

    window.mdjFetch = function mdjFetch(url, options) {
        const opts = Object.assign({ credentials: 'include' }, options || {});
        return fetch(url, opts).then(function (res) {
            if (res.status === 401) {
                loginRedirect();
                return Promise.reject(new Error('Sign in required'));
            }
            return res;
        });
    };

    window.mdjLogout = async function mdjLogout() {
        try {
            await window.mdjFetch('/dj/auth/logout', { method: 'POST' });
        } catch (_) {
            /* redirect may already have fired */
        }
        window.location.href = '/dj/login';
    };
})();
