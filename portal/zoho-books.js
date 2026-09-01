/**
 * Zoho Books API client (OAuth2 refresh token + REST).
 * @see docs/zoho-books-integration.md
 */

const REGION_MAP = {
    com: {
        accounts: 'https://accounts.zoho.com',
        api: 'https://www.zohoapis.com'
    },
    eu: {
        accounts: 'https://accounts.zoho.eu',
        api: 'https://www.zohoapis.eu'
    },
    in: {
        accounts: 'https://accounts.zoho.in',
        api: 'https://www.zohoapis.in'
    },
    'com.au': {
        accounts: 'https://accounts.zoho.com.au',
        api: 'https://www.zohoapis.com.au'
    },
    jp: {
        accounts: 'https://accounts.zoho.jp',
        api: 'https://www.zohoapis.jp'
    },
    ca: {
        accounts: 'https://accounts.zohocloud.ca',
        api: 'https://www.zohoapis.ca'
    }
};

function clientId() {
    return process.env.ZOHO_BOOKS_CLIENT_ID || '';
}

function clientSecret() {
    return process.env.ZOHO_BOOKS_CLIENT_SECRET || '';
}

function refreshToken() {
    const fromEnv = (process.env.ZOHO_BOOKS_REFRESH_TOKEN || '').trim();
    if (fromEnv) return fromEnv;
    try {
        const { portalDb } = require('../db/portal-database');
        const row = portalDb.getZohoOAuthCredentials();
        return row && row.refresh_token ? String(row.refresh_token).trim() : '';
    } catch {
        return '';
    }
}

/** @returns {'env'|'database'|null} */
function refreshTokenSource() {
    const fromEnv = (process.env.ZOHO_BOOKS_REFRESH_TOKEN || '').trim();
    if (fromEnv) return 'env';
    if (refreshToken()) return 'database';
    return null;
}

function organizationId() {
    return process.env.ZOHO_BOOKS_ORGANIZATION_ID || '';
}

function regionKey() {
    const raw = (process.env.ZOHO_BOOKS_REGION || 'eu').trim().toLowerCase();
    return REGION_MAP[raw] ? raw : 'eu';
}

function accountsBaseUrl() {
    if (process.env.ZOHO_BOOKS_ACCOUNTS_URL) {
        return String(process.env.ZOHO_BOOKS_ACCOUNTS_URL).trim().replace(/\/$/, '');
    }
    return REGION_MAP[regionKey()].accounts;
}

function apiBaseUrl() {
    if (process.env.ZOHO_BOOKS_API_BASE) {
        return String(process.env.ZOHO_BOOKS_API_BASE).trim().replace(/\/$/, '');
    }
    return REGION_MAP[regionKey()].api;
}

function isConfigured() {
    return (
        clientId().length > 0 &&
        clientSecret().length > 0 &&
        refreshToken().length > 0 &&
        organizationId().length > 0
    );
}

function configSummary() {
    const token = refreshToken();
    const source = refreshTokenSource();
    return {
        configured: isConfigured(),
        region: regionKey(),
        organization_id: organizationId() || null,
        accounts_url: accountsBaseUrl(),
        api_base: apiBaseUrl(),
        has_refresh_token: token.length > 0,
        refresh_token_source: source,
        uses_env_refresh_token: source === 'env'
    };
}

function clearTokenCache() {
    cachedAccessToken = null;
    cachedAccessTokenExpiresAt = 0;
}

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function refreshAccessToken() {
    const params = new URLSearchParams({
        refresh_token: refreshToken(),
        client_id: clientId(),
        client_secret: clientSecret(),
        grant_type: 'refresh_token'
    });
    const res = await fetch(`${accountsBaseUrl()}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        const msg =
            (data && (data.error || data.message)) ||
            `Zoho token refresh failed (${res.status})`;
        const err = new Error(msg);
        err.code = 'zoho_auth_failed';
        err.status = res.status;
        err.details = data;
        throw err;
    }
    cachedAccessToken = data.access_token;
    const expiresIn = Number(data.expires_in) || 3600;
    cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;
    return cachedAccessToken;
}

async function getAccessToken() {
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
        return cachedAccessToken;
    }
    return refreshAccessToken();
}

function zohoErrorFromBody(data, status) {
    const msg =
        (data && data.message) ||
        (data && data.error && data.error.message) ||
        (Array.isArray(data && data.errors) && data.errors[0] && data.errors[0].message) ||
        `Zoho Books request failed (${status})`;
    const err = new Error(msg);
    err.code = 'zoho_api_error';
    err.status = status;
    err.details = data;
    return err;
}

/**
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path - e.g. /books/v3/contacts
 */
async function booksRequest(method, path, { query = {}, body = null } = {}) {
    if (!isConfigured()) {
        const err = new Error('Zoho Books is not configured');
        err.code = 'service_unavailable';
        throw err;
    }
    const token = await getAccessToken();
    const q = new URLSearchParams({ organization_id: organizationId(), ...query });
    const url = `${apiBaseUrl()}${path}?${q.toString()}`;
    const headers = {
        Authorization: `Zoho-oauthtoken ${token}`
    };
    const opts = { method, headers };
    if (body != null) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw zohoErrorFromBody(data, res.status);
    }
    if (data && data.code != null && Number(data.code) !== 0) {
        throw zohoErrorFromBody(data, res.status);
    }
    return data;
}

async function searchContactByEmail(email) {
    const em = String(email || '').trim();
    if (!em) return null;
    const data = await booksRequest('GET', '/books/v3/contacts', {
        query: { email: em, contact_type: 'customer' }
    });
    const contacts = data && Array.isArray(data.contacts) ? data.contacts : [];
    return contacts.length ? contacts[0] : null;
}

async function getContact(contactId) {
    const data = await booksRequest('GET', `/books/v3/contacts/${encodeURIComponent(contactId)}`);
    return data && data.contact ? data.contact : null;
}

async function createContact(payload) {
    const data = await booksRequest('POST', '/books/v3/contacts', { body: payload });
    return data && data.contact ? data.contact : null;
}

async function updateContact(contactId, payload) {
    const data = await booksRequest('PUT', `/books/v3/contacts/${encodeURIComponent(contactId)}`, {
        body: payload
    });
    return data && data.contact ? data.contact : null;
}

async function createInvoice(payload) {
    const data = await booksRequest('POST', '/books/v3/invoices', { body: payload });
    return data && data.invoice ? data.invoice : null;
}

async function getInvoice(invoiceId) {
    const data = await booksRequest('GET', `/books/v3/invoices/${encodeURIComponent(invoiceId)}`);
    return data && data.invoice ? data.invoice : null;
}

async function markInvoiceSent(invoiceId) {
    const data = await booksRequest('POST', `/books/v3/invoices/${encodeURIComponent(invoiceId)}/status/sent`);
    return data && data.invoice ? data.invoice : null;
}

async function createCustomerPayment(payload) {
    const data = await booksRequest('POST', '/books/v3/customerpayments', { body: payload });
    return data && data.payment ? data.payment : null;
}

async function searchItemBySku(sku) {
    const code = String(sku || '').trim();
    if (!code) return null;
    try {
        const data = await booksRequest('GET', '/books/v3/items', { query: { sku: code } });
        const items = data && Array.isArray(data.items) ? data.items : [];
        const match = items.find((it) => String(it.sku || '').toLowerCase() === code.toLowerCase());
        return match || (items.length ? items[0] : null);
    } catch {
        const data = await booksRequest('GET', '/books/v3/items', {
            query: { search_text: code }
        });
        const items = data && Array.isArray(data.items) ? data.items : [];
        return (
            items.find((it) => String(it.sku || '').toLowerCase() === code.toLowerCase()) ||
            items[0] ||
            null
        );
    }
}

async function getItem(itemId) {
    const data = await booksRequest('GET', `/books/v3/items/${encodeURIComponent(itemId)}`);
    return data && data.item ? data.item : null;
}

async function createItem(payload) {
    const data = await booksRequest('POST', '/books/v3/items', { body: payload });
    return data && data.item ? data.item : null;
}

async function updateItem(itemId, payload) {
    const data = await booksRequest('PUT', `/books/v3/items/${encodeURIComponent(itemId)}`, {
        body: payload
    });
    return data && data.item ? data.item : null;
}

async function createEstimate(payload) {
    const data = await booksRequest('POST', '/books/v3/estimates', { body: payload });
    return data && data.estimate ? data.estimate : null;
}

async function getEstimate(estimateId) {
    const data = await booksRequest('GET', `/books/v3/estimates/${encodeURIComponent(estimateId)}`);
    return data && data.estimate ? data.estimate : null;
}

async function markEstimateSent(estimateId) {
    const data = await booksRequest('POST', `/books/v3/estimates/${encodeURIComponent(estimateId)}/status/sent`);
    return data && data.estimate ? data.estimate : null;
}

function booksWebHost() {
    const region = regionKey();
    if (region === 'eu') return 'https://books.zoho.eu';
    if (region === 'in') return 'https://books.zoho.in';
    if (region === 'com.au') return 'https://books.zoho.com.au';
    return 'https://books.zoho.com';
}

function invoiceWebUrl(invoiceId) {
    if (!invoiceId) return null;
    const org = organizationId();
    return `${booksWebHost()}/app/${org}#/invoices/${encodeURIComponent(String(invoiceId))}`;
}

function estimateWebUrl(estimateId) {
    if (!estimateId) return null;
    const org = organizationId();
    return `${booksWebHost()}/app/${org}#/quotes/${encodeURIComponent(String(estimateId))}`;
}

function zohoAuthRemediation() {
    const source = refreshTokenSource();
    if (source === 'env') {
        return (
            'ZOHO_BOOKS_REFRESH_TOKEN in server env overrides admin Connect and may lack ZohoBooks.settings.ALL. ' +
            'Remove it and use Connect again, or regenerate the env token with settings scope.'
        );
    }
    return (
        'Disconnect and Connect Zoho Books in Site → Integrations so the token includes ZohoBooks.settings.ALL (Items). ' +
        'The Zoho account must also have permission to manage Items in Books.'
    );
}

function isZohoAuthorizationError(err) {
    const msg = err && err.message ? String(err.message).toLowerCase() : '';
    return (
        msg.includes('not authorized') ||
        msg.includes('unauthorized') ||
        msg.includes('invalid oauth') ||
        err?.status === 401 ||
        err?.status === 403
    );
}

async function probeItemsAccess() {
    try {
        await booksRequest('GET', '/books/v3/items', { query: { page: 1, per_page: 1 } });
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err && err.message ? String(err.message) : 'items_probe_failed',
            authorization_error: isZohoAuthorizationError(err)
        };
    }
}

/** Verify OAuth credentials and organisation access. */
async function testConnection() {
    if (!isConfigured()) {
        return { ok: false, configured: false, reason: 'not_configured' };
    }
    await refreshAccessToken();
    const data = await booksRequest('GET', '/books/v3/organizations');
    const orgs = data && Array.isArray(data.organizations) ? data.organizations : [];
    const orgId = organizationId();
    const match =
        orgs.find((o) => String(o.organization_id) === String(orgId)) || null;
    const itemsProbe = await probeItemsAccess();
    const orgOk = !!match;
    const itemsOk = !!itemsProbe.ok;
    let message = match
        ? `Connected to ${match.name || 'Zoho Books organisation'}.`
        : `Token works but organisation ${orgId} was not found in this account.`;
    if (orgOk && !itemsOk) {
        message += ` Items API: ${itemsProbe.error || 'not authorized'}. ${zohoAuthRemediation()}`;
    } else if (orgOk && itemsOk) {
        message += ' Items API access OK.';
    }
    return {
        ok: orgOk && itemsOk,
        org_access_ok: orgOk,
        items_access_ok: itemsOk,
        configured: true,
        region: regionKey(),
        organization_id: orgId,
        organization_name: match ? match.name || match.organization_name || null : null,
        organizations_found: orgs.length,
        refresh_token_source: refreshTokenSource(),
        items_access_error: itemsProbe.error || null,
        remediation: orgOk && !itemsOk ? zohoAuthRemediation() : null,
        message
    };
}

module.exports = {
    isConfigured,
    configSummary,
    clientId,
    clientSecret,
    organizationId,
    regionKey,
    accountsBaseUrl,
    apiBaseUrl,
    clearTokenCache,
    booksRequest,
    searchContactByEmail,
    getContact,
    createContact,
    updateContact,
    createInvoice,
    getInvoice,
    markInvoiceSent,
    createCustomerPayment,
    searchItemBySku,
    getItem,
    createItem,
    updateItem,
    createEstimate,
    getEstimate,
    markEstimateSent,
    booksWebHost,
    invoiceWebUrl,
    estimateWebUrl,
    refreshTokenSource,
    isZohoAuthorizationError,
    zohoAuthRemediation,
    probeItemsAccess,
    testConnection
};
