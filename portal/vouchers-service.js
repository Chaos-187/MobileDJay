function portalDb() {
    return require('../db/portal-database').portalDb;
}

function normalizeVoucherCode(code) {
    return String(code || '')
        .trim()
        .toUpperCase();
}

function validateVoucherForContext(code, contextProductIds) {
    const normalized = normalizeVoucherCode(code);
    if (!normalized) {
        return {
            valid: false,
            code: '',
            discount_percent: 0,
            message: 'Enter a voucher code.'
        };
    }

    const voucher = portalDb().getActiveCatalogVoucherByCode(normalized);
    if (!voucher) {
        return {
            valid: false,
            code: normalized,
            discount_percent: 0
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
                message: voucher.invalid_message || 'This code does not apply to items in your hire list.'
            };
        }
    }

    return {
        valid: true,
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
    validateVoucherForContext,
    computeVoucherDiscountAmount
};
