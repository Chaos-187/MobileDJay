/**
 * Create Zoho Books invoices from portal bookings.
 */

const zohoBooks = require('./zoho-books');
const { syncCustomerToZoho } = require('./zoho-contact-sync');
const { mapBookingLineItemsToZoho } = require('./zoho-line-items');
const { computeBalanceDueAt } = require('./customer-payment-schedule');
const { portalDb } = require('../db/portal-database');

function isoDateOnly(iso) {
    if (!iso) return new Date().toISOString().slice(0, 10);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function depositDueDate(booking) {
    if (booking.deposit_due_at) return isoDateOnly(booking.deposit_due_at);
    const created = booking.created_at ? isoDateOnly(booking.created_at) : isoDateOnly();
    const d = new Date(created + 'T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString().slice(0, 10);
}

function balanceDueDate(booking) {
    const due = computeBalanceDueAt(booking);
    return isoDateOnly(due || booking.start_datetime);
}

function kindLabel(kind) {
    if (kind === 'deposit') return 'Deposit';
    if (kind === 'balance') return 'Balance';
    return 'Full quote';
}

function invoiceReference(booking, kind) {
    const ref = booking.reference || booking.id || 'booking';
    return `${ref}-${kind}`;
}

function buildInvoiceLineItems(booking, lineItems, quote, settlement, kind) {
    const currency = booking.deposit_currency || 'GBP';
    if (kind === 'full') {
        const items = mapBookingLineItemsToZoho(lineItems);
        if (items.length) return { line_items: items, currency_code: currency, amount: quote.quote_total };
        return {
            line_items: [
                {
                    name: booking.title || 'Event services',
                    rate: quote.quote_total,
                    quantity: 1,
                    description: booking.reference || undefined
                }
            ],
            currency_code: currency,
            amount: quote.quote_total
        };
    }
    if (kind === 'deposit') {
        const dep =
            booking.deposit_amount != null && Number.isFinite(Number(booking.deposit_amount))
                ? Number(booking.deposit_amount)
                : Math.round(quote.quote_total * 0.25 * 100) / 100;
        return {
            line_items: [
                {
                    name: `Deposit — ${booking.title || booking.reference || 'Event'}`,
                    rate: dep,
                    quantity: 1,
                    description: `Ref ${booking.reference || booking.id}`
                }
            ],
            currency_code: currency,
            amount: dep
        };
    }
    const remaining = Math.round((settlement.balance_remaining || 0) * 100) / 100;
    return {
        line_items: [
            {
                name: `Balance — ${booking.title || booking.reference || 'Event'}`,
                rate: remaining,
                quantity: 1,
                description: `Ref ${booking.reference || booking.id}`
            }
        ],
        currency_code: currency,
        amount: remaining
    };
}

/**
 * @param {string} bookingId
 * @param {{ kind?: 'deposit'|'balance'|'full', force?: boolean, mark_sent?: boolean }} opts
 */
async function createBookingZohoInvoice(bookingId, opts = {}) {
    if (!zohoBooks.isConfigured()) {
        const err = new Error('Zoho Books is not configured');
        err.code = 'service_unavailable';
        throw err;
    }

    const kindRaw = opts.kind != null ? String(opts.kind).trim().toLowerCase() : 'balance';
    const kind = ['deposit', 'balance', 'full'].includes(kindRaw) ? kindRaw : 'balance';
    const force = !!opts.force;

    const booking = portalDb.getBookingById(bookingId);
    if (!booking) {
        const err = new Error('Booking not found');
        err.code = 'not_found';
        throw err;
    }

    const existingId = portalDb.getBookingZohoInvoiceId(booking, kind);
    if (existingId && !force) {
        return {
            ok: true,
            already_exists: true,
            kind,
            invoice_id: existingId,
            invoice_url: zohoBooks.invoiceWebUrl(existingId),
            invoice: await zohoBooks.getInvoice(existingId).catch(() => null)
        };
    }

    const customer = portalDb.getUserById(booking.customer_id);
    if (!customer || customer.role !== 'customer') {
        const err = new Error('Booking has no customer account');
        err.code = 'validation_error';
        throw err;
    }

    const contactSync = await syncCustomerToZoho(booking.customer_id);
    if (!contactSync.ok || !contactSync.contact_id) {
        const err = new Error(contactSync.reason || 'Could not sync customer to Zoho');
        err.code = 'upstream_error';
        throw err;
    }

    const lineItems = portalDb.getBookingLineItems(bookingId);
    const quote = portalDb.summarizeBookingQuote(lineItems);
    const settlement = portalDb.bookingSettlementSnapshot(booking);

    if (kind === 'deposit') {
        const depPaid = booking.deposit_paid === 1 || booking.deposit_paid === true;
        if (depPaid && !force) {
            const err = new Error('Deposit is already marked paid');
            err.code = 'conflict';
            throw err;
        }
    }
    if (kind === 'balance' && settlement.balance_remaining <= 0.005 && !force) {
        const err = new Error('No balance remaining to invoice');
        err.code = 'conflict';
        throw err;
    }
    if (kind === 'full' && quote.quote_total <= 0.005) {
        const err = new Error('Add quote line items before creating a full invoice');
        err.code = 'validation_error';
        throw err;
    }

    const built = buildInvoiceLineItems(booking, lineItems, quote, settlement, kind);
    const dueDate =
        kind === 'deposit' ? depositDueDate(booking) : balanceDueDate(booking);

    const invoicePayload = {
        customer_id: contactSync.contact_id,
        reference_number: invoiceReference(booking, kind),
        date: isoDateOnly(),
        due_date: dueDate,
        currency_code: built.currency_code || 'GBP',
        line_items: built.line_items,
        notes: `${kindLabel(kind)} invoice for ${booking.title || 'event'} (${booking.reference || booking.id})`
    };

    const invoice = await zohoBooks.createInvoice(invoicePayload);
    if (!invoice || !invoice.invoice_id) {
        const err = new Error('Zoho did not return an invoice_id');
        err.code = 'upstream_error';
        throw err;
    }

    const invoiceId = String(invoice.invoice_id);
    portalDb.updateBookingZohoInvoice(bookingId, kind, invoiceId);

    if (opts.mark_sent !== false) {
        await zohoBooks.markInvoiceSent(invoiceId).catch((err) => {
            console.warn('[portal] zoho mark invoice sent', invoiceId, err.message || err);
        });
    }

    return {
        ok: true,
        kind,
        invoice_id: invoiceId,
        invoice_url: zohoBooks.invoiceWebUrl(invoiceId),
        invoice,
        quote_total: quote.quote_total,
        amount: built.amount,
        due_date: dueDate,
        customer_id: contactSync.contact_id
    };
}

function zohoStatusForBooking(booking) {
    if (!booking) return null;
    return {
        zoho_books_configured: zohoBooks.isConfigured(),
        deposit_invoice_id: booking.zoho_deposit_invoice_id || null,
        deposit_invoice_url: zohoBooks.invoiceWebUrl(booking.zoho_deposit_invoice_id),
        balance_invoice_id: booking.zoho_balance_invoice_id || null,
        balance_invoice_url: zohoBooks.invoiceWebUrl(booking.zoho_balance_invoice_id),
        full_invoice_id: booking.zoho_full_invoice_id || null,
        full_invoice_url: zohoBooks.invoiceWebUrl(booking.zoho_full_invoice_id),
        estimate_id: booking.zoho_estimate_id || null,
        estimate_url: zohoBooks.estimateWebUrl(booking.zoho_estimate_id),
        quote_in_zoho: !!(booking.zoho_estimate_id && String(booking.zoho_estimate_id).trim()),
        estimate_synced_at: booking.zoho_estimate_synced_at || null,
        estimate_sync_error: booking.zoho_estimate_sync_error || null
    };
}

module.exports = {
    createBookingZohoInvoice,
    zohoStatusForBooking
};
