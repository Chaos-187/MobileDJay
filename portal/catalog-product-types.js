/**
 * Catalog product type slugs — used for grouping in quote builder and admin.
 * Admins may use any slug; known types get friendly labels and sort order.
 */

/** @type {Record<string, { label: string, sort_order: number }>} */
const KNOWN_PRODUCT_TYPES = {
    mobile_dj: { label: 'Mobile DJ', sort_order: 10 },
    karaoke: { label: 'Karaoke', sort_order: 20 },
    pa_rental: { label: 'PA rental', sort_order: 30 },
    surf_simulator: { label: 'Surf simulator', sort_order: 40 },
    outdoor_games: { label: 'Outdoor games', sort_order: 50 },
    inflatables: { label: 'Inflatables & bouncy castles', sort_order: 60 },
    photo_booth: { label: 'Photo booth', sort_order: 70 },
    lighting: { label: 'Lighting', sort_order: 80 },
    audio_guestbook: { label: 'Audio guestbook', sort_order: 90 },
    general: { label: 'Other services', sort_order: 999 }
};

function normalizeProductType(raw) {
    if (raw == null || String(raw).trim() === '') return 'general';
    return String(raw)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 64) || 'general';
}

function labelForProductType(code) {
    const slug = normalizeProductType(code);
    if (KNOWN_PRODUCT_TYPES[slug]) return KNOWN_PRODUCT_TYPES[slug].label;
    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sortOrderForProductType(code) {
    const slug = normalizeProductType(code);
    if (KNOWN_PRODUCT_TYPES[slug]) return KNOWN_PRODUCT_TYPES[slug].sort_order;
    return 500;
}

function listKnownProductTypes() {
    return Object.entries(KNOWN_PRODUCT_TYPES)
        .map(([code, meta]) => ({ code, label: meta.label, sort_order: meta.sort_order }))
        .sort((a, b) => a.sort_order - b.sort_order);
}

function catalogPublicOrigin() {
    const explicit =
        process.env.PORTAL_PUBLIC_ORIGIN ||
        process.env.EYUP_PORTAL_PUBLIC_ORIGIN ||
        process.env.PORTAL_EVENTS_PUBLIC_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    const cors = process.env.PORTAL_CORS_ORIGINS || '';
    const first = cors
        .split(',')
        .map((s) => s.trim())
        .find((o) => o && /^https?:\/\//i.test(o));
    if (first) return first.replace(/\/$/, '');
    return 'https://requests.eyupevents.uk';
}

function resolveCatalogImageUrl(url) {
    if (url == null || String(url).trim() === '') return null;
    const s = String(url).trim();
    if (/^https?:\/\//i.test(s)) return s;
    const origin = catalogPublicOrigin();
    return origin + (s.startsWith('/') ? s : `/${s}`);
}

module.exports = {
    KNOWN_PRODUCT_TYPES,
    normalizeProductType,
    labelForProductType,
    sortOrderForProductType,
    listKnownProductTypes,
    catalogPublicOrigin,
    resolveCatalogImageUrl
};
