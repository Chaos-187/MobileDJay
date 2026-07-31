/**
 * In-memory rate limit for POST /auth/forgot-password (per IP + normalized email).
 */

const buckets = new Map();

function windowMs() {
    const raw = parseInt(process.env.PORTAL_FORGOT_PASSWORD_RATE_WINDOW_MS || '3600000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 3600000;
}

function maxAttempts() {
    const raw = parseInt(process.env.PORTAL_FORGOT_PASSWORD_RATE_MAX || '5', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function clientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) {
        return xf.split(',')[0].trim();
    }
    if (req.ip) return String(req.ip);
    if (req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
    return 'unknown';
}

function bucketKey(req, emailNorm) {
    return `${clientIp(req)}:${String(emailNorm || '').toLowerCase()}`;
}

/** @returns {boolean} true if request is allowed */
function allowForgotPasswordAttempt(req, emailNorm) {
    const key = bucketKey(req, emailNorm);
    const now = Date.now();
    const win = windowMs();
    const max = maxAttempts();
    let entry = buckets.get(key);
    if (!entry || now - entry.start >= win) {
        entry = { start: now, count: 0 };
    }
    entry.count += 1;
    buckets.set(key, entry);
    if (buckets.size > 5000) {
        for (const [k, v] of buckets) {
            if (now - v.start >= win) buckets.delete(k);
        }
    }
    return entry.count <= max;
}

module.exports = {
    allowForgotPasswordAttempt
};
