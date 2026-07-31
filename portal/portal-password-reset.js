/**
 * Forgot-password reset links (Brevo email + consume sets new password).
 */

const { portalDb } = require('../db/portal-database');
const brevoMail = require('./brevo-mail');

function passwordResetUrlForToken(token) {
    const base = brevoMail.portalLoginUrl();
    try {
        const u = new URL(base);
        u.searchParams.set('reset', String(token));
        return u.toString();
    } catch {
        const sep = base.indexOf('?') >= 0 ? '&' : '?';
        return `${base}${sep}reset=${encodeURIComponent(String(token))}`;
    }
}

async function sendPasswordResetEmail(user, issued) {
    if (!issued || !issued.token) {
        const err = new Error('Could not create password reset link');
        err.code = 'password_reset_failed';
        throw err;
    }
    const reset_link = passwordResetUrlForToken(issued.token);
    return brevoMail.sendCustomerTemplateEmail({
        templateKey: 'password_reset',
        user,
        params: { reset_link, login_link: reset_link },
        tags: ['eyup-portal', 'password_reset']
    });
}

module.exports = {
    passwordResetUrlForToken,
    sendPasswordResetEmail
};
