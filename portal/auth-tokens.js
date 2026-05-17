const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const BCRYPT_ROUNDS = 10;

const MIN_PORTAL_PASSWORD_LENGTH = 8;

/** Validates a new password plain string (registration, change-password, admin set). */
function validatePortalPasswordPlain(plain) {
    const s = String(plain ?? '');
    if (!s) {
        return { ok: false, message: 'password is required' };
    }
    if (s.length < MIN_PORTAL_PASSWORD_LENGTH) {
        return {
            ok: false,
            message: `password must be at least ${MIN_PORTAL_PASSWORD_LENGTH} characters`
        };
    }
    return { ok: true };
}

function getJwtSecret() {
    const s = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET;
    if (s) return s;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('PORTAL_JWT_SECRET must be set in production');
    }
    return 'dev-portal-jwt-secret-change-me';
}

function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
    if (!hash || !plain) return false;
    return bcrypt.compare(plain, hash);
}

function signAccessToken(user) {
    const secret = getJwtSecret();
    const expiresIn = process.env.PORTAL_JWT_EXPIRES_IN || '7d';
    return jwt.sign(
        { sub: user.id, role: user.role, email: user.email },
        secret,
        { expiresIn, jwtid: crypto.randomUUID() }
    );
}

function verifyAccessToken(token) {
    const secret = getJwtSecret();
    return jwt.verify(token, secret);
}

module.exports = {
    MIN_PORTAL_PASSWORD_LENGTH,
    validatePortalPasswordPlain,
    hashPassword,
    verifyPassword,
    signAccessToken,
    verifyAccessToken,
    getJwtSecret
};
