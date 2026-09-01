/**
 * Push portal catalog products to Zoho Books items.
 */

const zohoBooks = require('./zoho-books');
const { portalDb } = require('../db/portal-database');

function buildItemPayload(product) {
    const payload = {
        name: product.name || product.code || 'Service',
        sku: String(product.code || '').trim() || undefined,
        rate:
            product.standalone_rate != null && Number.isFinite(Number(product.standalone_rate))
                ? Math.round(Number(product.standalone_rate) * 100) / 100
                : 0,
        product_type: 'service'
    };
    if (product.description) payload.description = String(product.description).slice(0, 2000);
    return payload;
}

/**
 * @returns {Promise<{ ok: boolean, item_id?: string, skipped?: boolean, reason?: string }>}
 */
async function syncCatalogProductToZoho(productId) {
    if (!zohoBooks.isConfigured()) {
        return { ok: false, skipped: true, reason: 'not_configured' };
    }
    const product = portalDb.getCatalogProductById(productId);
    if (!product) {
        return { ok: false, reason: 'not_found' };
    }
    if (!product.code || !product.name) {
        await portalDb.updateCatalogProductZoho(productId, {
            zoho_item_sync_error: 'Product needs code and name'
        });
        return { ok: false, reason: 'invalid_product' };
    }

    const payload = buildItemPayload(product);
    let itemId = product.zoho_item_id ? String(product.zoho_item_id) : null;

    try {
        if (itemId) {
            await zohoBooks.updateItem(itemId, payload);
        } else {
            const existing = await zohoBooks.searchItemBySku(product.code);
            if (existing && existing.item_id) {
                itemId = String(existing.item_id);
                await zohoBooks.updateItem(itemId, payload);
            } else {
                const created = await zohoBooks.createItem(payload);
                itemId = created && created.item_id ? String(created.item_id) : null;
            }
        }
        if (!itemId) {
            throw new Error('Zoho did not return an item_id');
        }
        const now = new Date().toISOString();
        portalDb.updateCatalogProductZoho(productId, {
            zoho_item_id: itemId,
            zoho_item_synced_at: now,
            zoho_item_sync_error: null
        });
        return {
            ok: true,
            item_id: itemId,
            synced_at: now
        };
    } catch (err) {
        const msg = err && err.message ? String(err.message) : 'Zoho item sync failed';
        portalDb.updateCatalogProductZoho(productId, {
            zoho_item_sync_error: msg.slice(0, 500)
        });
        throw err;
    }
}

function scheduleZohoItemSync(productId) {
    if (!productId || !zohoBooks.isConfigured()) return;
    setImmediate(() => {
        syncCatalogProductToZoho(productId).catch((err) => {
            console.error('[portal] zoho item sync', productId, err.message || err);
        });
    });
}

function zohoStatusForProduct(product) {
    if (!product) return null;
    return {
        zoho_books_configured: zohoBooks.isConfigured(),
        zoho_item_id: product.zoho_item_id || null,
        zoho_item_synced_at: product.zoho_item_synced_at || null,
        zoho_item_sync_error: product.zoho_item_sync_error || null,
        product_synced: !!(product.zoho_item_id && String(product.zoho_item_id).trim())
    };
}

async function syncAllCatalogProductsToZoho() {
    if (!zohoBooks.isConfigured()) {
        const err = new Error('Zoho Books is not configured');
        err.code = 'service_unavailable';
        throw err;
    }
    const products = portalDb.listCatalogProducts({ activeOnly: false });
    const results = [];
    for (const p of products) {
        if (!p || !p.id) continue;
        try {
            const r = await syncCatalogProductToZoho(p.id);
            results.push({
                product_id: p.id,
                code: p.code || null,
                ok: !!r.ok,
                item_id: r.item_id || null,
                skipped: !!r.skipped,
                reason: r.reason || null
            });
        } catch (err) {
            results.push({
                product_id: p.id,
                code: p.code || null,
                ok: false,
                error: err && err.message ? String(err.message) : 'sync_failed'
            });
        }
    }
    return {
        total: results.length,
        synced: results.filter((r) => r.ok && r.item_id).length,
        failed: results.filter((r) => !r.ok && !r.skipped).length,
        skipped: results.filter((r) => r.skipped).length,
        results
    };
}

module.exports = {
    syncCatalogProductToZoho,
    scheduleZohoItemSync,
    syncAllCatalogProductsToZoho,
    zohoStatusForProduct,
    buildItemPayload
};
