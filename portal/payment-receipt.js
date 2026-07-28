/**
 * Customer payment receipts — HTML download + Stripe hosted receipt URL.
 */

const stripePortal = require('./stripe-portal');
const { resolvePaymentIntentId } = require('./refund-booking-payment');
const { portalDb } = require('../db/portal-database');

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatMoney(amount, currency) {
    const n = Number(amount);
    const cur = currency && String(currency).trim() ? String(currency).trim().toUpperCase() : 'GBP';
    if (!Number.isFinite(n)) return '—';
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n);
    } catch {
        return cur + ' ' + n.toFixed(2);
    }
}

function formatDate(iso) {
    if (!iso) return '—';
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

function kindLabel(kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'deposit') return 'Deposit';
    if (k === 'balance') return 'Balance';
    if (k === 'full') return 'Full payment';
    return 'Payment';
}

function paymentReceiptAllowed(payment) {
    if (!payment) return false;
    const st = String(payment.status || '').toLowerCase();
    return st === 'paid' || st === 'refunded';
}

function buildPaymentReceiptHtml({ payment, booking, customer }) {
    const name = customer
        ? [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
          customer.email ||
          'Customer'
        : 'Customer';
    const statusLabel =
        payment.status === 'refunded' ? 'Refunded' : 'Paid';
    const meta = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {};
    const refundNote =
        payment.status === 'refunded' && meta.stripe_refund_id
            ? `<p class="note">This payment was refunded (Stripe refund ${escapeHtml(meta.stripe_refund_id)}).</p>`
            : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt — ${escapeHtml(booking && booking.reference ? booking.reference : payment.id)}</title>
<style>
  body { font-family: system-ui, Segoe UI, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1.25rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
  .brand { font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: #666; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin: 1.25rem 0; }
  th, td { text-align: left; padding: 0.5rem 0; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { width: 38%; color: #555; font-weight: 600; }
  .amount { font-size: 1.25rem; font-weight: 700; }
  .note { font-size: 0.9rem; color: #555; margin-top: 1.5rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<p class="brand">EYUP EVENTS — payment receipt</p>
<h1>${escapeHtml(kindLabel(payment.kind))}</h1>
<p>Receipt for <strong>${escapeHtml(name)}</strong></p>
<table>
  <tr><th>Status</th><td>${escapeHtml(statusLabel)}</td></tr>
  <tr><th>Amount</th><td class="amount">${escapeHtml(formatMoney(payment.amount, payment.currency))}</td></tr>
  <tr><th>Date</th><td>${escapeHtml(formatDate(payment.paid_at || payment.created_at))}</td></tr>
  <tr><th>Booking</th><td>${escapeHtml(booking && booking.title ? booking.title : '—')}</td></tr>
  <tr><th>Reference</th><td>${escapeHtml(booking && booking.reference ? booking.reference : '—')}</td></tr>
  <tr><th>Event date</th><td>${escapeHtml(formatDate(booking && booking.start_datetime))}</td></tr>
  <tr><th>Payment ID</th><td><code>${escapeHtml(payment.id)}</code></td></tr>
</table>
${refundNote}
<p class="note">Thank you for booking with EYUP EVENTS. Keep this file for your records. Questions? Contact us via eyupevents.uk.</p>
</body>
</html>`;
}

async function resolveStripeReceiptUrl(payment) {
    if (!stripePortal.isConfigured()) return null;
    let intentId;
    try {
        intentId = await resolvePaymentIntentId(payment);
    } catch {
        return null;
    }
    if (!intentId) return null;
    try {
        const stripe = stripePortal.getClient();
        const pi = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
        let charge = pi.latest_charge;
        if (!charge) return null;
        if (typeof charge === 'string') {
            charge = await stripe.charges.retrieve(charge);
        }
        return charge.receipt_url || null;
    } catch {
        return null;
    }
}

function enrichCustomerTransactionRow(payment) {
    const b = portalDb.getBookingById(payment.booking_id);
    const receiptAvailable = paymentReceiptAllowed(payment);
    return {
        id: payment.id,
        booking_id: payment.booking_id,
        kind: payment.kind,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paid_at: payment.paid_at || null,
        created_at: payment.created_at || null,
        booking_reference: b ? b.reference : null,
        booking_title: b ? b.title : null,
        receipt_available: receiptAvailable,
        stripe_receipt_eligible:
            receiptAvailable &&
            !!(payment.stripe_payment_intent_id || payment.stripe_checkout_session_id)
    };
}

module.exports = {
    buildPaymentReceiptHtml,
    resolveStripeReceiptUrl,
    paymentReceiptAllowed,
    enrichCustomerTransactionRow,
    kindLabel
};
