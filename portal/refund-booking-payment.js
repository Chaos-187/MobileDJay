/**
 * Refund a paid booking_payments row via Stripe and update portal + booking state.
 */

const stripePortal = require('./stripe-portal');
const { portalDb, nowIso } = require('../db/portal-database');

async function resolvePaymentIntentId(payment) {
    if (!payment) return null;
    if (payment.stripe_payment_intent_id) {
        return String(payment.stripe_payment_intent_id);
    }
    if (!payment.stripe_checkout_session_id || !stripePortal.isConfigured()) {
        return null;
    }
    const stripe = stripePortal.getClient();
    const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
    const pi = session.payment_intent;
    if (typeof pi === 'string') return pi;
    if (pi && pi.id) return pi.id;
    return null;
}

/**
 * @param {string} paymentId
 * @param {{ adminUserId?: string, reason?: string }} [opts]
 */
async function refundBookingPayment(paymentId, opts = {}) {
    const payment = portalDb.getBookingPaymentById(paymentId);
    if (!payment) {
        return { status: 404, code: 'not_found', message: 'Payment not found' };
    }
    if (payment.status !== 'paid') {
        return {
            status: 422,
            code: 'validation_error',
            message: 'Only paid payments can be refunded'
        };
    }
    if (!stripePortal.isConfigured()) {
        return {
            status: 503,
            code: 'service_unavailable',
            message: 'Stripe is not configured'
        };
    }

    let intentId;
    try {
        intentId = await resolvePaymentIntentId(payment);
    } catch (err) {
        return {
            status: 502,
            code: 'upstream_error',
            message: err.message || 'Could not load Stripe payment details'
        };
    }
    if (!intentId) {
        return {
            status: 422,
            code: 'validation_error',
            message: 'This payment has no Stripe charge to refund (manual deposit only)'
        };
    }

    let refund;
    try {
        refund = await stripePortal.getClient().refunds.create({
            payment_intent: intentId,
            reason: 'requested_by_customer'
        });
    } catch (err) {
        return {
            status: err.statusCode === 404 ? 422 : 502,
            code: 'stripe_refund_failed',
            message: err.message || 'Stripe refund failed'
        };
    }

    const updated = portalDb.applyBookingPaymentRefund(payment.id, {
        stripe_refund_id: refund.id,
        refunded_at: nowIso(),
        admin_user_id: opts.adminUserId || null,
        reason: opts.reason || null
    });

    if (intentId && !payment.stripe_payment_intent_id) {
        portalDb.updateBookingPayment(payment.id, {
            stripe_payment_intent_id: intentId
        });
    }

    return {
        status: 200,
        body: {
            payment_id: payment.id,
            booking_id: payment.booking_id,
            status: 'refunded',
            stripe_refund_id: refund.id,
            payment: updated
        }
    };
}

module.exports = { refundBookingPayment, resolvePaymentIntentId };
