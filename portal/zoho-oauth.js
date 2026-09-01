/**
 * Zoho Books OAuth — admin "Connect" flow stores refresh token in SQLite.
 * @see docs/zoho-books-integration.md
 */

const crypto = require('crypto');
const { portalDb, uuid, nowIso } = require('../db/portal-database');
const zohoBooks = require('./zoho-books');

const OAUTH_PURPOSE = 'zoho_books';
const STATE_TTL_MS = 15 * 60 * 1000;
const SCOPES =
    'ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.estimates.ALL,ZohoBooks.settings.ALL';

function apiPublicOrigin() {
    const explicit =
        process.env.PORTAL_API_PUBLIC_ORIGIN ||
        process.env.ZOHO_BOOKS_OAUTH_API_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    return 'https://requests.eyupevents.uk';
}

function portalPublicOrigin() {
    const explicit =
        process.env.PORTAL_PUBLIC_ORIGIN ||
        process.env.EYUP_PORTAL_PUBLIC_ORIGIN ||
        process.env.STRIPE_CHECKOUT_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    const cors = process.env.PORTAL_CORS_ORIGINS || '';
    const first = cors
        .split(',')
        .map((s) => s.trim())
        .find((o) => o && /^https?:\/\//i.test(o));
    return first ? first.replace(/\/$/, '') : 'https://eyupevents.uk';
}

function oauthRedirectUri() {
    const explicit = process.env.ZOHO_BOOKS_OAUTH_REDIRECT_URI;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim();
    }
    return `${apiPublicOrigin()}/api/v1/admin/zoho/oauth/callback`;
}

function adminReturnUrl(query) {
    const base = `${portalPublicOrigin()}/events/admin.html`;
    const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
    return `${base}${q}`;
}

function hashState(plain) {
    return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

function hasOAuthClientCredentials() {
    return zohoBooks.clientId().length > 0 && zohoBooks.clientSecret().length > 0;
}

function canStartOAuth() {
    return hasOAuthClientCredentials() && zohoBooks.organizationId().length > 0;
}

function getRequestedScopes() {
    return SCOPES;
}

function oauthStatus() {
    const row = portalDb.getZohoOAuthCredentials();
    const envToken = (process.env.ZOHO_BOOKS_REFRESH_TOKEN || '').trim();
    return {
        oauth_connected: !!(row && row.refresh_token),
        oauth_connected_at: row && row.connected_at ? row.connected_at : null,
        oauth_connected_by_user_id:
            row && row.connected_by_user_id ? row.connected_by_user_id : null,
        has_env_refresh_token: envToken.length > 0,
        env_refresh_token_overrides_connect: envToken.length > 0,
        oauth_scopes_requested: SCOPES,
        oauth_redirect_uri: oauthRedirectUri(),
        oauth_client_configured: hasOAuthClientCredentials(),
        oauth_ready: canStartOAuth()
    };
}

function createOAuthState(adminUserId) {
    portalDb.purgeExpiredOAuthStates();
    const plain = crypto.randomBytes(32).toString('base64url');
    portalDb.createOAuthState({
        id: uuid(),
        purpose: OAUTH_PURPOSE,
        state_hash: hashState(plain),
        admin_user_id: adminUserId,
        expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString()
    });
    return plain;
}

function consumeOAuthState(plain) {
    if (!plain) return null;
    const row = portalDb.getOAuthStateByHash(hashState(plain), OAUTH_PURPOSE);
    if (!row) return null;
    portalDb.deleteOAuthState(row.id);
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
}

function buildAuthorizeUrl(adminUserId) {
    if (!canStartOAuth()) {
        const err = new Error(
            'Set ZOHO_BOOKS_CLIENT_ID, ZOHO_BOOKS_CLIENT_SECRET, and ZOHO_BOOKS_ORGANIZATION_ID before connecting'
        );
        err.code = 'service_unavailable';
        throw err;
    }
    const state = createOAuthState(adminUserId);
    const params = new URLSearchParams({
        scope: SCOPES,
        client_id: zohoBooks.clientId(),
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: oauthRedirectUri(),
        prompt: 'consent',
        state
    });
    return `${zohoBooks.accountsBaseUrl()}/oauth/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: zohoBooks.clientId(),
        client_secret: zohoBooks.clientSecret(),
        redirect_uri: oauthRedirectUri(),
        code: String(code)
    });
    const res = await fetch(`${zohoBooks.accountsBaseUrl()}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        const msg =
            (data && (data.error || data.message)) ||
            `Zoho token exchange failed (${res.status})`;
        const err = new Error(msg);
        err.code = 'zoho_auth_failed';
        err.status = res.status;
        err.details = data;
        throw err;
    }
    return data;
}

function saveRefreshToken(refreshToken, adminUserId) {
    portalDb.saveZohoRefreshToken(refreshToken, adminUserId);
    zohoBooks.clearTokenCache();
}

function disconnect() {
    portalDb.clearZohoRefreshToken();
    zohoBooks.clearTokenCache();
}

async function handleOAuthCallback(req, res) {
    const error = req.query.error;
    const errorDescription = req.query.error_description;
    if (error) {
        const msg = errorDescription || error;
        return res.redirect(
            adminReturnUrl(
                `tab=site&zoho=error&message=${encodeURIComponent(String(msg))}`
            )
        );
    }

    const code = req.query.code;
    const state = req.query.state;
    if (!code || !state) {
        return res.redirect(
            adminReturnUrl(
                `tab=site&zoho=error&message=${encodeURIComponent('Missing authorization code')}`
            )
        );
    }

    const stateRow = consumeOAuthState(state);
    if (!stateRow) {
        return res.redirect(
            adminReturnUrl(
                `tab=site&zoho=error&message=${encodeURIComponent('Invalid or expired OAuth state — try Connect again')}`
            )
        );
    }

    try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            return res.redirect(
                adminReturnUrl(
                    `tab=site&zoho=error&message=${encodeURIComponent('Zoho did not return a refresh token — use Connect again (consent is required)')}`
                )
            );
        }
        saveRefreshToken(tokens.refresh_token, stateRow.admin_user_id);
        return res.redirect(adminReturnUrl('tab=site&zoho=connected'));
    } catch (err) {
        console.error('[portal] zoho oauth callback', err);
        return res.redirect(
            adminReturnUrl(
                `tab=site&zoho=error&message=${encodeURIComponent(err.message || 'OAuth failed')}`
            )
        );
    }
}

module.exports = {
    oauthRedirectUri,
    oauthStatus,
    getRequestedScopes,
    canStartOAuth,
    buildAuthorizeUrl,
    disconnect,
    handleOAuthCallback,
    /** @deprecated use handleOAuthCallback */
    handleZohoOAuthCallback: handleOAuthCallback
};
