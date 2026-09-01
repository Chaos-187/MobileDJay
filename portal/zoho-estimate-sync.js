/**
 * Create Zoho Books estimates (quotes) from portal bookings awaiting deposit.
 */

const zohoBooks = require('./zoho-books');
const { syncCustomerToZoho } = require('./zoho-contact-sync');
const { mapBookingLineItemsToZoho } = require('./zoho-line-items');
const { portalDb } = require('../db/portal-database');

function safeUpdateBookingZohoEstimate(bookingId, patch) {
    try {
        if (typeof portalDb.updateBookingZohoEstimate === 'function') {
            portalDb.updateBookingZohoEstimate(bookingId, patch);
        } else {
            console.error(
                '[portal] updateBookingZohoEstimate missing — deploy latest db/portal-database.js'
            );
        }
    } catch (dbErr) {
        console.error('[portal] updateBookingZohoEstimate failed', dbErr.message || dbErr);
    }
}

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

function estimateReference(booking) {
    const ref = booking.reference || booking.id || 'booking';
    return `${ref}-quote`;
}

function autoEstimatesEnabled() {
    const raw = (process.env.ZOHO_BOOKS_AUTO_ESTIMATES || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function bookingEligibleForEstimate(booking, quote) {
    if (!booking || booking.status === 'cancelled') return false;
    const depPaid = booking.deposit_paid === 1 || booking.deposit_paid === true;
    if (depPaid) return false;
    if (!quote || Number(quote.quote_total) <= 0.005) return false;
    const lineItems = portalDb.getBookingLineItems(booking.id);
    const priced = (lineItems || []).filter((li) => Number(li.line_subtotal) > 0);
    return priced.length > 0;
}

/**
 * @param {string} bookingId
 * @param {{ force?: boolean, mark_sent?: boolean }} opts
 */
async function createBookingZohoEstimate(bookingId, opts = {}) {
    if (!zohoBooks.isConfigured()) {
        const err = new Error('Zoho Books is not configured');
        err.code = 'service_unavailable';
        throw err;
    }

    const force = !!opts.force;
    const booking = portalDb.getBookingById(bookingId);
    if (!booking) {
        const err = new Error('Booking not found');
        err.code = 'not_found';
        throw err;
    }

    const existingId = booking.zoho_estimate_id ? String(booking.zoho_estimate_id) : null;
    if (existingId && !force) {
        return {
            ok: true,
            already_exists: true,
            estimate_id: existingId,
            estimate_url: zohoBooks.estimateWebUrl(existingId),
            estimate: await zohoBooks.getEstimate(existingId).catch(() => null)
        };
    }

    const lineItems = portalDb.getBookingLineItems(bookingId);
    const quote = portalDb.summarizeBookingQuote(lineItems);
    if (!bookingEligibleForEstimate(booking, quote)) {
        const err = new Error(
            'Booking is not eligible for a quote (cancelled, deposit paid, or no priced line items)'
        );
        err.code = 'validation_error';
        throw err;
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

    const zohoLineItems = mapBookingLineItemsToZoho(lineItems);
    const currency = booking.deposit_currency || 'GBP';
    const dueDate = depositDueDate(booking);

    const estimatePayload = {
        customer_id: contactSync.contact_id,
        reference_number: estimateReference(booking),
        date: isoDateOnly(),
        expiry_date: dueDate,
        currency_code: currency,
        line_items: zohoLineItems.length
            ? zohoLineItems
            : [
                  {
                      name: booking.title || 'Event services',
                      rate: quote.quote_total,
                      quantity: 1,
                      description: booking.reference || undefined
                  }
              ],
        notes: `Quote for ${booking.title || 'event'} (${booking.reference || booking.id})`
    };

    try {
        const estimate = await zohoBooks.createEstimate(estimatePayload);
        if (!estimate || !estimate.estimate_id) {
            throw new Error('Zoho did not return an estimate_id');
        }

        const estimateId = String(estimate.estimate_id);
        const now = new Date().toISOString();
        safeUpdateBookingZohoEstimate(bookingId, {
            zoho_estimate_id: estimateId,
            zoho_estimate_synced_at: now,
            zoho_estimate_sync_error: null
        });

        if (opts.mark_sent !== false) {
            await zohoBooks.markEstimateSent(estimateId).catch((err) => {
                console.warn('[portal] zoho mark estimate sent', estimateId, err.message || err);
            });
        }

        return {
            ok: true,
            estimate_id: estimateId,
            estimate_url: zohoBooks.estimateWebUrl(estimateId),
            estimate,
            quote_total: quote.quote_total,
            expiry_date: dueDate,
            customer_id: contactSync.contact_id
        };
    } catch (err) {
        let msg = err && err.message ? String(err.message) : 'Zoho estimate sync failed';
        if (zohoBooks.isZohoAuthorizationError && zohoBooks.isZohoAuthorizationError(err)) {
            msg = `${msg}. ${zohoBooks.zohoAuthRemediation()}`;
        }
        safeUpdateBookingZohoEstimate(bookingId, {
            zoho_estimate_sync_error: msg.slice(0, 500)
        });
        const wrapped = new Error(msg);
        wrapped.code =
            err && err.code
                ? err.code
                : zohoBooks.isZohoAuthorizationError && zohoBooks.isZohoAuthorizationError(err)
                  ? 'zoho_auth_failed'
                  : 'upstream_error';
        wrapped.details = err && err.details ? err.details : undefined;
        throw wrapped;
    }
}

async function syncAllPendingEstimates() {
    if (!zohoBooks.isConfigured()) {
        const err = new Error('Zoho Books is not configured');
        err.code = 'service_unavailable';
        throw err;
    }
    const bookings = portalDb.listBookingsPendingZohoEstimate();
    const results = [];
    for (const b of bookings) {
        if (!b || !b.id) continue;
        try {
            const r = await createBookingZohoEstimate(b.id);
            results.push({
                booking_id: b.id,
                reference: b.reference || null,
                ok: !!r.ok,
                estimate_id: r.estimate_id || null,
                already_exists: !!r.already_exists
            });
        } catch (err) {
            results.push({
                booking_id: b.id,
                reference: b.reference || null,
                ok: false,
                error: err && err.message ? String(err.message) : 'sync_failed'
            });
        }
    }
    return {
        total: results.length,
        synced: results.filter((r) => r.ok && r.estimate_id).length,
        failed: results.filter((r) => !r.ok).length,
        results
    };
}

function scheduleZohoEstimateSync(bookingId) {
    if (!bookingId || !zohoBooks.isConfigured() || !autoEstimatesEnabled()) return;
    setImmediate(() => {
        const booking = portalDb.getBookingById(bookingId);
        if (!booking || booking.zoho_estimate_id) return;
        const lineItems = portalDb.getBookingLineItems(bookingId);
        const quote = portalDb.summarizeBookingQuote(lineItems);
        if (!bookingEligibleForEstimate(booking, quote)) return;
        createBookingZohoEstimate(bookingId).catch((err) => {
            console.error('[portal] zoho estimate sync', bookingId, err.message || err);
        });
    });
}

module.exports = {
    createBookingZohoEstimate,
    syncAllPendingEstimates,
    scheduleZohoEstimateSync,
    autoEstimatesEnabled,
    bookingEligibleForEstimate
};
