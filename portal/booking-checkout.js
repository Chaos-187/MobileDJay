/**
 * Create Stripe Checkout for a booking payment (admin or customer).
 */

const { portalDb, uuid, nowIso } = require('../db/portal-database');
const stripePortal = require('./stripe-portal');

const CHECKOUT_KINDS = new Set(['deposit', 'balance', 'full']);

/**
 * @param {object} params
 * @param {string} params.bookingId
 * @param {'admin'|'customer'} params.actor
 * @param {string} params.actorUserId
 * @param {object} [params.body]
 */
async function createBookingPaymentCheckout(params) {
    const { bookingId, actor, actorUserId, body } = params;
    const booking = portalDb.getBookingById(bookingId);
    if (!booking) {
        return { status: 404, code: 'not_found', message: 'Booking not found' };
    }

    if (actor === 'customer' && booking.customer_id !== actorUserId) {
        return { status: 404, code: 'not_found', message: 'Booking not found' };
    }

    if (!stripePortal.isConfigured()) {
        return {
            status: 503,
            code: 'service_unavailable',
            message: 'Stripe is not configured on this server'
        };
    }

    const kind = body && body.kind ? String(body.kind).trim().toLowerCase() : 'deposit';
    if (!CHECKOUT_KINDS.has(kind)) {
        return {
            status: 422,
            code: 'validation_error',
            message: 'kind must be deposit, balance, or full'
        };
    }

    const amountOverride =
        body && body.amount != null && body.amount !== '' ? Number(body.amount) : null;

    const resolved = stripePortal.resolveCheckoutAmount({
        portalDb,
        booking,
        kind,
        amountOverride: Number.isFinite(amountOverride) ? amountOverride : null
    });
    if (resolved.error) {
        return { status: 422, code: 'validation_error', message: resolved.error };
    }

    const customer = portalDb.getUserById(booking.customer_id);
    if (!customer || !customer.email) {
        return {
            status: 422,
            code: 'validation_error',
            message: 'Booking customer must have an email for Stripe Checkout'
        };
    }

    const urls = stripePortal.defaultCheckoutUrls(booking.reference);
    const successUrl =
        body && body.success_url && String(body.success_url).trim()
            ? String(body.success_url).trim()
            : urls.success_url;
    const cancelUrl =
        body && body.cancel_url && String(body.cancel_url).trim()
            ? String(body.cancel_url).trim()
            : urls.cancel_url;

    const paymentId = uuid();
    const t = nowIso();
    portalDb.insertBookingPayment({
        id: paymentId,
        booking_id: booking.id,
        customer_id: booking.customer_id,
        kind,
        status: 'pending',
        amount: resolved.amount,
        currency: resolved.currency,
        metadata: {
            created_by: actor,
            created_by_user_id: actorUserId,
            quote_total: resolved.quote_total
        },
        created_at: t,
        updated_at: t
    });

    let session;
    try {
        session = await stripePortal.createCheckoutSession({
            paymentId,
            booking,
            customerEmail: customer.email,
            kind,
            amount: resolved.amount,
            currency: resolved.currency,
            successUrl,
            cancelUrl
        });
    } catch (err) {
        portalDb.updateBookingPayment(paymentId, {
            status: 'failed',
            metadata: { error: err.message || 'checkout_create_failed' }
        });
        const status = err.code === 'validation_error' ? 422 : 502;
        return {
            status,
            code: err.code || 'upstream_error',
            message: err.message || 'Could not create Stripe Checkout session'
        };
    }

    portalDb.updateBookingPayment(paymentId, {
        stripe_checkout_session_id: session.id,
        status: 'processing',
        metadata: {
            created_by: actor,
            created_by_user_id: actorUserId,
            quote_total: resolved.quote_total,
            checkout_url: session.url
        }
    });

    return {
        status: 201,
        body: {
            payment_id: paymentId,
            booking_id: booking.id,
            kind,
            amount: resolved.amount,
            currency: resolved.currency,
            checkout_url: session.url,
            stripe_checkout_session_id: session.id,
            expires_at: session.expires_at
                ? new Date(session.expires_at * 1000).toISOString()
                : null
        }
    };
}

module.exports = {
    createBookingPaymentCheckout,
    CHECKOUT_KINDS
};
