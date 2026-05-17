const { OAuth2Client } = require('google-auth-library');

/**
 * Accepted OAuth audiences (typically one Web application client ID from Google Cloud Console).
 * Comma-/whitespace-separated for multiple client IDs (e.g. staging + prod).
 */
function getAcceptedAudiences() {
    const raw =
        process.env.PORTAL_GOOGLE_CLIENT_IDS ||
        process.env.PORTAL_GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        '';
    return String(raw)
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function isGoogleSignInConfigured() {
    return getAcceptedAudiences().length > 0;
}

/**
 * Verify a Google Identity Services credential (JWT id_token).
 * @returns {{ email: string, emailVerified: boolean, subject: string }}
 */
async function verifyGoogleIdToken(idToken) {
    const audiences = getAcceptedAudiences();
    if (audiences.length === 0) {
        const err = new Error('Google Sign-In is not configured on this server');
        err.code = 'GOOGLE_NOT_CONFIGURED';
        throw err;
    }
    const client = new OAuth2Client();
    let ticket;
    try {
        ticket = await client.verifyIdToken({
            idToken,
            audience: audiences.length === 1 ? audiences[0] : audiences
        });
    } catch {
        const err = new Error('invalid id_token');
        err.code = 'INVALID_GOOGLE_TOKEN';
        throw err;
    }
    const payload = ticket.getPayload();
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    return {
        email,
        emailVerified,
        subject: payload.sub || ''
    };
}

module.exports = { verifyGoogleIdToken, getAcceptedAudiences, isGoogleSignInConfigured };
