/**
 * Cloudflare Turnstile server-side verification.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Set CLOUDFLARE_TURNSTILE_SECRET_KEY (or TURNSTILE_SECRET_KEY) on the API host.
 * When unset, verification is skipped (local dev). When set, POST /auth/login, POST /auth/login/google,
 * and /auth/register require a valid cf_turnstile_response token from the client.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function getSecret() {
    const s = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY;
    return s != null && String(s).trim() !== '' ? String(s).trim() : '';
}

function isEnforced() {
    return getSecret().length > 0;
}

function clientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) {
        return xf.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || '';
}

/**
 * @returns {Promise<{ ok: boolean, skipped: boolean, errorCodes?: string[] }>}
 */
async function verifyTurnstile(req, token) {
    const secret = getSecret();
    if (!secret) {
        return { ok: true, skipped: true };
    }
    if (token == null || typeof token !== 'string' || !token.trim()) {
        return { ok: false, skipped: false, errorCodes: ['missing-input-response'] };
    }
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token.trim());
    const ip = clientIp(req);
    if (ip) body.set('remoteip', ip);

    const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    if (!res.ok) {
        return { ok: false, skipped: false, errorCodes: ['internal-http-error'] };
    }
    const data = await res.json();
    const codes = data['error-codes'] || data.error_codes || [];
    if (!data.success) {
        return { ok: false, skipped: false, errorCodes: Array.isArray(codes) ? codes : [String(codes)] };
    }
    return { ok: true, skipped: false };
}

module.exports = { verifyTurnstile, isEnforced, getSecret, clientIp };
