const express = require('express');
const { portalDb } = require('../db/portal-database');
const { hashPassword, verifyPassword, signAccessToken, verifyAccessToken } = require('./auth-tokens');
const { normalizePlaylist, formatMusicPlanSummary, parsePayloadRow, emptyPlaylist } = require('./music-plan');
const internalRouter = require('./internal-router');

const router = express.Router();

function jsonError(res, code, message, status = 400, details = {}) {
    res.status(status).json({ error: { code, message, details } });
}

function authMiddleware(req, res, next) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
        return jsonError(res, 'unauthorized', 'Missing or invalid Authorization header', 401);
    }
    const token = h.slice(7);
    try {
        const payload = verifyAccessToken(token);
        req.portalUser = { id: payload.sub, role: payload.role, email: payload.email };
        next();
    } catch {
        return jsonError(res, 'invalid_token', 'Invalid or expired token', 401);
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.portalUser || req.portalUser.role !== role) {
            return jsonError(res, 'forbidden', 'Insufficient permissions', 403);
        }
        next();
    };
}

function bookingCard(b) {
    return {
        id: b.id,
        title: b.title,
        start_datetime: b.start_datetime,
        end_datetime: b.end_datetime,
        venue: b.venue,
        service: b.service,
        status: b.status,
        reference: b.reference,
        contact_name: b.contact_name
    };
}

function resolveMusicPlanForBooking(booking) {
    const specific = portalDb.getMusicPlanRow(booking.customer_id, booking.id);
    const fallback = portalDb.getMusicPlanRow(booking.customer_id, null);
    let payload;
    if (specific) payload = parsePayloadRow(specific);
    else if (fallback) payload = parsePayloadRow(fallback);
    else payload = emptyPlaylist();
    return {
        music_plan: payload,
        music_plan_summary: formatMusicPlanSummary(payload)
    };
}

// --- Auth ---

router.post('/auth/register', async (req, res) => {
    try {
        const { email, password, first_name: firstName, last_name: lastName } = req.body || {};
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
            return jsonError(res, 'validation_error', 'role must not be supplied by the client', 422);
        }
        if (!email || !password) {
            return jsonError(res, 'validation_error', 'email and password are required', 422);
        }
        if (portalDb.getUserByEmail(email)) {
            return jsonError(res, 'conflict', 'An account with this email already exists', 409);
        }
        const passwordHash = await hashPassword(String(password));
        const id = portalDb.createUser({
            email,
            passwordHash,
            role: 'customer',
            firstName,
            lastName
        });
        const user = portalDb.getUserById(id);
        const access_token = signAccessToken(user);
        res.status(201).json({
            access_token,
            token_type: 'Bearer',
            user: { id: user.id, email: user.email, role: user.role, first_name: user.first_name }
        });
    } catch (err) {
        console.error('[portal] register', err);
        return jsonError(res, 'internal_error', 'Registration failed', 500);
    }
});

router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
            return jsonError(res, 'validation_error', 'role must not be supplied by the client', 422);
        }
        if (!email || !password) {
            return jsonError(res, 'validation_error', 'email and password are required', 422);
        }
        const user = portalDb.getUserByEmail(email);
        if (!user || !user.password_hash) {
            return jsonError(res, 'invalid_credentials', 'Invalid email or password', 401);
        }
        const ok = await verifyPassword(String(password), user.password_hash);
        if (!ok) {
            return jsonError(res, 'invalid_credentials', 'Invalid email or password', 401);
        }
        const access_token = signAccessToken(user);
        res.json({
            access_token,
            token_type: 'Bearer',
            user: { id: user.id, email: user.email, role: user.role, first_name: user.first_name }
        });
    } catch (err) {
        console.error('[portal] login', err);
        return jsonError(res, 'internal_error', 'Login failed', 500);
    }
});

router.post('/auth/logout', (_req, res) => {
    res.status(204).send();
});

router.get('/auth/me', authMiddleware, (req, res) => {
    const user = portalDb.getUserById(req.portalUser.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name
    });
});

// --- Customer ---

router.get('/customer/bookings', authMiddleware, requireRole('customer'), (req, res) => {
    const scope = req.query.scope || 'upcoming_all';
    const rows = portalDb.getCustomerBookingsUpcoming(req.portalUser.id);
    let bookings = rows.map(bookingCard);
    if (scope === 'next_upcoming') {
        bookings = bookings.slice(0, 1);
    } else if (scope !== 'upcoming_all') {
        return jsonError(res, 'validation_error', 'scope must be next_upcoming or upcoming_all', 422);
    }
    res.json({ bookings });
});

router.get('/customer/bookings/:id', authMiddleware, requireRole('customer'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const note = portalDb.getCustomerBookingNote(req.portalUser.id, booking.id);
    res.json({
        ...bookingCard(booking),
        notes_from_company: booking.notes_from_company || '',
        booking_customer_note: note?.body ?? ''
    });
});

router.patch('/customer/bookings/:id/note', authMiddleware, requireRole('customer'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const body = req.body?.body;
    if (body == null || typeof body !== 'string') {
        return jsonError(res, 'validation_error', 'body must be a string', 422);
    }
    portalDb.upsertCustomerBookingNote(req.portalUser.id, booking.id, body);
    const note = portalDb.getCustomerBookingNote(req.portalUser.id, booking.id);
    res.json({ booking_customer_note: note.body, updated_at: note.updated_at });
});

router.post('/customer/bookings/:id/hide', authMiddleware, requireRole('customer'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    portalDb.setBookingHidden(req.portalUser.id, booking.id, true);
    res.json({ hidden_from_dashboard: true });
});

router.delete('/customer/bookings/:id/hide', authMiddleware, requireRole('customer'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    portalDb.setBookingHidden(req.portalUser.id, booking.id, false);
    res.json({ hidden_from_dashboard: false });
});

router.get('/customer/profile', authMiddleware, requireRole('customer'), (req, res) => {
    const notes = portalDb.getAccountNotes(req.portalUser.id);
    const planRow = portalDb.getMusicPlanRow(req.portalUser.id, null);
    const music_plan = planRow ? parsePayloadRow(planRow) : emptyPlaylist();
    res.json({
        account_notes: notes.map((n) => n.body),
        music_plan,
        music_plan_summary: formatMusicPlanSummary(music_plan)
    });
});

router.put('/customer/profile', authMiddleware, requireRole('customer'), (req, res) => {
    const { account_notes: accountNotes, music_plan: musicPlan } = req.body || {};
    if (accountNotes != null) {
        if (!Array.isArray(accountNotes) || !accountNotes.every((x) => typeof x === 'string')) {
            return jsonError(res, 'validation_error', 'account_notes must be an array of strings', 422);
        }
        portalDb.replaceAccountNotes(req.portalUser.id, accountNotes);
    }
    if (musicPlan != null) {
        const normalized = normalizePlaylist(musicPlan);
        portalDb.upsertMusicPlan(req.portalUser.id, null, normalized);
    }
    const notes = portalDb.getAccountNotes(req.portalUser.id);
    const planRow = portalDb.getMusicPlanRow(req.portalUser.id, null);
    const music_plan = planRow ? parsePayloadRow(planRow) : emptyPlaylist();
    res.json({
        account_notes: notes.map((n) => n.body),
        music_plan,
        music_plan_summary: formatMusicPlanSummary(music_plan)
    });
});

// --- DJ ---

router.get('/dj/bookings/upcoming', authMiddleware, requireRole('dj'), (req, res) => {
    const rows = portalDb.getDjUpcomingBookings(req.portalUser.id);
    const bookings = rows.map((b) => ({
        ...bookingCard(b),
        dj_briefing: b.dj_briefing || ''
    }));
    res.json({ bookings });
});

router.get('/dj/bookings/:id', authMiddleware, requireRole('dj'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || !portalDb.isDjAssigned(req.portalUser.id, booking.id)) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const { music_plan, music_plan_summary } = resolveMusicPlanForBooking(booking);
    const crew = portalDb.getCrewNote(booking.id);
    res.json({
        ...bookingCard(booking),
        dj_briefing: booking.dj_briefing || '',
        music_plan,
        music_plan_summary,
        crew_notes: crew?.body ?? '',
        crew_notes_updated_at: crew?.updated_at ?? null
    });
});

router.patch('/dj/bookings/:id/crew-notes', authMiddleware, requireRole('dj'), (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || !portalDb.isDjAssigned(req.portalUser.id, booking.id)) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const body = req.body?.body;
    if (body == null || typeof body !== 'string') {
        return jsonError(res, 'validation_error', 'body must be a string', 422);
    }
    portalDb.upsertCrewNote(booking.id, req.portalUser.id, body);
    const crew = portalDb.getCrewNote(booking.id);
    res.json({ crew_notes: crew.body, updated_at: crew.updated_at });
});

router.use('/internal', internalRouter);

module.exports = router;
