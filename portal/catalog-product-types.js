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
    dj_tools: { label: 'DJ software & apps', sort_order: 15 },
    general: { label: 'Other services', sort_order: 999 }
};

/** Fallback artwork on eyupevents.uk when a product has no uploaded image. */
const DEFAULT_TYPE_IMAGES = {
    mobile_dj: 'https://eyupevents.uk/img/services/mobile-dj.png',
    karaoke: 'https://eyupevents.uk/img/services/karaoke.png',
    pa_rental: 'https://eyupevents.uk/img/services/pa-rental.png',
    surf_simulator: 'https://eyupevents.uk/img/services/events/surf-simulator.webp',
    outdoor_games: 'https://eyupevents.uk/img/services/outdoor-games.png',
    inflatables: 'https://eyupevents.uk/img/services/inflatables.png',
    photo_booth: 'https://eyupevents.uk/img/services/photo-booth.png',
    lighting: 'https://eyupevents.uk/img/services/mobile-dj.png',
    audio_guestbook: 'https://eyupevents.uk/img/services/audio-guestbook.png',
    dj_tools: 'https://eyupevents.uk/img/portal/bookings-preview.svg',
    general: 'https://eyupevents.uk/img/eyup-events-facebook-cover.png'
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
        process.env.PORTAL_API_PUBLIC_ORIGIN ||
        process.env.PORTAL_ASSET_ORIGIN ||
        process.env.PORTAL_PUBLIC_ORIGIN ||
        process.env.EYUP_PORTAL_PUBLIC_ORIGIN ||
        process.env.PORTAL_EVENTS_PUBLIC_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    return 'https://requests.eyupevents.uk';
}

function normalizeCatalogImageStorage(url) {
    if (url == null || String(url).trim() === '') return null;
    const s = String(url).trim();
    const match = s.match(/\/uploads\/catalog\/[^/?#\s]+/i);
    if (match) return match[0];
    return s;
}

function resolveCatalogImageUrl(url) {
    if (url == null || String(url).trim() === '') return null;
    const s = String(url).trim();
    const catalogPath = s.match(/\/uploads\/catalog\/[^/?#\s]+/i);
    if (catalogPath) {
        return catalogPublicOrigin() + catalogPath[0];
    }
    if (/^https?:\/\//i.test(s)) return s;
    const origin = catalogPublicOrigin();
    return origin + (s.startsWith('/') ? s : `/${s}`);
}

function inferProductType(product) {
    if (!product) return 'general';
    const explicit = normalizeProductType(product.product_type);
    if (explicit !== 'general') return explicit;

    const cap = product.capability_code ? normalizeProductType(product.capability_code) : '';
    if (cap && cap !== 'general' && KNOWN_PRODUCT_TYPES[cap]) return cap;

    const code = String(product.code || '').toLowerCase();
    const name = String(product.name || '').toLowerCase();
    const hay = `${code} ${name}`;

    if (/surf/.test(hay)) return 'surf_simulator';
    if (/karaoke/.test(hay)) return 'karaoke';
    if (/lighting|\bdmx\b/.test(hay)) return 'lighting';
    if (/camera|request.?app|song.?request|\bapp\b/.test(hay)) return 'dj_tools';
    if (/mobile.?dj|\bdj\b/.test(hay)) return 'mobile_dj';
    if (/outdoor|jenga|golf|connect/.test(hay)) return 'outdoor_games';
    if (/bouncy|inflat|castle/.test(hay)) return 'inflatables';
    if (/photo.?booth/.test(hay)) return 'photo_booth';
    if (/pa.?rental|\bpa\b|speaker/.test(hay)) return 'pa_rental';
    if (/guestbook/.test(hay)) return 'audio_guestbook';

    return 'general';
}

function defaultImageForProductType(typeCode) {
    const slug = inferProductType({ product_type: typeCode });
    return DEFAULT_TYPE_IMAGES[slug] || DEFAULT_TYPE_IMAGES.general;
}

function publicCatalogImageUrl(product) {
    const type = inferProductType(product);
    const stored = product && product.image_url ? resolveCatalogImageUrl(product.image_url) : null;
    if (stored) return stored;
    return defaultImageForProductType(type);
}

module.exports = {
    KNOWN_PRODUCT_TYPES,
    DEFAULT_TYPE_IMAGES,
    normalizeProductType,
    labelForProductType,
    sortOrderForProductType,
    listKnownProductTypes,
    catalogPublicOrigin,
    normalizeCatalogImageStorage,
    resolveCatalogImageUrl,
    inferProductType,
    defaultImageForProductType,
    publicCatalogImageUrl
};
