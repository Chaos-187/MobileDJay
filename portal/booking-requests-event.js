/**
 * Portal booking ↔ MobileDJay song-request event (features, slug link).
 */
const { eventDb, settingsDb } = require('../db/database');
const { portalDb } = require('../db/portal-database');

const GLOBAL_DEFAULT_KEYS = {
    default_enable_song_requests: true,
    default_enable_karaoke_requests: true,
    default_enable_messages: true,
    default_enable_photos: false,
    default_enable_tips: false
};

const FEATURE_KEYS = [
    'enable_song_requests',
    'enable_karaoke_requests',
    'enable_messages',
    'enable_photos',
    'enable_tips',
    'is_active'
];

function getMergedGlobalSettings() {
    const stored = settingsDb.get('global') || {};
    return { ...GLOBAL_DEFAULT_KEYS, ...stored };
}

function globalDefaultToInt(key) {
    const g = getMergedGlobalSettings();
    return g[key] === true ? 1 : 0;
}

function eventDateFromStart(startDatetime) {
    if (!startDatetime) return null;
    const s = String(startDatetime);
    return s.length >= 10 ? s.slice(0, 10) : null;
}

function resolveSlug(booking) {
    if (!booking || booking.requests_event_slug == null) return '';
    return String(booking.requests_event_slug).trim().toLowerCase();
}

function dbFlagToBool(v) {
    return v === 1 || v === true;
}

function featuresFromEventRow(event) {
    if (!event) return null;
    return {
        enable_song_requests: dbFlagToBool(event.enable_song_requests),
        enable_karaoke_requests: dbFlagToBool(event.enable_karaoke_requests),
        enable_messages: dbFlagToBool(event.enable_messages),
        enable_photos: dbFlagToBool(event.enable_photos),
        enable_tips: dbFlagToBool(event.enable_tips),
        is_active: event.is_active !== 0 && event.is_active !== false
    };
}

function createRequestsEventForBooking(booking) {
    if (!booking || !booking.id) return null;

    const existingSlug = resolveSlug(booking);
    if (existingSlug) {
        const ev = eventDb.getBySlug(existingSlug);
        if (ev) {
            return { slug: existingSlug, event_id: ev.id, created: false };
        }
    }

    const name =
        (booking.title && String(booking.title).trim()) ||
        (booking.reference && String(booking.reference).trim()) ||
        'Event';
    const venue = booking.venue != null ? String(booking.venue) : '';
    const reference = booking.reference ? String(booking.reference).trim() : '';
    const description = reference
        ? `EYUP portal booking ${reference}`
        : `EYUP portal booking ${booking.id}`;
    const eventDate = eventDateFromStart(booking.start_datetime);

    const { id: eventId, slug } = eventDb.create(name, description, venue, eventDate, {
        enable_song_requests: globalDefaultToInt('default_enable_song_requests'),
        enable_karaoke_requests: globalDefaultToInt('default_enable_karaoke_requests'),
        enable_messages: globalDefaultToInt('default_enable_messages'),
        enable_photos: globalDefaultToInt('default_enable_photos'),
        enable_tips: globalDefaultToInt('default_enable_tips')
    });

    portalDb.updateBooking(booking.id, { requests_event_slug: slug }, { admin: true });

    return { slug, event_id: eventId, created: true };
}

function getRequestsEventAdminPayload(booking) {
    const slug = resolveSlug(booking);
    if (!slug) {
        return {
            linked: false,
            slug: null,
            event_id: null,
            event_name: null,
            features: null,
            defaults_for_new_event: {
                enable_song_requests: getMergedGlobalSettings().default_enable_song_requests === true,
                enable_karaoke_requests:
                    getMergedGlobalSettings().default_enable_karaoke_requests === true,
                enable_messages: getMergedGlobalSettings().default_enable_messages === true,
                enable_photos: getMergedGlobalSettings().default_enable_photos === true,
                enable_tips: getMergedGlobalSettings().default_enable_tips === true,
                is_active: true
            }
        };
    }
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return {
            linked: false,
            slug,
            event_id: null,
            event_name: null,
            features: null
        };
    }
    return {
        linked: true,
        slug: event.slug,
        event_id: event.id,
        event_name: event.name || null,
        features: featuresFromEventRow(event)
    };
}

function parseFeaturePatch(body) {
    const patch = {};
    for (const key of FEATURE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        const v = body[key];
        if (typeof v !== 'boolean') {
            return { error: `${key} must be a boolean` };
        }
        patch[key] = v ? 1 : 0;
    }
    if (Object.keys(patch).length === 0) {
        return { error: 'No feature fields to update' };
    }
    return { patch };
}

function updateRequestsEventFeatures(booking, body) {
    let slug = resolveSlug(booking);
    let event = slug ? eventDb.getBySlug(slug) : null;
    if (!event) {
        const created = createRequestsEventForBooking(booking);
        if (!created) {
            return { error: 'Could not link a song-request event' };
        }
        booking = portalDb.getBookingById(booking.id);
        slug = resolveSlug(booking);
        event = slug ? eventDb.getBySlug(slug) : null;
    }
    if (!event) {
        return { error: 'Song-request event not found' };
    }

    const parsed = parseFeaturePatch(body || {});
    if (parsed.error) return { error: parsed.error };

    const ok = eventDb.update(event.id, parsed.patch);
    if (!ok) {
        return { error: 'No valid feature fields to update' };
    }
    const updated = eventDb.getById(event.id);
    return {
        linked: true,
        slug: updated.slug,
        event_id: updated.id,
        event_name: updated.name || null,
        features: featuresFromEventRow(updated)
    };
}

module.exports = {
    createRequestsEventForBooking,
    getRequestsEventAdminPayload,
    updateRequestsEventFeatures,
    featuresFromEventRow
};
