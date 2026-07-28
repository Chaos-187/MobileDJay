const express = require('express');
const { portalDb } = require('../db/portal-database');
const { hashPassword, verifyPassword, signAccessToken, verifyAccessToken, validatePortalPasswordPlain } = require('./auth-tokens');
const { normalizePlaylist, formatMusicPlanSummary, parsePayloadRow, emptyPlaylist } = require('./music-plan');
const internalRouter = require('./internal-router');
const adminRouter = require('./admin-router');
const publicRouter = require('./public-router');
const { verifyTurnstile } = require('./turnstile');
const { verifyGoogleIdToken, isGoogleSignInConfigured } = require('./verify-google-id-token');
const { getBookingPhotoGallery, photoGallerySummary, buildCustomerPhotoAlbums } = require('./booking-event-photos');
const { createBookingPaymentCheckout } = require('./booking-checkout');
const stripePortal = require('./stripe-portal');
const {
    customerPaymentOptions,
    customerBalanceBlockedMessage,
    balanceDueDaysBeforeEvent
} = require('./customer-payment-schedule');

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
        const user = portalDb.getUserById(payload.sub);
        if (!user) {
            return jsonError(res, 'invalid_token', 'Invalid or expired token', 401);
        }
        if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
            return jsonError(res, 'forbidden', 'Account disabled', 403);
        }
        req.portalUser = { id: user.id, role: user.role, email: user.email };
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

function customerPaymentRow(p) {
    if (!p) return null;
    return {
        id: p.id,
        booking_id: p.booking_id,
        kind: p.kind,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        paid_at: p.paid_at || null,
        created_at: p.created_at || null
    };
}

function customerBookingFinancialPayload(booking) {
    const settlement = portalDb.bookingSettlementSnapshot(booking);
    const stripeConfigured = stripePortal.isConfigured();
    const pay = customerPaymentOptions({ booking, settlement, stripeConfigured });
    return {
        ...settlement,
        balance_due_at: pay.balance_due_at,
        balance_due_days_before_event: pay.balance_due_days_before_event,
        can_pay_deposit: pay.can_pay_deposit,
        can_pay_balance: pay.can_pay_balance,
        balance_block_reason: pay.balance_block_reason,
        deposit_outstanding: pay.deposit_outstanding,
        stripe_configured: stripeConfigured
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

function parseCapabilitiesJson(raw) {
    if (raw == null || raw === '') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function djRowToPayload(row) {
    const {
        assignment_crew_role_label: roleLabel,
        assignment_crew_capabilities_json: capsJson,
        ...bookingRow
    } = row;
    const music = resolveMusicPlanForBooking(bookingRow);
    return {
        ...bookingCard(bookingRow),
        dj_briefing: bookingRow.dj_briefing || '',
        music_plan_summary: music.music_plan_summary,
        assignment: {
            crew_role_label: roleLabel || null,
            crew_capabilities: parseCapabilitiesJson(capsJson)
        }
    };
}

function djDetailPayload(booking, djUserId) {
    const a = portalDb.getAssignmentForDj(booking.id, djUserId);
    let caps = null;
    if (a?.crew_capabilities) {
        caps = parseCapabilitiesJson(a.crew_capabilities);
    }
    return {
        ...bookingCard(booking),
        dj_briefing: booking.dj_briefing || '',
        assignment: {
            crew_role_label: a?.crew_role_label ?? null,
            crew_capabilities: caps
        }
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
        const {
            email,
            password,
            first_name: firstName,
            last_name: lastName,
            cf_turnstile_response: cfTurnstile
        } = req.body || {};
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
            return jsonError(res, 'validation_error', 'role must not be supplied by the client', 422);
        }
        const ts = await verifyTurnstile(req, cfTurnstile);
        if (!ts.skipped && !ts.ok) {
            return jsonError(res, 'turnstile_failed', 'Turnstile verification failed', 400, {
                error_codes: ts.errorCodes || []
            });
        }
        if (!email || !password) {
            return jsonError(res, 'validation_error', 'email and password are required', 422);
        }
        const pwdVal = validatePortalPasswordPlain(password);
        if (!pwdVal.ok) {
            return jsonError(res, 'validation_error', pwdVal.message, 422);
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
        const { email, password, cf_turnstile_response: cfTurnstile } = req.body || {};
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
            return jsonError(res, 'validation_error', 'role must not be supplied by the client', 422);
        }
        const ts = await verifyTurnstile(req, cfTurnstile);
        if (!ts.skipped && !ts.ok) {
            return jsonError(res, 'turnstile_failed', 'Turnstile verification failed', 400, {
                error_codes: ts.errorCodes || []
            });
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
        if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
            return jsonError(res, 'forbidden', 'Account disabled', 403);
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

router.post('/auth/login/google', async (req, res) => {
    try {
        const { id_token: idTokenRaw, cf_turnstile_response: cfTurnstile } = req.body || {};
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
            return jsonError(res, 'validation_error', 'role must not be supplied by the client', 422);
        }
        const ts = await verifyTurnstile(req, cfTurnstile);
        if (!ts.skipped && !ts.ok) {
            return jsonError(res, 'turnstile_failed', 'Turnstile verification failed', 400, {
                error_codes: ts.errorCodes || []
            });
        }
        if (!isGoogleSignInConfigured()) {
            return jsonError(res, 'service_unavailable', 'Google sign-in is not configured on this server', 503);
        }
        if (idTokenRaw == null || String(idTokenRaw).trim() === '') {
            return jsonError(res, 'validation_error', 'id_token is required', 422);
        }

        let googleUser;
        try {
            googleUser = await verifyGoogleIdToken(String(idTokenRaw).trim());
        } catch (e) {
            if (e && e.code === 'INVALID_GOOGLE_TOKEN') {
                return jsonError(res, 'invalid_credentials', 'Invalid Google token', 401);
            }
            throw e;
        }

        if (!googleUser.emailVerified) {
            return jsonError(
                res,
                'forbidden',
                'Google account email must be verified before using it to sign in',
                403
            );
        }
        if (!googleUser.email) {
            return jsonError(res, 'invalid_credentials', 'Google token did not include an email claim', 401);
        }

        const user = portalDb.getUserByEmail(googleUser.email);
        if (!user) {
            return jsonError(
                res,
                'invalid_credentials',
                'No portal account matches this Google email — use the email we have on file',
                401
            );
        }
        if (user.role !== 'customer') {
            return jsonError(
                res,
                'forbidden',
                'Google sign-in is only available for customer portal accounts',
                403
            );
        }
        if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
            return jsonError(res, 'forbidden', 'Account disabled', 403);
        }

        const access_token = signAccessToken(user);
        res.json({
            access_token,
            token_type: 'Bearer',
            user: { id: user.id, email: user.email, role: user.role, first_name: user.first_name }
        });
    } catch (err) {
        console.error('[portal] login/google', err);
        return jsonError(res, 'internal_error', 'Google login failed', 500);
    }
});

router.post('/auth/logout', (_req, res) => {
    res.status(204).send();
});

router.post('/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { current_password: cur, new_password: next } = req.body || {};
        const user = portalDb.getUserById(req.portalUser.id);
        if (!user) {
            return jsonError(res, 'not_found', 'User not found', 404);
        }
        if (!user.password_hash) {
            return jsonError(res, 'validation_error', 'Password login is not set for this account', 422);
        }
        if (cur == null || next == null) {
            return jsonError(res, 'validation_error', 'current_password and new_password are required', 422);
        }
        const curOk = await verifyPassword(String(cur), user.password_hash);
        if (!curOk) {
            return jsonError(res, 'invalid_credentials', 'Current password is incorrect', 401);
        }
        const nextVal = validatePortalPasswordPlain(next);
        if (!nextVal.ok) {
            return jsonError(res, 'validation_error', nextVal.message, 422);
        }
        if (String(cur) === String(next)) {
            return jsonError(res, 'validation_error', 'new_password must differ from current password', 422);
        }
        const passwordHash = await hashPassword(String(next));
        portalDb.updateUserPatch(user.id, { password_hash: passwordHash });
        res.status(204).send();
    } catch (err) {
        console.error('[portal] change-password', err);
        return jsonError(res, 'internal_error', 'Password update failed', 500);
    }
});

router.post('/auth/delete-account', authMiddleware, async (req, res) => {
    try {
        const user = portalDb.getUserById(req.portalUser.id);
        if (!user) {
            return jsonError(res, 'not_found', 'User not found', 404);
        }
        const body = req.body || {};
        if (user.password_hash) {
            const { password } = body;
            if (password == null || String(password) === '') {
                return jsonError(res, 'validation_error', 'password is required to confirm deletion', 422);
            }
            const pwdOk = await verifyPassword(String(password), user.password_hash);
            if (!pwdOk) {
                return jsonError(res, 'invalid_credentials', 'Password is incorrect', 401);
            }
        } else {
            if (body.confirm_passwordless_delete !== true) {
                return jsonError(
                    res,
                    'validation_error',
                    'This account has no password; set confirm_passwordless_delete to true to confirm deletion',
                    422,
                    {
                        hint: 'Passwordless invites use this acknowledgement instead of verifying a password.'
                    }
                );
            }
        }

        const result = portalDb.deleteSelfServiceUser(req.portalUser.id);
        if (result.ok) {
            return res.status(204).send();
        }
        if (result.error === 'not_found') {
            return jsonError(res, 'not_found', result.message, 404);
        }
        if (
            result.error === 'last_admin' ||
            result.error === 'customer_has_bookings' ||
            result.error === 'dj_has_upcoming'
        ) {
            return jsonError(res, 'conflict', result.message, 409, { reason: result.error });
        }
        return jsonError(res, 'internal_error', 'Account deletion failed', 500);
    } catch (err) {
        console.error('[portal] delete-account', err);
        return jsonError(res, 'internal_error', 'Account deletion failed', 500);
    }
});

router.get('/auth/me', authMiddleware, (req, res) => {
    const user = portalDb.getUserById(req.portalUser.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    const out = {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone || null
    };
    if (user.role === 'dj' || user.role === 'admin') {
        out.capabilities = parseCapabilitiesJson(user.capabilities);
    }
    res.json(out);
});

// --- Customer bookings / events (same handlers; list key differs for `/events`) ---

function customerPortalCollectionKey(req) {
    return req.portalCollectionKey === 'events' ? 'events' : 'bookings';
}

const customerBookingRouter = express.Router({ mergeParams: true });

customerBookingRouter.get('/', (req, res) => {
    const scope = req.query.scope || 'upcoming_all';
    let bookings;
    if (scope === 'past_all') {
        bookings = portalDb.getCustomerBookingsPast(req.portalUser.id).map(bookingCard);
    } else if (scope === 'next_upcoming' || scope === 'upcoming_all') {
        const rows = portalDb.getCustomerBookingsUpcoming(req.portalUser.id);
        bookings = rows.map(bookingCard);
        if (scope === 'next_upcoming') {
            bookings = bookings.slice(0, 1);
        }
    } else {
        return jsonError(
            res,
            'validation_error',
            'scope must be next_upcoming, upcoming_all, or past_all',
            422
        );
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
    const { music_plan, music_plan_summary } = resolveMusicPlanForBooking(booking);
    res.json({
        ...bookingCard(booking),
        ...customerBookingFinancialPayload(booking),
        notes_from_company: booking.notes_from_company || '',
        booking_customer_note: note?.body ?? '',
        music_plan,
        music_plan_summary,
        photo_gallery: photoGallerySummary(booking)
    });
});

customerBookingRouter.get('/:id/photos', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    res.json(getBookingPhotoGallery(booking));
});

customerBookingRouter.post('/:id/payments/checkout', async (req, res) => {
    const result = await createBookingPaymentCheckout({
        bookingId: req.params.id,
        actor: 'customer',
        actorUserId: req.portalUser.id,
        body: req.body || {}
    });
    if (result.body) {
        return res.status(result.status).json(result.body);
    }
    return jsonError(res, result.code, result.message, result.status, result.details || {});
});

customerBookingRouter.put('/:id/music-plan', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || booking.customer_id !== req.portalUser.id) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const { music_plan: musicPlanIn } = req.body || {};
    if (musicPlanIn == null || typeof musicPlanIn !== 'object') {
        return jsonError(res, 'validation_error', 'music_plan object is required', 422);
    }
    const normalized = normalizePlaylist(musicPlanIn);
    portalDb.upsertMusicPlan(booking.customer_id, booking.id, normalized);
    const resolved = resolveMusicPlanForBooking(booking);
    res.json({
        music_plan: resolved.music_plan,
        music_plan_summary: resolved.music_plan_summary
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

function permissionBoolFromDb(v) {
    if (v === null || v === undefined) return null;
    return v === 1 || v === true;
}

function customerDetailsJson(user) {
    return {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone || null,
        allow_photos_social_media: permissionBoolFromDb(user.allow_photos_social_media),
        allow_videos_social_media: permissionBoolFromDb(user.allow_videos_social_media),
    };
}

router.get('/customer/transactions', authMiddleware, requireRole('customer'), (req, res) => {
    const userId = req.portalUser.id;
    const stripeConfigured = stripePortal.isConfigured();
    const upcoming = portalDb.getCustomerBookingsUpcoming(userId);
    const past = portalDb.getCustomerBookingsPast(userId);
    const seen = new Set();
    const bookings = [];

    function pushBooking(row) {
        if (!row || seen.has(row.id)) return;
        seen.add(row.id);
        const settlement = portalDb.bookingSettlementSnapshot(row);
        const pay = customerPaymentOptions({ booking: row, settlement, stripeConfigured });
        const hasMoney =
            settlement.quote_total > 0 ||
            (row.deposit_amount != null && Number(row.deposit_amount) > 0) ||
            settlement.amount_paid > 0;
        if (!hasMoney && row.status === 'cancelled') return;

        const payments = portalDb
            .listBookingPaymentsForBooking(row.id, { limit: 100 })
            .map(customerPaymentRow)
            .filter(Boolean);

        bookings.push({
            ...bookingCard(row),
            quote_total: settlement.quote_total,
            amount_paid: settlement.amount_paid,
            balance_remaining: settlement.balance_remaining,
            balance_due_at: pay.balance_due_at,
            balance_due_days_before_event: pay.balance_due_days_before_event,
            can_pay_deposit: pay.can_pay_deposit,
            can_pay_balance: pay.can_pay_balance,
            balance_block_reason: pay.balance_block_reason,
            deposit_outstanding: pay.deposit_outstanding,
            payments
        });
    }

    upcoming.forEach(pushBooking);
    past.forEach((row) => {
        const settlement = portalDb.bookingSettlementSnapshot(row);
        if (settlement.balance_remaining > 0.005 || settlement.amount_paid > 0) {
            pushBooking(row);
        }
    });

    bookings.sort((a, b) => String(a.start_datetime || '').localeCompare(String(b.start_datetime || '')));

    const paymentRows = portalDb.listBookingPaymentsForCustomer(userId, { limit: 200 });
    const transactions = paymentRows
        .map((p) => {
            const b = portalDb.getBookingById(p.booking_id);
            return {
                ...customerPaymentRow(p),
                booking_reference: b ? b.reference : null,
                booking_title: b ? b.title : null
            };
        })
        .sort((a, b) =>
            String(b.paid_at || b.created_at || '').localeCompare(String(a.paid_at || a.created_at || ''))
        );

    let totalOutstanding = 0;
    let currency = 'GBP';
    bookings.forEach((b) => {
        if (b.status === 'cancelled') return;
        if (b.balance_remaining > 0.005) {
            totalOutstanding += b.balance_remaining;
            if (b.deposit_currency) currency = String(b.deposit_currency).toUpperCase();
        }
    });
    totalOutstanding = Math.round(totalOutstanding * 100) / 100;

    res.json({
        stripe_configured: stripeConfigured,
        balance_due_days_before_event: balanceDueDaysBeforeEvent(),
        summary: {
            total_outstanding: totalOutstanding,
            currency
        },
        bookings,
        transactions
    });
});

router.get('/customer/details', authMiddleware, requireRole('customer'), (req, res) => {
    const user = portalDb.getUserById(req.portalUser.id);
    res.json(customerDetailsJson(user));
});

router.get('/customer/photos', authMiddleware, requireRole('customer'), (req, res) => {
    const upcoming = portalDb.getCustomerBookingsUpcoming(req.portalUser.id);
    const past = portalDb.getCustomerBookingsPast(req.portalUser.id);
    const byId = new Map();
    for (const b of [...upcoming, ...past]) {
        if (b && b.id) byId.set(b.id, b);
    }
    const albums = buildCustomerPhotoAlbums([...byId.values()]);
    res.json({ albums });
});

router.patch('/customer/details', authMiddleware, requireRole('customer'), (req, res) => {
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
        return jsonError(res, 'validation_error', 'email cannot be updated via this endpoint', 422);
    }
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'first_name')) patch.first_name = body.first_name;
    if (Object.prototype.hasOwnProperty.call(body, 'last_name')) patch.last_name = body.last_name;
    if (Object.prototype.hasOwnProperty.call(body, 'phone')) patch.phone = body.phone;
    if (Object.prototype.hasOwnProperty.call(body, 'allow_photos_social_media')) {
        const v = body.allow_photos_social_media;
        if (v !== null && typeof v !== 'boolean') {
            return jsonError(
                res,
                'validation_error',
                'allow_photos_social_media must be true, false, or null',
                422
            );
        }
        patch.allow_photos_social_media = v;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'allow_videos_social_media')) {
        const v = body.allow_videos_social_media;
        if (v !== null && typeof v !== 'boolean') {
            return jsonError(
                res,
                'validation_error',
                'allow_videos_social_media must be true, false, or null',
                422
            );
        }
        patch.allow_videos_social_media = v;
    }
    if (Object.keys(patch).length === 0) {
        return jsonError(
            res,
            'validation_error',
            'Provide first_name, last_name, phone, and/or media permission fields',
            422
        );
    }
    const ok = portalDb.updateUserPatch(req.portalUser.id, patch);
    if (!ok) {
        return jsonError(res, 'validation_error', 'No valid fields to update', 422);
    }
    const user = portalDb.getUserById(req.portalUser.id);
    res.json(customerDetailsJson(user));
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

// --- DJ bookings / events ---

function djPortalCollectionKey(req) {
    return req.portalCollectionKey === 'events' ? 'events' : 'bookings';
}

const djBookingRouter = express.Router({ mergeParams: true });

djBookingRouter.get('/upcoming', (req, res) => {
    const rows = portalDb.getDjUpcomingBookings(req.portalUser.id);
    const bookings = rows.map((row) => djRowToPayload(row));
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
        ...djDetailPayload(updated, req.portalUser.id),
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
    const line_items = portalDb.getBookingLineItems(updated.id);
    const quote = portalDb.summarizeBookingQuote(line_items);
    res.json({
        ...djDetailPayload(updated, req.portalUser.id),
        music_plan,
        music_plan_summary,
        crew_notes: crew?.body ?? '',
        crew_notes_updated_at: crew?.updated_at ?? null,
        line_items,
        quote_subtotal: quote.quote_subtotal,
        quote_total: quote.quote_total
    });
});

djBookingRouter.get('/:id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking || !portalDb.isDjAssigned(req.portalUser.id, booking.id)) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const { music_plan, music_plan_summary } = resolveMusicPlanForBooking(booking);
    const crew = portalDb.getCrewNote(booking.id);
    const line_items = portalDb.getBookingLineItems(booking.id);
    const quote = portalDb.summarizeBookingQuote(line_items);
    const customer_media_permissions = portalDb.getCustomerMediaPermissions(booking.customer_id);
    res.json({
        ...djDetailPayload(booking, req.portalUser.id),
        music_plan,
        music_plan_summary,
        crew_notes: crew?.body ?? '',
        crew_notes_updated_at: crew?.updated_at ?? null,
        line_items,
        customer_media_permissions,
        quote_subtotal: quote.quote_subtotal,
        quote_total: quote.quote_total
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

router.use('/public', publicRouter);

router.use('/admin', authMiddleware, requireRole('admin'), adminRouter);

router.use('/internal', internalRouter);

module.exports = router;
