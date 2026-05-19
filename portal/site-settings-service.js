const { portalDb } = require('../db/portal-database');

/** Must match marketing `js/site-settings.js` (EyupSiteSettings.DEFAULTS). */
const DEFAULTS = {
    nav: {
        home: true,
        services: true,
        mobile_dj: true,
        pa_rental: true,
        karaoke: true,
        photo_booth: true,
        audio_guestbook: true,
        inflatables: true,
        outdoor_games: true,
        for_djs: true,
        mobile_requests_app: true,
        dmx_lighting: true,
        gallery: true,
        about: true,
        your_portal: true,
        requests: true,
        contact: true
    },
    contact_form_enabled: true,
    contact_form_disabled_message:
        'Sorry, we are currently fully booked. Please check back soon or call us on 07868 134663.'
};

const NAV_KEYS = Object.keys(DEFAULTS.nav);
const ALLOWED_TOP_KEYS = new Set(['nav', 'contact_form_enabled', 'contact_form_disabled_message']);

function mergeSiteSettings(raw) {
    const out = {
        nav: { ...DEFAULTS.nav },
        contact_form_enabled: DEFAULTS.contact_form_enabled,
        contact_form_disabled_message: DEFAULTS.contact_form_disabled_message
    };
    if (raw && typeof raw === 'object' && raw.nav && typeof raw.nav === 'object') {
        for (const k of NAV_KEYS) {
            if (typeof raw.nav[k] === 'boolean') {
                out.nav[k] = raw.nav[k];
            }
        }
    }
    if (raw && typeof raw === 'object' && typeof raw.contact_form_enabled === 'boolean') {
        out.contact_form_enabled = raw.contact_form_enabled;
    }
    if (raw && typeof raw === 'object' && typeof raw.contact_form_disabled_message === 'string') {
        const msg = raw.contact_form_disabled_message.trim();
        if (msg.length > 0 && msg.length <= 500) {
            out.contact_form_disabled_message = msg;
        }
    }
    if (out.contact_form_enabled === false && !String(out.contact_form_disabled_message).trim()) {
        out.contact_form_disabled_message = DEFAULTS.contact_form_disabled_message;
    }
    return out;
}

function validateSiteSettingsBody(body) {
    const details = {};
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, details: { body: 'must be a JSON object' } };
    }

    const unknownFields = Object.keys(body).filter((k) => !ALLOWED_TOP_KEYS.has(k));
    if (unknownFields.length) {
        return { ok: false, details: { unknown_fields: unknownFields } };
    }

    if (!('nav' in body)) {
        details.nav = 'is required';
    } else if (body.nav == null || typeof body.nav !== 'object' || Array.isArray(body.nav)) {
        details.nav = 'must be an object';
    } else {
        const navUnknown = Object.keys(body.nav).filter((k) => !NAV_KEYS.includes(k));
        for (const k of navUnknown) {
            details[`nav.${k}`] = 'is not allowed';
        }
        for (const k of NAV_KEYS) {
            if (!(k in body.nav)) {
                details[`nav.${k}`] = 'is required';
            } else if (typeof body.nav[k] !== 'boolean') {
                details[`nav.${k}`] = 'must be a boolean';
            }
        }
    }

    if (!('contact_form_enabled' in body)) {
        details.contact_form_enabled = 'is required';
    } else if (typeof body.contact_form_enabled !== 'boolean') {
        details.contact_form_enabled = 'must be a boolean';
    }

    if (!('contact_form_disabled_message' in body)) {
        details.contact_form_disabled_message = 'is required';
    } else if (typeof body.contact_form_disabled_message !== 'string') {
        details.contact_form_disabled_message = 'must be a string';
    } else {
        const msg = body.contact_form_disabled_message.trim();
        if (msg.length > 500) {
            details.contact_form_disabled_message = 'must be at most 500 characters';
        } else if (/<[a-z]/i.test(body.contact_form_disabled_message)) {
            details.contact_form_disabled_message = 'must not contain HTML';
        } else if (body.contact_form_enabled === false && msg.length === 0) {
            /* substitute server default on save */
        } else if (msg.length === 0) {
            details.contact_form_disabled_message = 'must be a non-empty string';
        }
    }

    if (Object.keys(details).length) {
        return { ok: false, details };
    }

    return { ok: true, merged: mergeSiteSettings(body) };
}

function getSiteSettings() {
    const row = portalDb.getSiteSettingsRow();
    let raw = {};
    if (row && row.payload_json) {
        try {
            raw = JSON.parse(row.payload_json);
        } catch {
            raw = {};
        }
    }
    return mergeSiteSettings(raw);
}

function putSiteSettings(body, adminUserId) {
    const result = validateSiteSettingsBody(body);
    if (!result.ok) {
        const err = new Error('Invalid site settings');
        err.code = 'validation_error';
        err.details = result.details;
        throw err;
    }
    portalDb.saveSiteSettings(JSON.stringify(result.merged), adminUserId);
    return result.merged;
}

module.exports = {
    DEFAULTS,
    NAV_KEYS,
    mergeSiteSettings,
    validateSiteSettingsBody,
    getSiteSettings,
    putSiteSettings
};
