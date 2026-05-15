const express = require('express');
const crypto = require('crypto');
const { portalDb, uuid, normalizeEmail } = require('../db/portal-database');
const { hashPassword } = require('./auth-tokens');

const router = express.Router();

function jsonError(res, code, message, status = 400, details = {}) {
    res.status(status).json({ error: { code, message, details } });
}

function parseJsonField(raw) {
    if (raw == null || raw === '') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function publicUser(row) {
    if (!row) return null;
    const u = { ...row };
    delete u.password_hash;
    if (u.capabilities && typeof u.capabilities === 'string') {
        u.capabilities = parseJsonField(u.capabilities) ?? u.capabilities;
    }
    return u;
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

function blocksLastAdminRemoval(userId, patch) {
    const u = portalDb.getUserById(userId);
    if (!u) return false;
    const isActiveAdmin = u.role === 'admin' && (!u.disabled_at || String(u.disabled_at).trim() === '');
    if (!isActiveAdmin) return false;
    let losingAdmin = false;
    if (patch.role !== undefined && patch.role !== 'admin') losingAdmin = true;
    if (
        patch.disabled_at !== undefined &&
        patch.disabled_at != null &&
        String(patch.disabled_at).trim() !== ''
    ) {
        losingAdmin = true;
    }
    if (!losingAdmin) return false;
    return portalDb.countActiveAdmins() <= 1;
}

function audit(adminId, action, entityType, entityId, details) {
    portalDb.appendAudit(adminId, action, entityType, entityId, details);
}

// --- Users ---

router.get('/users', (req, res) => {
    const role = req.query.role || null;
    const q = req.query.q || null;
    const limit = req.query.limit;
    const offset = req.query.offset;
    const rows = portalDb.listUsers({ role: role || undefined, q: q || undefined, limit, offset });
    res.json({ users: rows.map(publicUser) });
});

router.post('/users', async (req, res) => {
    try {
        const body = req.body || {};
        const {
            email,
            role,
            first_name: firstName,
            last_name: lastName,
            phone,
            password,
            capabilities,
            account_manager_user_id: am
        } = body;
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
        if (String(plain).length < 8) {
            return jsonError(res, 'validation_error', 'password must be at least 8 characters when provided', 422);
        }
        const passwordHash = await hashPassword(plain);
        const id = portalDb.createUser({
            email: normalizeEmail(email),
            passwordHash,
            role,
            firstName,
            lastName,
            phone,
            capabilities,
            accountManagerUserId: am
        });
        audit(req.portalUser.id, 'user.create', 'user', id, { email: normalizeEmail(email), role });
        const user = portalDb.getUserById(id);
        const out = publicUser(user);
        if (password == null || String(password).length === 0) {
            out.temporary_password = plain;
            out._warning = 'Store or email this password now; it will not be shown again.';
        }
        res.status(201).json(out);
    } catch (err) {
        console.error('[portal] admin/users POST', err);
        return jsonError(res, 'internal_error', 'User creation failed', 500);
    }
});

router.get('/users/:id', (req, res) => {
    const user = portalDb.getUserById(req.params.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    res.json(publicUser(user));
});

router.patch('/users/:id', async (req, res) => {
    const userId = req.params.id;
    const user = portalDb.getUserById(userId);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    const patch = { ...req.body } || {};
    delete patch.id;
    if (Object.prototype.hasOwnProperty.call(patch, 'password')) {
        const p = patch.password;
        delete patch.password;
        if (p != null && String(p).length > 0) {
            if (String(p).length < 8) {
                return jsonError(res, 'validation_error', 'password must be at least 8 characters', 422);
            }
            patch.password_hash = await hashPassword(String(p));
        }
    }
    if (blocksLastAdminRemoval(userId, patch)) {
        return jsonError(res, 'conflict', 'Cannot disable or demote the last active admin', 409);
    }
    const ok = portalDb.updateUserPatch(userId, patch);
    if (!ok) {
        return jsonError(res, 'validation_error', 'No valid fields to update', 422);
    }
    audit(req.portalUser.id, 'user.patch', 'user', userId, { keys: Object.keys(patch) });
    res.json(publicUser(portalDb.getUserById(userId)));
});

router.post('/users/:id/reinvite', (req, res) => {
    audit(req.portalUser.id, 'user.reinvite', 'user', req.params.id, { stub: true });
    res.status(204).send();
});

// --- Bookings ---

router.get('/bookings', (req, res) => {
    const rows = portalDb.listBookingsAdmin({
        customer_id: req.query.customer_id,
        status: req.query.status,
        start_from: req.query.start_from,
        start_to: req.query.start_to,
        limit: req.query.limit,
        offset: req.query.offset
    });
    res.json({ bookings: rows });
});

router.post('/bookings', (req, res) => {
    try {
        const body = req.body || {};
        let customerId = body.customer_id;
        if (!customerId && body.customer_email) {
            const r = portalDb.upsertCustomerForBooking({
                email: body.customer_email,
                first_name: body.first_name,
                last_name: body.last_name,
                phone: body.phone,
                account_manager_user_id: body.account_manager_user_id
            });
            if (r.error) {
                return jsonError(
                    res,
                    'validation_error',
                    'Email is already in use by a non-customer account',
                    422,
                    { code: r.error }
                );
            }
            customerId = r.user.id;
        }
        if (!customerId) {
            return jsonError(res, 'validation_error', 'customer_id or customer_email is required', 422);
        }
        const cust = portalDb.getUserById(customerId);
        if (!cust || cust.role !== 'customer') {
            return jsonError(res, 'not_found', 'customer not found', 404);
        }
        const {
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
            guest_count_range: guestCountRange,
            event_type: eventType,
            services_required: servicesRequired,
            enquiry_message: enquiryMessage,
            hear_about: hearAbout,
            newsletter_opt_in: newsletterOptIn,
            lead_metadata: leadMetadata,
            deposit_paid: depositPaidIn,
            deposit_amount: depositAmountIn,
            deposit_currency: depositCurrencyIn,
            deposit_paid_at: depositPaidAtIn,
            deposit_note: depositNoteIn
        } = body;
        if (!title || !startDatetime || !endDatetime) {
            return jsonError(res, 'validation_error', 'title, start_datetime, and end_datetime are required', 422);
        }
        const st = status && ['confirmed', 'pending', 'cancelled'].includes(status) ? status : 'pending';
        const reference =
            referenceIn && String(referenceIn).trim() ? String(referenceIn).trim() : generateUniqueReference();
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
        audit(req.portalUser.id, 'booking.create', 'booking', bookingId, { reference });
        const booking = portalDb.getBookingById(bookingId);
        res.status(201).json({ ...booking, assignments: [] });
    } catch (err) {
        console.error('[portal] admin/bookings POST', err);
        return jsonError(res, 'internal_error', 'Booking creation failed', 500);
    }
});

router.get('/bookings/:id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const assignments = portalDb.getAssignmentsWithUsers(req.params.id);
    const normalized = assignments.map((a) => ({
        dj_user_id: a.dj_user_id,
        crew_role_label: a.crew_role_label || null,
        crew_capabilities: parseJsonField(a.crew_capabilities),
        assigned_at: a.assigned_at,
        user_email: a.user_email,
        user_first_name: a.user_first_name,
        user_last_name: a.user_last_name,
        user_phone: a.user_phone
    }));
    res.json({ ...booking, assignments: normalized });
});

router.patch('/bookings/:id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const patch = { ...req.body } || {};
    delete patch.id;
    const ok = portalDb.updateBooking(req.params.id, patch, { admin: true });
    if (!ok) {
        return jsonError(res, 'validation_error', 'No valid fields to update', 422);
    }
    audit(req.portalUser.id, 'booking.patch', 'booking', req.params.id, { keys: Object.keys(patch) });
    res.json(portalDb.getBookingById(req.params.id));
});

router.post('/bookings/:id/assignments', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const { dj_user_id: djUserId, crew_role_label: crewRoleLabel, crew_capabilities: crewCapabilities } =
        req.body || {};
    if (!djUserId || typeof djUserId !== 'string') {
        return jsonError(res, 'validation_error', 'dj_user_id is required', 422);
    }
    const u = portalDb.getUserById(djUserId);
    if (!u || u.role !== 'dj') {
        return jsonError(res, 'validation_error', 'dj_user_id must be a crew (dj) user', 422);
    }
    portalDb.upsertBookingAssignment(req.params.id, djUserId, {
        crew_role_label: crewRoleLabel,
        crew_capabilities: crewCapabilities
    });
    audit(req.portalUser.id, 'assignment.upsert', 'booking', req.params.id, { dj_user_id: djUserId });
    const a = portalDb.getAssignmentForDj(req.params.id, djUserId);
    res.status(201).json({
        booking_id: a.booking_id,
        dj_user_id: a.dj_user_id,
        crew_role_label: a.crew_role_label || null,
        crew_capabilities: parseJsonField(a.crew_capabilities),
        assigned_at: a.assigned_at
    });
});

router.delete('/bookings/:id/assignments/:dj_user_id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const ok = portalDb.deleteBookingAssignment(req.params.id, req.params.dj_user_id);
    if (!ok) {
        return jsonError(res, 'not_found', 'Assignment not found', 404);
    }
    audit(req.portalUser.id, 'assignment.delete', 'booking', req.params.id, {
        dj_user_id: req.params.dj_user_id
    });
    res.status(204).send();
});

module.exports = router;
