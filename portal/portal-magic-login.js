/**
 * One-time magic sign-in links for customer portal onboarding (Brevo emails).
 */

const { portalDb } = require('../db/portal-database');
const brevoMail = require('./brevo-mail');

function magicLoginUrlForToken(token) {
    const base = brevoMail.portalLoginUrl();
    try {
        const u = new URL(base);
        u.searchParams.set('magic', String(token));
        return u.toString();
    } catch {
        const sep = base.indexOf('?') >= 0 ? '&' : '?';
        return `${base}${sep}magic=${encodeURIComponent(String(token))}`;
    }
}

function issueCustomerMagicLoginLink(userId, ttlMinutes) {
    const issued = portalDb.createMagicLoginToken(userId, ttlMinutes);
    if (!issued || !issued.token) {
        const err = new Error('Could not create magic sign-in link');
        err.code = 'magic_link_failed';
        throw err;
    }
    return {
        url: magicLoginUrlForToken(issued.token),
        expires_at: issued.expires_at
    };
}

module.exports = {
    magicLoginUrlForToken,
    issueCustomerMagicLoginLink
};
