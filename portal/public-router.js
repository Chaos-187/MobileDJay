const express = require('express');
const { getSiteSettings } = require('./site-settings-service');
const stripePortal = require('./stripe-portal');
const { syncCheckoutSessionFromStripe } = require('./stripe-checkout-sync');

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
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(settings);
    } catch (e) {
        next(e);
    }
});

module.exports = router;
