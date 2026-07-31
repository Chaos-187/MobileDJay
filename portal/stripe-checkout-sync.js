/**
 * Reconcile portal booking_payments with Stripe Checkout session state.
 */

const stripePortal = require('./stripe-portal');
const { portalDb, nowIso } = require('../db/portal-database');
const { schedulePaymentReceivedEmail } = require('./payment-received-email');

function paymentIdFromSession(session) {
    return (
        (session.metadata && session.metadata.portal_payment_id) ||
        session.client_reference_id ||
        null
    );
}

function resolvePaymentForSession(session) {
    if (!session || !session.id) return null;
    let payment = portalDb.getBookingPaymentByCheckoutSessionId(session.id);
    if (!payment) {
        const pid = paymentIdFromSession(session);
        if (pid) payment = portalDb.getBookingPaymentById(pid);
    }
    return payment;
}

function applyCheckoutCompleted(session) {
    const payment = resolvePaymentForSession(session);
    if (!payment) {
        return { ok: false, reason: 'payment_not_found' };
    }
    if (payment.status === 'paid') {
        schedulePaymentReceivedEmail(payment.id);
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

    schedulePaymentReceivedEmail(payment.id);
    return { ok: true, payment_id: payment.id, booking_id: payment.booking_id, status: 'paid' };
}

function applyCheckoutAbandoned(session, reason) {
    const payment = resolvePaymentForSession(session);
    if (!payment) {
        return { ok: false, reason: 'payment_not_found' };
    }
    if (payment.status === 'paid') {
        return { ok: true, skipped: true, payment_id: payment.id, status: 'paid' };
    }
    if (payment.status === 'cancelled') {
        return { ok: true, skipped: true, payment_id: payment.id, status: 'cancelled' };
    }
    portalDb.updateBookingPayment(payment.id, {
        status: 'cancelled',
        metadata: {
            ...(payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {}),
            cancelled_reason: reason || 'checkout_abandoned',
            cancelled_at: nowIso()
        }
    });
    return { ok: true, payment_id: payment.id, status: 'cancelled' };
}

/**
 * @param {string} sessionId Stripe Checkout Session id (cs_...)
 * @param {{ outcome?: 'success'|'cancel'|'auto' }} [opts]
 */
async function syncCheckoutSessionFromStripe(sessionId, opts = {}) {
    const id = sessionId != null ? String(sessionId).trim() : '';
    if (!id || !id.startsWith('cs_')) {
        const err = new Error('Invalid Stripe session id');
        err.code = 'validation_error';
        throw err;
    }
    if (!stripePortal.isConfigured()) {
        const err = new Error('Stripe is not configured');
        err.code = 'service_unavailable';
        throw err;
    }

    const stripe = stripePortal.getClient();
    const session = await stripe.checkout.sessions.retrieve(id);
    const payment = resolvePaymentForSession(session);

    if (!payment) {
        const err = new Error('No portal payment found for this checkout session');
        err.code = 'not_found';
        throw err;
    }

    const outcome = opts.outcome || 'auto';

    if (session.status === 'complete' && session.payment_status === 'paid') {
        const r = applyCheckoutCompleted(session);
        return {
            payment_id: payment.id,
            booking_id: payment.booking_id,
            portal_status: 'paid',
            stripe_status: session.status,
            synced: !r.duplicate
        };
    }

    const unpaid =
        session.payment_status === 'unpaid' ||
        session.payment_status === 'no_payment_required';

    if (session.status === 'expired' && unpaid) {
        applyCheckoutAbandoned(session, 'session_expired');
        return {
            payment_id: payment.id,
            booking_id: payment.booking_id,
            portal_status: 'cancelled',
            stripe_status: session.status,
            synced: true
        };
    }

    if (unpaid && (session.status === 'open' || outcome === 'cancel')) {
        if (outcome === 'cancel' || outcome === 'auto') {
            applyCheckoutAbandoned(session, outcome === 'cancel' ? 'customer_cancelled' : 'unpaid_open');
            return {
                payment_id: payment.id,
                booking_id: payment.booking_id,
                portal_status: 'cancelled',
                stripe_status: session.status,
                synced: true
            };
        }
    }

    return {
        payment_id: payment.id,
        booking_id: payment.booking_id,
        portal_status: payment.status,
        stripe_status: session.status,
        stripe_payment_status: session.payment_status,
        synced: false
    };
}

module.exports = {
    syncCheckoutSessionFromStripe,
    applyCheckoutCompleted,
    applyCheckoutAbandoned,
    resolvePaymentForSession
};
