function portalDb() {
    return require('../db/portal-database').portalDb;
}

/** Baseline defaults — unknown nav keys from the DB/admin UI are still persisted. */
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
        surf_simulator: true,
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

const SITES_DEFAULTS = {
    events: {
        contact_form_enabled: true
    },
    inflatables: {
        contact_form_enabled: true,
        contact_form_disabled_message: DEFAULTS.contact_form_disabled_message,
        deposit_rate: 0.25,
        featured_product_ids: [],
        maintenance_mode: false,
        maintenance_message:
            'We are updating the website. Please check back soon or call us on 07868 134663.'
    }
};

const NAV_KEYS = Object.keys(DEFAULTS.nav);
const KNOWN_TOP_KEYS = new Set(['nav', 'contact_form_enabled', 'contact_form_disabled_message', 'sites']);
const NAV_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_NAV_KEY_LEN = 64;

function isValidNavKey(key) {
    return (
        typeof key === 'string' &&
        key.length > 0 &&
        key.length <= MAX_NAV_KEY_LEN &&
        NAV_KEY_PATTERN.test(key)
    );
}

function isPrimitiveSettingValue(value) {
    return (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string' ||
        typeof value === 'number'
    );
}

function normalizeStringArray(value) {
    if (value == null) return [];
    if (Array.isArray(value)) {
        return value.map((x) => String(x || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/[,;\n]+/)
            .map((x) => x.trim())
            .filter(Boolean);
    }
    return [];
}

function mergeSitesBlock(rawSites, topLevelContact) {
    const raw = rawSites && typeof rawSites === 'object' ? rawSites : {};
    const eventsRaw = raw.events && typeof raw.events === 'object' ? raw.events : {};
    const inflatablesRaw =
        raw.inflatables && typeof raw.inflatables === 'object' ? raw.inflatables : {};

    const eventsContactEnabled =
        typeof eventsRaw.contact_form_enabled === 'boolean'
            ? eventsRaw.contact_form_enabled
            : topLevelContact.enabled;
    const inflatablesContactEnabled =
        typeof inflatablesRaw.contact_form_enabled === 'boolean'
            ? inflatablesRaw.contact_form_enabled
            : topLevelContact.enabled;

    let inflatablesMessage = SITES_DEFAULTS.inflatables.contact_form_disabled_message;
    if (
        inflatablesRaw.contact_form_disabled_message != null &&
        String(inflatablesRaw.contact_form_disabled_message).trim()
    ) {
        inflatablesMessage = String(inflatablesRaw.contact_form_disabled_message).trim();
    } else if (topLevelContact.message) {
        inflatablesMessage = topLevelContact.message;
    }

    let depositRate = SITES_DEFAULTS.inflatables.deposit_rate;
    if (inflatablesRaw.deposit_rate != null && Number.isFinite(Number(inflatablesRaw.deposit_rate))) {
        depositRate = Math.min(1, Math.max(0, Number(inflatablesRaw.deposit_rate)));
    }

    const featured =
        inflatablesRaw.featured_product_ids != null
            ? normalizeStringArray(inflatablesRaw.featured_product_ids)
            : normalizeStringArray(inflatablesRaw.featured_product_codes);

    const maintenanceMode =
        typeof inflatablesRaw.maintenance_mode === 'boolean'
            ? inflatablesRaw.maintenance_mode
            : SITES_DEFAULTS.inflatables.maintenance_mode;

    let maintenanceMessage = SITES_DEFAULTS.inflatables.maintenance_message;
    if (
        inflatablesRaw.maintenance_message != null &&
        String(inflatablesRaw.maintenance_message).trim()
    ) {
        maintenanceMessage = String(inflatablesRaw.maintenance_message).trim();
    }

    return {
        events: {
            contact_form_enabled: eventsContactEnabled
        },
        inflatables: {
            contact_form_enabled: inflatablesContactEnabled,
            contact_form_disabled_message: inflatablesMessage,
            deposit_rate: depositRate,
            featured_product_ids: featured,
            maintenance_mode: maintenanceMode,
            maintenance_message: maintenanceMessage
        }
    };
}

function syncTopLevelContactFromSites(out) {
    if (out.sites && out.sites.events && typeof out.sites.events.contact_form_enabled === 'boolean') {
        out.contact_form_enabled = out.sites.events.contact_form_enabled;
    } else if (typeof out.contact_form_enabled === 'boolean') {
        out.sites.events.contact_form_enabled = out.contact_form_enabled;
    }
    return out;
}

function mergeSiteSettings(raw) {
    const out = {
        nav: { ...DEFAULTS.nav },
        contact_form_enabled: DEFAULTS.contact_form_enabled,
        contact_form_disabled_message: DEFAULTS.contact_form_disabled_message
    };

    if (raw && typeof raw === 'object' && raw.nav && typeof raw.nav === 'object') {
        for (const k of Object.keys(raw.nav)) {
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

    out.sites = mergeSitesBlock(raw && raw.sites, {
        enabled: out.contact_form_enabled,
        message: out.contact_form_disabled_message
    });
    syncTopLevelContactFromSites(out);

    // Preserve additional top-level primitive settings for forward compatibility.
    if (raw && typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
            if (KNOWN_TOP_KEYS.has(k)) continue;
            const v = raw[k];
            if (isPrimitiveSettingValue(v)) {
                out[k] = v;
            }
        }
    }

    return out;
}

function inferEnquirySiteKey(body) {
    const b = body && typeof body === 'object' ? body : {};
    const meta =
        b.lead_metadata && typeof b.lead_metadata === 'object' ? b.lead_metadata : {};
    if (
        b.form_source === 'eyup_inflatables_website' ||
        meta.form_source === 'eyup_inflatables_website' ||
        meta.site === 'eyupinflatables'
    ) {
        return 'inflatables';
    }
    return 'events';
}

function isMaintenanceModeForSite(settings, siteKey) {
    const merged = settings && settings.sites ? settings : mergeSiteSettings(settings || {});
    if (siteKey === 'inflatables') {
        return merged.sites.inflatables.maintenance_mode === true;
    }
    return false;
}

function maintenanceMessageForSite(settings, siteKey) {
    const merged = settings && settings.sites ? settings : mergeSiteSettings(settings || {});
    if (siteKey === 'inflatables') {
        return (
            merged.sites.inflatables.maintenance_message ||
            SITES_DEFAULTS.inflatables.maintenance_message
        );
    }
    return '';
}

function isContactFormEnabledForSite(settings, siteKey) {
    const merged = settings && settings.sites ? settings : mergeSiteSettings(settings || {});
    if (siteKey === 'inflatables') {
        if (merged.sites.inflatables.maintenance_mode === true) return false;
        return merged.sites.inflatables.contact_form_enabled !== false;
    }
    return merged.contact_form_enabled !== false;
}

function contactFormDisabledMessageForSite(settings, siteKey) {
    const merged = settings && settings.sites ? settings : mergeSiteSettings(settings || {});
    if (siteKey === 'inflatables') {
        return (
            merged.sites.inflatables.contact_form_disabled_message ||
            DEFAULTS.contact_form_disabled_message
        );
    }
    return merged.contact_form_disabled_message || DEFAULTS.contact_form_disabled_message;
}

function getPublicSiteSettingsResponse(merged, siteQuery) {
    const site = siteQuery != null ? String(siteQuery).trim().toLowerCase() : '';
    if (site === 'inflatables') {
        const inf = merged.sites.inflatables;
        return {
            site: 'inflatables',
            contact_form_enabled: inf.contact_form_enabled,
            contact_form_disabled_message: inf.contact_form_disabled_message,
            deposit_rate: inf.deposit_rate,
            featured_product_ids: inf.featured_product_ids.slice(),
            maintenance_mode: inf.maintenance_mode === true,
            maintenance_message: inf.maintenance_message
        };
    }
    return merged;
}

function validateSiteSettingsBody(body) {
    const details = {};
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, details: { body: 'must be a JSON object' } };
    }

    if (!('nav' in body)) {
        details.nav = 'is required';
    } else if (body.nav == null || typeof body.nav !== 'object' || Array.isArray(body.nav)) {
        details.nav = 'must be an object';
    } else {
        for (const k of Object.keys(body.nav)) {
            if (!isValidNavKey(k)) {
                details[`nav.${k}`] = 'must be a lowercase snake_case key (letters, numbers, underscores)';
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

    if ('sites' in body) {
        if (body.sites == null || typeof body.sites !== 'object' || Array.isArray(body.sites)) {
            details.sites = 'must be an object';
        } else {
            if ('events' in body.sites) {
                const ev = body.sites.events;
                if (ev == null || typeof ev !== 'object' || Array.isArray(ev)) {
                    details['sites.events'] = 'must be an object';
                } else if (
                    'contact_form_enabled' in ev &&
                    typeof ev.contact_form_enabled !== 'boolean'
                ) {
                    details['sites.events.contact_form_enabled'] = 'must be a boolean';
                }
            }
            if ('inflatables' in body.sites) {
                const inf = body.sites.inflatables;
                if (inf == null || typeof inf !== 'object' || Array.isArray(inf)) {
                    details['sites.inflatables'] = 'must be an object';
                } else {
                    if (
                        'contact_form_enabled' in inf &&
                        typeof inf.contact_form_enabled !== 'boolean'
                    ) {
                        details['sites.inflatables.contact_form_enabled'] = 'must be a boolean';
                    }
                    if ('contact_form_disabled_message' in inf) {
                        if (typeof inf.contact_form_disabled_message !== 'string') {
                            details['sites.inflatables.contact_form_disabled_message'] =
                                'must be a string';
                        } else {
                            const msg = inf.contact_form_disabled_message.trim();
                            if (msg.length > 500) {
                                details['sites.inflatables.contact_form_disabled_message'] =
                                    'must be at most 500 characters';
                            } else if (/<[a-z]/i.test(inf.contact_form_disabled_message)) {
                                details['sites.inflatables.contact_form_disabled_message'] =
                                    'must not contain HTML';
                            }
                        }
                    }
                    if ('deposit_rate' in inf) {
                        const rate = Number(inf.deposit_rate);
                        if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
                            details['sites.inflatables.deposit_rate'] =
                                'must be a number between 0 and 1';
                        }
                    }
                    if ('featured_product_ids' in inf && inf.featured_product_ids != null) {
                        if (!Array.isArray(inf.featured_product_ids)) {
                            details['sites.inflatables.featured_product_ids'] = 'must be an array';
                        } else if (
                            inf.featured_product_ids.some(
                                (id) => typeof id !== 'string' || !String(id).trim()
                            )
                        ) {
                            details['sites.inflatables.featured_product_ids'] =
                                'must be an array of non-empty strings';
                        }
                    }
                    if ('maintenance_mode' in inf && typeof inf.maintenance_mode !== 'boolean') {
                        details['sites.inflatables.maintenance_mode'] = 'must be a boolean';
                    }
                    if ('maintenance_message' in inf) {
                        if (typeof inf.maintenance_message !== 'string') {
                            details['sites.inflatables.maintenance_message'] = 'must be a string';
                        } else {
                            const msg = inf.maintenance_message.trim();
                            if (msg.length > 500) {
                                details['sites.inflatables.maintenance_message'] =
                                    'must be at most 500 characters';
                            } else if (/<[a-z]/i.test(inf.maintenance_message)) {
                                details['sites.inflatables.maintenance_message'] =
                                    'must not contain HTML';
                            }
                        }
                    }
                }
            }
        }
    }

    for (const k of Object.keys(body)) {
        if (KNOWN_TOP_KEYS.has(k)) continue;
        if (!isPrimitiveSettingValue(body[k])) {
            details[k] = 'must be a boolean, string, number, or null';
        }
    }

    if (Object.keys(details).length) {
        return { ok: false, details };
    }

    return { ok: true, merged: mergeSiteSettings(body) };
}

function getSiteSettings() {
    const row = portalDb().getSiteSettingsRow();
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
    portalDb().saveSiteSettings(JSON.stringify(result.merged), adminUserId);
    return result.merged;
}

module.exports = {
    DEFAULTS,
    SITES_DEFAULTS,
    NAV_KEYS,
    mergeSiteSettings,
    validateSiteSettingsBody,
    getSiteSettings,
    putSiteSettings,
    inferEnquirySiteKey,
    isMaintenanceModeForSite,
    maintenanceMessageForSite,
    isContactFormEnabledForSite,
    contactFormDisabledMessageForSite,
    getPublicSiteSettingsResponse
};
