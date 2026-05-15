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
    const depositPaid = b.deposit_paid === 1 || b.deposit_paid === true;
    const amt = b.deposit_amount;
    return {
        id: b.id,
        title: b.title,
        start_datetime: b.start_datetime,
        end_datetime: b.end_datetime,
        venue: b.venue,
        service: b.service,
        status: b.status,
        reference: b.reference,
        contact_name: b.contact_name,
        deposit_paid: depositPaid,
        deposit_amount:
            amt != null && amt !== '' && Number.isFinite(Number(amt)) ? Number(amt) : null,
        deposit_currency: b.deposit_currency || 'GBP',
        deposit_paid_at: b.deposit_paid_at || null,
        deposit_note: b.deposit_note || null
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

// --- Customer bookings / events (same handlers; list key differs for `/events`) ---

function customerPortalCollectionKey(req) {
    return req.portalCollectionKey === 'events' ? 'events' : 'bookings';
}

const customerBookingRouter = express.Router({ mergeParams: true });

customerBookingRouter.get('/', (req, res) => {
    const scope = req.query.scope || 'upcoming_all';
    const rows = portalDb.getCustomerBookingsUpcoming(req.portalUser.id);
    let bookings = rows.map(bookingCard);
    if (scope === 'next_upcoming') {
        bookings = bookings.slice(0, 1);
    } else if (scope !== 'upcoming_all') {
        return jsonError(res, 'validation_error', 'scope must be next_upcoming or upcoming_all', 422);
    }
    const key = customerPortalCollectionKey(req);
    res.json({ [key]: bookings });
});

customerBookingRouter.get('/:id', (req, res) => {
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

customerBookingRouter.patch('/:id/note', (req, res) => {
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

customerBookingRouter.post('/:id/hide', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    portalDb.setBookingHidden(req.portalUser.id, booking.id, true);
    res.json({ hidden_from_dashboard: true });
});

customerBookingRouter.delete('/:id/hide', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    portalDb.setBookingHidden(req.portalUser.id, booking.id, false);
    res.json({ hidden_from_dashboard: false });
});

router.use(
    '/customer/bookings',
    authMiddleware,
    requireRole('customer'),
    (req, _res, next) => {
        req.portalCollectionKey = 'bookings';
        next();
    },
    customerBookingRouter
);
router.use(
    '/customer/events',
    authMiddleware,
    requireRole('customer'),
    (req, _res, next) => {
        req.portalCollectionKey = 'events';
        next();
    },
    customerBookingRouter
);

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

// --- DJ bookings / events ---

function djPortalCollectionKey(req) {
    return req.portalCollectionKey === 'events' ? 'events' : 'bookings';
}

const djBookingRouter = express.Router({ mergeParams: true });

djBookingRouter.get('/upcoming', (req, res) => {
    const rows = portalDb.getDjUpcomingBookings(req.portalUser.id);
    const bookings = rows.map((b) => ({
        ...bookingCard(b),
        dj_briefing: b.dj_briefing || ''
    }));
    const key = djPortalCollectionKey(req);
    res.json({ [key]: bookings });
});

djBookingRouter.post('/:id/cancel', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || !portalDb.isDjAssigned(req.portalUser.id, booking.id)) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    portalDb.updateBooking(booking.id, { status: 'cancelled' });
    const updated = portalDb.getBookingById(booking.id);
    res.json({
        ...bookingCard(updated),
        dj_briefing: updated.dj_briefing || '',
        message: 'Booking cancelled.'
    });
});

djBookingRouter.patch('/:id/crew-notes', (req, res) => {
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

/** Deposit + DJ-cancel-only status update (assigned DJ only). */
djBookingRouter.patch('/:id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || !portalDb.isDjAssigned(req.portalUser.id, booking.id)) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const body = req.body || {};
    const patch = {};

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        if (body.status !== 'cancelled') {
            return jsonError(
                res,
                'validation_error',
                'DJ may only set status to cancelled (use POST …/cancel or status: "cancelled")',
                422
            );
        }
        patch.status = 'cancelled';
    }

    const hasPaidAtKey = Object.prototype.hasOwnProperty.call(body, 'deposit_paid_at');

    if (Object.prototype.hasOwnProperty.call(body, 'deposit_paid')) {
        const paid = !!body.deposit_paid;
        patch.deposit_paid = paid ? 1 : 0;
        if (!paid) {
            patch.deposit_paid_at = null;
        }
    }

    if (hasPaidAtKey && patch.deposit_paid !== 0) {
        const raw = body.deposit_paid_at;
        patch.deposit_paid_at =
            raw == null || String(raw).trim() === '' ? null : String(raw).trim();
    }

    if (
        Object.prototype.hasOwnProperty.call(body, 'deposit_paid') &&
        body.deposit_paid &&
        !hasPaidAtKey
    ) {
        patch.deposit_paid_at = new Date().toISOString();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'deposit_amount')) {
        if (body.deposit_amount === null || body.deposit_amount === '') {
            patch.deposit_amount = null;
        } else if (typeof body.deposit_amount === 'number' && Number.isFinite(body.deposit_amount)) {
            patch.deposit_amount = body.deposit_amount;
        } else {
            const n = Number(body.deposit_amount);
            if (!Number.isFinite(n)) {
                return jsonError(res, 'validation_error', 'deposit_amount must be a number', 422);
            }
            patch.deposit_amount = n;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'deposit_currency')) {
        const c = body.deposit_currency != null ? String(body.deposit_currency).trim().toUpperCase() : '';
        patch.deposit_currency = c || 'GBP';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'deposit_note')) {
        patch.deposit_note =
            body.deposit_note == null || String(body.deposit_note).trim() === ''
                ? null
                : String(body.deposit_note).trim();
    }

    if (Object.keys(patch).length === 0) {
        return jsonError(
            res,
            'validation_error',
            'Provide at least one of: status, deposit_paid, deposit_amount, deposit_currency, deposit_note, deposit_paid_at',
            422
        );
    }

    portalDb.updateBooking(booking.id, patch);
    const updated = portalDb.getBookingById(booking.id);
    const { music_plan, music_plan_summary } = resolveMusicPlanForBooking(updated);
    const crew = portalDb.getCrewNote(updated.id);
    res.json({
        ...bookingCard(updated),
        dj_briefing: updated.dj_briefing || '',
        music_plan,
        music_plan_summary,
        crew_notes: crew?.body ?? '',
        crew_notes_updated_at: crew?.updated_at ?? null
    });
});

djBookingRouter.get('/:id', (req, res) => {
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

router.use(
    '/dj/bookings',
    authMiddleware,
    requireRole('dj'),
    (req, _res, next) => {
        req.portalCollectionKey = 'bookings';
        next();
    },
    djBookingRouter
);
router.use(
    '/dj/events',
    authMiddleware,
    requireRole('dj'),
    (req, _res, next) => {
        req.portalCollectionKey = 'events';
        next();
    },
    djBookingRouter
);

router.use('/internal', internalRouter);

module.exports = router;
