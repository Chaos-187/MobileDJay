/**
 * Brevo "payment received" email after booking_payments → paid (Stripe checkout).
 */

const brevoMail = require('./brevo-mail');
const { resolveStripeReceiptUrl, kindLabel } = require('./payment-receipt');
const { portalDb } = require('../db/portal-database');

function formatMoney(amount, currency) {
    const n = Number(amount);
    const cur = currency && String(currency).trim() ? String(currency).trim().toUpperCase() : 'GBP';
    if (!Number.isFinite(n)) return '';
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n);
    } catch {
        return `${n.toFixed(2)} ${cur}`;
    }
}

function formatEventDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function formatPaidAt(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return String(iso);
    }
}

function schedulePaymentReceivedEmail(paymentId) {
    if (!paymentId) return;
    setImmediate(() => {
        sendPaymentReceivedEmailIfNeeded(paymentId).catch((err) => {
            console.error('[portal] payment received email', paymentId, err.message || err);
        });
    });
}

async function sendPaymentReceivedEmailIfNeeded(paymentId) {
    if (!brevoMail.isConfigured() || !brevoMail.getTemplateId('payment_received')) {
        return { skipped: true, reason: 'template_not_configured' };
    }

    const payment = portalDb.getBookingPaymentById(paymentId);
    if (!payment || payment.status !== 'paid') {
        return { skipped: true, reason: 'not_paid' };
    }
    if (payment.payment_email_sent_at && !String(payment.payment_email_sent_at).startsWith('claim:')) {
        return { skipped: true, reason: 'already_sent' };
    }

    if (!portalDb.tryClaimBookingPaymentEmailSend(paymentId)) {
        return { skipped: true, reason: 'already_sent_or_claimed' };
    }

    const customer = portalDb.getUserById(payment.customer_id);
    if (!customer || customer.role !== 'customer' || !customer.email) {
        portalDb.releaseBookingPaymentEmailClaim(paymentId);
        return { skipped: true, reason: 'no_customer_email' };
    }
    if (customer.disabled_at) {
        portalDb.releaseBookingPaymentEmailClaim(paymentId);
        return { skipped: true, reason: 'customer_disabled' };
    }

    const booking = portalDb.getBookingById(payment.booking_id);
    const eventDate = formatEventDate(booking && booking.start_datetime);
    const portalLink = brevoMail.portalCustomerUrl('tab=transactions');

    let receiptLink = '';
    try {
        const stripeUrl = await resolveStripeReceiptUrl(payment);
        if (stripeUrl) receiptLink = stripeUrl;
    } catch {
        /* optional */
    }

    const params = {
        EVENT_TITLE: (booking && booking.title) || 'Your event',
        EVENT_REFERENCE: (booking && booking.reference) || payment.booking_id || '',
        EVENT_DATE: eventDate,
        PAYMENT_KIND: kindLabel(payment.kind),
        PAYMENT_AMOUNT: formatMoney(payment.amount, payment.currency),
        PAID_AT: formatPaidAt(payment.paid_at),
        PORTAL_LINK: portalLink,
        RECEIPT_LINK: receiptLink
    };

    try {
        const sent = await brevoMail.sendCustomerTemplateEmail({
            templateKey: 'payment_received',
            user: customer,
            params,
            tags: ['eyup-portal', 'payment_received', 'payment', payment.id]
        });

        portalDb.markBookingPaymentEmailSent(paymentId);
        return { ok: true, messageId: sent.messageId };
    } catch (err) {
        portalDb.releaseBookingPaymentEmailClaim(paymentId);
        throw err;
    }
}

module.exports = {
    schedulePaymentReceivedEmail,
    sendPaymentReceivedEmailIfNeeded
};
