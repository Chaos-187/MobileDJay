#!/usr/bin/env node
/**
 * Upsert inflatables demo vouchers (by code). Resolves product_codes to catalog UUIDs.
 * Usage: node scripts/import-inflatables-vouchers.js [--dry-run]
 *
 * Uses portalDb when Phase 3 methods exist; otherwise applies vouchers directly to SQLite
 * (same schema as db/portal-database.js) so import works before portal-database.js is synced.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dryRun = process.argv.includes('--dry-run');
const jsonPath = path.join(__dirname, '..', 'data', 'inflatables-vouchers-sample.json');
const dbPath = path.join(__dirname, '..', 'db', 'eyup_portal.db');

function uuid() {
    return crypto.randomUUID();
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeVoucherCode(code) {
    return String(code || '')
        .trim()
        .toUpperCase();
}

function parseJsonStringArray(raw) {
    if (raw == null || String(raw).trim() === '') return [];
    try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function ensureVoucherTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS catalog_vouchers (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            discount_percent REAL NOT NULL DEFAULT 0,
            product_ids_json TEXT,
            applies_to TEXT,
            invalid_message TEXT,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

function resolveCatalogProductIdRef(db, ref) {
    const key = String(ref || '').trim();
    if (!key) return null;
    const byId = db.prepare('SELECT id FROM catalog_products WHERE id = ?').get(key);
    if (byId) return byId.id;
    const byCode = db
        .prepare('SELECT id FROM catalog_products WHERE code = ? COLLATE NOCASE')
        .get(key.toLowerCase());
    return byCode ? byCode.id : null;
}

function resolveCatalogProductIdRefs(db, refs) {
    const out = [];
    const seen = new Set();
    (Array.isArray(refs) ? refs : []).forEach((ref) => {
        const id = resolveCatalogProductIdRef(db, ref);
        if (id && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    });
    return out;
}

function listVouchersDirect(db) {
    return db
        .prepare('SELECT id, code FROM catalog_vouchers ORDER BY code COLLATE NOCASE ASC')
        .all();
}

function insertVoucherDirect(db, row) {
    const code = normalizeVoucherCode(row.code);
    if (!code) throw new Error('Voucher code is required');
    const productIds = resolveCatalogProductIdRefs(
        db,
        row.product_ids || row.product_codes || parseJsonStringArray(row.product_ids_json)
    );
    const id = row.id || uuid();
    const t = nowIso();
    db.prepare(
        `INSERT INTO catalog_vouchers (
            id, code, discount_percent, product_ids_json, applies_to, invalid_message, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        code,
        Number.isFinite(Number(row.discount_percent)) ? Number(row.discount_percent) : 0,
        productIds.length ? JSON.stringify(productIds) : null,
        row.applies_to != null ? String(row.applies_to) : null,
        row.invalid_message != null ? String(row.invalid_message) : null,
        row.is_active === false || row.is_active === 0 ? 0 : 1,
        t,
        t
    );
}

function updateVoucherDirect(db, voucherId, patch) {
    const existing = db.prepare('SELECT id FROM catalog_vouchers WHERE id = ?').get(voucherId);
    if (!existing) return;
    const sets = [];
    const params = [];
    if (patch.code != null) {
        sets.push('code = ?');
        params.push(normalizeVoucherCode(patch.code));
    }
    if (patch.discount_percent != null) {
        sets.push('discount_percent = ?');
        params.push(Number(patch.discount_percent) || 0);
    }
    if (
        patch.product_ids != null ||
        patch.product_codes != null ||
        patch.product_ids_json != null
    ) {
        const productIds = resolveCatalogProductIdRefs(
            db,
            patch.product_ids ||
                patch.product_codes ||
                parseJsonStringArray(patch.product_ids_json)
        );
        sets.push('product_ids_json = ?');
        params.push(productIds.length ? JSON.stringify(productIds) : null);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'applies_to')) {
        sets.push('applies_to = ?');
        params.push(patch.applies_to != null ? String(patch.applies_to) : null);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'invalid_message')) {
        sets.push('invalid_message = ?');
        params.push(patch.invalid_message != null ? String(patch.invalid_message) : null);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
        sets.push('is_active = ?');
        params.push(patch.is_active ? 1 : 0);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(voucherId);
    db.prepare(`UPDATE catalog_vouchers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function voucherMapKey(code, channel) {
    return String(code).toUpperCase() + ':' + String(channel || 'inflatables').toLowerCase();
}

function upsertViaPortalDb(vouchers) {
    const { portalDb } = require('../db/portal-database');
    if (typeof portalDb.listCatalogVouchers !== 'function') {
        return null;
    }
    const existing = portalDb.listCatalogVouchers();
    const byCode = new Map(
        existing.map((v) => [voucherMapKey(v.code, v.channel || 'inflatables'), v])
    );
    let created = 0;
    let updated = 0;
    vouchers.forEach((row) => {
        const code = normalizeVoucherCode(row.code);
        if (!code) return;
        const ch = String(row.channel || 'inflatables').toLowerCase();
        const prior = byCode.get(voucherMapKey(code, ch));
        if (prior) {
            portalDb.updateCatalogVoucher(prior.id, row);
            updated += 1;
        } else {
            portalDb.insertCatalogVoucher(row);
            created += 1;
        }
    });
    return { created, updated, mode: 'portalDb' };
}

function upsertDirectSqlite(vouchers) {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    ensureVoucherTable(db);
    const existing = listVouchersDirect(db);
    const byCode = new Map(
        existing.map((v) => [voucherMapKey(v.code, v.channel || 'inflatables'), v])
    );
    let created = 0;
    let updated = 0;
    const tx = db.transaction(() => {
        vouchers.forEach((row) => {
            const code = normalizeVoucherCode(row.code);
            if (!code) return;
            const ch = String(row.channel || 'inflatables').toLowerCase();
            const prior = byCode.get(voucherMapKey(code, ch));
            if (prior) {
                updateVoucherDirect(db, prior.id, row);
                updated += 1;
            } else {
                insertVoucherDirect(db, row);
                created += 1;
            }
        });
    });
    tx();
    db.close();
    return {
        created,
        updated,
        mode: 'direct-sqlite',
        note: 'Deploy updated db/portal-database.js (Phase 3) so the API can validate vouchers.'
    };
}

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
    let stats = upsertViaPortalDb(vouchers);
    if (!stats) {
        stats = upsertDirectSqlite(vouchers);
    }
    console.log('Voucher import complete:', stats);
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
