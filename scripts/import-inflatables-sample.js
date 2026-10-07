#!/usr/bin/env node
/**
 * Import MobileDJay/data/inflatables-catalog-sample.json into portal DB (upsert by code).
 * Usage: node scripts/import-inflatables-sample.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const jsonPath = path.join(__dirname, '..', 'data', 'inflatables-catalog-sample.json');

function main() {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const products = Array.isArray(raw.products) ? raw.products : [];
    if (!products.length) {
        console.error('No products in', jsonPath);
        process.exit(1);
    }
    if (dryRun) {
        console.log('Dry run — would import', products.length, 'product(s):');
        products.forEach((p) => console.log(' -', p.code, p.name));
        return;
    }
    const { portalDb } = require('../db/portal-database');
    const stats = portalDb.importCatalogSnapshot({ products }, { replaceAddonLinks: true });
    console.log('Import complete:', stats);
}

try {
    main();
} catch (err) {
    if (err.code === 'ERR_DLOPEN_FAILED' || /better_sqlite3/.test(String(err.message))) {
        console.error('SQLite unavailable — run npm rebuild on this machine, or import on the API server.');
    } else {
        console.error(err);
    }
    process.exit(1);
}
