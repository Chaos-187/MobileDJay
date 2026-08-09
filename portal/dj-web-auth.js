/**
 * Portal auth for MobileDJay DJ web UI (/dj) — same users as EYUP events portal.
 */
const { portalDb } = require('../db/portal-database');
const { verifyAccessToken, verifyPassword, signAccessToken } = require('./auth-tokens');
const { verifyTurnstile } = require('./turnstile');

const COOKIE_NAME = 'mdj_portal_token';
const COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function isAuthDisabled() {
    return process.env.MDJ_DJ_AUTH_DISABLED === '1' || process.env.MDJ_DJ_AUTH_DISABLED === 'true';
}

function devBypassUser() {
    return { id: 'dev-bypass', role: 'admin', email: 'dev@local', first_name: 'Dev', last_name: 'DJ' };
}

function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header || typeof header !== 'string') return {};
    const out = {};
    for (const part of header.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1);
        try {
            out[key] = decodeURIComponent(val);
        } catch {
            out[key] = val;
        }
    }
    return out;
}

function getTokenFromRequest(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        return auth.slice(7).trim();
    }
    const cookies = parseCookies(req);
    return cookies[COOKIE_NAME] || null;
}

function authUserPayload(user) {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name
    };
}

function loadPortalUser(req) {
    if (isAuthDisabled()) {
        return devBypassUser();
    }
    const token = getTokenFromRequest(req);
    if (!token) return null;
    try {
        const payload = verifyAccessToken(token);
        const user = portalDb.getUserById(payload.sub);
        if (!user) return null;
        if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
            return null;
        }
        return user;
    } catch {
        return null;
    }
}

function isDjOrAdmin(user) {
    return user && (user.role === 'dj' || user.role === 'admin');
}

function setAuthCookie(res, token, req) {
    const secure =
        process.env.MDJ_COOKIE_SECURE === '1' ||
        process.env.NODE_ENV === 'production' ||
        (req && req.secure);
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${COOKIE_MAX_AGE_SEC}`
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res, req) {
    const secure =
        process.env.MDJ_COOKIE_SECURE === '1' ||
        process.env.NODE_ENV === 'production' ||
        (req && req.secure);
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function getAssignedSlugSet(user) {
    if (!user || user.role === 'admin') return null;
    return new Set(portalDb.getDjAssignedRequestsEventSlugs(user.id));
}

function filterEventsForUser(events, user) {
    const list = events || [];
    const slugs = getAssignedSlugSet(user);
    if (slugs === null) return list;
    return list.filter((e) => e && e.slug && slugs.has(String(e.slug).trim().toLowerCase()));
}

function userCanAccessEvent(user, event) {
    if (!event) return false;
    if (isAuthDisabled() || !user) return true;
    if (user.role === 'admin') return true;
    const slugs = getAssignedSlugSet(user);
    if (!slugs || slugs.size === 0) return false;
    return slugs.has(String(event.slug).trim().toLowerCase());
}

function filterRequestsForUser(requests, user, allowedEvents) {
    const allowedIds = new Set((allowedEvents || []).map((e) => Number(e.id)));
    const slugs = getAssignedSlugSet(user);
    if (slugs === null) return requests || [];
    return (requests || []).filter((r) => {
        if (r.eventId != null && allowedIds.has(Number(r.eventId))) return true;
        if (r.eventSlug && slugs.has(String(r.eventSlug).trim().toLowerCase())) return true;
        return r.eventId == null && !r.eventSlug;
    });
}

function filterMessagesForUser(messages, user, allowedEvents) {
    const allowedIds = new Set((allowedEvents || []).map((e) => Number(e.id)));
    const slugs = getAssignedSlugSet(user);
    if (slugs === null) return messages || [];
    return (messages || []).filter((m) => {
        if (m.eventId != null && allowedIds.has(Number(m.eventId))) return true;
        if (m.eventSlug && slugs.has(String(m.eventSlug).trim().toLowerCase())) return true;
        return m.eventId == null && !m.eventSlug;
    });
}

function attachPortalUser(req, res, next) {
    req.portalUser = loadPortalUser(req);
    next();
}

function requireDjWebAuth(req, res, next) {
    const user = loadPortalUser(req);
    if (!user) {
        const nextUrl = encodeURIComponent(req.originalUrl || '/dj');
        return res.redirect(`/dj/login?next=${nextUrl}`);
    }
    if (!isDjOrAdmin(user)) {
        return res.redirect('/dj/login?error=role');
    }
    req.portalUser = user;
    next();
}

function requireDjApiAuth(req, res, next) {
    const user = loadPortalUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Sign in required' });
    }
    if (!isDjOrAdmin(user)) {
        return res.status(403).json({ error: 'DJ or admin account required' });
    }
    req.portalUser = user;
    next();
}

function requireAdminWebAuth(req, res, next) {
    const user = loadPortalUser(req);
    if (!user) {
        return res.redirect(`/dj/login?next=${encodeURIComponent(req.originalUrl || '/dj/settings')}`);
    }
    if (user.role !== 'admin') {
        return res.status(403).render('error', {
            error: 'Admin access required for global settings.',
            customerName: '',
            eventSlug: null
        });
    }
    req.portalUser = user;
    next();
}

function requireAdminApiAuth(req, res, next) {
    const user = loadPortalUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Sign in required' });
    }
    if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.portalUser = user;
    next();
}

function requireEventAccess(req, res, next) {
    const eventId = parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    const { eventDb } = require('../db/database');
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (!userCanAccessEvent(req.portalUser, event)) {
        return res.status(403).json({ error: 'You do not have access to this event' });
    }
    req.event = event;
    next();
}

function requireEventAccessBySlugParam(paramName = 'eventSlug') {
    return (req, res, next) => {
        const slug = req.params[paramName];
        const { eventDb } = require('../db/database');
        const event = eventDb.getBySlug(slug);
        if (!event) {
            return res.status(404).render('error', {
                error: 'Event not found',
                customerName: '',
                eventSlug: null
            });
        }
        if (!userCanAccessEvent(req.portalUser, event)) {
            return res.status(403).render('error', {
                error: 'You do not have access to this event.',
                customerName: '',
                eventSlug: null
            });
        }
        req.event = event;
        next();
    };
}

function requireEventAccessBySlugApi(paramName = 'eventSlug') {
    return (req, res, next) => {
        const slug = req.params[paramName];
        const { eventDb } = require('../db/database');
        const event = eventDb.getBySlug(slug);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (!userCanAccessEvent(req.portalUser, event)) {
            return res.status(403).json({ error: 'You do not have access to this event' });
        }
        req.event = event;
        next();
    };
}

function requireEventAccessByPhotoId(req, res, next) {
    const photoId = parseInt(req.params.id, 10);
    if (!Number.isFinite(photoId)) {
        return res.status(400).json({ error: 'Invalid photo id' });
    }
    const { photoDb, eventDb } = require('../db/database');
    const photo = photoDb.getById(photoId);
    if (!photo) {
        return res.status(404).json({ error: 'Photo not found' });
    }
    const event = eventDb.getById(photo.event_id);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (!userCanAccessEvent(req.portalUser, event)) {
        return res.status(403).json({ error: 'You do not have access to this event' });
    }
    req.event = event;
    req.photo = photo;
    next();
}

function requireEventAccessByTrackId(req, res, next) {
    const trackId = parseInt(req.params.id, 10);
    if (!Number.isFinite(trackId)) {
        return res.status(400).json({ error: 'Invalid track id' });
    }
    const { trackDb, eventDb } = require('../db/database');
    const track = trackDb.getById(trackId);
    if (!track) {
        return res.status(404).json({ error: 'Track not found' });
    }
    const event = eventDb.getById(track.event_id);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (!userCanAccessEvent(req.portalUser, event)) {
        return res.status(403).json({ error: 'You do not have access to this event' });
    }
    req.event = event;
    req.track = track;
    next();
}

function requireEventSlugAccessFromRequest(req, res, next) {
    const slug =
        (req.body && req.body.eventSlug != null ? String(req.body.eventSlug).trim() : '') ||
        (req.query && req.query.eventSlug != null ? String(req.query.eventSlug).trim() : '');
    if (!slug) {
        return res.status(422).json({ error: 'eventSlug is required' });
    }
    const { eventDb } = require('../db/database');
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (!userCanAccessEvent(req.portalUser, event)) {
        return res.status(403).json({ error: 'You do not have access to this event' });
    }
    req.event = event;
    next();
}

async function handleDjLogin(req, res) {
    try {
        const { email, password, cf_turnstile_response: cfTurnstile } = req.body || {};
        const ts = await verifyTurnstile(req, cfTurnstile);
        if (!ts.skipped && !ts.ok) {
            return res.status(400).json({
                error: 'Turnstile verification failed',
                error_codes: ts.errorCodes || []
            });
        }
        if (!email || !password) {
            return res.status(422).json({ error: 'Email and password are required' });
        }
        const user = portalDb.getUserByEmail(String(email).trim());
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const ok = await verifyPassword(String(password), user.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
            return res.status(403).json({ error: 'Account disabled' });
        }
        if (!isDjOrAdmin(user)) {
            return res.status(403).json({
                error: 'This sign-in is for DJ and crew accounts. Use the customer portal for booking access.'
            });
        }
        const token = signAccessToken(user);
        setAuthCookie(res, token, req);
        res.json({ success: true, user: authUserPayload(user) });
    } catch (err) {
        console.error('[dj-web-auth] login', err);
        res.status(500).json({ error: 'Login failed' });
    }
}

function handleDjLogout(req, res) {
    clearAuthCookie(res, req);
    res.json({ success: true });
}

function getUpcomingGigsForUser(user) {
    if (!user || user.role === 'admin') return [];
    return portalDb.getDjUpcomingBookings(user.id).map((b) => ({
        id: b.id,
        title: b.title,
        reference: b.reference,
        start_datetime: b.start_datetime,
        venue: b.venue,
        requests_event_slug: b.requests_event_slug || null
    }));
}

module.exports = {
    COOKIE_NAME,
    isAuthDisabled,
    attachPortalUser,
    requireDjWebAuth,
    requireDjApiAuth,
    requireAdminWebAuth,
    requireAdminApiAuth,
    requireEventAccess,
    requireEventAccessBySlugParam,
    requireEventAccessBySlugApi,
    requireEventAccessByPhotoId,
    requireEventAccessByTrackId,
    requireEventSlugAccessFromRequest,
    filterEventsForUser,
    filterRequestsForUser,
    filterMessagesForUser,
    userCanAccessEvent,
    authUserPayload,
    loadPortalUser,
    setAuthCookie,
    clearAuthCookie,
    handleDjLogin,
    handleDjLogout,
    getUpcomingGigsForUser,
    getAssignedSlugSet
};
