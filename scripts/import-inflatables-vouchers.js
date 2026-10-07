#!/usr/bin/env node
/**
 * Upsert inflatables demo vouchers (by code). Resolves product_codes to catalog UUIDs.
 * Usage: node scripts/import-inflatables-vouchers.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const jsonPath = path.join(__dirname, '..', 'data', 'inflatables-vouchers-sample.json');

function main() {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const vouchers = Array.isArray(raw.vouchers) ? raw.vouchers : [];
    if (!vouchers.length) {
        console.error('No vouchers in', jsonPath);
        process.exit(1);
    }
    if (dryRun) {
        console.log('Dry run — would upsert', vouchers.length, 'voucher(s):');
        vouchers.forEach((v) => console.log(' -', v.code, v.discount_percent + '%'));
        return;
    }
    const { portalDb } = require('../db/portal-database');
    const existing = portalDb.listCatalogVouchers();
    const byCode = new Map(existing.map((v) => [String(v.code).toUpperCase(), v]));
    let created = 0;
    let updated = 0;
    vouchers.forEach((row) => {
        const code = String(row.code || '').trim().toUpperCase();
        if (!code) return;
        const prior = byCode.get(code);
        if (prior) {
            portalDb.updateCatalogVoucher(prior.id, row);
            updated += 1;
        } else {
            portalDb.insertCatalogVoucher(row);
            created += 1;
        }
    });
    console.log('Voucher import complete:', { created, updated });
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
