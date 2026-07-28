/**
 * Stripe Checkout + webhook helpers for portal booking payments.
 */

const Stripe = require('stripe');

function secretKey() {
    return process.env.STRIPE_SECRET_KEY || '';
}

function webhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || '';
}

let stripeClient = null;

function getClient() {
    const key = secretKey();
    if (!key) return null;
    if (!stripeClient) {
        stripeClient = new Stripe(key);
    }
    return stripeClient;
}

function isConfigured() {
    return secretKey().length > 0;
}

function isWebhookConfigured() {
    return webhookSecret().length > 0;
}

function publicOrigin() {
    const explicit =
        process.env.PORTAL_PUBLIC_ORIGIN ||
        process.env.EYUP_PORTAL_PUBLIC_ORIGIN ||
        process.env.STRIPE_CHECKOUT_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    const cors = process.env.PORTAL_CORS_ORIGINS || '';
    const first = cors
        .split(',')
        .map((s) => s.trim())
        .find((o) => o && /^https?:\/\//i.test(o));
    return first ? first.replace(/\/$/, '') : 'https://eyupevents.uk';
}

function defaultCheckoutUrls(bookingReference) {
    const ref = bookingReference ? encodeURIComponent(String(bookingReference)) : '';
    const base = publicOrigin();
    const success =
        process.env.STRIPE_CHECKOUT_SUCCESS_URL ||
        `${base}/events/customer?payment=success${ref ? '&ref=' + ref : ''}`;
    const cancel =
        process.env.STRIPE_CHECKOUT_CANCEL_URL ||
        `${base}/events/customer?payment=cancelled${ref ? '&ref=' + ref : ''}`;
    return { success_url: success, cancel_url: cancel };
}

function toStripeCurrency(code) {
    return String(code || 'GBP')
        .trim()
        .toLowerCase();
}

function toMinorUnits(amountMajor, currency) {
    const n = Number(amountMajor);
    if (!Number.isFinite(n) || n <= 0) return null;
    const cur = toStripeCurrency(currency);
    const zeroDecimal = new Set(['jpy', 'krw', 'vnd']);
    if (zeroDecimal.has(cur)) return Math.round(n);
    return Math.round(n * 100);
}

function kindLabel(kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'deposit') return 'Deposit';
    if (k === 'balance') return 'Balance';
    if (k === 'full') return 'Full payment';
    return 'Payment';
}

/**
 * @param {object} opts
 * @param {import('../db/portal-database').portalDb} opts.portalDb
 */
function resolveCheckoutAmount(opts) {
    const { portalDb, booking, kind, amountOverride, lineItems } = opts;
    const currency =
        booking.deposit_currency && String(booking.deposit_currency).trim()
            ? String(booking.deposit_currency).trim().toUpperCase()
            : 'GBP';
    const quote = portalDb.summarizeBookingQuote(lineItems || portalDb.getBookingLineItems(booking.id));
    const quoteTotal = Number(quote.quote_total) || 0;
    const depositAmount =
        booking.deposit_amount != null && Number.isFinite(Number(booking.deposit_amount))
            ? Number(booking.deposit_amount)
            : 0;
    const depositPaid = booking.deposit_paid === 1 || booking.deposit_paid === true;

    if (amountOverride != null && amountOverride !== '') {
        const a = Number(amountOverride);
        if (!Number.isFinite(a) || a <= 0) {
            return { error: 'amount must be a positive number' };
        }
        return { amount: Math.round(a * 100) / 100, currency, quote_total: quoteTotal };
    }

    const k = String(kind || '').toLowerCase();
    if (k === 'deposit') {
        if (depositPaid) {
            return { error: 'Deposit is already marked paid on this booking' };
        }
        if (depositAmount <= 0) {
            return {
                error: 'Set a deposit amount on the booking or pass amount in the request body'
            };
        }
        return { amount: depositAmount, currency, quote_total: quoteTotal };
    }
    if (k === 'balance') {
        if (quoteTotal <= 0) {
            return {
                error: 'Add catalog line items to the booking (or pass amount) to charge a balance'
            };
        }
        const paidDeposit = depositPaid && depositAmount > 0 ? depositAmount : 0;
        const paidOther = portalDb.sumPaidBookingPayments(booking.id, ['balance', 'full']);
        const due = Math.round((quoteTotal - paidDeposit - paidOther) * 100) / 100;
        if (due <= 0) {
            return { error: 'No balance remaining on this booking' };
        }
        if (!depositPaid && depositAmount > 0) {
            return { error: 'Deposit must be paid before charging the balance' };
        }
        return { amount: due, currency, quote_total: quoteTotal };
    }
    if (k === 'full') {
        if (quoteTotal <= 0) {
            return {
                error: 'Add catalog line items to the booking (or pass amount) for a full payment'
            };
        }
        const paid = portalDb.sumPaidBookingPayments(booking.id, ['deposit', 'balance', 'full']);
        const due = Math.round((quoteTotal - paid) * 100) / 100;
        if (due <= 0) {
            return { error: 'This booking is already fully paid' };
        }
        return { amount: due, currency, quote_total: quoteTotal };
    }
    return { error: 'kind must be deposit, balance, or full' };
}

async function createCheckoutSession({
    paymentId,
    booking,
    customerEmail,
    customerName,
    kind,
    amount,
    currency,
    successUrl,
    cancelUrl
}) {
    const stripe = getClient();
    if (!stripe) {
        const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY)');
        err.code = 'stripe_not_configured';
        throw err;
    }
    const unitAmount = toMinorUnits(amount, currency);
    if (unitAmount == null || unitAmount < 30) {
        const err = new Error('Payment amount is too small for Stripe');
        err.code = 'validation_error';
        throw err;
    }
    const cur = toStripeCurrency(currency);
    const title = booking.title || 'Event booking';
    const ref = booking.reference || booking.id;
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: customerEmail || undefined,
        client_reference_id: paymentId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            portal_payment_id: paymentId,
            booking_id: booking.id,
            customer_id: booking.customer_id,
            kind: String(kind),
            booking_reference: String(ref)
        },
        line_items: [
            {
                quantity: 1,
                price_data: {
                    currency: cur,
                    unit_amount: unitAmount,
                    product_data: {
                        name: `EYUP EVENTS — ${kindLabel(kind)} (${ref})`,
                        description: title
                    }
                }
            }
        ]
    });
    return session;
}

function constructWebhookEvent(rawBody, signatureHeader) {
    const stripe = getClient();
    const secret = webhookSecret();
    if (!stripe || !secret) {
        const err = new Error('Stripe webhook is not configured');
        err.code = 'stripe_webhook_not_configured';
        throw err;
    }
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

module.exports = {
    getClient,
    isConfigured,
    isWebhookConfigured,
    publicOrigin,
    defaultCheckoutUrls,
    resolveCheckoutAmount,
    createCheckoutSession,
    constructWebhookEvent,
    kindLabel,
    toMinorUnits
};
