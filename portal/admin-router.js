const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { portalDb, uuid, normalizeEmail } = require('../db/portal-database');
const { hashPassword, validatePortalPasswordPlain } = require('./auth-tokens');
const { formatMusicPlanSummary, parsePayloadRow, emptyPlaylist, normalizePlaylist } = require('./music-plan');
const { getSiteSettings, putSiteSettings } = require('./site-settings-service');
const { snapshotToCsv, csvToImportPayload } = require('./catalog-csv');
const { getBookingPhotoGallery, photoGallerySummary } = require('./booking-event-photos');
const {
    createRequestsEventForBooking,
    getRequestsEventAdminPayload,
    updateRequestsEventFeatures
} = require('./booking-requests-event');
const brevoMail = require('./brevo-mail');
const { issueCustomerMagicLoginLink } = require('./portal-magic-login');
const { sendPasswordResetEmail } = require('./portal-password-reset');
const stripePortal = require('./stripe-portal');
const { createBookingPaymentCheckout } = require('./booking-checkout');
const { refundBookingPayment } = require('./refund-booking-payment');
const { syncCheckoutSessionFromStripe } = require('./stripe-checkout-sync');
const { balanceDueCalendarFields } = require('./customer-payment-schedule');
const { catalogImageUpload, catalogRoot } = require('./catalog-image-upload');
const { resolveCatalogImageUrl } = require('./catalog-product-types');

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

// --- Site settings ---

router.get('/site-settings', (req, res, next) => {
    try {
        const settings = getSiteSettings();
        res.set('Cache-Control', 'no-store');
        res.json(settings);
    } catch (e) {
        next(e);
    }
});

router.put('/site-settings', (req, res, next) => {
    try {
        const merged = putSiteSettings(req.body, req.portalUser.id);
        const navDisabled = Object.entries(merged.nav)
            .filter(([, enabled]) => !enabled)
            .map(([key]) => key);
        audit(req.portalUser.id, 'site_settings.update', 'site_settings', 'default', {
            contact_form_enabled: merged.contact_form_enabled,
            nav_disabled: navDisabled
        });
        res.set('Cache-Control', 'no-store');
        res.json(merged);
    } catch (e) {
        if (e.code === 'validation_error') {
            return jsonError(res, 'validation_error', e.message || 'Invalid site settings', 422, e.details || {});
        }
        next(e);
    }
});

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
        let passwordHash = null;
        let generatedPlain = null;
        if (password != null && String(password).length > 0) {
            const pv = validatePortalPasswordPlain(String(password));
            if (!pv.ok) {
                return jsonError(res, 'validation_error', pv.message, 422);
            }
            passwordHash = await hashPassword(String(password));
        } else if (role !== 'customer') {
            generatedPlain = randomPassword();
            const pv = validatePortalPasswordPlain(generatedPlain);
            if (!pv.ok) {
                return jsonError(res, 'internal_error', 'Could not generate a valid temporary password', 500);
            }
            passwordHash = await hashPassword(generatedPlain);
        }
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
        if (generatedPlain) {
            out.temporary_password = generatedPlain;
            out._warning = 'Store or email this password now; it will not be shown again.';
        } else if (role === 'customer' && passwordHash == null) {
            out._hint =
                'Customer created without a password. Send a welcome email with a magic sign-in link from the Emails tab.';
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
            const pv = validatePortalPasswordPlain(p);
            if (!pv.ok) {
                return jsonError(res, 'validation_error', pv.message, 422);
            }
            patch.password_hash = await hashPassword(String(p));
            patch.require_password_setup = 0;
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

const CUSTOMER_EMAIL_TEMPLATES = new Set([
    'account_created',
    'account_created_temporary_password'
]);

async function sendCustomerPortalEmail(req, res, { userId, templateKey, reinvite }) {
    if (!brevoMail.isConfigured()) {
        return jsonError(
            res,
            'service_unavailable',
            'Brevo is not configured (set BREVO_API_KEY and template IDs)',
            503
        );
    }
    const user = portalDb.getUserById(userId);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    if (user.role !== 'customer') {
        return jsonError(
            res,
            'validation_error',
            'Portal welcome emails can only be sent to customer accounts',
            422
        );
    }
    if (!user.email) {
        return jsonError(res, 'validation_error', 'Customer has no email address', 422);
    }

    if (templateKey === 'password_reset') {
        if (!brevoMail.getTemplateId('password_reset')) {
            return jsonError(
                res,
                'service_unavailable',
                'Password reset template is not configured (set BREVO_TEMPLATE_PASSWORD_RESET)',
                503
            );
        }
        try {
            const issued = portalDb.createPasswordResetToken(userId);
            if (!issued || !issued.token) {
                return jsonError(res, 'internal_error', 'Could not create password reset link', 500);
            }
            const sent = await sendPasswordResetEmail(user, issued);
            audit(req.portalUser.id, 'user.send_email', 'user', userId, {
                template: 'password_reset',
                email: user.email,
                message_id: sent.messageId,
                password_reset: true,
                reset_link_expires_at: issued.expires_at
            });
            return res.json({
                ok: true,
                template: 'password_reset',
                to: user.email,
                message_id: sent.messageId,
                reset_link_expires_at: issued.expires_at,
                _hint:
                    'Customer can set a new password via the link; their current password stays valid until the link is used.'
            });
        } catch (err) {
            console.error('[portal] send-password-reset', err);
            const status = err.code === 'template_not_configured' ? 503 : err.status === 400 ? 422 : 502;
            return jsonError(
                res,
                err.code === 'template_not_configured' ? 'service_unavailable' : 'upstream_error',
                err.message || 'Password reset email could not be sent',
                status,
                err.details ? { brevo: err.details } : {}
            );
        }
    }

    if (!CUSTOMER_EMAIL_TEMPLATES.has(templateKey)) {
        return jsonError(res, 'validation_error', 'Invalid or unsupported email template', 422);
    }

    let brevoTemplateKey = templateKey;
    let clearPassword =
        req.body && (req.body.clear_password_login === true || req.body.clear_password_login === 'true');
    if (templateKey === 'account_created_temporary_password') {
        clearPassword = true;
        brevoTemplateKey = 'account_created';
    }

    const params = { login_link: brevoMail.portalLoginUrl() };
    const out = {
        ok: true,
        template: brevoTemplateKey,
        to: user.email,
        ...(templateKey !== brevoTemplateKey ? { requested_template: templateKey } : {})
    };

    if (clearPassword) {
        portalDb.updateUserPatch(userId, {
            password_hash: null,
            require_password_setup: 1
        });
        out.password_cleared = true;
        out._hint =
            'Password login was cleared. The email contains a one-time magic link; the customer will set a new password after signing in.';
    } else if (!user.password_hash) {
        portalDb.updateUserPatch(userId, { require_password_setup: 1 });
    }

    try {
        const magic = issueCustomerMagicLoginLink(userId);
        params.login_link = magic.url;
        out.magic_link_expires_at = magic.expires_at;
    } catch (magicErr) {
        console.error('[portal] magic link', magicErr);
        return jsonError(res, 'internal_error', 'Could not create magic sign-in link', 500);
    }

    try {
        const sent = await brevoMail.sendCustomerTemplateEmail({
            templateKey: brevoTemplateKey,
            user,
            params,
            tags: reinvite
                ? ['eyup-portal', brevoTemplateKey, 'reinvite']
                : ['eyup-portal', brevoTemplateKey]
        });
        out.message_id = sent.messageId;
        audit(req.portalUser.id, reinvite ? 'user.reinvite' : 'user.send_email', 'user', userId, {
            template: brevoTemplateKey,
            requested_template: templateKey !== brevoTemplateKey ? templateKey : undefined,
            email: user.email,
            message_id: sent.messageId,
            password_cleared: !!out.password_cleared,
            magic_link: true
        });
        if (reinvite) {
            return res.status(204).send();
        }
        return res.json(out);
    } catch (err) {
        console.error('[portal] send-email', err);
        const status = err.code === 'template_not_configured' ? 503 : err.status === 400 ? 422 : 502;
        return jsonError(
            res,
            err.code === 'template_not_configured' ? 'service_unavailable' : 'upstream_error',
            err.message || 'Email could not be sent',
            status,
            err.details ? { brevo: err.details } : {}
        );
    }
}

router.get('/email-templates', (req, res) => {
    res.json({
        brevo_configured: brevoMail.isConfigured(),
        templates: brevoMail.listConfiguredTemplates()
    });
});

router.post('/users/:id/send-email', (req, res) => {
    const templateKey =
        req.body && req.body.template ? String(req.body.template).trim() : 'account_created';
    return sendCustomerPortalEmail(req, res, {
        userId: req.params.id,
        templateKey,
        reinvite: false
    });
});

router.post('/users/:id/reinvite', (req, res) => {
    return sendCustomerPortalEmail(req, res, {
        userId: req.params.id,
        templateKey: 'account_created',
        reinvite: true
    });
});

router.get('/users/:id/bookings', (req, res) => {
    const user = portalDb.getUserById(req.params.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    if (user.role !== 'customer') {
        return jsonError(res, 'validation_error', 'Bookings are listed for customer accounts only', 422);
    }
    const rows = portalDb.listBookingsAdmin({
        customer_id: user.id,
        status: req.query.status,
        start_from: req.query.start_from,
        start_to: req.query.start_to,
        limit: req.query.limit,
        offset: req.query.offset
    });
    const bookings = rows.map((b) => {
        const quote = portalDb.summarizeBookingQuote(portalDb.getBookingLineItems(b.id));
        return {
            ...b,
            quote_total: quote.quote_total,
            ...portalDb.bookingSettlementSnapshot(b),
            stripe_configured: stripePortal.isConfigured()
        };
    });
    res.json({ customer_id: user.id, bookings, stripe_configured: stripePortal.isConfigured() });
});

router.get('/users/:id/payments', (req, res) => {
    const user = portalDb.getUserById(req.params.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    if (user.role !== 'customer') {
        return jsonError(res, 'validation_error', 'Payment history is for customer accounts only', 422);
    }
    const payments = portalDb.listBookingPaymentsForCustomer(user.id, {
        limit: req.query.limit,
        offset: req.query.offset
    });
    const paymentsEnriched = payments.map((p) => {
        const b = portalDb.getBookingById(p.booking_id);
        return {
            ...p,
            booking_reference: b ? b.reference : null,
            booking_title: b ? b.title : null
        };
    });
    const booking_deposits = portalDb.listCustomerDepositSummaries(user.id);
    res.json({
        customer_id: user.id,
        stripe_configured: stripePortal.isConfigured(),
        stripe_webhook_configured: stripePortal.isWebhookConfigured(),
        payments: paymentsEnriched,
        booking_deposits
    });
});

router.get('/users/:id/audit', (req, res) => {
    const user = portalDb.getUserById(req.params.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    if (user.role !== 'customer') {
        return jsonError(res, 'validation_error', 'Audit history is for customer accounts only', 422);
    }
    const rows = portalDb.listAuditForCustomer(user.id, {
        limit: req.query.limit,
        offset: req.query.offset
    });
    const entries = rows.map((row) => {
        const admin = portalDb.getUserById(row.admin_user_id);
        const adminName = admin
            ? [admin.first_name, admin.last_name].filter(Boolean).join(' ').trim() ||
              admin.email ||
              row.admin_user_id
            : row.admin_user_id;
        return {
            id: row.id,
            action: row.action,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            details: row.details,
            created_at: row.created_at,
            admin_user_id: row.admin_user_id,
            admin_email: admin ? admin.email : null,
            admin_name: adminName
        };
    });
    res.json({ customer_id: user.id, entries });
});

router.post('/users/:id/payments/reconcile', async (req, res) => {
    const user = portalDb.getUserById(req.params.id);
    if (!user) {
        return jsonError(res, 'not_found', 'User not found', 404);
    }
    if (user.role !== 'customer') {
        return jsonError(res, 'validation_error', 'Payment reconcile is for customer accounts only', 422);
    }
    if (!stripePortal.isConfigured()) {
        return jsonError(res, 'service_unavailable', 'Stripe is not configured', 503);
    }
    const payments = portalDb.listBookingPaymentsForCustomer(user.id, { limit: 100 }).filter(
        (p) =>
            (p.status === 'processing' || p.status === 'pending') &&
            p.stripe_checkout_session_id
    );
    const results = [];
    for (const p of payments) {
        try {
            const row = await syncCheckoutSessionFromStripe(p.stripe_checkout_session_id, {
                outcome: 'auto'
            });
            results.push(row);
        } catch (err) {
            results.push({
                payment_id: p.id,
                error: err.message || 'sync_failed'
            });
        }
    }
    audit(req.portalUser.id, 'user.payments_reconcile', 'user', user.id, {
        count: results.length
    });
    res.json({ customer_id: user.id, results });
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
    const bookings = rows.map((b) => {
        const settlement = portalDb.bookingSettlementSnapshot(b);
        return {
            ...b,
            ...settlement,
            ...balanceDueCalendarFields(b, settlement)
        };
    });
    res.json({ bookings });
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
        if (Array.isArray(body.line_items) && body.line_items.length) {
            try {
                portalDb.replaceBookingLineItems(bookingId, body.line_items);
            } catch (lineErr) {
                portalDb.db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
                return jsonError(
                    res,
                    'validation_error',
                    lineErr.message || 'Invalid line_items',
                    422
                );
            }
        }
        audit(req.portalUser.id, 'booking.create', 'booking', bookingId, { reference });
        let booking = portalDb.getBookingById(bookingId);
        try {
            createRequestsEventForBooking(booking);
        } catch (linkErr) {
            console.error('[portal] admin/bookings requests event link', linkErr);
        }
        booking = portalDb.getBookingById(bookingId);
        const line_items = portalDb.getBookingLineItems(bookingId);
        const quote = portalDb.summarizeBookingQuote(line_items);
        res.status(201).json({ ...booking, assignments: [], line_items, ...quote });
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
    const { music_plan, music_plan_summary } = resolveMusicPlanForBooking(booking);
    const line_items = portalDb.getBookingLineItems(req.params.id);
    const quote = portalDb.summarizeBookingQuote(line_items);
    const customer_media_permissions = portalDb.getCustomerMediaPermissions(booking.customer_id);
    res.json({
        ...booking,
        assignments: normalized,
        music_plan,
        music_plan_summary,
        line_items,
        customer_media_permissions,
        photo_gallery: photoGallerySummary(booking),
        ...quote,
        ...portalDb.bookingSettlementSnapshot(booking),
        stripe_configured: stripePortal.isConfigured()
    });
});

const BOOKING_EMAIL_TEMPLATES = new Set(['deposit_due', 'invoice_due']);

function formatMoneyForEmail(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: (currency || 'GBP').toString().toUpperCase()
        }).format(n);
    } catch {
        return `${n} ${currency || 'GBP'}`;
    }
}

function formatEventDateForEmail(iso) {
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

async function payLinkForBookingEmail(bookingId, templateKey, adminUserId, includePayLink) {
    if (!includePayLink || !stripePortal.isConfigured()) {
        return brevoMail.portalLoginUrl();
    }
    const kind = templateKey === 'deposit_due' ? 'deposit' : 'balance';
    const result = await createBookingPaymentCheckout({
        bookingId,
        actor: 'admin',
        actorUserId: adminUserId,
        body: { kind }
    });
    if (result.body && result.body.checkout_url) {
        return result.body.checkout_url;
    }
    return brevoMail.portalLoginUrl();
}

router.post('/bookings/:id/send-email', async (req, res) => {
    if (!brevoMail.isConfigured()) {
        return jsonError(
            res,
            'service_unavailable',
            'Brevo is not configured (set BREVO_API_KEY and template IDs)',
            503
        );
    }
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const customer = portalDb.getUserById(booking.customer_id);
    if (!customer || customer.role !== 'customer') {
        return jsonError(res, 'validation_error', 'Booking has no customer account', 422);
    }
    if (!customer.email) {
        return jsonError(res, 'validation_error', 'Customer has no email address', 422);
    }
    const templateKey =
        req.body && req.body.template ? String(req.body.template).trim() : 'deposit_due';
    if (!BOOKING_EMAIL_TEMPLATES.has(templateKey)) {
        return jsonError(res, 'validation_error', 'Invalid or unsupported email template', 422);
    }

    const settlement = portalDb.bookingSettlementSnapshot(booking);
    const eventDate = formatEventDateForEmail(booking.start_datetime);
    const currency = booking.deposit_currency || 'GBP';
    const includePayLink = !(req.body && req.body.include_pay_link === false);

    let payLink;
    try {
        payLink = await payLinkForBookingEmail(
            booking.id,
            templateKey,
            req.portalUser.id,
            includePayLink
        );
    } catch (err) {
        payLink = brevoMail.portalLoginUrl();
    }

    const params = {
        login_link: brevoMail.portalLoginUrl(),
        EVENT_TITLE: booking.title || 'Your event',
        EVENT_DATE: eventDate,
        PAY_LINK: payLink
    };

    if (templateKey === 'deposit_due') {
        const depAmt =
            booking.deposit_amount != null && Number.isFinite(Number(booking.deposit_amount))
                ? Number(booking.deposit_amount)
                : 0;
        params.DEPOSIT_AMOUNT = depAmt > 0 ? formatMoneyForEmail(depAmt, currency) : '';
        params.DUE_DATE = booking.deposit_due_at
            ? formatEventDateForEmail(booking.deposit_due_at)
            : eventDate;
    } else {
        params.INVOICE_REFERENCE = booking.reference || booking.id || '';
        params.INVOICE_AMOUNT =
            settlement.balance_remaining > 0
                ? formatMoneyForEmail(settlement.balance_remaining, currency)
                : settlement.quote_total > 0
                  ? formatMoneyForEmail(settlement.quote_total, currency)
                  : '';
        params.DUE_DATE = booking.balance_due_at
            ? formatEventDateForEmail(booking.balance_due_at)
            : eventDate;
    }

    try {
        const sent = await brevoMail.sendCustomerTemplateEmail({
            templateKey,
            user: customer,
            params,
            tags: ['eyup-portal', templateKey, 'booking', booking.id]
        });
        audit(req.portalUser.id, 'booking.send_email', 'booking', booking.id, {
            template: templateKey,
            email: customer.email,
            message_id: sent.messageId
        });
        return res.json({
            ok: true,
            template: templateKey,
            to: customer.email,
            message_id: sent.messageId,
            pay_link_included: includePayLink && !!payLink
        });
    } catch (err) {
        console.error('[portal] booking send-email', err);
        const status = err.code === 'template_not_configured' ? 503 : err.status === 400 ? 422 : 502;
        return jsonError(
            res,
            err.code === 'template_not_configured' ? 'service_unavailable' : 'upstream_error',
            err.message || 'Email could not be sent',
            status,
            err.details ? { brevo: err.details } : {}
        );
    }
});

router.get('/bookings/:id/photos', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    res.json(getBookingPhotoGallery(booking));
});

router.get('/bookings/:id/requests-event', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    res.json(getRequestsEventAdminPayload(booking));
});

router.get('/bookings/:id/payments', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const line_items = portalDb.getBookingLineItems(booking.id);
    const quote = portalDb.summarizeBookingQuote(line_items);
    res.json({
        booking_id: booking.id,
        stripe_configured: stripePortal.isConfigured(),
        payments: portalDb.listBookingPaymentsForBooking(booking.id),
        quote_total: quote.quote_total,
        deposit_paid: !!(booking.deposit_paid === 1 || booking.deposit_paid === true),
        deposit_amount: booking.deposit_amount
    });
});

router.post('/bookings/:id/payments/checkout', async (req, res) => {
    const result = await createBookingPaymentCheckout({
        bookingId: req.params.id,
        actor: 'admin',
        actorUserId: req.portalUser.id,
        body: req.body || {}
    });
    if (result.body) {
        audit(req.portalUser.id, 'booking.checkout', 'booking', req.params.id, {
            payment_id: result.body.payment_id,
            kind: result.body.kind,
            amount: result.body.amount
        });
        return res.status(result.status).json(result.body);
    }
    return jsonError(res, result.code, result.message, result.status, result.details || {});
});

router.post('/payments/:id/refund', async (req, res) => {
    const result = await refundBookingPayment(req.params.id, {
        adminUserId: req.portalUser.id,
        reason:
            req.body && req.body.reason != null ? String(req.body.reason).trim().slice(0, 500) : null
    });
    if (result.body) {
        audit(req.portalUser.id, 'payment.refund', 'booking', result.body.booking_id, {
            payment_id: result.body.payment_id,
            stripe_refund_id: result.body.stripe_refund_id
        });
        return res.json(result.body);
    }
    return jsonError(res, result.code, result.message, result.status, result.details || {});
});

router.patch('/bookings/:id/requests-event', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const result = updateRequestsEventFeatures(booking, req.body || {});
    if (result.error) {
        return jsonError(res, 'validation_error', result.error, 422);
    }
    audit(req.portalUser.id, 'booking.requests_event', 'booking', req.params.id, {
        keys: Object.keys(req.body || {})
    });
    res.json(result);
});

router.patch('/bookings/:id', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const patch = { ...req.body } || {};
    delete patch.id;
    const lineItems = patch.line_items;
    delete patch.line_items;
    const hasPatchFields = Object.keys(patch).length > 0;
    if (hasPatchFields) {
        const ok = portalDb.updateBooking(req.params.id, patch, { admin: true });
        if (!ok) {
            return jsonError(res, 'validation_error', 'No valid fields to update', 422);
        }
    } else if (lineItems === undefined) {
        return jsonError(res, 'validation_error', 'No valid fields to update', 422);
    }
    if (lineItems !== undefined) {
        try {
            portalDb.replaceBookingLineItems(
                req.params.id,
                Array.isArray(lineItems) ? lineItems : []
            );
        } catch (lineErr) {
            return jsonError(res, 'validation_error', lineErr.message || 'Invalid line_items', 422);
        }
    }
    audit(req.portalUser.id, 'booking.patch', 'booking', req.params.id, {
        keys: Object.keys(req.body || {})
    });
    const updated = portalDb.getBookingById(req.params.id);
    const items = portalDb.getBookingLineItems(req.params.id);
    const quote = portalDb.summarizeBookingQuote(items);
    res.json({ ...updated, line_items: items, ...quote });
});

router.put('/bookings/:id/music-plan', (req, res) => {
    const booking = portalDb.getBookingById(req.params.id);
    if (!booking) {
        return jsonError(res, 'not_found', 'Booking not found', 404);
    }
    const { music_plan: musicPlanIn } = req.body || {};
    if (musicPlanIn == null || typeof musicPlanIn !== 'object') {
        return jsonError(res, 'validation_error', 'music_plan object is required', 422);
    }
    const normalized = normalizePlaylist(musicPlanIn);
    portalDb.upsertMusicPlan(booking.customer_id, booking.id, normalized);
    audit(req.portalUser.id, 'booking.music_plan', 'booking', req.params.id, {});
    const resolved = resolveMusicPlanForBooking(booking);
    res.json({
        music_plan: resolved.music_plan,
        music_plan_summary: resolved.music_plan_summary
    });
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
    if (!portalDb.isCrewAssignableUser(u)) {
        return jsonError(
            res,
            'validation_error',
            'dj_user_id must be a crew (dj) or admin user',
            422
        );
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

// --- Catalog products & services ---

router.get('/catalog/export', (req, res) => {
    const snapshot = portalDb.exportCatalogSnapshot();
    audit(req.portalUser.id, 'catalog.export', 'catalog', null, {
        product_count: snapshot.products.length
    });
    const format = req.query.format != null ? String(req.query.format).trim().toLowerCase() : '';
    if (format === 'csv') {
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="eyup-catalog.csv"');
        res.send(snapshotToCsv(snapshot));
        return;
    }
    res.json(snapshot);
});

router.post('/catalog/import', (req, res) => {
    const body = req.body || {};
    let payload = body;
    if (typeof body.csv === 'string' && body.csv.trim()) {
        try {
            payload = csvToImportPayload(body.csv);
        } catch (err) {
            return jsonError(res, 'validation_error', err.message || 'Invalid CSV', 422);
        }
    }
    if (!payload.products || !Array.isArray(payload.products)) {
        return jsonError(res, 'validation_error', 'products array or csv field is required', 422);
    }
    try {
        const replaceAddonLinks = body.replace_addon_links !== false;
        const stats = portalDb.importCatalogSnapshot(payload, { replaceAddonLinks });
        audit(req.portalUser.id, 'catalog.import', 'catalog', null, stats);
        res.json({ ok: true, ...stats });
    } catch (err) {
        console.error('[portal] admin/catalog/import', err);
        return jsonError(res, 'internal_error', err.message || 'Import failed', 500);
    }
});

router.get('/catalog/products', (req, res) => {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    const products = portalDb.listCatalogProducts({ activeOnly });
    res.json({ products });
});

router.get('/catalog/product-types', (req, res) => {
    res.json({ product_types: portalDb.listCatalogProductTypes() });
});

router.post('/catalog/products', (req, res) => {
    const body = req.body || {};
    if (!body.code || !body.name) {
        return jsonError(res, 'validation_error', 'code and name are required', 422);
    }
    if (portalDb.getCatalogProductByCode(body.code)) {
        return jsonError(res, 'conflict', 'Product code already exists', 409);
    }
    try {
        const product = portalDb.insertCatalogProduct(body);
        audit(req.portalUser.id, 'catalog_product.create', 'catalog_product', product.id, {
            code: product.code
        });
        res.status(201).json(product);
    } catch (err) {
        console.error('[portal] admin/catalog/products POST', err);
        return jsonError(res, 'internal_error', 'Product creation failed', 500);
    }
});

router.get('/catalog/products/:id', (req, res) => {
    const product = portalDb.getCatalogProductById(req.params.id);
    if (!product) {
        return jsonError(res, 'not_found', 'Product not found', 404);
    }
    res.json(product);
});

router.patch('/catalog/products/:id', (req, res) => {
    const product = portalDb.updateCatalogProduct(req.params.id, req.body || {});
    if (!product) {
        return jsonError(res, 'not_found', 'Product not found', 404);
    }
    audit(req.portalUser.id, 'catalog_product.patch', 'catalog_product', req.params.id, {
        keys: Object.keys(req.body || {})
    });
    res.json(product);
});

router.delete('/catalog/products/:id', (req, res) => {
    const existing = portalDb.getCatalogProductById(req.params.id);
    if (!existing) {
        return jsonError(res, 'not_found', 'Product not found', 404);
    }
    const result = portalDb.deleteCatalogProduct(req.params.id);
    audit(req.portalUser.id, 'catalog_product.delete', 'catalog_product', req.params.id, result);
    res.json({ ok: true, ...result });
});

router.post('/catalog/products/:id/addons', (req, res) => {
    const parent = portalDb.getCatalogProductById(req.params.id);
    if (!parent) {
        return jsonError(res, 'not_found', 'Parent product not found', 404);
    }
    const { addon_product_id: addonProductId, addon_rate: addonRate, addon_pricing_model: addonPricingModel } =
        req.body || {};
    if (!addonProductId) {
        return jsonError(res, 'validation_error', 'addon_product_id is required', 422);
    }
    const addon = portalDb.getCatalogProductById(addonProductId);
    if (!addon) {
        return jsonError(res, 'not_found', 'Add-on product not found', 404);
    }
    portalDb.upsertCatalogProductAddon(req.params.id, addonProductId, {
        addon_rate: addonRate,
        addon_pricing_model: addonPricingModel
    });
    audit(req.portalUser.id, 'catalog_addon.upsert', 'catalog_product', req.params.id, {
        addon_product_id: addonProductId
    });
    res.status(201).json(portalDb.getCatalogProductById(req.params.id));
});

router.delete('/catalog/products/:id/addons/:addonProductId', (req, res) => {
    const parent = portalDb.getCatalogProductById(req.params.id);
    if (!parent) {
        return jsonError(res, 'not_found', 'Parent product not found', 404);
    }
    portalDb.deleteCatalogProductAddon(req.params.id, req.params.addonProductId);
    audit(req.portalUser.id, 'catalog_addon.delete', 'catalog_product', req.params.id, {
        addon_product_id: req.params.addonProductId
    });
    res.status(204).send();
});

function unlinkCatalogImageFile(imageUrl) {
    if (!imageUrl || !String(imageUrl).startsWith('/uploads/catalog/')) return;
    const filename = path.basename(String(imageUrl));
    const filePath = path.join(catalogRoot, filename);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        console.warn('[portal] catalog image unlink', filePath, e.message);
    }
}

router.post('/catalog/products/:id/image', (req, res) => {
    const existing = portalDb.getCatalogProductById(req.params.id);
    if (!existing) {
        return jsonError(res, 'not_found', 'Product not found', 404);
    }
    catalogImageUpload.single('image')(req, res, (err) => {
        if (err) {
            return jsonError(res, 'validation_error', err.message || 'Image upload failed', 422);
        }
        if (!req.file) {
            return jsonError(res, 'validation_error', 'image file is required', 422);
        }
        const imageUrl = `/uploads/catalog/${req.file.filename}`;
        if (existing.image_url && existing.image_url !== imageUrl) {
            unlinkCatalogImageFile(existing.image_url);
        }
        const product = portalDb.updateCatalogProduct(req.params.id, { image_url: imageUrl });
        audit(req.portalUser.id, 'catalog_product.image', 'catalog_product', req.params.id, {
            image_url: imageUrl
        });
        res.json({
            ...product,
            image_url: resolveCatalogImageUrl(product.image_url)
        });
    });
});

router.delete('/catalog/products/:id/image', (req, res) => {
    const existing = portalDb.getCatalogProductById(req.params.id);
    if (!existing) {
        return jsonError(res, 'not_found', 'Product not found', 404);
    }
    if (existing.image_url) unlinkCatalogImageFile(existing.image_url);
    const product = portalDb.updateCatalogProduct(req.params.id, { image_url: null });
    audit(req.portalUser.id, 'catalog_product.image_clear', 'catalog_product', req.params.id, {});
    res.json(product);
});

// --- Enquiries (contact form leads) ---

router.get('/enquiries', (req, res) => {
    const status = req.query.status || null;
    const q = req.query.q || null;
    const limit = req.query.limit;
    const offset = req.query.offset;
    const enquiries = portalDb.listEnquiries({ status, q, limit, offset });
    res.json({ enquiries });
});

router.get('/enquiries/:id', (req, res) => {
    const enquiry = portalDb.getEnquiryById(req.params.id);
    if (!enquiry) {
        return jsonError(res, 'not_found', 'Enquiry not found', 404);
    }
    res.json(enquiry);
});

router.patch('/enquiries/:id', (req, res) => {
    const existing = portalDb.getEnquiryById(req.params.id);
    if (!existing) {
        return jsonError(res, 'not_found', 'Enquiry not found', 404);
    }
    const patch = req.body || {};
    const allowedPatch = {};
    if (patch.status !== undefined) allowedPatch.status = patch.status;
    if (patch.admin_notes !== undefined) allowedPatch.admin_notes = patch.admin_notes;
    const updated = portalDb.updateEnquiry(req.params.id, allowedPatch);
    audit(req.portalUser.id, 'enquiry.patch', 'enquiry', req.params.id, {
        keys: Object.keys(allowedPatch)
    });
    res.json(updated);
});

router.post('/enquiries/:id/convert-to-booking', (req, res) => {
    try {
        const enquiry = portalDb.getEnquiryById(req.params.id);
        if (!enquiry) {
            return jsonError(res, 'not_found', 'Enquiry not found', 404);
        }
        if (enquiry.booking_id) {
            return jsonError(res, 'conflict', 'Enquiry already converted to a booking', 409, {
                booking_id: enquiry.booking_id
            });
        }

        const body = req.body || {};
        const r = portalDb.upsertCustomerForBooking({
            email: enquiry.email,
            first_name: enquiry.first_name,
            last_name: enquiry.last_name,
            phone: enquiry.phone
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
        const customerId = r.user.id;

        const eventDate = enquiry.event_date || '';
        const defaultStart = eventDate ? `${eventDate}T18:00:00.000Z` : new Date().toISOString();
        const defaultEnd = eventDate ? `${eventDate}T23:59:00.000Z` : defaultStart;
        const title =
            body.title && String(body.title).trim()
                ? String(body.title).trim()
                : `${enquiry.event_type || 'Event'} — ${enquiry.first_name} ${enquiry.last_name}`.trim();
        const startDatetime =
            body.start_datetime && String(body.start_datetime).trim()
                ? String(body.start_datetime).trim()
                : defaultStart;
        const endDatetime =
            body.end_datetime && String(body.end_datetime).trim()
                ? String(body.end_datetime).trim()
                : defaultEnd;
        const reference =
            body.reference && String(body.reference).trim()
                ? String(body.reference).trim()
                : generateUniqueReference();
        const existingRef = portalDb.db.prepare('SELECT 1 AS ok FROM bookings WHERE reference = ?').get(reference);
        if (existingRef) {
            return jsonError(res, 'conflict', 'reference already in use', 409);
        }

        const bookingId = uuid();
        const contactName = `${enquiry.first_name} ${enquiry.last_name}`.trim();
        portalDb.insertBooking({
            id: bookingId,
            customer_id: customerId,
            title,
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            venue: enquiry.venue || '',
            service: Array.isArray(enquiry.services_required)
                ? enquiry.services_required.join(', ')
                : '',
            status: 'pending',
            reference,
            contact_name: contactName,
            guest_count_range: enquiry.guest_count_range,
            event_type: enquiry.event_type,
            services_required: enquiry.services_required,
            enquiry_message: enquiry.message,
            hear_about: enquiry.hear_about,
            newsletter_opt_in: enquiry.newsletter_opt_in,
            lead_metadata: enquiry.lead_metadata
        });

        if (Array.isArray(enquiry.quote_line_items) && enquiry.quote_line_items.length) {
            const lineItems = enquiry.quote_line_items.map((line, index) => ({
                client_key: line.client_key || `eq-${index}`,
                parent_client_key: line.parent_client_key || undefined,
                product_id: line.product_id,
                pricing_context: line.pricing_context || 'standalone',
                quantity: line.quantity,
                hours: line.hours,
                unit_rate: line.unit_rate,
                discount_type: line.discount_type,
                discount_value: line.discount_value,
                label: line.label,
                sort_order: index
            }));
            portalDb.replaceBookingLineItems(bookingId, lineItems);
        }

        audit(req.portalUser.id, 'booking.create', 'booking', bookingId, {
            reference,
            from_enquiry_id: enquiry.id
        });

        let booking = portalDb.getBookingById(bookingId);
        try {
            createRequestsEventForBooking(booking);
        } catch (linkErr) {
            console.error('[portal] admin/enquiries convert requests event link', linkErr);
        }
        booking = portalDb.getBookingById(bookingId);
        const lineItems = portalDb.getBookingLineItems(bookingId);
        const quote = portalDb.summarizeBookingQuote(lineItems);

        portalDb.updateEnquiry(enquiry.id, {
            status: 'converted',
            booking_id: bookingId
        });

        audit(req.portalUser.id, 'enquiry.convert', 'enquiry', enquiry.id, {
            booking_id: bookingId,
            reference
        });

        res.status(201).json({
            enquiry_id: enquiry.id,
            booking: { ...booking, line_items: lineItems, ...quote }
        });
    } catch (err) {
        console.error('[portal] admin/enquiries/convert-to-booking', err);
        return jsonError(res, 'internal_error', 'Could not convert enquiry to booking', 500);
    }
});

module.exports = router;
