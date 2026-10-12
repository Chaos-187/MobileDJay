const { portalDb } = require('../db/portal-database');
const pipaHub = require('./pipa-hub-client');

function parseExistingMetadata(product) {
    if (!product) return {};
    const raw = product.product_metadata_json;
    if (raw == null || raw === '') return {};
    try {
        const o = JSON.parse(String(raw));
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
        return {};
    }
}

/**
 * Fetch PIPA device and merge compliance fields into catalog product.
 * @param {string} productId
 * @param {{ tag?: string|number, apply_name?: boolean, apply_description?: boolean, apply_image_url?: boolean }} options
 */
async function syncCatalogProductFromPipaHub(productId, options = {}) {
    const product = portalDb.getCatalogProductById(productId);
    if (!product) {
        const err = new Error('Product not found');
        err.code = 'not_found';
        throw err;
    }
    if (!pipaHub.isConfigured()) {
        const err = new Error(
            'PIPA Hub is not configured. Set PIPA_HUB_API_KEY on the API server (default base https://hub.pipa.org.uk).'
        );
        err.code = 'service_unavailable';
        throw err;
    }

    const tag = options.tag != null && options.tag !== '' ? options.tag : product.pipa_hub_asset_id;
    if (tag == null || String(tag).trim() === '') {
        const err = new Error('Provide a PIPA tag number or set pipa_hub_asset_id on the product first.');
        err.code = 'validation_error';
        throw err;
    }

    const device = await pipaHub.getDeviceByTag(tag);
    const existingMeta = parseExistingMetadata(product);
    const { metadata, productFields, summary } = pipaHub.buildCatalogMetadataPatch(
        device,
        existingMeta,
        {
            apply_name: !!options.apply_name,
            apply_description: !!options.apply_description,
            apply_image_url: !!options.apply_image_url
        }
    );

    const patch = { ...metadata, ...productFields };
    const updated = portalDb.updateCatalogProduct(productId, patch);
    if (!updated) {
        const err = new Error('Product not found');
        err.code = 'not_found';
        throw err;
    }

    return {
        ok: true,
        product: updated,
        pipa: summary,
        applied: {
            metadata_keys: Object.keys(metadata),
            product_field_keys: Object.keys(productFields)
        }
    };
}

module.exports = {
    syncCatalogProductFromPipaHub
};
