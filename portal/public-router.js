const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    getSiteSettings,
    getPublicSiteSettingsResponse
} = require('./site-settings-service');
const stripePortal = require('./stripe-portal');
const { syncCheckoutSessionFromStripe } = require('./stripe-checkout-sync');
const { portalDb } = require('../db/portal-database');
const { createPublicEnquiry } = require('./enquiries-public');
const { validateVoucherForContext } = require('./vouchers-service');
const { catalogRoot } = require('./catalog-image-upload');
const { catalogImageFilename, normalizeProductType } = require('./catalog-product-types');

const router = express.Router();

function jsonError(res, code, message, status = 400) {
    res.status(status).json({ error: { code, message } });
}

router.post('/stripe/sync-checkout-session', async (req, res) => {
    if (!stripePortal.isConfigured()) {
        return jsonError(res, 'service_unavailable', 'Stripe is not configured', 503);
    }
    const body = req.body || {};
    const sessionId = body.session_id != null ? String(body.session_id).trim() : '';
    if (!sessionId) {
        return jsonError(res, 'validation_error', 'session_id is required', 422);
    }
    const outcomeRaw = body.outcome != null ? String(body.outcome).toLowerCase() : 'auto';
    const outcome =
        outcomeRaw === 'success' || outcomeRaw === 'cancel' ? outcomeRaw : 'auto';
    try {
        const result = await syncCheckoutSessionFromStripe(sessionId, { outcome });
        res.json(result);
    } catch (err) {
        const status =
            err.code === 'validation_error'
                ? 422
                : err.code === 'not_found'
                  ? 404
                  : err.code === 'service_unavailable'
                    ? 503
                    : 502;
        return jsonError(
            res,
            err.code || 'upstream_error',
            err.message || 'Could not sync checkout session',
            status
        );
    }
});

router.get('/site-settings', (req, res, next) => {
    try {
        const settings = getSiteSettings();
        const siteQuery = req.query.site != null ? String(req.query.site).trim() : '';
        const body = getPublicSiteSettingsResponse(settings, siteQuery);
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(body);
    } catch (e) {
        next(e);
    }
});

router.get('/catalog/image/:filename', (req, res) => {
    const filename = catalogImageFilename(`/uploads/catalog/${req.params.filename || ''}`);
    if (!filename || !/\.(jpe?g|png|webp|gif)$/i.test(filename)) {
        return jsonError(res, 'not_found', 'Image not found', 404);
    }
    const filePath = path.join(catalogRoot, filename);
    if (!fs.existsSync(filePath)) {
        return jsonError(res, 'not_found', 'Image not found', 404);
    }
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.sendFile(filePath);
});

router.get('/catalog/quote-products', (req, res, next) => {
    try {
        const productTypeRaw =
            req.query.product_type != null ? String(req.query.product_type).trim() : '';
        const productTypeFilter = productTypeRaw ? normalizeProductType(productTypeRaw) : null;
        const payload = portalDb.listPublicQuoteCatalogGrouped(
            productTypeFilter ? { productTypeFilter } : undefined
        );
        let productTypes = portalDb.listCatalogProductTypes();
        if (productTypeFilter) {
            productTypes = productTypes.filter((t) => t.code === productTypeFilter);
        }
        const body = {
            products: payload.products,
            groups: payload.groups,
            product_types: productTypes
        };
        if (productTypeFilter) {
            body.product_type_filter = productTypeFilter;
        }
        res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
        res.json(body);
    } catch (e) {
        next(e);
    }
});

router.get('/catalog/inflatables-availability', (req, res, next) => {
    try {
        const blocks = portalDb.listPublicInflatablesAvailabilityBlocks();
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json({ blocks });
    } catch (e) {
        next(e);
    }
});

router.post('/vouchers/validate', (req, res, next) => {
    try {
        const body = req.body || {};
        const code = body.code != null ? String(body.code) : '';
        const productIds =
            body.product_ids != null
                ? body.product_ids
                : body.productIds != null
                  ? body.productIds
                  : [];
        let channel = body.channel != null ? String(body.channel).trim() : '';
        if (!channel) {
            if (
                body.site === 'eyupinflatables' ||
                body.form_source === 'eyup_inflatables_website'
            ) {
                channel = 'inflatables';
            } else {
                channel = 'events';
            }
        }
        const customerEmail =
            body.customer_email != null
                ? body.customer_email
                : body.email != null
                  ? body.email
                  : null;
        const result = validateVoucherForContext(code, productIds, channel, {
            customerEmail
        });
        res.json(result);
    } catch (e) {
        next(e);
    }
});

router.post('/enquiries', createPublicEnquiry);

module.exports = router;
