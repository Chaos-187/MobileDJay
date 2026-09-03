/**
 * Map portal booking line items to Zoho Books line_items (with optional item_id).
 */

const { portalDb } = require('../db/portal-database');

function resolveProductZohoItemId(productId) {
    if (!productId) return null;
    const product = portalDb.getCatalogProductById(productId);
    return product && product.zoho_item_id ? String(product.zoho_item_id) : null;
}

function mapLineItemsToZoho(lineItems, { resolveItemId } = {}) {
    return (lineItems || [])
        .filter((li) => Number(li.line_subtotal) > 0)
        .map((li) => {
            const qty = Number(li.quantity) || 1;
            const hours = li.hours != null && Number(li.hours) > 0 ? Number(li.hours) : null;
            const rate =
                li.unit_rate != null && Number.isFinite(Number(li.unit_rate))
                    ? Number(li.unit_rate)
                    : qty > 0
                      ? Number(li.line_subtotal) / qty
                      : Number(li.line_subtotal);
            const item = {
                name: li.label || li.product_code || 'Service',
                rate: Math.round(rate * 100) / 100,
                quantity: hours != null ? hours : qty
            };
            if (hours != null) {
                item.description = `${qty} × ${hours}h`;
            }
            const productId = li.product_id || li.catalog_product_id || null;
            if (resolveItemId && productId) {
                const zohoItemId = resolveItemId(productId);
                if (zohoItemId) item.item_id = zohoItemId;
            }
            return item;
        });
}

function mapBookingLineItemsToZoho(lineItems) {
    return mapLineItemsToZoho(lineItems, { resolveItemId: resolveProductZohoItemId });
}

function mapBookingLineItemsToZohoWithoutItemIds(lineItems) {
    return mapLineItemsToZoho(lineItems);
}

module.exports = {
    mapLineItemsToZoho,
    mapBookingLineItemsToZoho,
    mapBookingLineItemsToZohoWithoutItemIds,
    resolveProductZohoItemId
};
