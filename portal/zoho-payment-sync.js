/**
 * Record portal booking payments in Zoho Books (Stripe / cash → customer payment).
 */

const zohoBooks = require('./zoho-books');
const { portalDb } = require('../db/portal-database');

function paymentModeForMetadata(metadata) {
    if (metadata && metadata.method === 'cash') return 'cash';
    if (metadata && metadata.stripe) return 'creditcard';
    return 'creditcard';
}

/**
 * Apply a paid portal payment to the linked Zoho invoice.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, payment_id?: string }>}
 */
async function syncPaymentToZoho(paymentId) {
    if (!zohoBooks.isConfigured()) {
        return { ok: false, skipped: true, reason: 'not_configured' };
    }

    const payment = portalDb.getBookingPaymentById(paymentId);
    if (!payment || payment.status !== 'paid') {
        return { ok: false, skipped: true, reason: 'not_paid' };
    }
    if (payment.zoho_payment_synced_at && !String(payment.zoho_payment_synced_at).startsWith('claim:')) {
        return { ok: false, skipped: true, reason: 'already_synced' };
    }

    const booking = portalDb.getBookingById(payment.booking_id);
    if (!booking) {
        return { ok: false, reason: 'booking_not_found' };
    }

    let invoiceId = payment.zoho_invoice_id || null;
    if (!invoiceId) {
        const kind = payment.kind === 'deposit' ? 'deposit' : payment.kind === 'full' ? 'full' : 'balance';
        invoiceId = portalDb.getBookingZohoInvoiceId(booking, kind);
    }
    if (!invoiceId) {
        portalDb.updateBookingPaymentZoho(paymentId, {
            zoho_sync_error: 'No Zoho invoice linked — create an invoice first'
        });
        return { ok: false, reason: 'no_invoice' };
    }

    const customer = portalDb.getUserById(payment.customer_id);
    const zohoContactId = customer && customer.zoho_contact_id ? String(customer.zoho_contact_id) : null;
    if (!zohoContactId) {
        portalDb.updateBookingPaymentZoho(paymentId, {
            zoho_sync_error: 'Customer not synced to Zoho'
        });
        return { ok: false, reason: 'no_zoho_contact' };
    }

    try {
        const payload = {
            customer_id: zohoContactId,
            payment_mode: paymentModeForMetadata(payment.metadata),
            amount: payment.amount,
            date: (payment.paid_at || new Date().toISOString()).slice(0, 10),
            reference_number: payment.id,
            description: `Portal ${payment.kind} payment — ${booking.reference || booking.id}`,
            invoices: [
                {
                    invoice_id: invoiceId,
                    amount_applied: payment.amount
                }
            ]
        };
        const zohoPayment = await zohoBooks.createCustomerPayment(payload);
        const zohoPaymentId =
            zohoPayment && zohoPayment.payment_id ? String(zohoPayment.payment_id) : null;
        const now = new Date().toISOString();
        portalDb.updateBookingPaymentZoho(paymentId, {
            zoho_invoice_id: invoiceId,
            zoho_payment_id: zohoPaymentId,
            zoho_payment_synced_at: now,
            zoho_sync_error: null
        });
        return { ok: true, payment_id: zohoPaymentId, zoho_payment: zohoPayment, synced_at: now };
    } catch (err) {
        const msg = err && err.message ? String(err.message) : 'Zoho payment sync failed';
        portalDb.updateBookingPaymentZoho(paymentId, {
            zoho_sync_error: msg.slice(0, 500)
        });
        throw err;
    }
}

function scheduleZohoPaymentSync(paymentId) {
    if (!paymentId || !zohoBooks.isConfigured()) return;
    setImmediate(() => {
        syncPaymentToZoho(paymentId).catch((err) => {
            console.error('[portal] zoho payment sync', paymentId, err.message || err);
        });
    });
}

module.exports = {
    syncPaymentToZoho,
    scheduleZohoPaymentSync
};
