const path = require('path');
const fs = require('fs');
const { siteMediaRoot } = require('./site-media-upload');

const SITE_MEDIA_CATEGORIES = new Set(['products', 'news', 'gallery', 'general']);

function normalizeSiteMediaCategory(raw) {
    const s = String(raw || '')
        .trim()
        .toLowerCase();
    return SITE_MEDIA_CATEGORIES.has(s) ? s : 'general';
}

function siteMediaFilename(urlOrPath) {
    if (urlOrPath == null || String(urlOrPath).trim() === '') return null;
    let s = String(urlOrPath).trim();
    const apiMatch = s.match(/\/api\/v1\/public\/media\/image\/([^/?#\s]+)/i);
    if (apiMatch) s = `/uploads/site-media/${decodeURIComponent(apiMatch[1])}`;
    const rel = s.replace(/^\/uploads\/site-media\//i, '');
    if (!rel || rel.includes('..') || rel.includes('/')) return null;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(rel)) return null;
    return rel;
}

function normalizeSiteMediaStorage(urlOrPath) {
    const name = siteMediaFilename(urlOrPath);
    return name ? `/uploads/site-media/${name}` : null;
}

function catalogPublicOrigin() {
    const explicit =
        process.env.PORTAL_API_PUBLIC_ORIGIN ||
        process.env.PORTAL_ASSET_ORIGIN ||
        process.env.PORTAL_REQUESTS_PUBLIC_ORIGIN;
    if (explicit && String(explicit).trim()) {
        return String(explicit).trim().replace(/\/$/, '');
    }
    return 'https://requests.eyupevents.uk';
}

function resolveSiteMediaPublicUrl(storedPath) {
    const filename = siteMediaFilename(storedPath);
    if (!filename) return null;
    return `${catalogPublicOrigin()}/api/v1/public/media/image/${encodeURIComponent(filename)}`;
}

function unlinkSiteMediaFile(storedPath) {
    const filename = siteMediaFilename(storedPath);
    if (!filename) return;
    const filePath = path.join(siteMediaRoot, filename);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        console.warn('[portal] site media unlink', filePath, e.message);
    }
}

module.exports = {
    SITE_MEDIA_CATEGORIES,
    normalizeSiteMediaCategory,
    siteMediaFilename,
    normalizeSiteMediaStorage,
    resolveSiteMediaPublicUrl,
    unlinkSiteMediaFile,
    siteMediaRoot
};
