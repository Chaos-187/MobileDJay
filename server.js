const path = require('path');
const fs = require('fs');

/** Always next to server.js — not relative to cwd (important under systemd/npm on Ubuntu). */
const portalEnvPath = path.resolve(__dirname, '.env');
const envOutcome = require('dotenv').config({ path: portalEnvPath });

if (!process.env.PORTAL_SILENCE_ENV_LOG) {
    const exists = fs.existsSync(portalEnvPath);
    const cwd = process.cwd();
    if (!exists) {
        console.warn(
            `[env] No .env at ${portalEnvPath} (cwd=${cwd}). Export vars in the shell, systemd EnvironmentFile=, etc. Silence: PORTAL_SILENCE_ENV_LOG=1`
        );
    } else if (envOutcome.error) {
        console.warn(`[env] Could not parse ${portalEnvPath}: ${envOutcome.error.message}`);
    } else {
        const count = envOutcome.parsed ? Object.keys(envOutcome.parsed).length : 0;
        console.log(
            `[env] Loaded dotenv file: ${portalEnvPath} (${count} lines parsed). cwd=${cwd}. Silence this line: PORTAL_SILENCE_ENV_LOG=1`
        );
    }
}

const express = require('express');
const https = require('https');
const querystring = require('querystring');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const cors = require('cors');
const { eventDb, requestDb, messageDb, replyDb, photoDb, trackDb, guestDb, slideshowDb, settingsDb, ensureDefaultEvent } = require('./db/database');
const portalRouter = require('./portal/router');
const djWebAuth = require('./portal/dj-web-auth');
const app = express();

const portalCorsOrigins = (process.env.PORTAL_CORS_ORIGINS ||
    'https://eyupevents.uk,https://www.eyupevents.uk,https://requests.eyupevents.uk'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const PORT = process.env.PORT || 3000;

// Initialize DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Guest photo uploads — stored on disk under uploads/photos/<eventId>/
const uploadsRoot = path.join(__dirname, 'uploads');
const photosRoot = path.join(uploadsRoot, 'photos');
fs.mkdirSync(photosRoot, { recursive: true });
app.use('/uploads/photos', express.static(photosRoot, { maxAge: '7d', immutable: true }));

const photoStorage = multer.diskStorage({
    destination(req, file, cb) {
        const eventDir = path.join(photosRoot, String(req.event.id));
        fs.mkdirSync(eventDir, { recursive: true });
        cb(null, eventDir);
    },
    filename(req, file, cb) {
        const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype] || '.jpg';
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
});
const photoUpload = multer({
    storage: photoStorage,
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, or GIF images are allowed'), ok);
    }
});

// Event theme assets (backgrounds/logos uploaded by the DJ) — uploads/themes/<eventId>/
const themesRoot = path.join(uploadsRoot, 'themes');
fs.mkdirSync(themesRoot, { recursive: true });
app.use('/uploads/themes', express.static(themesRoot, { maxAge: '7d' }));

// Display background slideshow images — uploads/slideshow/<eventId>/
const slideshowRoot = path.join(uploadsRoot, 'slideshow');
fs.mkdirSync(slideshowRoot, { recursive: true });
app.use('/uploads/slideshow', express.static(slideshowRoot, { maxAge: '7d' }));

// Product catalog images — uploads/catalog/
const catalogImagesRoot = path.join(uploadsRoot, 'catalog');
fs.mkdirSync(catalogImagesRoot, { recursive: true });
app.use('/uploads/catalog', express.static(catalogImagesRoot, { maxAge: '30d' }));

const slideshowStorage = multer.diskStorage({
    destination(req, file, cb) {
        const eventDir = path.join(slideshowRoot, String(req.params.id));
        fs.mkdirSync(eventDir, { recursive: true });
        cb(null, eventDir);
    },
    filename(req, file, cb) {
        const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype] || '.jpg';
        cb(null, `slide-${Date.now()}${ext}`);
    }
});
const slideshowUpload = multer({
    storage: slideshowStorage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, or GIF images are allowed'), ok);
    }
});

const themeStorage = multer.diskStorage({
    destination(req, file, cb) {
        const eventDir = path.join(themesRoot, String(req.params.id));
        fs.mkdirSync(eventDir, { recursive: true });
        cb(null, eventDir);
    },
    filename(req, file, cb) {
        const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' })[file.mimetype] || '.jpg';
        const kind = ['bg', 'logo', 'display_bg'].includes(req.query.kind) ? req.query.kind : 'img';
        cb(null, `${kind}-${Date.now()}${ext}`);
    }
});
const themeUpload = multer({
    storage: themeStorage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, GIF, or SVG images are allowed'), ok);
    }
});

// Catalogue uploads (VirtualDJ song database XML / karaoke CSV) — staged in a temp
// dir, validated by parsing, then moved into db/ and hot-reloaded.
const catalogueTmpDir = path.join(uploadsRoot, 'tmp');
fs.mkdirSync(catalogueTmpDir, { recursive: true });
const catalogueUpload = multer({
    storage: multer.diskStorage({
        destination(req, file, cb) { cb(null, catalogueTmpDir); },
        filename(req, file, cb) { cb(null, `catalogue-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`); }
    }),
    limits: { fileSize: 200 * 1024 * 1024, files: 1 }
});

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

const { handleStripeWebhook } = require('./portal/stripe-webhook');
const stripeWebhookRaw = express.raw({ type: 'application/json' });
app.post('/api/v1/stripe/webhook', stripeWebhookRaw, handleStripeWebhook);
/** Legacy/alternate Stripe Dashboard URL (must still be POST + raw JSON). Prefer /stripe/webhook. */
app.post('/api/v1/stripe', stripeWebhookRaw, handleStripeWebhook);

app.use(express.json());

function djAllowedEvents(user) {
    return djWebAuth.filterEventsForUser(eventDb.getAll(), user);
}

function renderDjDashboard(req, res) {
    const events = djAllowedEvents(req.portalUser);
    const messages = djWebAuth.filterMessagesForUser(getDjInboxMessages(), req.portalUser, events);
    const requests = djWebAuth.filterRequestsForUser(djRequests, req.portalUser, events);
    res.render('dj-dashboard', {
        events,
        requests,
        messages,
        portalUser: djWebAuth.authUserPayload(req.portalUser),
        assignedGigs: djWebAuth.getUpcomingGigsForUser(req.portalUser),
        isAdmin: req.portalUser.role === 'admin'
    });
}

// ==================== DJ portal sign-in (same accounts as eyupevents.uk/events) ====================
app.get('/dj/login', (req, res) => {
    const user = djWebAuth.loadPortalUser(req);
    if (user && (user.role === 'dj' || user.role === 'admin')) {
        return res.redirect(req.query.next && String(req.query.next).startsWith('/') ? req.query.next : '/dj');
    }
    const turnstileSiteKey =
        (process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || '').trim() ||
        '0x4AAAAAADRESh0tEw6T6JKh';
    res.render('dj-login', {
        error: req.query.error,
        nextUrl: req.query.next && String(req.query.next).startsWith('/') ? req.query.next : '/dj',
        turnstileSiteKey
    });
});

app.post('/dj/auth/login', (req, res) => djWebAuth.handleDjLogin(req, res));
app.post('/dj/auth/logout', djWebAuth.requireDjApiAuth, (req, res) => djWebAuth.handleDjLogout(req, res));

// ==================== Global App Settings ====================
// DJ-wide configuration stored in SQLite (app_settings) instead of hard-coded values.
const GLOBAL_SETTINGS_DEFAULTS = {
    dj_name: 'DJ Chaos',
    // Public URL guests use to reach this app (for share links/QR codes).
    // Empty = derive from the incoming request, which can be wrong behind a proxy.
    public_base_url: '',
    virtualdj_enabled: true,
    virtualdj_ask_path: '/ask/HawaiianNight',
    default_enable_song_requests: true,
    default_enable_karaoke_requests: true,
    default_enable_messages: true,
    default_enable_photos: false,
    default_enable_tips: false,
    enable_public_events_page: false,
    photo_max_per_guest: 20,
    // Photo slideshow: display screens periodically pop up a random guest photo
    photo_slideshow_enabled: false,
    photo_slideshow_minutes: 5,
    // Banner style around showcased photos: party | neon | elegant | minimal
    photo_banner_style: 'party',
    // Big-screen guest message card: classic | party | neon | elegant | minimal | celebration | retro
    display_message_style: 'classic'
};

const DISPLAY_MESSAGE_STYLES = ['classic', 'party', 'neon', 'elegant', 'minimal', 'celebration', 'retro'];

function resolveDisplayMessageStyle(event) {
    const settings = getGlobalSettings();
    const raw = (event && event.display_message_style) || settings.display_message_style || 'classic';
    return DISPLAY_MESSAGE_STYLES.includes(raw) ? raw : 'classic';
}

// Base URL for shareable guest links: configured public URL if set, else the request host.
function getPublicBaseUrl(req) {
    const configured = (getGlobalSettings().public_base_url || '').trim().replace(/\/+$/, '');
    return configured || `${req.protocol}://${req.get('host')}`;
}

function getGlobalSettings() {
    return { ...GLOBAL_SETTINGS_DEFAULTS, ...settingsDb.get('global', {}) };
}

// Make the configured DJ name available to every rendered view (used by
// guest pages to label DJ replies instead of a hard-coded name).
app.use((req, res, next) => {
    res.locals.djName = getGlobalSettings().dj_name;
    next();
});

function saveGlobalSettings(patch) {
    const merged = { ...getGlobalSettings() };
    for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in GLOBAL_SETTINGS_DEFAULTS)) continue;
        const defaultValue = GLOBAL_SETTINGS_DEFAULTS[key];
        if (typeof defaultValue === 'boolean') {
            merged[key] = value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
        } else if (typeof defaultValue === 'number') {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0) merged[key] = n;
        } else {
            merged[key] = value == null ? defaultValue : String(value).trim();
        }
    }
    settingsDb.set('global', merged);
    return merged;
}

// EYUP events portal JSON API (separate SQLite DB — does not touch song-request tables)
app.use(
    '/api/v1',
    cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true);
            if (portalCorsOrigins.includes(origin)) return cb(null, true);
            cb(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Portal-Internal-Key']
    }),
    portalRouter
);

// Global variables to store catalogues
let songCatalogue = [];
let karaokeCatalogue = [];

// Requests/messages/replies are persisted in SQLite and mirrored into these
// in-memory arrays for fast filtering. Hydrated from the DB at startup; every
// mutation writes through to the DB so nothing is lost on restart.
let djRequests = [];
let djMessages = [];
let djReplies = [];

try {
    djRequests = requestDb.getAllLive();
    djMessages = messageDb.getAllLive();
    djReplies = replyDb.getAllLive();
    console.log(`Restored from DB: ${djRequests.length} requests, ${djMessages.length} messages, ${djReplies.length} replies`);
} catch (err) {
    console.error('Failed to restore requests/messages/replies from DB:', err);
}

// Current playing track state (for DMX controller integration)
// Keyed by eventId or 'global' for non-event-specific tracks
let nowPlayingMap = {};

// Helper middleware to get event from slug
function getEventFromSlug(req, res, next) {
    const slug = req.params.eventSlug;
    if (!slug) {
        return next();
    }
    
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return res.status(404).render('error', { 
            error: 'Event not found', 
            customerName: '',
            eventSlug: null
        });
    }
    
    if (!event.is_active) {
        return res.status(403).render('error', { 
            error: 'This event is no longer active', 
            customerName: '',
            eventSlug: slug
        });
    }
    
    req.event = event;
    next();
}

// JSON variant for API routes (no EJS error pages)
function getEventFromSlugJson(req, res, next) {
    const slug = req.params.eventSlug;
    if (!slug) {
        return res.status(400).json({ error: 'Event slug is required' });
    }
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (!event.is_active) {
        return res.status(403).json({ error: 'This event is no longer active' });
    }
    req.event = event;
    next();
}

function isGuestMessageForReply(m) {
    return (
        !m.isReply &&
        m.type !== 'song-request' &&
        m.type !== 'karaoke-request' &&
        m.type !== 'spinner-result'
    );
}

function isDjInboxMessage(m) {
    return isGuestMessageForReply(m) || m.type === 'spinner-result';
}

function filterDjInboxMessages(messages) {
    return messages.filter(isDjInboxMessage);
}

/** DJ-only inbox note when a spinner runs — never queued for the public message screen. */
function queueSpinnerResultForDj(event, spinnerKind, messageText) {
    const titles = {
        karaoke: '🎤 Karaoke spinner',
        guest: '👤 Guest spinner',
        coin: '🪙 Heads or tails',
        yesno: '❓ Yes or No'
    };
    const djDisplayMessage = {
        customerName: titles[spinnerKind] || '🎲 Spinner',
        message: messageText,
        textMessage: messageText,
        timestamp: new Date().toISOString(),
        displayed: true,
        private: true,
        type: 'spinner-result',
        eventId: event.id,
        eventSlug: event.slug,
        eventName: event.name
    };
    djDisplayMessage.id = messageDb.add(djDisplayMessage);
    djMessages.push(djDisplayMessage);
}

function getDjInboxMessages() {
    return enrichMessagesWithReplyStatus(filterDjInboxMessages(djMessages), djReplies);
}

function buildCustomerTimeline(customerName, eventSlug = null, eventId = null) {
    const name = String(customerName || '').trim().toLowerCase();
    if (!name) return [];
    const items = [];

    for (const m of djMessages) {
        if (!isGuestMessageForReply(m)) continue;
        if ((m.customerName || '').toLowerCase() !== name) continue;
        if (eventId != null && m.eventId != null && Number(m.eventId) !== Number(eventId)) continue;
        if (eventSlug && m.eventSlug && m.eventSlug !== eventSlug) continue;
        items.push({
            kind: 'message',
            id: m.id,
            timestamp: m.timestamp,
            body: m.message,
            textMessage: m.textMessage,
            hasMedia: !!m.hasMedia,
            private: !!m.private
        });
    }

    for (const r of djReplies) {
        if ((r.customerName || '').toLowerCase() !== name) continue;
        if (eventId != null && r.eventId != null && Number(r.eventId) !== Number(eventId)) continue;
        if (eventSlug && r.eventSlug && r.eventSlug !== eventSlug) continue;
        items.push({
            kind: 'reply',
            id: r.id,
            timestamp: r.timestamp,
            body: r.replyMessage,
            replyMessage: r.replyMessage,
            direct: !!r.direct,
            originalType: r.originalType || null
        });
    }

    for (const req of djRequests) {
        if ((req.customerName || '').toLowerCase() !== name) continue;
        if (eventId != null && req.eventId != null && Number(req.eventId) !== Number(eventId)) continue;
        if (eventSlug && req.eventSlug && req.eventSlug !== eventSlug) continue;
        items.push({
            kind: 'request',
            id: req.id,
            timestamp: req.timestamp,
            type: req.type,
            title: req.song ? req.song.title : req.title,
            artist: req.song ? req.song.artist : req.artist,
            message: req.message || null,
            note: req.message || null,
            status: req.status || 'pending'
        });
    }

    items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return items;
}

function buildGuestConversation(eventId, customerName) {
    const event = eventDb.getById(eventId);
    const eventSlug = event ? event.slug : null;
    return buildCustomerTimeline(customerName, eventSlug, eventId);
}

async function submitGuestMessage(body, res, { json = false } = {}) {
    const customerName = (body.customerName || '').trim();
    const eventSlug = body.eventSlug || null;
    let { message, messageText } = body;

    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;

    if (!rejectGuestIfModerated(event, customerName, res, {
        json,
        eventSlug,
        silentThankYou: {
            customerName,
            requestType: 'message',
            details: { message: 'Your message' },
            eventSlug: eventSlug || null
        }
    })) {
        return null;
    }

    if (!customerName) {
        if (json) {
            res.status(400).json({ error: 'customerName is required' });
        } else {
            res.redirect('/');
        }
        return null;
    }

    const rawDjOnly = body.djOnly;
    const djOnly = rawDjOnly === '1' || rawDjOnly === 'on' || rawDjOnly === 'true' || rawDjOnly === true;

    messageText = typeof messageText === 'string' ? messageText.trim() : '';
    let richContent = typeof message === 'string' ? message : '';
    if (!richContent.trim() && messageText) {
        richContent = messageText;
    }
    const hasMedia = richContent.includes('<img');

    const cleanMessage = DOMPurify.sanitize(richContent, {
        ALLOWED_TAGS: ['img', 'br', 'p', 'div', 'span', 'strong', 'em', 'u', 'b', 'i'],
        ALLOWED_ATTR: ['src', 'alt', 'style', 'class'],
        ALLOW_DATA_ATTR: false,
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });

    const textContent = DOMPurify.sanitize(richContent, {
        ALLOWED_TAGS: [],
        KEEP_CONTENT: true
    }).trim();

    const finalMessage = cleanMessage || (hasMedia ? richContent : '');

    if (!finalMessage || (!textContent && !hasMedia)) {
        if (json) {
            res.status(400).json({ error: 'Please enter a message or add some media.' });
        } else {
            res.status(400).render('error', {
                error: 'Please enter a message or add some media.',
                customerName,
                eventSlug: eventSlug || null
            });
        }
        return null;
    }

    if (textContent.length > 500) {
        if (json) {
            res.status(400).json({ error: 'Message text is too long. Please keep it under 500 characters.' });
        } else {
            res.status(400).render('error', {
                error: 'Message text is too long. Please keep it under 500 characters.',
                customerName,
                eventSlug: eventSlug || null
            });
        }
        return null;
    }

    const djDisplayMessage = {
        customerName,
        message: finalMessage,
        textMessage: textContent || (hasMedia ? 'Message with media' : 'Empty message'),
        timestamp: new Date().toISOString(),
        displayed: false,
        private: !!djOnly,
        hasMedia,
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    djDisplayMessage.id = messageDb.add(djDisplayMessage);
    djMessages.push(djDisplayMessage);

    try {
        await sendToVirtualDJ(customerName, textContent || 'Message with inline GIFs/images');
        console.log('Guest message sent:', {
            customerName,
            hasMedia,
            messageLength: finalMessage.length,
            djOnly,
            eventSlug: eventSlug || null
        });

        if (json) {
            res.json({
                success: true,
                message: {
                    id: djDisplayMessage.id,
                    kind: 'message',
                    timestamp: djDisplayMessage.timestamp,
                    body: djDisplayMessage.message,
                    textMessage: djDisplayMessage.textMessage,
                    hasMedia: djDisplayMessage.hasMedia,
                    private: djDisplayMessage.private
                }
            });
            return djDisplayMessage;
        }

        res.render('thank-you', {
            customerName,
            requestType: 'message',
            details: { message: textContent || 'Message with inline GIFs/images' },
            eventSlug: eventSlug || null
        });
        return djDisplayMessage;
    } catch (error) {
        console.error('Error sending message to VirtualDJ:', error);
        if (json) {
            res.status(500).json({ error: 'Failed to send message. Please try again.' });
        } else {
            res.status(500).render('error', {
                error: 'Failed to send message. Please try again.',
                customerName,
                eventSlug: eventSlug || null
            });
        }
        return null;
    }
}

function enrichMessagesWithReplyStatus(messages, replies) {
    const repliedMessageIds = new Set(
        replies
            .filter(r => r.originalType === 'message' && r.originalId != null)
            .map(r => Number(r.originalId))
    );
    return messages.map(m => ({
        ...m,
        needsReply: isGuestMessageForReply(m) && !repliedMessageIds.has(Number(m.id))
    }));
}

const GUEST_SUBMIT_GENERIC_ERROR = 'Unable to complete your request right now. Please try again later.';

function isGuestModerated(event, customerName) {
    if (!event || !customerName) return false;
    return !guestDb.getModerationStatus(event.id, customerName).allowed;
}

/** Returns false when the guest is moderated and the response has been sent. */
function rejectGuestIfModerated(event, customerName, res, { json = false, eventSlug = null, silentThankYou = null } = {}) {
    if (!isGuestModerated(event, customerName)) return true;
    if (json) {
        res.json({ success: true });
    } else if (silentThankYou) {
        res.render('thank-you', silentThankYou);
    } else {
        res.status(503).render('error', {
            error: GUEST_SUBMIT_GENERIC_ERROR,
            customerName,
            eventSlug: eventSlug || (event && event.slug) || null
        });
    }
    return false;
}

// Storage for karaoke spinner (per event slug — display + requests stay scoped to the gig)
const karaokeSpinStateBySlug = {};

function emptyKaraokeSpinState() {
    return { shouldSpin: false, selectedSong: null, timestamp: null };
}

function getKaraokeSpinState(slug) {
    if (!slug) return emptyKaraokeSpinState();
    return karaokeSpinStateBySlug[slug] || emptyKaraokeSpinState();
}

function clearKaraokeSpinState(slug) {
    if (slug) delete karaokeSpinStateBySlug[slug];
}

// Guest spinner (per event slug — same trigger / poll / animate pattern as karaoke)
const guestSpinStateBySlug = {};

function emptyGuestSpinState() {
    return { shouldSpin: false, selectedGuest: null, timestamp: null };
}

function getGuestSpinState(slug) {
    if (!slug) return emptyGuestSpinState();
    return guestSpinStateBySlug[slug] || emptyGuestSpinState();
}

function clearGuestSpinState(slug) {
    if (slug) delete guestSpinStateBySlug[slug];
}

// Coin (heads/tails) and yes/no binary spinners
const coinSpinStateBySlug = {};
const yesNoSpinStateBySlug = {};

function emptyBinarySpinState() {
    return { shouldSpin: false, result: null, timestamp: null };
}

function getCoinSpinState(slug) {
    if (!slug) return emptyBinarySpinState();
    return coinSpinStateBySlug[slug] || emptyBinarySpinState();
}

function clearCoinSpinState(slug) {
    if (slug) delete coinSpinStateBySlug[slug];
}

function getYesNoSpinState(slug) {
    if (!slug) return emptyBinarySpinState();
    return yesNoSpinStateBySlug[slug] || emptyBinarySpinState();
}

function clearYesNoSpinState(slug) {
    if (slug) delete yesNoSpinStateBySlug[slug];
}

function triggerCoinSpinForEvent(eventSlug) {
    const slug = String(eventSlug || '').trim();
    if (!slug) return { error: 'eventSlug is required' };
    const event = eventDb.getBySlug(slug);
    if (!event) return { error: 'Event not found' };
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    coinSpinStateBySlug[slug] = {
        shouldSpin: true,
        result,
        timestamp: Date.now()
    };
    console.log('Coin spin triggered for event', slug, ':', result);
    const label = result === 'heads' ? 'Heads' : 'Tails';
    queueSpinnerResultForDj(event, 'coin', `Result: ${label}`);
    return { success: true, result, eventSlug: slug, eventId: event.id };
}

function triggerYesNoSpinForEvent(eventSlug) {
    const slug = String(eventSlug || '').trim();
    if (!slug) return { error: 'eventSlug is required' };
    const event = eventDb.getBySlug(slug);
    if (!event) return { error: 'Event not found' };
    const result = Math.random() < 0.5 ? 'yes' : 'no';
    yesNoSpinStateBySlug[slug] = {
        shouldSpin: true,
        result,
        timestamp: Date.now()
    };
    console.log('Yes/No spin triggered for event', slug, ':', result);
    const label = result === 'yes' ? 'Yes' : 'No';
    queueSpinnerResultForDj(event, 'yesno', `Result: ${label}`);
    return { success: true, result, eventSlug: slug, eventId: event.id };
}

function getEligibleGuestsForEvent(event) {
    return guestDb
        .getByEvent(event.id)
        .filter(
            (g) =>
                g.status !== 'banned' &&
                g.customerName &&
                !guestDb.isSyntheticName(g.customerName)
        );
}

// Photo showcase trigger — DJ pushes a guest photo to the event display screen.
// Keyed by event slug; the display polls and clears it after showing.
const photoShowcaseState = {};

// DJ-triggered animated screen prompts (per event slug, or 'global' for legacy display)
const displayPromptState = {};

const DISPLAY_PROMPTS = {
    'great-moves': {
        label: 'Great Moves!',
        icon: 'fa-fire-flame-curved',
        subtext: "Show 'em how it's done!",
        style: 'great-moves'
    },
    'dance-floor-open': {
        label: 'Dance Floor Open!',
        icon: 'fa-door-open',
        subtext: "Everyone's invited!",
        style: 'dance-floor'
    },
    'dad-dancing': {
        label: 'Dad Dancing!',
        icon: 'fa-person-walking',
        subtext: 'Awkward moves encouraged',
        style: 'dad-dancing'
    },
    'slow-dance': {
        label: 'Slow Dance',
        icon: 'fa-heart',
        subtext: 'Grab your partner',
        style: 'slow-dance'
    },
    'last-orders': {
        label: 'Last Orders!',
        icon: 'fa-bell',
        subtext: 'Final requests coming up!',
        style: 'last-orders'
    },
    'round-applause': {
        label: 'Round of Applause!',
        icon: 'fa-hands-clapping',
        subtext: 'Give it up!',
        style: 'applause'
    },
    'selfie-time': {
        label: 'Selfie Time!',
        icon: 'fa-camera',
        subtext: 'Strike a pose!',
        style: 'selfie'
    }
};

// Canonical catalogue file locations (uploads from the settings page land here)
const SONG_DB_XML_PATH = path.join(__dirname, 'db', 'Song_Database.xml');
const KARAOKE_CSV_PATH = path.join(__dirname, 'db', 'Karaoke_Catalog.csv');
// Pre-upload-feature install location, kept as a read fallback
const LEGACY_KARAOKE_CSV_PATH = path.join(__dirname, 'db', 'VirtualDJ_Karaoke_Catalog_2025-12-29.csv');

// Parse a VirtualDJ database XML file into a song catalogue array. Throws on invalid XML.
async function parseSongsXML(xmlPath) {
    const xmlData = fs.readFileSync(xmlPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);

    const songs = [];
    let id = 1;

    if (result.VirtualDJ_Database && result.VirtualDJ_Database.Song) {
        result.VirtualDJ_Database.Song.forEach(song => {
            if (song.Tags && song.Tags[0]) {
                const tags = song.Tags[0].$;
                if (tags.Title && tags.Author) {
                    songs.push({
                        id: id++,
                        title: tags.Title,
                        artist: tags.Author,
                        genre: tags.Album || 'Unknown',
                        year: tags.Year || 'Unknown'
                    });
                }
            }
        });
    }
    return songs;
}

// Parse a karaoke catalogue CSV (Title/Artist/Genre columns) into an array. Rejects on read error.
function parseKaraokeCSV(csvPath) {
    return new Promise((resolve, reject) => {
        const songs = [];
        let id = 1;
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                const title = row.Title || row.title;
                const artist = row.Artist || row.artist;
                const genre = row.Genre || row.genre || '';

                // Assign difficulty based on genre or randomly if no genre
                let difficulty = 'Medium';
                if (genre) {
                    if (genre.toLowerCase().includes('pop') || genre.toLowerCase().includes('rnb')) {
                        difficulty = 'Easy';
                    } else if (genre.toLowerCase().includes('rock') || genre.toLowerCase().includes('metal')) {
                        difficulty = 'Hard';
                    }
                } else {
                    const difficulties = ['Easy', 'Medium', 'Hard'];
                    difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
                }

                if (title && artist) {
                    songs.push({
                        id: id++,
                        title: title.trim(),
                        artist: artist.trim(),
                        difficulty: difficulty,
                        genre: genre.trim()
                    });
                }
            })
            .on('end', () => resolve(songs))
            .on('error', reject);
    });
}

// Function to load songs from VirtualDJ XML database
async function loadSongsFromXML() {
    try {
        if (!fs.existsSync(SONG_DB_XML_PATH)) {
            console.warn('Song_Database.xml not found, using sample data');
            songCatalogue = getSampleSongs();
            return;
        }
        songCatalogue = await parseSongsXML(SONG_DB_XML_PATH);
        console.log(`Loaded ${songCatalogue.length} songs from XML database`);
    } catch (error) {
        console.error('Error loading songs from XML:', error);
        songCatalogue = getSampleSongs();
    }
}

// Function to load karaoke from CSV file
async function loadKaraokeFromCSV() {
    try {
        const csvPath = fs.existsSync(KARAOKE_CSV_PATH) ? KARAOKE_CSV_PATH : LEGACY_KARAOKE_CSV_PATH;
        if (!fs.existsSync(csvPath)) {
            console.warn('Karaoke CSV not found, using sample data');
            karaokeCatalogue = getSampleKaraoke();
            return;
        }
        karaokeCatalogue = await parseKaraokeCSV(csvPath);
        console.log(`Loaded ${karaokeCatalogue.length} karaoke songs from CSV`);
    } catch (error) {
        console.error('Error loading karaoke from CSV:', error);
        karaokeCatalogue = getSampleKaraoke();
    }
}

// Sample data functions (fallback)
function getSampleSongs() {
    return [
        { id: 1, title: "Shape of You", artist: "Ed Sheeran", genre: "Pop", year: "2017" },
        { id: 2, title: "Bohemian Rhapsody", artist: "Queen", genre: "Rock", year: "1975" },
        { id: 3, title: "Billie Jean", artist: "Michael Jackson", genre: "Pop", year: "1983" },
        { id: 4, title: "Hotel California", artist: "Eagles", genre: "Rock", year: "1976" },
        { id: 5, title: "Sweet Caroline", artist: "Neil Diamond", genre: "Classic Rock", year: "1969" },
        { id: 6, title: "Dancing Queen", artist: "ABBA", genre: "Disco", year: "1976" },
        { id: 7, title: "Hey Jude", artist: "The Beatles", genre: "Rock", year: "1968" },
        { id: 8, title: "Imagine", artist: "John Lennon", genre: "Classic Rock", year: "1971" }
    ];
}

function getSampleKaraoke() {
    return [
        { id: 1, title: "I Will Survive", artist: "Gloria Gaynor", difficulty: "Easy" },
        { id: 2, title: "Sweet Child O' Mine", artist: "Guns N' Roses", difficulty: "Hard" },
        { id: 3, title: "Don't Stop Believin'", artist: "Journey", difficulty: "Medium" },
        { id: 4, title: "Livin' on a Prayer", artist: "Bon Jovi", difficulty: "Medium" },
        { id: 5, title: "My Way", artist: "Frank Sinatra", difficulty: "Easy" },
        { id: 6, title: "Wonderwall", artist: "Oasis", difficulty: "Easy" },
        { id: 7, title: "We Are the Champions", artist: "Queen", difficulty: "Medium" },
        { id: 8, title: "Summer of '69", artist: "Bryan Adams", difficulty: "Easy" }
    ];
}

// Initialize catalogues on startup
async function initializeCatalogues() {
    console.log('Loading song and karaoke catalogues...');
    await loadSongsFromXML();
    await loadKaraokeFromCSV();
    console.log('Catalogues loaded successfully');
}

// Function to send data to VirtualDJ
async function sendToVirtualDJ(name, messageText) {
    const settings = getGlobalSettings();
    if (!settings.virtualdj_enabled) {
        console.log('VirtualDJ integration disabled in settings; skipping send.');
        return null;
    }
    const askPath = settings.virtualdj_ask_path || GLOBAL_SETTINGS_DEFAULTS.virtualdj_ask_path;

    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            'name': name,
            'message': messageText
        });

        const options = {
            hostname: 'virtualdj.com',
            path: askPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'MobileDJay/1.0'
            },
            timeout: 10000 // 10 second timeout
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                // Handle redirects (302, 301, etc.)
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    const redirectUrl = res.headers.location;
                    console.log(`VirtualDJ redirected to: ${redirectUrl}`);
                    
                    if (redirectUrl) {
                        // Follow the redirect
                        followRedirect(redirectUrl, postData, resolve, reject);
                    } else {
                        console.log('VirtualDJ redirect successful (no location header)');
                        resolve(data);
                    }
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('Successfully sent to VirtualDJ:', { name, messageText });
                    resolve(data);
                } else {
                    console.error('VirtualDJ responded with status:', res.statusCode);
                    console.error('Response data:', data);
                    reject(new Error(`VirtualDJ request failed with status: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error sending to VirtualDJ:', error);
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to VirtualDJ timed out'));
        });

        req.write(postData);
        req.end();
    });
}

// Helper function to follow redirects
function followRedirect(redirectUrl, postData, resolve, reject) {
    const url = require('url');
    let parsedUrl;
    
    // Handle relative URLs by making them absolute to virtualdj.com
    if (redirectUrl.startsWith('/')) {
        parsedUrl = {
            protocol: 'https:',
            hostname: 'virtualdj.com',
            path: redirectUrl
        };
    } else {
        parsedUrl = url.parse(redirectUrl);
    }
    
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'MobileDJay/1.0'
        },
        timeout: 10000
    };

    const protocol = parsedUrl.protocol === 'https:' ? https : require('http');
    
    const req = protocol.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('Successfully sent to VirtualDJ after redirect');
                resolve(data);
            } else if (res.statusCode >= 300 && res.statusCode < 400) {
                // Handle multiple redirects if necessary
                const nextRedirectUrl = res.headers.location;
                if (nextRedirectUrl) {
                    followRedirect(nextRedirectUrl, postData, resolve, reject);
                } else {
                    console.log('VirtualDJ redirect chain completed');
                    resolve(data);
                }
            } else {
                console.error('VirtualDJ redirect failed with status:', res.statusCode);
                console.error('Redirect response data:', data);
                reject(new Error(`VirtualDJ redirect failed with status: ${res.statusCode}`));
            }
        });
    });

    req.on('error', (error) => {
        console.error('Error following VirtualDJ redirect:', error);
        reject(error);
    });

    req.on('timeout', () => {
        req.destroy();
        reject(new Error('VirtualDJ redirect request timed out'));
    });

    req.write(postData);
    req.end();
}

// Routes
// ==================== Event Management API ====================

// Get all events (for DJ dashboard)
app.get('/api/events', djWebAuth.requireDjApiAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const events = djAllowedEvents(req.portalUser).map((event) => ({
        ...event,
        stats: eventDb.getStats(event.id)
    }));
    res.json(events);
});

// Create a new event
app.post('/api/events', djWebAuth.requireAdminApiAuth, (req, res) => {
    const { name, description, venue, eventDate, 
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css, logo_image,
            enable_song_requests, enable_karaoke_requests, enable_messages, enable_photos,
            enable_tips, tip_provider, tip_payment_link, tip_links, show_public } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Event name is required' });
    }
    
    try {
        const eventOptions = { 
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css, logo_image,
            enable_song_requests: enable_song_requests !== undefined ? (enable_song_requests ? 1 : 0) : 1,
            enable_karaoke_requests: enable_karaoke_requests !== undefined ? (enable_karaoke_requests ? 1 : 0) : 1,
            enable_messages: enable_messages !== undefined ? (enable_messages ? 1 : 0) : 1,
            enable_photos: enable_photos ? 1 : 0,
            enable_tips: enable_tips ? 1 : 0,
            show_public: show_public ? 1 : 0,
            tip_provider: tip_provider || null,
            tip_payment_link: tip_payment_link || null,
            tip_links: tip_links ? (typeof tip_links === 'string' ? tip_links : JSON.stringify(tip_links)) : null
        };
        const result = eventDb.create(name, description, venue, eventDate, eventOptions);
        const event = eventDb.getById(result.id);
        res.json({ success: true, event });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// Update an event
app.put('/api/events/:id', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id);
    const updates = req.body;
    
    // Serialize tip_links array to JSON string for storage
    if (updates.tip_links && typeof updates.tip_links !== 'string') {
        updates.tip_links = JSON.stringify(updates.tip_links);
    }
    
    try {
        const success = eventDb.update(eventId, updates);
        if (success) {
            const event = eventDb.getById(eventId);
            res.json({ success: true, event });
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// Cancel event — closes customer-facing request pages (sets is_active = 0). Does not delete data.
app.post('/api/events/:id/cancel', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    try {
        const existing = eventDb.getById(eventId);
        if (!existing) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const success = eventDb.update(eventId, { is_active: 0 });
        if (!success) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const event = eventDb.getById(eventId);
        res.json({
            success: true,
            action: 'cancelled',
            message: 'Event deactivated; customers will see an inactive notice until reactivated.',
            event
        });
    } catch (error) {
        console.error('Error cancelling event:', error);
        res.status(500).json({ error: 'Failed to cancel event' });
    }
});

// Postpone event — updates scheduled date (and optionally venue). Does not change is_active.
app.post('/api/events/:id/postpone', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    const body = req.body || {};
    const rawDate = body.event_date ?? body.eventDate;
    if (rawDate == null || typeof rawDate !== 'string' || !rawDate.trim()) {
        return res.status(400).json({
            error: 'event_date is required (use ISO date string or YYYY-MM-DD)'
        });
    }
    const event_date = rawDate.trim();
    try {
        const existing = eventDb.getById(eventId);
        if (!existing) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const updates = { event_date };
        if (body.venue !== undefined && body.venue !== null) {
            updates.venue = String(body.venue).trim();
        }
        const success = eventDb.update(eventId, updates);
        if (!success) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const event = eventDb.getById(eventId);
        res.json({
            success: true,
            action: 'postponed',
            message: 'Event date updated.',
            event
        });
    } catch (error) {
        console.error('Error postponing event:', error);
        res.status(500).json({ error: 'Failed to postpone event' });
    }
});

// Delete an event
app.delete('/api/events/:id', djWebAuth.requireAdminApiAuth, (req, res) => {
    const eventId = parseInt(req.params.id);
    
    try {
        const success = eventDb.delete(eventId);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// Get event by slug (public)
app.get('/api/events/slug/:slug', (req, res) => {
    const event = eventDb.getBySlug(req.params.slug);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event);
});

// ==================== Global Settings API ====================

app.get('/api/settings', djWebAuth.requireDjApiAuth, (req, res) => {
    res.json(getGlobalSettings());
});

app.put('/api/settings', djWebAuth.requireAdminApiAuth, (req, res) => {
    try {
        const merged = saveGlobalSettings(req.body || {});
        res.json({ success: true, settings: merged });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Current catalogue status for the settings page (counts + file info)
app.get('/api/settings/catalogues', djWebAuth.requireAdminApiAuth, (req, res) => {
    function fileInfo(...candidates) {
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                const stat = fs.statSync(p);
                return { exists: true, filename: path.basename(p), size: stat.size, modified: stat.mtime };
            }
        }
        return { exists: false };
    }
    res.json({
        songs: { count: songCatalogue.length, file: fileInfo(SONG_DB_XML_PATH) },
        karaoke: { count: karaokeCatalogue.length, file: fileInfo(KARAOKE_CSV_PATH, LEGACY_KARAOKE_CSV_PATH) }
    });
});

// Upload a new VirtualDJ song database XML — validated by parsing before it replaces the old one
app.post('/api/settings/upload-song-database', djWebAuth.requireAdminApiAuth, catalogueUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const tmpPath = req.file.path;
    try {
        const songs = await parseSongsXML(tmpPath);
        if (songs.length === 0) {
            throw new Error('No songs found — is this a VirtualDJ database XML export?');
        }
        fs.copyFileSync(tmpPath, SONG_DB_XML_PATH);
        songCatalogue = songs;
        console.log(`Song database replaced via upload: ${songs.length} songs (${req.file.originalname})`);
        res.json({ success: true, count: songs.length });
    } catch (error) {
        console.error('Song database upload rejected:', error.message);
        res.status(400).json({ error: `Invalid song database: ${error.message}` });
    } finally {
        fs.unlink(tmpPath, () => {});
    }
});

// Upload a new karaoke catalogue CSV — validated by parsing before it replaces the old one
app.post('/api/settings/upload-karaoke-catalog', djWebAuth.requireAdminApiAuth, catalogueUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const tmpPath = req.file.path;
    try {
        const songs = await parseKaraokeCSV(tmpPath);
        if (songs.length === 0) {
            throw new Error('No songs found — the CSV needs Title and Artist columns');
        }
        fs.copyFileSync(tmpPath, KARAOKE_CSV_PATH);
        karaokeCatalogue = songs;
        console.log(`Karaoke catalogue replaced via upload: ${songs.length} songs (${req.file.originalname})`);
        res.json({ success: true, count: songs.length });
    } catch (error) {
        console.error('Karaoke catalogue upload rejected:', error.message);
        res.status(400).json({ error: `Invalid karaoke catalogue: ${error.message}` });
    } finally {
        fs.unlink(tmpPath, () => {});
    }
});

// Send a test message to VirtualDJ using the currently saved settings
app.post('/api/settings/test-virtualdj', djWebAuth.requireAdminApiAuth, async (req, res) => {
    const settings = getGlobalSettings();
    if (!settings.virtualdj_enabled) {
        return res.status(400).json({ error: 'VirtualDJ integration is disabled — enable and save it first' });
    }
    try {
        await sendToVirtualDJ('MobileDJay', 'Connection test from Global Settings');
        res.json({ success: true });
    } catch (error) {
        console.error('VirtualDJ test failed:', error);
        res.status(502).json({ error: error.message || 'Could not reach VirtualDJ' });
    }
});

// ==================== Event Share Links API ====================

// All shareable links for an event (used by the DJ "Share" modal)
app.get('/api/events/:id/links', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const base = getPublicBaseUrl(req);
    res.json({
        guest: `${base}/event/${event.slug}`,
        photos: `${base}/event/${event.slug}/photo`,
        gallery: `${base}/gallery/${event.slug}/${event.share_token}`,
        display: `${base}/dj/display/${event.slug}`
    });
});

// Rotate the gallery share token (invalidates previously shared gallery links)
app.post('/api/events/:id/regenerate-share-token', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const token = eventDb.regenerateShareToken(eventId);
    if (!token) {
        return res.status(500).json({ error: 'Failed to regenerate token' });
    }
    const base = getPublicBaseUrl(req);
    res.json({ success: true, share_token: token, gallery: `${base}/gallery/${event.slug}/${token}` });
});

// ==================== Event Theme Image Uploads ====================

// Upload a theme asset for an event (?kind=bg|logo|display_bg). Returns the public URL;
// the client then saves that URL on the event via PUT /api/events/:id.
app.post('/api/events/:id/theme-image', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = req.event;
    themeUpload.single('image')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 10 MB)' : (err.message || 'Upload failed');
            return res.status(400).json({ error: msg });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No image attached' });
        }
        res.json({ success: true, url: `/uploads/themes/${event.id}/${req.file.filename}` });
    });
});

// ==================== Event Guests (check-in + moderation) ====================

// Guest checks in when they enter their name on the event landing page
app.post('/api/event/:eventSlug/guest-checkin', getEventFromSlugJson, (req, res) => {
    const customerName = (req.body.customerName || '').toString().trim();
    if (!customerName) {
        return res.status(400).json({ error: 'Name is required' });
    }
    guestDb.checkIn(req.event.id, customerName);
    res.json({ success: true });
});

// DJ-only guest status (not used on guest pages)
app.get('/api/events/:id/guests/:customerName/status', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const customerName = (req.params.customerName || '').toString().trim();
    const mod = guestDb.getModerationStatus(event.id, customerName);
    res.json({
        status: mod.allowed ? 'active' : mod.reason,
        until: mod.until || null
    });
});

// DJ: list guests who have signed up or interacted with an event
app.get('/api/events/:id/guests', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    res.json(guestDb.getByEvent(event.id));
});

// DJ: full conversation timeline for a guest at an event
app.get('/api/events/:id/guests/:customerName/conversation', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const customerName = decodeURIComponent(req.params.customerName || '').trim();
    if (!customerName) {
        return res.status(400).json({ error: 'customerName is required' });
    }
    res.json({
        eventId: event.id,
        eventName: event.name,
        customerName,
        items: buildGuestConversation(event.id, customerName)
    });
});

// DJ: silence, ban, or reinstate a guest
app.put('/api/events/:id/guests/moderate', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const customerName = (req.body.customerName || '').toString().trim();
    const action = (req.body.action || '').toString().toLowerCase();
    if (!customerName) {
        return res.status(400).json({ error: 'customerName is required' });
    }

    if (action === 'silence') {
        const minutes = parseInt(req.body.durationMinutes, 10);
        if (!minutes || minutes < 1 || minutes > 24 * 60) {
            return res.status(400).json({ error: 'durationMinutes must be between 1 and 1440' });
        }
        guestDb.setSilenced(event.id, customerName, minutes, req.body.note || null);
    } else if (action === 'ban') {
        guestDb.setBanned(event.id, customerName, req.body.note || null);
    } else if (action === 'active' || action === 'reinstate') {
        guestDb.setActive(event.id, customerName);
    } else {
        return res.status(400).json({ error: 'action must be silence, ban, or active' });
    }

    const guests = guestDb.getByEvent(event.id);
    const updated = guests.find(g => g.customerName.toLowerCase() === customerName.toLowerCase());
    res.json({ success: true, guest: updated || null });
});

// DJ: remove a guest from the event list (does not delete their requests/messages)
app.post('/api/events/:id/guests/remove', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const customerName = (req.body.customerName || '').toString().trim();
    if (!customerName) {
        return res.status(400).json({ error: 'customerName is required' });
    }
    if (guestDb.isSyntheticName(customerName)) {
        guestDb.deleteFromEvent(event.id, customerName);
        return res.json({ success: true });
    }
    const removed = guestDb.deleteFromEvent(event.id, customerName);
    if (!removed) {
        return res.status(404).json({ error: 'Guest not found on this event' });
    }
    res.json({ success: true });
});

// ==================== Photos API ====================

function photoToJson(row) {
    return {
        id: row.id,
        eventId: row.event_id,
        customerName: row.customer_name,
        url: `/uploads/photos/${row.event_id}/${row.filename}`,
        caption: row.caption,
        hidden: row.is_hidden === 1,
        timestamp: row.created_at
    };
}

// Guest photo upload (multipart form: photo file + customerName + caption)
app.post('/api/event/:eventSlug/photos', getEventFromSlugJson, (req, res) => {
    if (!req.event.enable_photos) {
        return res.status(403).json({ error: 'Photos are not enabled for this event' });
    }
    photoUpload.single('photo')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 15 MB)' : (err.message || 'Upload failed');
            return res.status(400).json({ error: msg });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No photo attached' });
        }
        const customerName = (req.body.customerName || '').toString().trim().slice(0, 50) || null;
        const caption = (req.body.caption || '').toString().trim().slice(0, 200) || null;

        if (customerName && !rejectGuestIfModerated(req.event, customerName, res, { json: true })) {
            fs.unlink(req.file.path, () => {});
            return;
        }
        if (customerName) {
            const maxPerGuest = getGlobalSettings().photo_max_per_guest;
            const guestCount = photoDb.getByEvent(req.event.id, true)
                .filter((p) => (p.customer_name || '').toLowerCase() === customerName.toLowerCase()).length;
            if (guestCount >= maxPerGuest) {
                fs.unlink(req.file.path, () => {});
                return res.status(429).json({ error: `Photo limit reached (${maxPerGuest} per guest)` });
            }
        }
        const photoId = photoDb.create(req.event.id, {
            customerName,
            filename: req.file.filename,
            originalName: req.file.originalname || null,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            caption
        });
        const row = photoDb.getById(photoId);
        console.log(`Photo uploaded for event ${req.event.slug} by ${customerName || 'anonymous'} (${req.file.size} bytes)`);
        res.json({ success: true, photo: photoToJson(row) });
    });
});

// Public list of visible photos for an event (guest + customer gallery)
app.get('/api/event/:eventSlug/photos', getEventFromSlugJson, (req, res) => {
    const rows = photoDb.getByEvent(req.event.id, false);
    res.json(rows.map(photoToJson));
});

// DJ list including hidden photos
app.get('/api/events/:id/photos', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const rows = photoDb.getByEvent(event.id, true);
    res.json(rows.map(photoToJson));
});

// DJ hide/unhide a photo (kept on disk, excluded from guest gallery)
app.put('/api/photos/:id/hidden', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessByPhotoId, (req, res) => {
    const photo = req.photo;
    const hidden = req.body.hidden === true || req.body.hidden === 1 || req.body.hidden === '1' || req.body.hidden === 'true';
    photoDb.setHidden(photo.id, hidden);
    res.json({ success: true, hidden });
});

// DJ delete a photo (removes DB row + file on disk)
app.delete('/api/photos/:id', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessByPhotoId, (req, res) => {
    const photo = req.photo;
    photoDb.delete(photo.id);
    const filePath = path.join(photosRoot, String(photo.event_id), photo.filename);
    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
            console.error('Failed to delete photo file:', filePath, err.message);
        }
    });
    res.json({ success: true });
});

// ==================== Photo Showcase (DJ pushes a photo to the display) ====================

// Trigger: show this photo on the event's display screen
app.post('/api/photos/:id/showcase', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessByPhotoId, (req, res) => {
    const photo = req.photo;
    const event = req.event;
    photoShowcaseState[event.slug] = {
        photo: photoToJson(photo),
        eventName: event.name,
        // Per-event style wins; fall back to the global setting
        bannerStyle: event.photo_banner_style || getGlobalSettings().photo_banner_style,
        timestamp: Date.now()
    };
    res.json({ success: true });
});

// Slideshow pacing — last time an automatic photo was served, per event slug
const photoSlideshowLast = {};

// Poll: the display checks whether a photo should be shown.
// DJ-triggered showcases take priority; otherwise, if the slideshow is enabled,
// a random guest photo is served once every X minutes.
app.get('/api/display/:eventSlug/photo-showcase', (req, res) => {
    const slug = req.params.eventSlug;
    if (photoShowcaseState[slug]) {
        return res.json(photoShowcaseState[slug]);
    }

    const settings = getGlobalSettings();
    if (!settings.photo_slideshow_enabled) {
        return res.json({});
    }

    // Start the countdown from the first poll so a photo doesn't pop up
    // the moment the display is opened.
    if (!(slug in photoSlideshowLast)) {
        photoSlideshowLast[slug] = Date.now();
        return res.json({});
    }

    const intervalMs = Math.max(1, settings.photo_slideshow_minutes) * 60 * 1000;
    if (Date.now() - photoSlideshowLast[slug] < intervalMs) {
        return res.json({});
    }

    const event = eventDb.getBySlug(slug);
    if (!event || !event.enable_photos) {
        return res.json({});
    }
    const rows = photoDb.getByEvent(event.id, false); // visible photos only
    if (rows.length === 0) {
        return res.json({});
    }

    photoSlideshowLast[slug] = Date.now();
    const photo = rows[Math.floor(Math.random() * rows.length)];
    res.json({
        photo: photoToJson(photo),
        eventName: event.name,
        slideshow: true,
        bannerStyle: event.photo_banner_style || settings.photo_banner_style,
        timestamp: Date.now()
    });
});

// Clear: the display acknowledges it has shown the photo
app.post('/api/display/:eventSlug/photo-showcase/clear', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    delete photoShowcaseState[req.params.eventSlug];
    res.json({ success: true });
});

// ==================== Display Prompts (DJ pushes animated announcements to the screen) ====================

app.get('/api/display-prompts', (req, res) => {
    res.json(DISPLAY_PROMPTS);
});

app.post('/api/display/:eventSlug/prompt/:promptId', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    const { eventSlug, promptId } = req.params;
    const prompt = DISPLAY_PROMPTS[promptId];
    if (!prompt) {
        return res.status(404).json({ error: 'Unknown prompt' });
    }
    displayPromptState[eventSlug] = {
        prompt: { ...prompt, id: promptId },
        timestamp: Date.now()
    };
    res.json({ success: true, prompt: displayPromptState[eventSlug].prompt });
});

app.get('/api/display/:eventSlug/prompt', (req, res) => {
    const slug = req.params.eventSlug;
    const state = displayPromptState[slug];
    if (!state) {
        return res.json({});
    }
    // Consume immediately so repeat polls cannot re-show the same prompt
    delete displayPromptState[slug];
    res.json(state);
});

app.post('/api/display/:eventSlug/prompt/clear', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    delete displayPromptState[req.params.eventSlug];
    res.json({ success: true });
});

// Karaoke spinner — scoped to event display + request queue for that event
function triggerKaraokeSpinForEvent(eventSlug) {
    const slug = String(eventSlug || '').trim();
    if (!slug) {
        return { error: 'eventSlug is required' };
    }
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return { error: 'Event not found' };
    }
    if (karaokeCatalogue.length === 0) {
        return { error: 'No karaoke songs available' };
    }

    const randomIndex = Math.floor(Math.random() * karaokeCatalogue.length);
    const selectedSong = karaokeCatalogue[randomIndex];

    karaokeSpinStateBySlug[slug] = {
        shouldSpin: true,
        selectedSong,
        timestamp: Date.now()
    };

    const request = {
        type: 'karaoke',
        customerName: '🎲 Random Spinner',
        song: selectedSong,
        message: 'Randomly selected by DJ karaoke spinner',
        timestamp: new Date().toISOString(),
        status: 'pending',
        eventId: event.id,
        eventSlug: event.slug,
        eventName: event.name
    };
    request.id = requestDb.add(request);
    djRequests.push(request);

    const diff = selectedSong.difficulty ? ` (${selectedSong.difficulty})` : '';
    queueSpinnerResultForDj(
        event,
        'karaoke',
        `Winning track: "${selectedSong.title}" by ${selectedSong.artist || 'Unknown'}${diff}. Added to the request queue.`
    );

    console.log('Karaoke spin triggered for event', slug, ':', selectedSong.title);
    return { success: true, song: selectedSong, eventSlug: slug, eventId: event.id };
}

app.post('/api/display/:eventSlug/karaoke/trigger-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    const result = triggerKaraokeSpinForEvent(req.params.eventSlug);
    if (result.error) {
        const code = result.error === 'Event not found' ? 404 : 400;
        return res.status(code).json(result);
    }
    res.json(result);
});

app.get('/api/display/:eventSlug/karaoke/spin-status', (req, res) => {
    res.json(getKaraokeSpinState(req.params.eventSlug));
});

app.post('/api/display/:eventSlug/karaoke/clear-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    clearKaraokeSpinState(req.params.eventSlug);
    res.json({ success: true });
});

function triggerGuestSpinForEvent(eventSlug) {
    const slug = String(eventSlug || '').trim();
    if (!slug) {
        return { error: 'eventSlug is required' };
    }
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return { error: 'Event not found' };
    }
    const guests = getEligibleGuestsForEvent(event);
    if (!guests.length) {
        return {
            error: 'No guests on file for this event yet — guests appear after they request or message.'
        };
    }
    const pick = guests[Math.floor(Math.random() * guests.length)];
    const selectedGuest = {
        id: pick.id,
        customerName: pick.customerName,
        requestCount: pick.requestCount || 0,
        messageCount: pick.messageCount || 0,
        photoCount: pick.photoCount || 0
    };
    guestSpinStateBySlug[slug] = {
        shouldSpin: true,
        selectedGuest,
        timestamp: Date.now()
    };
    queueSpinnerResultForDj(event, 'guest', `Selected guest: ${selectedGuest.customerName}`);
    console.log('Guest spin triggered for event', slug, ':', selectedGuest.customerName);
    return { success: true, guest: selectedGuest, eventSlug: slug, eventId: event.id };
}

app.get('/api/display/:eventSlug/guest-spinner/guests', (req, res) => {
    const event = eventDb.getBySlug(req.params.eventSlug);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const guests = getEligibleGuestsForEvent(event).map((g) => ({
        id: g.id,
        customerName: g.customerName,
        requestCount: g.requestCount || 0,
        messageCount: g.messageCount || 0,
        photoCount: g.photoCount || 0
    }));
    res.json({ guests });
});

app.post('/api/display/:eventSlug/guest-spinner/trigger', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    const result = triggerGuestSpinForEvent(req.params.eventSlug);
    if (result.error) {
        const code =
            result.error === 'Event not found'
                ? 404
                : result.error.includes('No guests')
                  ? 400
                  : 400;
        return res.status(code).json(result);
    }
    res.json(result);
});

app.get('/api/display/:eventSlug/guest-spinner/spin-status', (req, res) => {
    res.json(getGuestSpinState(req.params.eventSlug));
});

app.post('/api/display/:eventSlug/guest-spinner/clear-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    clearGuestSpinState(req.params.eventSlug);
    res.json({ success: true });
});

app.post('/api/display/:eventSlug/coin-spinner/trigger', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    const result = triggerCoinSpinForEvent(req.params.eventSlug);
    if (result.error) {
        const code = result.error === 'Event not found' ? 404 : 400;
        return res.status(code).json(result);
    }
    res.json(result);
});

app.get('/api/display/:eventSlug/coin-spinner/spin-status', (req, res) => {
    res.json(getCoinSpinState(req.params.eventSlug));
});

app.post('/api/display/:eventSlug/coin-spinner/clear-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    clearCoinSpinState(req.params.eventSlug);
    res.json({ success: true });
});

app.post('/api/display/:eventSlug/yesno-spinner/trigger', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    const result = triggerYesNoSpinForEvent(req.params.eventSlug);
    if (result.error) {
        const code = result.error === 'Event not found' ? 404 : 400;
        return res.status(code).json(result);
    }
    res.json(result);
});

app.get('/api/display/:eventSlug/yesno-spinner/spin-status', (req, res) => {
    res.json(getYesNoSpinState(req.params.eventSlug));
});

app.post('/api/display/:eventSlug/yesno-spinner/clear-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessBySlugApi('eventSlug'), (req, res) => {
    clearYesNoSpinState(req.params.eventSlug);
    res.json({ success: true });
});

// ==================== Tracks Played ====================

function maybeLogTrackFromNowPlaying(eventId, { title, artist, album }) {
    if (!eventId || !title) return;
    const latest = trackDb.getLatest(eventId);
    if (latest && latest.title === title && (latest.artist || '') === (artist || '')) {
        return;
    }
    trackDb.add(eventId, { title, artist, album, source: 'now-playing' });
}

// When VirtualDJ/DMX posts now-playing without an event, log to the active event
function resolveEventForTrackLog(eventId, eventSlug) {
    if (eventId) {
        const event = eventDb.getById(parseInt(eventId, 10));
        if (event) return event.id;
    }
    if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) return event.id;
    }
    const active = eventDb.getActive();
    if (active.length === 0) return null;
    if (active.length === 1) return active[0].id;
    // Multiple active events — use the most recently updated
    active.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return active[0].id;
}

// Guest-facing list (only when the event has "show on guest page" enabled)
app.get('/api/event/:eventSlug/tracks-played', getEventFromSlugJson, (req, res) => {
    if (!req.event.show_tracks_played_guest) {
        return res.json([]);
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    res.json(trackDb.getByEvent(req.event.id, limit));
});

// DJ: list tracks for an event
app.get('/api/events/:id/tracks-played', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    res.json(trackDb.getByEvent(event.id, limit));
});

// DJ: manually log a track
app.post('/api/events/:id/tracks-played', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const title = (req.body.title || '').trim();
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    const id = trackDb.add(event.id, {
        title,
        artist: (req.body.artist || '').trim() || null,
        album: (req.body.album || '').trim() || null,
        source: 'manual',
        playedAt: req.body.played_at || req.body.playedAt || null
    });
    const row = trackDb.getById(id);
    res.json({ success: true, track: row ? trackDb._toJson(row) : null });
});

// DJ: log the current now-playing track for this event
app.post('/api/events/:id/tracks-played/from-now-playing', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const event = eventDb.getById(parseInt(req.params.id, 10));
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const key = `event_${event.id}`;
    const np = nowPlayingMap[key] || nowPlayingMap['global'];
    if (!np || !np.title) {
        return res.status(400).json({ error: 'Nothing is currently playing' });
    }
    maybeLogTrackFromNowPlaying(event.id, np);
    const track = trackDb.getLatest(event.id);
    res.json({ success: true, track });
});

app.delete('/api/tracks-played/:id', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccessByTrackId, (req, res) => {
    const track = req.track;
    trackDb.delete(track.id);
    res.json({ success: true });
});

// ==================== DJ Routes ====================
app.get('/dj', djWebAuth.requireDjWebAuth, renderDjDashboard);

app.get('/dj/events', djWebAuth.requireDjWebAuth, (req, res) => {
    const events = djAllowedEvents(req.portalUser)
        .map((event) => ({
            ...event,
            stats: eventDb.getStats(event.id)
        }))
        .sort((a, b) => {
            if (Boolean(a.is_active) !== Boolean(b.is_active)) {
                return Number(b.is_active) - Number(a.is_active);
            }
            const dateA = a.event_date ? new Date(a.event_date).getTime() : 0;
            const dateB = b.event_date ? new Date(b.event_date).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
    res.render('event-management', {
        events,
        portalUser: djWebAuth.authUserPayload(req.portalUser),
        isAdmin: req.portalUser.role === 'admin',
        globalDisplayMessageStyle: resolveDisplayMessageStyle(null)
    });
});

// Global DJ configuration page (settings that apply to every event)
app.get('/dj/settings', djWebAuth.requireAdminWebAuth, (req, res) => {
    res.render('dj-settings', { settings: getGlobalSettings() });
});

// DJ photo management for an event (hide/unhide/delete guest photos)
app.get('/dj/photos/:eventSlug', djWebAuth.requireDjWebAuth, djWebAuth.requireEventAccessBySlugParam('eventSlug'), (req, res) => {
    const event = req.event;
    const photos = photoDb.getByEvent(event.id, true);
    res.render('dj-photos', { event, photos });
});

// Event-specific display config
app.get('/dj/display-config/:eventSlug', djWebAuth.requireDjWebAuth, djWebAuth.requireEventAccessBySlugParam('eventSlug'), (req, res) => {
    const event = req.event;
    res.render('display-config', {
        event,
        displaySlides: slideshowDb.getByEvent(event.id),
        resolvedMessageStyle: resolveDisplayMessageStyle(event)
    });
});

// Event-specific display
app.get('/dj/display/:eventSlug', (req, res) => {
    const event = eventDb.getBySlug(req.params.eventSlug);
    if (!event) {
        return res.status(404).render('error', { error: 'Event not found', customerName: '', eventSlug: null });
    }
    const publicMessages = djMessages.filter(msg => !msg.private && msg.eventSlug === event.slug);
    res.render('dj-display', {
        event,
        messages: publicMessages,
        displaySlides: slideshowDb.getByEvent(event.id),
        resolvedMessageStyle: resolveDisplayMessageStyle(event)
    });
});

// Legacy global display (redirect or show all)
app.get('/dj/display', (req, res) => {
    // Only pass non-private messages to the public display
    const publicMessages = djMessages.filter(msg => !msg.private);
    res.render('dj-display', { event: null, messages: publicMessages, resolvedMessageStyle: 'classic' });
});

// API endpoint to update event display config
app.put('/api/events/:id/display-config', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = req.params.id;
    const updates = {
        display_show_qr: req.body.display_show_qr ? 1 : 0,
        display_qr_position: req.body.display_qr_position || 'top-right',
        display_qr_size: parseInt(req.body.display_qr_size) || 120,
        display_qr_label: req.body.display_qr_label || 'Scan to Request Songs!',
        display_bg_color1: req.body.display_bg_color1 || '#000428',
        display_bg_color2: req.body.display_bg_color2 || '#004e92',
        display_bg_image: req.body.display_bg_image || null,
        display_bg_slideshow_enabled: req.body.display_bg_slideshow_enabled ? 1 : 0,
        display_bg_slideshow_seconds: Math.min(Math.max(parseInt(req.body.display_bg_slideshow_seconds, 10) || 15, 5), 300),
        display_bg_overlay_opacity: Math.min(Math.max(parseInt(req.body.display_bg_overlay_opacity, 10) || 45, 0), 100),
        display_show_waiting_message: (req.body.display_show_waiting_message === 1 || req.body.display_show_waiting_message === true || req.body.display_show_waiting_message === '1') ? 1 : 0,
        display_card_color: req.body.display_card_color || '#ffffff',
        display_card_opacity: parseInt(req.body.display_card_opacity) || 85,
        display_message_style: req.body.display_message_style || null
    };
    
    const success = eventDb.update(eventId, updates);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: 'Failed to update display config' });
    }
});

// Display background slideshow images
app.get('/api/events/:id/display-slideshow', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    res.json(slideshowDb.getByEvent(eventId));
});

app.post('/api/events/:id/display-slideshow', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    slideshowUpload.single('image')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 10 MB)' : (err.message || 'Upload failed');
            return res.status(400).json({ error: msg });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No image attached' });
        }
        const imageUrl = `/uploads/slideshow/${eventId}/${req.file.filename}`;
        const slide = slideshowDb.add(eventId, imageUrl);
        res.json({ success: true, slide, slides: slideshowDb.getByEvent(eventId) });
    });
});

app.put('/api/events/:id/display-slideshow/reorder', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const order = req.body.order || req.body.orderedIds;
    if (!Array.isArray(order) || order.length === 0) {
        return res.status(400).json({ error: 'order array is required' });
    }
    const slides = slideshowDb.reorder(eventId, order);
    res.json({ success: true, slides });
});

app.delete('/api/events/:id/display-slideshow/:slideId', djWebAuth.requireDjApiAuth, djWebAuth.requireEventAccess, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const slideId = parseInt(req.params.slideId, 10);
    const event = eventDb.getById(eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const imageUrl = slideshowDb.delete(slideId, eventId);
    if (!imageUrl) {
        return res.status(404).json({ error: 'Slide not found' });
    }
    if (imageUrl.startsWith('/uploads/slideshow/')) {
        const diskPath = path.join(__dirname, imageUrl.replace(/^\//, '').split('/').join(path.sep));
        fs.unlink(diskPath, () => {});
    }
    res.json({ success: true, slides: slideshowDb.getByEvent(eventId) });
});

app.get('/karaoke-spinner', (req, res) => {
    res.render('karaoke-spinner');
});

app.get('/guest-spinner', (req, res) => {
    res.render('guest-spinner');
});

app.get('/coin-spinner', (req, res) => {
    res.render('coin-spinner');
});

app.get('/yesno-spinner', (req, res) => {
    res.render('yesno-spinner');
});

app.get('/api/dj/dashboard-data', djWebAuth.requireDjApiAuth, (req, res) => {
    const events = djAllowedEvents(req.portalUser);
    res.json({
        requests: djWebAuth.filterRequestsForUser(djRequests, req.portalUser, events),
        messages: djWebAuth.filterMessagesForUser(getDjInboxMessages(), req.portalUser, events)
    });
});

// API endpoint for DJ messages (supports includePrivate with secret)
app.get('/api/dj/messages', djWebAuth.requireDjApiAuth, (req, res) => {
    const includePrivate = req.query.includePrivate === 'true';
    const events = djAllowedEvents(req.portalUser);

    // Start with messages that haven't been marked displayed
    const pending = djWebAuth.filterMessagesForUser(
        djMessages.filter((msg) => !msg.displayed),
        req.portalUser,
        events
    );

    if (includePrivate) {
        return res.json(pending);
    }

    const publicPending = pending.filter((msg) => !msg.private);
    res.json(publicPending);
});

app.post('/api/dj/message/:id/mark-displayed', djWebAuth.requireDjApiAuth, (req, res) => {
    const messageId = parseInt(req.params.id);
    const message = djMessages.find(msg => msg.id === messageId);
    if (message) {
        message.displayed = true;
    }
    messageDb.markDisplayed(messageId);
    res.json({ success: true });
});

app.delete('/api/dj/message/:id', djWebAuth.requireDjApiAuth, (req, res) => {
    const messageId = parseInt(req.params.id, 10);
    if (!Number.isFinite(messageId)) {
        return res.status(400).json({ error: 'Invalid message id' });
    }
    const message = djMessages.find((msg) => msg.id === messageId);
    if (!message) {
        return res.status(404).json({ error: 'Message not found' });
    }
    if (message.type !== 'spinner-result') {
        return res.status(400).json({ error: 'Only spinner result notes can be removed here' });
    }
    if (!messageDb.delete(messageId)) {
        return res.status(404).json({ error: 'Message not found' });
    }
    const idx = djMessages.findIndex((msg) => msg.id === messageId);
    if (idx !== -1) {
        djMessages.splice(idx, 1);
    }
    res.json({ success: true });
});

app.delete('/api/dj/request/:id', djWebAuth.requireDjApiAuth, (req, res) => {
    const requestId = parseInt(req.params.id);
    const index = djRequests.findIndex(req => req.id === requestId);
    if (index !== -1) {
        djRequests.splice(index, 1);
    }
    requestDb.delete(requestId);
    res.json({ success: true });
});

app.post('/api/dj/reply', djWebAuth.requireDjApiAuth, (req, res) => {
    const { customerName, replyMessage, originalType, originalId, direct } = req.body;
    
    if (!customerName || !replyMessage) {
        return res.status(400).json({ error: 'Customer name and reply message are required' });
    }
    
    const isDirect = direct === true || direct === 'true';

    // Create reply entry (always delivered to the guest's messages screen)
    const reply = {
        customerName,
        replyMessage,
        originalType: originalType || 'request', // Default to 'request' if not provided
        originalId,
        timestamp: new Date().toISOString(),
        displayed: false,
        direct: isDirect
    };
    reply.id = replyDb.add(reply);
    djReplies.push(reply);
    
    // Queue for the public display screen — skipped for direct replies
    if (!isDirect) {
        const displayMessage = {
            customerName: `DJ Reply to ${customerName}`,
            message: replyMessage,
            timestamp: new Date().toISOString(),
            displayed: false,
            isReply: true
        };
        displayMessage.id = messageDb.add(displayMessage);
        djMessages.push(displayMessage);
    }
    
    console.log(`DJ reply sent${isDirect ? ' (direct)' : ''}:`, reply);
    res.json({ success: true, reply });
});

app.get('/api/dj/replies', djWebAuth.requireDjApiAuth, (req, res) => {
    res.json(djReplies);
});

app.get('/api/customer/replies/:customerName', (req, res) => {
    const customerName = req.params.customerName;
    const customerReplies = djReplies.filter(reply => 
        reply.customerName.toLowerCase() === customerName.toLowerCase()
    );
    res.json(customerReplies);
});

// Full activity for a guest: messages, DJ replies, and song/karaoke requests.
app.get('/api/customer/activity/:customerName', (req, res) => {
    const customerName = decodeURIComponent(req.params.customerName || '').trim();
    if (!customerName) {
        return res.status(400).json({ error: 'customerName is required' });
    }
    const eventSlug = req.query.eventSlug || null;
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;
    const items = buildCustomerTimeline(customerName, eventSlug, event ? event.id : null);

    const replies = items.filter((i) => i.kind === 'reply');
    const requests = items.filter((i) => i.kind === 'request');
    const messages = items.filter((i) => i.kind === 'message');

    res.json({ items, replies, requests, messages });
});

app.post('/api/customer/message', async (req, res) => {
    await submitGuestMessage(req.body || {}, res, { json: true });
});

// Karaoke Spinner API endpoints
app.get('/api/karaoke/all', (req, res) => {
    res.json(karaokeCatalogue);
});

// Shared function to trigger karaoke spin (legacy + dashboard header — requires eventSlug)
function triggerKaraokeSpin(eventSlug) {
    return triggerKaraokeSpinForEvent(eventSlug);
}

app.post('/api/karaoke/trigger-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventSlugAccessFromRequest, (req, res) => {
    const slug = req.body?.eventSlug != null ? String(req.body.eventSlug).trim() : '';
    const result = triggerKaraokeSpin(slug);
    if (result.error) {
        const status =
            result.error === 'Event not found'
                ? 404
                : result.error === 'eventSlug is required'
                  ? 422
                  : 400;
        return res.status(status).json(result);
    }
    res.json(result);
});

// GET endpoint for external devices (e.g., Stream Deck, automation)
app.get('/api/karaoke/trigger-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventSlugAccessFromRequest, (req, res) => {
    const slug = req.query.eventSlug != null ? String(req.query.eventSlug).trim() : '';
    const result = triggerKaraokeSpin(slug);
    if (result.error) {
        const status =
            result.error === 'Event not found'
                ? 404
                : result.error === 'eventSlug is required'
                  ? 422
                  : 400;
        return res.status(status).json(result);
    }
    res.json(result);
});

app.get('/api/karaoke/spin-status', djWebAuth.requireDjApiAuth, djWebAuth.requireEventSlugAccessFromRequest, (req, res) => {
    const slug = req.query.eventSlug != null ? String(req.query.eventSlug).trim() : '';
    if (!slug) {
        return res.status(422).json({ error: 'eventSlug query parameter is required' });
    }
    res.json(getKaraokeSpinState(slug));
});

app.post('/api/karaoke/clear-spin', djWebAuth.requireDjApiAuth, djWebAuth.requireEventSlugAccessFromRequest, (req, res) => {
    const slug = req.body?.eventSlug != null ? String(req.body.eventSlug).trim() : '';
    if (!slug) {
        return res.status(422).json({ error: 'eventSlug is required' });
    }
    clearKaraokeSpinState(slug);
    res.json({ success: true });
});

// Customer Routes
app.get('/', (req, res) => {
    if (getGlobalSettings().enable_public_events_page) {
        return res.render('events-list', { events: eventDb.getPublicListing() });
    }
    res.render('index', { eventSlug: null, event: null });
});

app.get('/song-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded song catalogue so the song selection page can show songs
    res.render('song-request', { songs: songCatalogue, customerName, eventSlug: null, event: null });
});

app.get('/karaoke-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded karaoke catalogue so the karaoke selection page can show options
    res.render('karaoke-request', { karaoke: karaokeCatalogue, customerName, eventSlug: null, event: null });
});

app.get('/send-message', (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('send-message', { customerName, eventSlug: null }); // Pass customer name
});

// Legacy alias — public events picker lives at /
app.get('/events', (req, res) => {
    res.redirect('/');
});

app.get('/api/public/events', (req, res) => {
    if (!getGlobalSettings().enable_public_events_page) {
        return res.status(404).json({ error: 'Public events page is not enabled' });
    }
    res.json(eventDb.getPublicListing());
});

// ==================== Event-specific Customer Routes ====================
// Event landing page
app.get('/event/:eventSlug', getEventFromSlug, (req, res) => {
    res.render('index', { eventSlug: req.event.slug, event: req.event });
});

// Event-specific song request
app.get('/event/:eventSlug/song-request', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('song-request', { 
        songs: songCatalogue, 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Event-specific karaoke request
app.get('/event/:eventSlug/karaoke-request', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('karaoke-request', { 
        karaoke: karaokeCatalogue, 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Event-specific message
app.get('/event/:eventSlug/send-message', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('send-message', { 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Event-specific photo capture page
app.get('/event/:eventSlug/photo', getEventFromSlug, (req, res) => {
    if (!req.event.enable_photos) {
        return res.status(403).render('error', {
            error: 'Photos are not enabled for this event',
            customerName: '',
            eventSlug: req.event.slug
        });
    }
    const customerName = req.query.customerName || '';
    res.render('photo-capture', {
        customerName,
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Dedicated full-screen live camera page ("Event Cam")
app.get('/event/:eventSlug/camera', getEventFromSlug, (req, res) => {
    if (!req.event.enable_photos) {
        return res.status(403).render('error', {
            error: 'Photos are not enabled for this event',
            customerName: '',
            eventSlug: req.event.slug
        });
    }
    const customerName = req.query.customerName || '';
    res.render('photo-camera', {
        customerName,
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Customer-facing photo gallery — token-protected link the DJ shares after the event.
// Works even when the event has been deactivated (customers view photos afterwards).
function getGalleryEvent(eventSlug, token) {
    const event = eventDb.getBySlug(eventSlug);
    if (!event || !event.share_token || event.share_token !== token) {
        return null;
    }
    return event;
}

function safeDownloadName(name) {
    return (name || 'photo').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
}

// Download every visible gallery photo as a zip archive
app.get('/gallery/:eventSlug/:token/download-all', (req, res) => {
    const event = getGalleryEvent(req.params.eventSlug, req.params.token);
    if (!event) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    const photos = photoDb.getByEvent(event.id, false);
    if (photos.length === 0) {
        return res.status(404).json({ error: 'No photos to download' });
    }

    const zipName = `${safeDownloadName(event.name)}-photos.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
        console.error('Gallery zip error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create zip' });
        }
    });
    archive.pipe(res);

    for (const photo of photos) {
        const filePath = path.join(photosRoot, String(photo.event_id), photo.filename);
        if (fs.existsSync(filePath)) {
            const who = photo.customer_name ? safeDownloadName(photo.customer_name) + '-' : '';
            archive.file(filePath, { name: `${who}${photo.id}-${photo.filename}` });
        }
    }

    archive.finalize();
});

// Download a single gallery photo (token-protected)
app.get('/gallery/:eventSlug/:token/photo/:id/download', (req, res) => {
    const event = getGalleryEvent(req.params.eventSlug, req.params.token);
    if (!event) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    const photo = photoDb.getById(parseInt(req.params.id, 10));
    if (!photo || photo.event_id !== event.id || photo.is_hidden) {
        return res.status(404).json({ error: 'Photo not found' });
    }

    const filePath = path.join(photosRoot, String(photo.event_id), photo.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Photo file missing' });
    }

    const who = photo.customer_name ? safeDownloadName(photo.customer_name) + '-' : '';
    res.download(filePath, `${who}${photo.filename}`);
});

app.get('/gallery/:eventSlug/:token', (req, res) => {
    const event = getGalleryEvent(req.params.eventSlug, req.params.token);
    if (!event) {
        return res.status(404).render('error', {
            error: 'Gallery not found — the link may have expired',
            customerName: '',
            eventSlug: null
        });
    }
    const photos = photoDb.getByEvent(event.id, false);
    res.render('photo-gallery', {
        event,
        photos,
        galleryToken: req.params.token
    });
});

// API Routes for search functionality
app.get('/api/search/songs', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    // Only return results if query has at least 3 characters
    if (query.length < 3) {
        return res.json([]);
    }
    
    const filteredSongs = songCatalogue.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query) ||
        (song.genre && song.genre.toLowerCase().includes(query)) ||
        (song.year && song.year.toString().includes(query))
    );
    res.json(filteredSongs);
});

app.get('/api/search/karaoke', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    // Only return results if query has at least 3 characters
    if (query.length < 3) {
        return res.json([]);
    }
    
    const filteredKaraoke = karaokeCatalogue.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query) ||
        (song.difficulty && song.difficulty.toLowerCase().includes(query)) ||
        (song.genre && song.genre.toLowerCase().includes(query))
    );
    res.json(filteredKaraoke);
});

// Handle form submissions
app.post('/submit-song-request', async (req, res) => {
    const { customerName, songId, message, eventSlug } = req.body;
    const selectedSong = songCatalogue.find(s => s.id == songId);
    
    // Get event info if eventSlug provided
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;

    if (!rejectGuestIfModerated(event, customerName, res, {
        eventSlug,
        silentThankYou: {
            customerName,
            requestType: 'song request',
            details: selectedSong,
            eventSlug: eventSlug || null
        }
    })) {
        return;
    }
    
    // Store the request for DJ dashboard
    const request = {
        type: 'song',
        customerName,
        song: selectedSong,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    request.id = requestDb.add(request);
    djRequests.push(request);
    
    // Also add to djMessages for DJ display screen
    const displayMessage = {
        customerName: customerName,
        message: `🎵 Song Request: "${selectedSong.title}" by ${selectedSong.artist}`,
        timestamp: new Date().toISOString(),
        displayed: false,
        isReply: false,
        type: 'song-request',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    displayMessage.id = messageDb.add(displayMessage);
    djMessages.push(displayMessage);
    
    // Prepare message for VirtualDJ
    const djMessage = `Song Request from ${customerName}: "${selectedSong.title}" by ${selectedSong.artist}${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Song request sent to VirtualDJ:', { customerName, songId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'song request',
            details: selectedSong,
            eventSlug: eventSlug || null
        });
    } catch (error) {
        console.error('Error sending song request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName,
            eventSlug: eventSlug || null
        });
    }
});

app.post('/submit-karaoke-request', async (req, res) => {
    const { customerName, karaokeId, message, eventSlug } = req.body;
    const selectedKaraoke = karaokeCatalogue.find(k => k.id == karaokeId);
    
    // Get event info if eventSlug provided
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;

    if (!rejectGuestIfModerated(event, customerName, res, {
        eventSlug,
        silentThankYou: {
            customerName,
            requestType: 'karaoke request',
            details: selectedKaraoke,
            eventSlug: eventSlug || null
        }
    })) {
        return;
    }
    
    // Store the request for DJ dashboard
    const request = {
        type: 'karaoke',
        customerName,
        song: selectedKaraoke,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    request.id = requestDb.add(request);
    djRequests.push(request);
    
    // Also add to djMessages for DJ display screen
    const displayMessage = {
        customerName: customerName,
        message: `🎤 Karaoke Request: "${selectedKaraoke.title}" by ${selectedKaraoke.artist}`,
        timestamp: new Date().toISOString(),
        displayed: false,
        isReply: false,
        type: 'karaoke-request',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    displayMessage.id = messageDb.add(displayMessage);
    djMessages.push(displayMessage);
    
    // Prepare message for VirtualDJ
    const djMessage = `Karaoke Request from ${customerName}: "${selectedKaraoke.title}" by ${selectedKaraoke.artist} (${selectedKaraoke.difficulty})${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Karaoke request sent to VirtualDJ:', { customerName, karaokeId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'karaoke request',
            details: selectedKaraoke,
            eventSlug: eventSlug || null
        });
    } catch (error) {
        console.error('Error sending karaoke request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName,
            eventSlug: eventSlug || null
        });
    }
});

app.post('/submit-message', async (req, res) => {
    await submitGuestMessage(req.body || {}, res, { json: false });
});

// ============================================
// NOW PLAYING API (DMX Controller Integration)
// ============================================

// Helper to get empty now playing object
function getEmptyNowPlaying() {
    return {
        title: null,
        artist: null,
        album: null,
        duration: null,
        elapsed: null,
        artwork: null,
        eventId: null,
        eventSlug: null,
        updatedAt: null
    };
}

// POST endpoint to receive current track info from DMX controller
app.post('/api/now-playing', (req, res) => {
    const { title, artist, album, duration, elapsed, artwork, eventId, eventSlug } = req.body;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    // Determine the key - use eventId, resolve from eventSlug, or use 'global'
    let key = 'global';
    let resolvedEventId = eventId || null;
    let resolvedEventSlug = eventSlug || null;
    
    if (eventId) {
        key = `event_${eventId}`;
        // Try to get slug from event
        const event = eventDb.getById(eventId);
        if (event) {
            resolvedEventSlug = event.slug;
        }
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
            resolvedEventId = event.id;
            resolvedEventSlug = eventSlug;
        } else {
            return res.status(404).json({ error: 'Event not found' });
        }
    }
    
    const nowPlaying = {
        title: title || null,
        artist: artist || null,
        album: album || null,
        duration: duration || null,
        elapsed: elapsed || null,
        artwork: artwork || null,
        eventId: resolvedEventId,
        eventSlug: resolvedEventSlug,
        updatedAt: new Date().toISOString()
    };
    
    nowPlayingMap[key] = nowPlaying;
    
    // Always log played tracks — use explicit event or fall back to the active event
    const trackLogEventId = resolveEventForTrackLog(resolvedEventId, resolvedEventSlug);
    if (trackLogEventId) {
        maybeLogTrackFromNowPlaying(trackLogEventId, nowPlaying);
    }
    
    console.log('Now playing updated:', nowPlaying.title, '-', nowPlaying.artist, key !== 'global' ? `(${key})` : '(global)');
    res.json({ success: true, nowPlaying });
});

// GET endpoint to retrieve current track info
app.get('/api/now-playing', (req, res) => {
    const { eventId, eventSlug } = req.query;
    
    // Determine which now playing to return
    let key = 'global';
    
    if (eventId) {
        key = `event_${eventId}`;
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
        }
    }
    
    // Return event-specific track if exists, otherwise fall back to global
    const nowPlaying = nowPlayingMap[key] || nowPlayingMap['global'] || getEmptyNowPlaying();
    res.json(nowPlaying);
});

// DELETE endpoint to clear now playing (when playback stops)
app.delete('/api/now-playing', (req, res) => {
    const { eventId, eventSlug } = req.query;
    
    let key = 'global';
    
    if (eventId) {
        key = `event_${eventId}`;
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
        }
    }
    
    delete nowPlayingMap[key];
    console.log('Now playing cleared:', key);
    res.json({ success: true });
});

// Start server
async function startServer() {
    await initializeCatalogues();
    
    // Ensure default event exists
    const defaultEvent = ensureDefaultEvent();
    if (defaultEvent) {
        console.log(`Created default event with slug: ${defaultEvent.slug}`);
    }
    
    app.listen(PORT, () => {
        console.log(`MobileDJay server is running on http://localhost:${PORT}`);
        console.log(`Songs loaded: ${songCatalogue.length}`);
        console.log(`Karaoke songs loaded: ${karaokeCatalogue.length}`);
        const events = eventDb.getAll();
        console.log(`Events in database: ${events.length}`);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
