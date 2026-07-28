/**
 * Stripe webhook — mount with express.raw({ type: 'application/json' }) before express.json().
 */

const stripePortal = require('./stripe-portal');
const {
    applyCheckoutCompleted,
    applyCheckoutAbandoned,
    resolvePaymentForSession
} = require('./stripe-checkout-sync');

function jsonError(res, code, message, status = 400) {
    res.status(status).json({ error: { code, message } });
}

function applyCheckoutExpired(session) {
    const payment = resolvePaymentForSession(session);
    if (!payment) return { ok: false };
    if (payment.status === 'paid') return { ok: true, skipped: true };
    if (payment.status === 'cancelled') return { ok: true, skipped: true };
    applyCheckoutAbandoned(session, 'session_expired');
    return { ok: true, payment_id: payment.id };
}

async function handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        return jsonError(res, 'validation_error', 'Missing Stripe-Signature header', 400);
    }
    if (!stripePortal.isWebhookConfigured()) {
        return jsonError(res, 'service_unavailable', 'Stripe webhook secret is not configured', 503);
    }

    let event;
    try {
        event = stripePortal.constructWebhookEvent(req.body, sig);
    } catch (err) {
        console.warn('[stripe] webhook signature', err.message || err);
        return jsonError(res, 'invalid_signature', 'Webhook signature verification failed', 400);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                applyCheckoutCompleted(event.data.object);
                break;
            case 'checkout.session.expired':
                applyCheckoutExpired(event.data.object);
                break;
            default:
                break;
        }
    } catch (err) {
        console.error('[stripe] webhook handler', err);
        return jsonError(res, 'internal_error', 'Webhook processing failed', 500);
    }

    res.json({ received: true });
}

module.exports = { handleStripeWebhook, applyCheckoutCompleted };
