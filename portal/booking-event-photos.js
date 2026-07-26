/**
 * Guest photo albums (MobileDJay `photos` table) exposed to portal customers via booking.requests_event_slug.
 */
const { eventDb, photoDb } = require('../db/database');

function requestsPublicOrigin() {
    const raw =
        process.env.PORTAL_REQUESTS_PUBLIC_ORIGIN ||
        process.env.PUBLIC_REQUESTS_ORIGIN ||
        'https://requests.eyupevents.uk';
    return String(raw).replace(/\/$/, '');
}

function normalizeSlug(raw) {
    if (raw == null || raw === '') return '';
    return String(raw).trim().toLowerCase();
}

function photoToPortalJson(row, origin) {
    return {
        id: row.id,
        url: `${origin}/uploads/photos/${row.event_id}/${row.filename}`,
        caption: row.caption || null,
        customer_name: row.customer_name || null,
        created_at: row.created_at || null,
    };
}

function resolveEventForBooking(booking) {
    if (!booking) return null;
    const slug = normalizeSlug(booking.requests_event_slug);
    if (!slug) return null;
    return eventDb.getBySlug(slug) || null;
}

function getBookingPhotoGallery(booking) {
    const slug = normalizeSlug(booking && booking.requests_event_slug);
    const origin = requestsPublicOrigin();
    if (!slug) {
        return {
            linked: false,
            event_slug: null,
            event_name: null,
            photos_enabled: false,
            photo_count: 0,
            photos: [],
            download_all_url: null,
            external_gallery_url: null,
        };
    }
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return {
            linked: false,
            event_slug: slug,
            event_name: null,
            photos_enabled: false,
            photo_count: 0,
            photos: [],
            download_all_url: null,
            external_gallery_url: null,
        };
    }
    const rows = photoDb.getByEvent(event.id, false);
    const photos = rows.map((row) => photoToPortalJson(row, origin));
    const token = event.share_token ? String(event.share_token) : '';
    const galleryBase = token ? `${origin}/gallery/${event.slug}/${token}` : null;
    return {
        linked: true,
        event_slug: event.slug,
        event_name: event.name || null,
        photos_enabled: event.enable_photos === 1 || event.enable_photos === true,
        photo_count: photos.length,
        photos,
        download_all_url: galleryBase && photos.length ? `${galleryBase}/download-all` : null,
        external_gallery_url: galleryBase,
    };
}

function photoGallerySummary(booking) {
    const full = getBookingPhotoGallery(booking);
    return {
        linked: full.linked,
        event_slug: full.event_slug,
        photo_count: full.photo_count,
        photos_enabled: full.photos_enabled,
    };
}

/** Customer portal: one album per linked booking (dedupe by booking id). */
function buildCustomerPhotoAlbums(bookings) {
    const list = Array.isArray(bookings) ? bookings : [];
    const albums = [];
    for (const b of list) {
        if (!b || !b.id) continue;
        const gallery = getBookingPhotoGallery(b);
        if (!gallery.linked) continue;
        albums.push({
            booking_id: b.id,
            title: b.title || '',
            reference: b.reference || null,
            start_datetime: b.start_datetime || null,
            end_datetime: b.end_datetime || null,
            venue: b.venue || null,
            photo_count: gallery.photo_count,
            photos_enabled: gallery.photos_enabled,
            photos: gallery.photos,
            download_all_url: gallery.download_all_url,
            external_gallery_url: gallery.external_gallery_url,
        });
    }
    albums.sort((a, b) => {
        const ta = Date.parse(a.start_datetime || '') || 0;
        const tb = Date.parse(b.start_datetime || '') || 0;
        return tb - ta;
    });
    return albums;
}

module.exports = {
    getBookingPhotoGallery,
    photoGallerySummary,
    buildCustomerPhotoAlbums,
    resolveEventForBooking,
    requestsPublicOrigin,
};
