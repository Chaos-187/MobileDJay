const express = require('express');
const crypto = require('crypto');
const { portalDb, uuid } = require('../db/portal-database');
const { hashPassword, validatePortalPasswordPlain } = require('./auth-tokens');
const { createRequestsEventForBooking } = require('./create-requests-event-for-booking');

const router = express.Router();

function jsonError(res, code, message, status = 400, details = {}) {
    res.status(status).json({ error: { code, message, details } });
}

function constantTimeEqual(a, b) {
    const x = Buffer.from(String(a || ''), 'utf8');
    const y = Buffer.from(String(b || ''), 'utf8');
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
}

function requireInternalKey(req, res, next) {
    const configured = process.env.PORTAL_INTERNAL_API_KEY;
    if (!configured || configured.length < 16) {
        return jsonError(
            res,
            'service_unavailable',
            'Internal API is disabled (set PORTAL_INTERNAL_API_KEY to a long random secret)',
            503
        );
    }
    const sent = req.headers['x-portal-internal-key'];
    if (!sent || !constantTimeEqual(sent, configured)) {
        return jsonError(res, 'unauthorized', 'Invalid or missing X-Portal-Internal-Key', 401);
    }
    next();
}

function generateUniqueReference() {
    for (let i = 0; i < 12; i++) {
        const ref = `EY-${1000 + Math.floor(Math.random() * 9000)}`;
        const row = portalDb.db.prepare('SELECT 1 AS ok FROM bookings WHERE reference = ?').get(ref);
        if (!row) return ref;
    }
    return `EY-${uuid().slice(0, 8).toUpperCase()}`;
}

function randomPassword() {
    return crypto.randomBytes(18).toString('base64url');
}

function parseJsonMaybe(s) {
    if (s == null || s === '') return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

router.use(requireInternalKey);

/**
 * Create portal user (customer, dj, or admin). Intended for n8n / back-office automation.
 * POST /api/v1/internal/users
 */
router.post('/users', async (req, res) => {
    try {
        const { email, role, password, first_name: firstName, last_name: lastName } = req.body || {};
        if (!email || typeof email !== 'string') {
            return jsonError(res, 'validation_error', 'email is required', 422);
        }
        if (!role || !['customer', 'dj', 'admin'].includes(role)) {
            return jsonError(res, 'validation_error', 'role must be customer, dj, or admin', 422);
        }
        if (portalDb.getUserByEmail(email)) {
            return jsonError(res, 'conflict', 'An account with this email already exists', 409);
        }
        const plain = password != null && String(password).length > 0 ? String(password) : randomPassword();
        const passwordGenerated = password == null || String(password).length === 0;
        const pv = validatePortalPasswordPlain(plain);
        if (!pv.ok) {
            return jsonError(res, 'validation_error', pv.message, 422);
        }
        const passwordHash = await hashPassword(plain);
        const id = portalDb.createUser({
            email,
            passwordHash,
            role,
            firstName,
            lastName
        });
        const user = portalDb.getUserById(id);
        const out = {
            id: user.id,
            email: user.email,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name
        };
        if (passwordGenerated) {
            out.temporary_password = plain;
            out._warning = 'Store or email this password now; it will not be shown again.';
        }
        res.status(201).json(out);
    } catch (err) {
        console.error('[portal] internal/users', err);
        return jsonError(res, 'internal_error', 'User creation failed', 500);
    }
});

/**
 * Create booking and optionally assign DJs by id or email.
 * POST /api/v1/internal/bookings
 */
function handleInternalCreateBooking(req, res) {
    try {
        const body = req.body || {};
        const {
            customer_id: customerIdIn,
            customer_email: customerEmailIn,
            title,
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            venue,
            service,
            status,
            reference: referenceIn,
            contact_name: contactName,
            notes_from_company: notesFromCompany,
            dj_briefing: djBriefing,
            dj_user_ids: djUserIds,
            dj_emails: djEmails,
            deposit_paid: depositPaidIn,
            deposit_amount: depositAmountIn,
            deposit_currency: depositCurrencyIn,
            deposit_paid_at: depositPaidAtIn,
            deposit_note: depositNoteIn,
            guest_count_range: guestCountRange,
            event_type: eventType,
            services_required: servicesRequired,
            enquiry_message: enquiryMessage,
            hear_about: hearAbout,
            newsletter_opt_in: newsletterOptIn,
            lead_metadata: leadMetadata,
            first_name: bodyFirstName,
            last_name: bodyLastName,
            phone: bodyPhone,
            account_manager_user_id: accountManagerUserId
        } = body;

        let customerId = customerIdIn;
        if (!customerId && customerEmailIn) {
            const u = portalDb.getUserByEmail(customerEmailIn);
            if (u) {
                if (u.role !== 'customer') {
                    return jsonError(
                        res,
                        'validation_error',
                        'customer_email must refer to a user with role customer',
                        422
                    );
                }
                customerId = u.id;
            } else {
                const r = portalDb.upsertCustomerForBooking({
                    email: customerEmailIn,
                    first_name: bodyFirstName,
                    last_name: bodyLastName,
                    phone: bodyPhone,
                    account_manager_user_id: accountManagerUserId
                });
                if (r.error) {
                    return jsonError(res, 'conflict', 'customer_email matches a non-customer account', 409);
                }
                customerId = r.user.id;
            }
        }
        if (!customerId || typeof customerId !== 'string') {
            return jsonError(res, 'validation_error', 'customer_id or customer_email is required', 422);
        }
        const cust = portalDb.getUserById(customerId);
        if (!cust || cust.role !== 'customer') {
            return jsonError(res, 'not_found', 'customer not found', 404);
        }
        if (!title || !startDatetime || !endDatetime) {
            return jsonError(res, 'validation_error', 'title, start_datetime, and end_datetime are required', 422);
        }
        const st = status && ['confirmed', 'pending', 'cancelled'].includes(status) ? status : 'pending';
        const reference = referenceIn && String(referenceIn).trim() ? String(referenceIn).trim() : generateUniqueReference();
        const existingRef = portalDb.db.prepare('SELECT 1 AS ok FROM bookings WHERE reference = ?').get(reference);
        if (existingRef) {
            return jsonError(res, 'conflict', 'reference already in use', 409);
        }
        const bookingId = uuid();
        portalDb.insertBooking({
            id: bookingId,
            customer_id: customerId,
            title: String(title),
            start_datetime: String(startDatetime),
            end_datetime: String(endDatetime),
            venue: venue != null ? String(venue) : '',
            service: service != null ? String(service) : '',
            status: st,
            reference,
            contact_name: contactName != null ? String(contactName) : '',
            notes_from_company: notesFromCompany != null ? String(notesFromCompany) : null,
            dj_briefing: djBriefing != null ? String(djBriefing) : null,
            guest_count_range: guestCountRange,
            event_type: eventType,
            services_required: servicesRequired,
            enquiry_message: enquiryMessage,
            hear_about: hearAbout,
            newsletter_opt_in: !!newsletterOptIn,
            lead_metadata: leadMetadata,
            deposit_paid: !!depositPaidIn,
            deposit_amount: depositAmountIn,
            deposit_currency: depositCurrencyIn,
            deposit_paid_at: depositPaidAtIn,
            deposit_note: depositNoteIn
        });

        const assignIds = new Set();
        if (Array.isArray(djUserIds)) {
            djUserIds.forEach((id) => {
                if (typeof id === 'string') assignIds.add(id);
            });
        }
        if (Array.isArray(djEmails)) {
            djEmails.forEach((em) => {
                const u = portalDb.getUserByEmail(em);
                if (portalDb.isCrewAssignableUser(u)) assignIds.add(u.id);
            });
        }
        for (const djId of assignIds) {
            const u = portalDb.getUserById(djId);
            if (portalDb.isCrewAssignableUser(u)) {
                portalDb.assignDj(bookingId, djId);
            }
        }

        const booking = portalDb.getBookingById(bookingId);
        try {
            createRequestsEventForBooking(booking);
        } catch (linkErr) {
            console.error('[portal] internal/bookings requests event link', linkErr);
        }
        const linked = portalDb.getBookingById(bookingId);
        res.status(201).json({
            id: linked.id,
            customer_id: linked.customer_id,
            title: linked.title,
            start_datetime: linked.start_datetime,
            end_datetime: linked.end_datetime,
            venue: linked.venue,
            service: linked.service,
            status: linked.status,
            reference: linked.reference,
            requests_event_slug: linked.requests_event_slug || null,
            contact_name: linked.contact_name,
            notes_from_company: linked.notes_from_company || '',
            dj_briefing: linked.dj_briefing || '',
            deposit_paid: linked.deposit_paid === 1,
            deposit_amount:
                linked.deposit_amount != null && Number.isFinite(Number(linked.deposit_amount))
                    ? Number(linked.deposit_amount)
                    : null,
            deposit_currency: linked.deposit_currency || 'GBP',
            deposit_paid_at: linked.deposit_paid_at || null,
            deposit_note: linked.deposit_note || null,
            guest_count_range: linked.guest_count_range || null,
            event_type: linked.event_type || null,
            services_required: parseJsonMaybe(linked.services_required),
            enquiry_message: linked.enquiry_message || null,
            hear_about: linked.hear_about || null,
            newsletter_opt_in: linked.newsletter_opt_in === 1,
            lead_metadata: parseJsonMaybe(linked.lead_metadata),
            assigned_dj_user_ids: [...assignIds]
        });
    } catch (err) {
        console.error('[portal] internal/bookings', err);
        return jsonError(res, 'internal_error', 'Booking creation failed', 500);
    }
}

/** POST /api/v1/internal/bookings — create gig / portal event */
router.post('/bookings', handleInternalCreateBooking);

/** POST /api/v1/internal/events — alias for `/internal/bookings` (same body & response). */
router.post('/events', handleInternalCreateBooking);

module.exports = router;
