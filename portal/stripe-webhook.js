/**
 * Stripe webhook — mount with express.raw({ type: 'application/json' }) before express.json().
 */

const stripePortal = require('./stripe-portal');
const { portalDb, nowIso } = require('../db/portal-database');

function jsonError(res, code, message, status = 400) {
    res.status(status).json({ error: { code, message } });
}

function applyCheckoutCompleted(session) {
    const paymentId =
        (session.metadata && session.metadata.portal_payment_id) ||
        session.client_reference_id;
    if (!paymentId) {
        console.warn('[stripe] checkout.session.completed without payment id');
        return { ok: false, reason: 'missing_payment_id' };
    }

    let payment = portalDb.getBookingPaymentById(paymentId);
    if (!payment && session.id) {
        payment = portalDb.getBookingPaymentByCheckoutSessionId(session.id);
    }
    if (!payment) {
        console.warn('[stripe] unknown payment', paymentId);
        return { ok: false, reason: 'payment_not_found' };
    }

    if (payment.status === 'paid') {
        return { ok: true, duplicate: true, payment_id: payment.id };
    }

    const paidAt = nowIso();
    const intentId =
        typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent && session.payment_intent.id
              ? session.payment_intent.id
              : null;

    portalDb.completeBookingPayment(payment.id, {
        status: 'paid',
        paid_at: paidAt,
        stripe_payment_intent_id: intentId,
        stripe_checkout_session_id: session.id
    });

    return { ok: true, payment_id: payment.id, booking_id: payment.booking_id };
}

function applyCheckoutExpired(session) {
    const paymentId =
        (session.metadata && session.metadata.portal_payment_id) ||
        session.client_reference_id;
    if (!paymentId) return { ok: false };
    const payment = portalDb.getBookingPaymentById(paymentId);
    if (!payment || payment.status === 'paid') return { ok: true, skipped: true };
    if (payment.status === 'cancelled') return { ok: true, skipped: true };
    portalDb.updateBookingPayment(payment.id, { status: 'cancelled' });
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
