/**
 * PIPA Hub device API (v7.0).
 * @see https://www.pipa.org.uk/media/qf1orpsr/pipa-api-documentation-v70.pdf
 *
 * Auth: header X-API-Key
 * GET  /api/v1/devices/getbytag?tag={tagNo}
 * POST /api/v1/devices/getbytags  body: JSON array of tag integers
 */

/** UK PIPA Hub platform — override with PIPA_HUB_API_BASE_URL if PIPA give a different host. */
const PIPA_HUB_DEFAULT_BASE_URL = 'https://hub.pipa.org.uk';
const PIPA_HUB_API_BASE_URL = (process.env.PIPA_HUB_API_BASE_URL || '').trim();
const PIPA_HUB_API_KEY = (process.env.PIPA_HUB_API_KEY || '').trim();
const PIPA_HUB_REQUEST_TIMEOUT_MS = Math.min(
    Math.max(Number(process.env.PIPA_HUB_REQUEST_TIMEOUT_MS) || 20000, 5000),
    60000
);

/** @see PDF — Result_Value on Device */
const PIPA_DEVICE_RESULT = {
    INVALID: 0,
    VALID: 10,
    INACTIVE: 20,
    LOST_STOLEN: 30,
    DEACTIVATED: 40
};

function trimBaseUrl() {
    const raw = PIPA_HUB_API_BASE_URL || PIPA_HUB_DEFAULT_BASE_URL;
    return raw.replace(/\/+$/, '');
}

function isConfigured() {
    return !!PIPA_HUB_API_KEY;
}

function configSummary() {
    return {
        configured: isConfigured(),
        base_url: trimBaseUrl(),
        base_url_from_env: !!PIPA_HUB_API_BASE_URL,
        default_base_url: PIPA_HUB_DEFAULT_BASE_URL,
        api_key_set: !!PIPA_HUB_API_KEY,
        docs_url: 'https://www.pipa.org.uk/media/qf1orpsr/pipa-api-documentation-v70.pdf',
        hub_portal_url: 'https://hub.pipa.org.uk/'
    };
}

function apiRoot() {
    return `${trimBaseUrl()}/api/v1`;
}

function assertApiKey() {
    if (!PIPA_HUB_API_KEY) {
        const err = new Error('PIPA Hub API key is not configured (PIPA_HUB_API_KEY).');
        err.code = 'service_unavailable';
        throw err;
    }
}

function parseTagNumber(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    return n;
}

async function pipaRequest(method, path, { body } = {}) {
    assertApiKey();
    const url = `${apiRoot()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PIPA_HUB_REQUEST_TIMEOUT_MS);
    try {
        const init = {
            method,
            headers: {
                'X-API-Key': PIPA_HUB_API_KEY,
                Accept: 'application/json'
            },
            signal: controller.signal
        };
        if (body != null) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await fetch(url, init);
        const text = await res.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }
        }
        if (!res.ok) {
            const err = new Error(
                data && data.message
                    ? String(data.message)
                    : `PIPA Hub request failed (${res.status})`
            );
            err.code = res.status === 401 || res.status === 403 ? 'pipa_auth_failed' : 'upstream_error';
            err.status = res.status;
            err.details = { url: path, body: data };
            throw err;
        }
        return data;
    } catch (err) {
        if (err.name === 'AbortError') {
            const timeoutErr = new Error('PIPA Hub request timed out');
            timeoutErr.code = 'upstream_error';
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {number|string} tagNo
 * @returns {Promise<object>} Device model from PIPA
 */
async function getDeviceByTag(tagNo) {
    const tag = parseTagNumber(tagNo);
    if (tag == null) {
        const err = new Error('tag must be a positive integer (PIPA tag number)');
        err.code = 'validation_error';
        throw err;
    }
    const device = await pipaRequest('GET', `/devices/getbytag?tag=${encodeURIComponent(String(tag))}`);
    if (!device || typeof device !== 'object') {
        const err = new Error('PIPA Hub returned an empty device response');
        err.code = 'upstream_error';
        throw err;
    }
    return device;
}

/**
 * @param {number[]} tagNumbers
 * @returns {Promise<object[]>}
 */
async function getDevicesByTags(tagNumbers) {
    const tags = (tagNumbers || [])
        .map((t) => parseTagNumber(t))
        .filter((t) => t != null);
    if (!tags.length) {
        const err = new Error('tags must include at least one valid tag number');
        err.code = 'validation_error';
        throw err;
    }
    if (tags.length > 50) {
        const err = new Error('At most 50 tags per request');
        err.code = 'validation_error';
        throw err;
    }
    const data = await pipaRequest('POST', '/devices/getbytags', { body: tags });
    if (!Array.isArray(data)) {
        const err = new Error('PIPA Hub getbytags did not return an array');
        err.code = 'upstream_error';
        throw err;
    }
    return data;
}

function deviceLookupOk(device) {
    const rv = device && device.Result_Value;
    return rv === PIPA_DEVICE_RESULT.VALID;
}

function deviceLookupWarning(device) {
    const rv = device && device.Result_Value;
    if (rv === PIPA_DEVICE_RESULT.INACTIVE) {
        return 'Device tag is inactive; verify the current tag before hire.';
    }
    if (rv === PIPA_DEVICE_RESULT.LOST_STOLEN) {
        return 'Device is marked lost/stolen in PIPA Hub.';
    }
    if (rv === PIPA_DEVICE_RESULT.DEACTIVATED) {
        return 'Device is deactivated by PIPA and must not be used until cleared.';
    }
    if (rv === PIPA_DEVICE_RESULT.INVALID || rv == null) {
        return 'No device found for this tag.';
    }
    return null;
}

function formatIsoDate(value) {
    if (value == null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDimensions(device) {
    const parts = [];
    if (device.Size_Length != null && device.Size_Length !== '') {
        parts.push(`L ${device.Size_Length}m`);
    }
    if (device.Size_Width != null && device.Size_Width !== '') {
        parts.push(`W ${device.Size_Width}m`);
    }
    if (device.Size_Height != null && device.Size_Height !== '') {
        parts.push(`H ${device.Size_Height}m`);
    }
    return parts.length ? parts.join(' × ') : null;
}

/**
 * Admin-friendly snapshot (no full Reports tree by default).
 * @param {object} device
 * @param {{ include_reports?: boolean }} opts
 */
function summarizeDevice(device, opts = {}) {
    if (!device || typeof device !== 'object') return null;
    const out = {
        result_value: device.Result_Value,
        result_label: device.Result_Label || null,
        lookup_ok: deviceLookupOk(device),
        warning: deviceLookupWarning(device),
        tag_current: device.Tag_Current != null ? Number(device.Tag_Current) : null,
        tag_initial: device.Tag_Initial != null ? Number(device.Tag_Initial) : null,
        type_label: device.Type_Label || null,
        name: device.Name || null,
        description: device.Description || null,
        manufacturer: device.Manufacturer || null,
        serial_no: device.SerialNo || null,
        owner_name: device.Owner_Name || null,
        status_label: device.Status_Label || null,
        certificate_expiry: device.CertificateExpiry || null,
        certificate_expiry_display: formatIsoDate(device.CertificateExpiry),
        dimensions: formatDimensions(device),
        url_image_front: device.URL_Image_Front || null,
        url_pdf_certificate: device.URL_PDF_Certificate || null,
        url_report: device.URL_Report || null
    };
    if (opts.include_reports && Array.isArray(device.Reports)) {
        out.reports = device.Reports.slice(0, 12).map((r) => ({
            report_id: r.Report_Id,
            type_label: r.Type_Label,
            status_label: r.Status_Label,
            inspection_result_label: r.InspectionResult_Label,
            valid_from: r.Valid_From,
            valid_to: r.Valid_To
        }));
    }
    return out;
}

/**
 * Map PIPA device → catalog metadata patch (does not include pricing/code).
 * @param {object} device
 * @param {object} existingMeta parsed product metadata
 * @param {{ apply_name?: boolean, apply_description?: boolean }} options
 */
function buildCatalogMetadataPatch(device, existingMeta, options = {}) {
    const meta = existingMeta && typeof existingMeta === 'object' ? { ...existingMeta } : {};
    const summary = summarizeDevice(device);
    if (!summary.lookup_ok && summary.warning) {
        const err = new Error(summary.warning);
        err.code = 'validation_error';
        err.details = { result_value: summary.result_value, result_label: summary.result_label };
        throw err;
    }

    const specs = { ...(meta.specs && typeof meta.specs === 'object' ? meta.specs : {}) };
    if (summary.tag_current != null) specs['PIPA tag'] = String(summary.tag_current);
    if (summary.type_label) specs['PIPA type'] = summary.type_label;
    if (summary.manufacturer) specs['Manufacturer'] = summary.manufacturer;
    if (summary.serial_no) specs['Serial no.'] = summary.serial_no;
    if (summary.dimensions) specs['Size'] = summary.dimensions;
    if (summary.status_label) specs['Inspection status'] = summary.status_label;
    if (summary.certificate_expiry_display) {
        specs['Certificate expires'] = summary.certificate_expiry_display;
    }
    if (summary.owner_name) specs['PIPA owner'] = summary.owner_name;

    const highlights = Array.isArray(meta.highlights) ? meta.highlights.slice() : [];
    const pipaHighlight = summary.status_label
        ? `PIPA inspection: ${summary.status_label}`
        : null;
    if (pipaHighlight && !highlights.includes(pipaHighlight)) {
        highlights.unshift(pipaHighlight);
    }
    const certHighlight =
        summary.certificate_expiry_display != null
            ? `PIPA certificate to ${summary.certificate_expiry_display}`
            : null;
    if (certHighlight && !highlights.includes(certHighlight)) {
        highlights.unshift(certHighlight);
    }

    const patch = {
        specs,
        highlights: highlights.slice(0, 24),
        pipa_hub_asset_id:
            summary.tag_current != null ? String(summary.tag_current) : meta.pipa_hub_asset_id || null
    };

    const productFields = {};
    if (options.apply_name && summary.name) {
        productFields.name = String(summary.name).trim().slice(0, 200);
    }
    if (options.apply_description && summary.description) {
        productFields.description = String(summary.description).trim().slice(0, 4000);
    }
    if (options.apply_image_url && summary.url_image_front) {
        productFields.image_url = String(summary.url_image_front).trim().slice(0, 2048);
    }

    return { metadata: patch, productFields, summary };
}

async function testConnection() {
    if (!isConfigured()) {
        return { ok: false, message: 'PIPA_HUB_API_KEY is required (base URL defaults to https://hub.pipa.org.uk).' };
    }
    try {
        await pipaRequest('GET', '/devices/getbytag?tag=0');
    } catch (err) {
        if (err.code === 'pipa_auth_failed') {
            return { ok: false, message: err.message, auth_failed: true };
        }
        if (err.status === 404 || err.status === 400) {
            return { ok: true, message: 'API reachable (tag lookup returned expected client error).' };
        }
        return { ok: false, message: err.message || 'Connection failed' };
    }
    return { ok: true, message: 'API reachable.' };
}

module.exports = {
    PIPA_DEVICE_RESULT,
    isConfigured,
    configSummary,
    parseTagNumber,
    getDeviceByTag,
    getDevicesByTags,
    summarizeDevice,
    buildCatalogMetadataPatch,
    deviceLookupOk,
    deviceLookupWarning,
    testConnection
};
