function portalDb() {
    return require('../db/portal-database').portalDb;
}

function normalizeVoucherCode(code) {
    return String(code || '')
        .trim()
        .toUpperCase();
}

function normalizeVoucherChannel(channel) {
    const s = String(channel || '')
        .trim()
        .toLowerCase();
    if (s === 'events' || s === 'eyup_events' || s === 'eyup_events_website') return 'events';
    return 'inflatables';
}

function normalizeCustomerEmail(email) {
    const { normalizeEmail } = require('../db/portal-database');
    return normalizeEmail(email);
}

function parseVoucherInstant(value) {
    if (value == null || String(value).trim() === '') return null;
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? null : d.getTime();
}

function validateVoucherRules(voucher, options) {
    options = options || {};
    const now = Date.now();
    const fromMs = parseVoucherInstant(voucher.valid_from);
    if (fromMs != null && now < fromMs) {
        return {
            valid: false,
            message: voucher.invalid_message || 'This voucher is not valid yet.'
        };
    }
    const untilMs = parseVoucherInstant(voucher.valid_until);
    if (untilMs != null && now > untilMs) {
        return {
            valid: false,
            message: voucher.invalid_message || 'This voucher has expired.'
        };
    }
    if (voucher.max_redemptions != null && voucher.max_redemptions >= 0) {
        const used = Number(voucher.redemption_count) || 0;
        if (used >= voucher.max_redemptions) {
            return {
                valid: false,
                message: voucher.invalid_message || 'This voucher has reached its redemption limit.'
            };
        }
    }
    const allowed = Array.isArray(voucher.customer_emails) ? voucher.customer_emails : [];
    if (allowed.length) {
        const email = options.customerEmail ? normalizeCustomerEmail(options.customerEmail) : '';
        if (!email || !allowed.includes(email)) {
            return {
                valid: false,
                message:
                    voucher.invalid_message ||
                    'This code is restricted to specific customers — use the email it was issued to.'
            };
        }
    }
    return { valid: true };
}

function validateVoucherForContext(code, contextProductIds, channel, options) {
    const normalized = normalizeVoucherCode(code);
    if (!normalized) {
        return {
            valid: false,
            code: '',
            discount_percent: 0,
            message: 'Enter a voucher code.'
        };
    }

    const channelNorm = normalizeVoucherChannel(channel || 'inflatables');
    const voucher = portalDb().getActiveCatalogVoucherByCode(normalized, channelNorm);
    if (!voucher) {
        return {
            valid: false,
            code: normalized,
            discount_percent: 0
        };
    }

    const ruleCheck = validateVoucherRules(voucher, options);
    if (!ruleCheck.valid) {
        return {
            valid: false,
            code: normalized,
            discount_percent: 0,
            message: ruleCheck.message
        };
    }

    const cartIds = Array.isArray(contextProductIds)
        ? contextProductIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    const requiredIds = Array.isArray(voucher.product_ids) ? voucher.product_ids : [];

    if (requiredIds.length) {
        const inList = requiredIds.some((id) => cartIds.includes(String(id)));
        if (!inList) {
            return {
                valid: false,
                code: normalized,
                discount_percent: 0,
                message:
                    voucher.invalid_message || 'This code does not apply to items in your hire list.'
            };
        }
    }

    return {
        valid: true,
        voucher_id: voucher.id,
        code: normalized,
        discount_percent: Number(voucher.discount_percent) || 0,
        product_ids: requiredIds.length ? requiredIds.slice() : null,
        applies_to: voucher.applies_to || '',
        invalid_message: voucher.invalid_message || ''
    };
}

function computeVoucherDiscountAmount(quoteLineItems, voucherResult) {
    if (!voucherResult || !voucherResult.valid) return 0;
    const pct = Number(voucherResult.discount_percent) || 0;
    if (pct <= 0) return 0;
    const lines = Array.isArray(quoteLineItems) ? quoteLineItems : [];
    const restricted = Array.isArray(voucherResult.product_ids) ? voucherResult.product_ids : null;
    let base = 0;
    lines.forEach((line) => {
        if (restricted && restricted.length && !restricted.includes(String(line.product_id))) return;
        base += Number(line.line_subtotal) || 0;
    });
    if (!restricted || !restricted.length) {
        base = lines.reduce((sum, line) => sum + (Number(line.line_subtotal) || 0), 0);
    }
    return Math.round(base * (pct / 100) * 100) / 100;
}

module.exports = {
    normalizeVoucherCode,
    normalizeVoucherChannel,
    validateVoucherForContext,
    computeVoucherDiscountAmount
};
