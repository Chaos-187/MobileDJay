/**
 * Brevo transactional email (POST /v3/smtp/email).
 * Template IDs map to YAML exports under EYUP_EVENTS/email-templates/.
 */

const BREVO_API = 'https://api.brevo.com/v3';

/** @type {Record<string, { env: string, label: string }>} */
const TEMPLATE_REGISTRY = {
    account_created: {
        env: 'BREVO_TEMPLATE_ACCOUNT_CREATED',
        label: 'Account created'
    },
    account_created_temporary_password: {
        env: 'BREVO_TEMPLATE_ACCOUNT_CREATED_TEMP_PASSWORD',
        label: 'Account created (temporary password)'
    },
    deposit_due: {
        env: 'BREVO_TEMPLATE_DEPOSIT_DUE',
        label: 'Deposit due'
    },
    invoice_due: {
        env: 'BREVO_TEMPLATE_INVOICE_DUE',
        label: 'Invoice due'
    },
    post_event_thank_you: {
        env: 'BREVO_TEMPLATE_POST_EVENT_THANK_YOU',
        label: 'Post-event thank you'
    },
    contact_autoresponder: {
        env: 'BREVO_TEMPLATE_CONTACT_AUTORESPONDER',
        label: 'Contact autoresponder'
    },
    contact_autoresponder_inflatables: {
        env: 'BREVO_TEMPLATE_CONTACT_AUTORESPONDER_INFLATABLES',
        label: 'Inflatables hire autoresponder'
    },
    password_reset: {
        env: 'BREVO_TEMPLATE_PASSWORD_RESET',
        label: 'Password reset'
    },
    payment_received: {
        env: 'BREVO_TEMPLATE_PAYMENT_RECEIVED',
        label: 'Payment received'
    }
};

function apiKey() {
    return process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || '';
}

function isConfigured() {
    return apiKey().length > 0;
}

function senderEmail() {
    const raw = process.env.BREVO_SENDER_EMAIL;
    return raw != null && String(raw).trim() ? String(raw).trim() : '';
}

function isSenderConfigured() {
    return senderEmail().length > 0;
}

function getTemplateId(templateKey) {
    const entry = TEMPLATE_REGISTRY[templateKey];
    if (!entry) return null;
    const raw = process.env[entry.env];
    if (raw == null || String(raw).trim() === '') return null;
    const id = parseInt(String(raw).trim(), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function listConfiguredTemplates() {
    return Object.entries(TEMPLATE_REGISTRY)
        .filter(([key]) => getTemplateId(key) != null)
        .map(([key, meta]) => ({ key, label: meta.label, template_id: getTemplateId(key) }));
}

function portalLoginUrl() {
    const explicit =
        process.env.PORTAL_PUBLIC_ORIGIN ||
        process.env.EYUP_PORTAL_PUBLIC_ORIGIN ||
        process.env.PORTAL_EVENTS_PUBLIC_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return `${String(explicit).trim().replace(/\/$/, '')}/events/login`;
    }
    const cors = process.env.PORTAL_CORS_ORIGINS || '';
    const first = cors
        .split(',')
        .map((s) => s.trim())
        .find((o) => o && /^https?:\/\//i.test(o));
    if (first) {
        return `${first.replace(/\/$/, '')}/events/login`;
    }
    return 'https://eyupevents.uk/events/login';
}

function portalCustomerUrl(query) {
    const login = portalLoginUrl();
    const base = login.replace(/\/login\/?$/i, '/customer');
    if (query != null && String(query).trim()) {
        const q = String(query).trim().replace(/^\?/, '');
        return `${base}?${q}`;
    }
    return base;
}

function recipientName(user) {
    const parts = [user.first_name, user.last_name].filter(Boolean);
    if (parts.length) return parts.join(' ');
    return user.email || '';
}

async function brevoRequest(method, path, body) {
    const key = apiKey();
    if (!key) {
        const err = new Error('Brevo API key is not configured');
        err.code = 'brevo_not_configured';
        throw err;
    }
    const res = await fetch(`${BREVO_API}${path}`, {
        method,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': key
        },
        body: body != null ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }
    if (!res.ok) {
        let msg =
            (data && (data.message || data.error)) ||
            `Brevo request failed (${res.status})`;
        if (typeof msg !== 'string') msg = JSON.stringify(msg);
        if (res.status === 401 || res.status === 403) {
            msg = `Brevo rejected the API key (${res.status}). Check BREVO_API_KEY on the server.`;
        } else if (res.status === 404 && path.includes('/smtp/email')) {
            msg = `Brevo template not found. Check template ID env vars (e.g. BREVO_TEMPLATE_ACCOUNT_CREATED).`;
        }
        const err = new Error(msg);
        err.code = 'brevo_api_error';
        err.status = res.status;
        err.details = data;
        throw err;
    }
    return data;
}

async function upsertContact({ email, firstName, lastName }) {
    if (!email) return;
    await brevoRequest('POST', '/contacts', {
        email,
        updateEnabled: true,
        attributes: {
            FIRSTNAME: firstName != null ? String(firstName) : '',
            LASTNAME: lastName != null ? String(lastName) : ''
        }
    });
}

/**
 * @param {object} opts
 * @param {string} opts.templateKey
 * @param {{ email: string, first_name?: string, last_name?: string }} opts.user
 * @param {Record<string, unknown>} [opts.params]
 * @param {string[]} [opts.tags]
 */
async function sendCustomerTemplateEmail({ templateKey, user, params, tags }) {
    const templateId = getTemplateId(templateKey);
    if (!templateId) {
        const entry = TEMPLATE_REGISTRY[templateKey];
        const err = new Error(
            entry
                ? `Template "${templateKey}" is not configured (set ${entry.env})`
                : `Unknown email template "${templateKey}"`
        );
        err.code = 'template_not_configured';
        throw err;
    }
    if (!user || !user.email) {
        const err = new Error('Recipient email is required');
        err.code = 'validation_error';
        throw err;
    }

    await upsertContact({
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
    }).catch((e) => {
        // Non-fatal: templates can still use params; log for ops.
        console.warn('[brevo] contact upsert', e.message || e);
    });

    const payload = {
        to: [{ email: user.email, name: recipientName(user) }],
        templateId,
        params: {
            login_link: portalLoginUrl(),
            ...(params || {})
        },
        tags: tags && tags.length ? tags : ['eyup-portal', templateKey]
    };

    const fromEmail = senderEmail();
    const senderName = process.env.BREVO_SENDER_NAME;
    if (fromEmail) {
        payload.sender = {
            email: fromEmail,
            ...(senderName && String(senderName).trim()
                ? { name: String(senderName).trim() }
                : {})
        };
    } else {
        const err = new Error(
            'Brevo sender is not configured (set BREVO_SENDER_EMAIL and verify the address in Brevo)'
        );
        err.code = 'sender_not_configured';
        throw err;
    }

    const data = await brevoRequest('POST', '/smtp/email', payload);
    return { messageId: data && data.messageId ? data.messageId : null, templateId };
}

module.exports = {
    TEMPLATE_REGISTRY,
    isConfigured,
    isSenderConfigured,
    senderEmail,
    getTemplateId,
    listConfiguredTemplates,
    portalLoginUrl,
    portalCustomerUrl,
    sendCustomerTemplateEmail
};
