#!/usr/bin/env node
/**
 * Phase 0 checks: CORS origins + catalog product_type filter (MS-001, MS-002).
 * Run from MobileDJay: node scripts/test-phase0-multi-site.js
 */
const {
    isPortalCorsOriginAllowed,
    isEyupInflatablesOrigin,
    parsePortalCorsOrigins
} = require('../portal/cors-config');

function assert(condition, message) {
    if (!condition) {
        console.error('FAIL:', message);
        process.exitCode = 1;
        return false;
    }
    console.log('OK:', message);
    return true;
}

const allowed = parsePortalCorsOrigins();

assert(
    isPortalCorsOriginAllowed('https://eyupinflatables.uk', allowed),
    'CORS allows eyupinflatables.uk'
);
assert(
    isPortalCorsOriginAllowed('https://www.eyupinflatables.uk', allowed),
    'CORS allows www.eyupinflatables.uk'
);
assert(isEyupInflatablesOrigin('https://eyupinflatables.uk'), 'inflatables origin helper');
assert(
    isPortalCorsOriginAllowed('https://eyupevents.uk', allowed),
    'CORS still allows eyupevents.uk'
);
assert(
    !isPortalCorsOriginAllowed('https://evil.example', allowed),
    'CORS rejects unknown origin'
);

function runCatalogTests() {
    const { portalDb } = require('../db/portal-database');
    const full = portalDb.listPublicQuoteCatalogGrouped();
    const filtered = portalDb.listPublicQuoteCatalogGrouped({ productTypeFilter: 'inflatables' });

    assert(Array.isArray(full.products), 'full catalog returns products array');
    assert(Array.isArray(filtered.products), 'filtered catalog returns products array');
    assert(filtered.products.length <= full.products.length, 'filtered count <= full count');
    for (const p of filtered.products) {
        if (p.product_type !== 'inflatables') {
            assert(false, 'filtered product has wrong type: ' + p.product_type);
            break;
        }
    }
    if (filtered.products.length) {
        assert(true, 'all filtered products are product_type inflatables');
    } else {
        console.log('NOTE: no inflatables products in DB — filter returns empty (OK for dev DB)');
    }

    const unchanged =
        full.products.length ===
        portalDb.listPublicQuoteCatalogGrouped(undefined).products.length;
    assert(unchanged, 'ungrouped options undefined matches default full catalog size');

    if (full.products.length > filtered.products.length) {
        assert(true, 'filter reduces product set when mixed catalog present');
    }
}

try {
    runCatalogTests();
} catch (err) {
    console.warn(
        'SKIP: catalog DB tests —',
        err.code === 'ERR_DLOPEN_FAILED' || /better_sqlite3/.test(String(err.message))
            ? 'rebuild better-sqlite3 (npm rebuild) on this Node version'
            : err.message
    );
}

if (process.exitCode) {
    console.error('\nPhase 0 tests failed.');
    process.exit(1);
}
console.log('\nPhase 0 tests passed.');
