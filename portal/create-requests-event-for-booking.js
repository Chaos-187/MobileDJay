/**
 * When a portal booking is created, provision a matching MobileDJay song-request event
 * and store its slug on bookings.requests_event_slug.
 */
const { eventDb, settingsDb } = require('../db/database');
const { portalDb } = require('../db/portal-database');

function eventDateFromStart(startDatetime) {
    if (!startDatetime) return null;
    const s = String(startDatetime);
    return s.length >= 10 ? s.slice(0, 10) : null;
}

function defaultEnablePhotos() {
    const global = settingsDb.get('global');
    if (global && typeof global.default_enable_photos === 'boolean') {
        return global.default_enable_photos ? 1 : 0;
    }
    return 1;
}

/**
 * @param {object} booking — materialized portal booking row
 * @returns {{ slug: string, event_id: number, created: boolean } | null}
 */
function createRequestsEventForBooking(booking) {
    if (!booking || !booking.id) return null;

    const existingSlug =
        booking.requests_event_slug != null && String(booking.requests_event_slug).trim()
            ? String(booking.requests_event_slug).trim().toLowerCase()
            : '';
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
        enable_photos: defaultEnablePhotos(),
        enable_song_requests: 1,
        enable_messages: 1
    });

    portalDb.updateBooking(
        booking.id,
        { requests_event_slug: slug },
        { admin: true }
    );

    return { slug, event_id: eventId, created: true };
}

module.exports = { createRequestsEventForBooking };
