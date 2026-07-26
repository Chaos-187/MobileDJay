const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const pii = require('./pii-crypto');

const dbPath = path.join(__dirname, 'eyup_portal.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        role TEXT NOT NULL CHECK(role IN ('customer','dj','admin')),
        first_name TEXT,
        last_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        email_verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        start_datetime TEXT NOT NULL,
        end_datetime TEXT NOT NULL,
        venue TEXT NOT NULL DEFAULT '',
        service TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('confirmed','pending','cancelled')),
        reference TEXT NOT NULL UNIQUE,
        contact_name TEXT NOT NULL DEFAULT '',
        notes_from_company TEXT,
        dj_briefing TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_customer_start ON bookings(customer_id, start_datetime);
    CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_datetime);

    CREATE TABLE IF NOT EXISTS booking_assignments (
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        dj_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (booking_id, dj_user_id)
    );

    CREATE TABLE IF NOT EXISTS customer_booking_preferences (
        customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        hidden_from_dashboard INTEGER NOT NULL DEFAULT 0 CHECK(hidden_from_dashboard IN (0,1)),
        PRIMARY KEY (customer_id, booking_id)
    );

    CREATE TABLE IF NOT EXISTS booking_customer_notes (
        customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (customer_id, booking_id)
    );

    CREATE TABLE IF NOT EXISTS customer_account_notes (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_account_notes_customer ON customer_account_notes(customer_id, sort_order);

    CREATE TABLE IF NOT EXISTS music_plans (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS booking_crew_notes (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
        author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// Partial uniques for music_plans (one default + one per booking)
try {
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_music_plan_customer_default
        ON music_plans(customer_id) WHERE booking_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_music_plan_customer_booking
        ON music_plans(customer_id, booking_id) WHERE booking_id IS NOT NULL;
    `);
} catch (e) {
    /* indexes may exist */
}

// Booking deposit & extensions (SQLite ALTER IF NOT EXISTS pattern)
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN deposit_paid INTEGER NOT NULL DEFAULT 0`);
} catch (e) {
    /* exists */
}
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN deposit_amount REAL`);
} catch (e) {
    /* exists */
}
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN deposit_currency TEXT DEFAULT 'GBP'`);
} catch (e) {
    /* exists */
}
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN deposit_paid_at TEXT`);
} catch (e) {
    /* exists */
}
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN deposit_note TEXT`);
} catch (e) {
    /* exists */
}

/** Spec v1.1 — users (contact parity, roster, admins) */
const userExtCols = [
    'ALTER TABLE users ADD COLUMN phone TEXT',
    'ALTER TABLE users ADD COLUMN capabilities TEXT',
    'ALTER TABLE users ADD COLUMN account_manager_user_id TEXT REFERENCES users(id)',
    'ALTER TABLE users ADD COLUMN disabled_at TEXT',
    'ALTER TABLE users ADD COLUMN allow_photos_social_media INTEGER',
    'ALTER TABLE users ADD COLUMN allow_videos_social_media INTEGER'
];
for (const stmt of userExtCols) {
    try {
        db.exec(stmt);
    } catch (e) {
        /* exists */
    }
}

/** Booking contact-form parity + lead fields */
const bookingExtCols = [
    'ALTER TABLE bookings ADD COLUMN guest_count_range TEXT',
    'ALTER TABLE bookings ADD COLUMN event_type TEXT',
    'ALTER TABLE bookings ADD COLUMN services_required TEXT',
    'ALTER TABLE bookings ADD COLUMN enquiry_message TEXT',
    'ALTER TABLE bookings ADD COLUMN hear_about TEXT',
    'ALTER TABLE bookings ADD COLUMN newsletter_opt_in INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE bookings ADD COLUMN lead_metadata TEXT'
];
for (const stmt of bookingExtCols) {
    try {
        db.exec(stmt);
    } catch (e) {
        /* exists */
    }
}

/** Crew assignment labels (spec §4.3) */
const assignExtCols = [
    'ALTER TABLE booking_assignments ADD COLUMN crew_role_label TEXT',
    'ALTER TABLE booking_assignments ADD COLUMN crew_capabilities TEXT'
];
for (const stmt of assignExtCols) {
    try {
        db.exec(stmt);
    } catch (e) {
        /* exists */
    }
}

try {
    db.exec(`ALTER TABLE users ADD COLUMN pii_ciphertext TEXT`);
} catch (e) {
    /* exists */
}
try {
    db.exec(`ALTER TABLE bookings ADD COLUMN booking_pii_ciphertext TEXT`);
} catch (e) {
    /* exists */
}

db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
        id TEXT PRIMARY KEY,
        admin_user_id TEXT NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);

    CREATE TABLE IF NOT EXISTS portal_site_settings (
        id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by_user_id TEXT REFERENCES users(id)
    );
`);

db.prepare(`
    INSERT OR IGNORE INTO portal_site_settings (id, payload_json, updated_at)
    VALUES ('default', '{}', datetime('now'))
`).run();

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_products (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        pricing_model TEXT NOT NULL DEFAULT 'hourly'
            CHECK(pricing_model IN ('hourly','flat','unit')),
        standalone_rate REAL NOT NULL DEFAULT 0,
        minimum_hours REAL,
        currency TEXT NOT NULL DEFAULT 'GBP',
        capability_code TEXT,
        allows_addons INTEGER NOT NULL DEFAULT 1 CHECK(allows_addons IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_products_active_sort ON catalog_products(is_active, sort_order, name);

    CREATE TABLE IF NOT EXISTS catalog_product_addons (
        parent_product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
        addon_product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
        addon_rate REAL NOT NULL DEFAULT 0,
        addon_pricing_model TEXT CHECK(
            addon_pricing_model IS NULL OR addon_pricing_model IN ('hourly','flat','unit')
        ),
        PRIMARY KEY (parent_product_id, addon_product_id),
        CHECK (parent_product_id != addon_product_id)
    );

    CREATE TABLE IF NOT EXISTS booking_line_items (
        id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES catalog_products(id),
        parent_line_item_id TEXT REFERENCES booking_line_items(id) ON DELETE CASCADE,
        pricing_context TEXT NOT NULL DEFAULT 'standalone'
            CHECK(pricing_context IN ('standalone','addon')),
        quantity REAL NOT NULL DEFAULT 1,
        hours REAL,
        unit_rate REAL NOT NULL DEFAULT 0,
        discount_type TEXT NOT NULL DEFAULT 'none'
            CHECK(discount_type IN ('none','percent','fixed')),
        discount_value REAL NOT NULL DEFAULT 0,
        line_subtotal REAL NOT NULL DEFAULT 0,
        label TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_booking_line_items_booking ON booking_line_items(booking_id, sort_order);
`);

try {
    db.exec(`ALTER TABLE catalog_products ADD COLUMN minimum_hours REAL`);
} catch (e) {
    /* exists */
}

function clampHoursToProductMinimum(product, hours) {
    const min =
        product && product.minimum_hours != null && Number.isFinite(Number(product.minimum_hours))
            ? Number(product.minimum_hours)
            : 0;
    let h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
        h = min > 0 ? min : 0;
    } else if (min > 0 && h < min) {
        h = min;
    }
    return h;
}

function computeCatalogLineSubtotal({ pricing_model: pricingModel, quantity, hours, unit_rate: unitRate, discount_type: discountType, discount_value: discountValue }) {
    const model = pricingModel || 'hourly';
    const qty = Number(quantity);
    const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const rate = Number(unitRate);
    const r = Number.isFinite(rate) ? rate : 0;
    let base;
    if (model === 'hourly') {
        const h = Number(hours);
        base = r * (Number.isFinite(h) && h > 0 ? h : 0);
    } else if (model === 'unit') {
        base = r * q;
    } else {
        base = r * q;
    }
    const dt = discountType || 'none';
    const dv = Number(discountValue);
    let total = base;
    if (dt === 'percent' && Number.isFinite(dv)) {
        total = base * (1 - Math.min(Math.max(dv, 0), 100) / 100);
    } else if (dt === 'fixed' && Number.isFinite(dv)) {
        total = base - Math.max(dv, 0);
    }
    return Math.round(Math.max(0, total) * 100) / 100;
}

function materializeCatalogProduct(row, { addons = null } = {}) {
    if (!row) return row;
    const out = {
        ...row,
        allows_addons: row.allows_addons === 1,
        is_active: row.is_active === 1
    };
    if (addons != null) out.addons = addons;
    return out;
}

function nowIso() {
    return new Date().toISOString();
}

function uuid() {
    return crypto.randomUUID();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getUserRawById(uid) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
}

function getBookingRawById(bookingId) {
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
}

function materializeUser(row) {
    if (!row) return row;
    if (pii.isEnabled() && row.pii_ciphertext && String(row.pii_ciphertext).startsWith(pii.PREFIX)) {
        const d = pii.decryptUserBlob(row.pii_ciphertext);
        if (d) {
            return {
                ...row,
                email: d.email,
                first_name: d.first_name ?? null,
                last_name: d.last_name ?? null,
                phone: d.phone ?? null
            };
        }
    }
    return row;
}

function materializeBooking(row) {
    if (!row) return row;
    if (pii.isEnabled() && row.booking_pii_ciphertext && String(row.booking_pii_ciphertext).startsWith(pii.PREFIX)) {
        const d = pii.decryptBookingBlob(row.booking_pii_ciphertext);
        if (d) {
            return {
                ...row,
                contact_name: d.contact_name != null ? d.contact_name : row.contact_name,
                enquiry_message: d.enquiry_message != null ? d.enquiry_message : row.enquiry_message,
                hear_about: d.hear_about != null ? d.hear_about : row.hear_about
            };
        }
    }
    return row;
}

function emailStorageKey(normalizedEmail) {
    if (!pii.isEnabled()) return normalizedEmail;
    return pii.stableEmailId(normalizedEmail);
}

function migrateLegacyPortalPiiAtRest() {
    if (!pii.isEnabled()) return;
    const run = () => {
        const userRows = db
            .prepare(
                `SELECT id, email, first_name, last_name, phone, pii_ciphertext FROM users
                 WHERE (pii_ciphertext IS NULL OR trim(pii_ciphertext) = '') AND instr(email, '@') > 0`
            )
            .all();
        for (const r of userRows) {
            const em = String(r.email || '').trim();
            if (!em.includes('@')) continue;
            const norm = normalizeEmail(em);
            const sid = pii.stableEmailId(norm);
            const blob = pii.encryptUserBlob({
                email: norm,
                first_name: r.first_name,
                last_name: r.last_name,
                phone: r.phone != null ? String(r.phone).trim() : null
            });
            db.prepare(
                `UPDATE users SET email = ?, first_name = NULL, last_name = NULL, phone = NULL, pii_ciphertext = ?, updated_at = ? WHERE id = ?`
            ).run(sid, blob, nowIso(), r.id);
        }

        const bookingRows = db
            .prepare(
                `SELECT id, contact_name, enquiry_message, hear_about, booking_pii_ciphertext FROM bookings
                 WHERE booking_pii_ciphertext IS NULL OR trim(booking_pii_ciphertext) = ''`
            )
            .all();
        for (const r of bookingRows) {
            const cn = r.contact_name != null ? String(r.contact_name) : '';
            const en = r.enquiry_message != null ? String(r.enquiry_message) : '';
            const hb = r.hear_about != null ? String(r.hear_about) : '';
            if (!cn.trim() && !en.trim() && !hb.trim()) continue;
            const blob = pii.encryptBookingBlob({
                contact_name: cn,
                enquiry_message: en || null,
                hear_about: hb || null
            });
            db.prepare(
                `UPDATE bookings SET booking_pii_ciphertext = ?, contact_name = '', enquiry_message = NULL, hear_about = NULL, updated_at = ? WHERE id = ?`
            ).run(blob, nowIso(), r.id);
        }

        const notes = db.prepare(`SELECT customer_id, booking_id, body FROM booking_customer_notes`).all();
        for (const r of notes) {
            if (!r.body || String(r.body).startsWith(pii.PREFIX)) continue;
            db.prepare(`UPDATE booking_customer_notes SET body = ? WHERE customer_id = ? AND booking_id = ?`).run(
                pii.encryptString(r.body),
                r.customer_id,
                r.booking_id
            );
        }

        const accountNotes = db.prepare(`SELECT id, body FROM customer_account_notes`).all();
        for (const r of accountNotes) {
            if (!r.body || String(r.body).startsWith(pii.PREFIX)) continue;
            db.prepare(`UPDATE customer_account_notes SET body = ? WHERE id = ?`).run(pii.encryptString(r.body), r.id);
        }

        const plans = db.prepare(`SELECT id, payload FROM music_plans`).all();
        for (const r of plans) {
            if (!r.payload || String(r.payload).startsWith(pii.PREFIX)) continue;
            db.prepare(`UPDATE music_plans SET payload = ?, updated_at = ? WHERE id = ?`).run(
                pii.encryptString(r.payload),
                nowIso(),
                r.id
            );
        }
    };
    db.transaction(run)();
}

migrateLegacyPortalPiiAtRest();

if (process.env.NODE_ENV === 'production' && !pii.isEnabled()) {
    console.warn(
        '[portal] Production: PORTAL_PII_ENCRYPTION_KEY is unset — customer portal PII stays plaintext in SQLite. Set a 32-byte key (hex or base64).'
    );
}

const portalDb = {
    db,

    createUser({ email, passwordHash, role, firstName, lastName, phone, capabilities, accountManagerUserId }) {
        const id = uuid();
        const em = normalizeEmail(email);
        const capJson =
            capabilities != null ? (typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities)) : null;
        const tel = phone != null && String(phone).trim() ? String(phone).trim() : null;
        const key = emailStorageKey(em);
        if (pii.isEnabled()) {
            const blob = pii.encryptUserBlob({
                email: em,
                first_name: firstName || null,
                last_name: lastName || null,
                phone: tel
            });
            db.prepare(`
                INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, pii_ciphertext, updated_at)
                VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
            `).run(id, key, passwordHash ?? null, role, capJson, accountManagerUserId || null, blob, nowIso());
        } else {
            db.prepare(`
                INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                key,
                passwordHash ?? null,
                role,
                firstName || null,
                lastName || null,
                tel,
                capJson,
                accountManagerUserId || null,
                nowIso()
            );
        }
        return id;
    },

    appendAudit(adminUserId, action, entityType, entityId, detailsObj) {
        db.prepare(`
            INSERT INTO admin_audit_log (id, admin_user_id, action, entity_type, entity_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            uuid(),
            adminUserId,
            action,
            entityType,
            entityId || null,
            JSON.stringify(detailsObj || {}),
            nowIso()
        );
    },

    getSiteSettingsRow() {
        return db
            .prepare(
                `SELECT payload_json, updated_at, updated_by_user_id FROM portal_site_settings WHERE id = 'default'`
            )
            .get();
    },

    saveSiteSettings(payloadJson, adminUserId) {
        db.prepare(`
            UPDATE portal_site_settings
            SET payload_json = ?, updated_at = datetime('now'), updated_by_user_id = ?
            WHERE id = 'default'
        `).run(payloadJson, adminUserId || null);
    },

    countActiveAdmins() {
        return db.prepare(`
            SELECT COUNT(*) AS c FROM users
            WHERE role = 'admin' AND (disabled_at IS NULL OR trim(disabled_at) = '')
        `).get().c;
    },

    /**
     * Self-service portal account deletion after router-level password / confirmation checks.
     * — Customers with any booking row are rejected (preserve business records; contact support).
     * — DJs with a non-cancelled assignment on a booking ending in the future (or ongoing) are rejected.
     * — Last active admin cannot be removed.
     * — Clears `admin_audit_log` and `users.account_manager_user_id` references before DELETE.
     */
    deleteSelfServiceUser(userId) {
        const raw = getUserRawById(userId);
        if (!raw) return { error: 'not_found', message: 'User not found' };
        const user = materializeUser(raw);

        const isActiveAdmin =
            user.role === 'admin' && (user.disabled_at == null || String(user.disabled_at).trim() === '');
        if (isActiveAdmin && this.countActiveAdmins() <= 1) {
            return {
                error: 'last_admin',
                message: 'Cannot delete the last active admin account'
            };
        }

        if (user.role === 'customer') {
            const { c } = db.prepare(`SELECT COUNT(1) AS c FROM bookings WHERE customer_id = ?`).get(userId);
            if (c > 0) {
                return {
                    error: 'customer_has_bookings',
                    message:
                        'This account has booking history and cannot be deleted automatically. Contact support to close your account.'
                };
            }
        }

        if (user.role === 'dj') {
            const { c } = db.prepare(
                `SELECT COUNT(1) AS c FROM booking_assignments ba
                 JOIN bookings b ON b.id = ba.booking_id
                 WHERE ba.dj_user_id = ? AND b.end_datetime >= ? AND b.status != 'cancelled'`
            ).get(userId, nowIso());
            if (c > 0) {
                return {
                    error: 'dj_has_upcoming',
                    message:
                        'You have upcoming event assignments; contact your coordinator before deleting your account.'
                };
            }
        }

        const run = () => {
            db.prepare(`DELETE FROM admin_audit_log WHERE admin_user_id = ?`).run(userId);
            db.prepare(`UPDATE users SET account_manager_user_id = NULL WHERE account_manager_user_id = ?`).run(userId);
            db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
        };
        db.transaction(run)();

        return { ok: true };
    },

    listUsers({ role, q, limit = 50, offset = 0 }) {
        const lim = Math.min(Number(limit) || 50, 200);
        const off = Number(offset) || 0;
        const qTrim = q && String(q).trim() ? String(q).trim() : '';
        const baseSelect = `
            SELECT id, email, phone, role, first_name, last_name, capabilities, account_manager_user_id,
                   disabled_at, email_verified_at, created_at, updated_at, pii_ciphertext
            FROM users WHERE 1=1
        `;

        if (pii.isEnabled() && qTrim) {
            let sql = baseSelect;
            const params = [];
            if (role === 'crew') {
                sql += " AND role IN ('dj', 'admin')";
            } else if (role) {
                sql += ' AND role = ?';
                params.push(role);
            }
            sql += ' ORDER BY datetime(created_at) DESC LIMIT 3000';
            const needle = qTrim.toLowerCase();
            const rows = db.prepare(sql).all(...params);
            const filtered = rows
                .map((r) => materializeUser(r))
                .filter((u) => {
                    const em = String(u.email || '').toLowerCase();
                    const fn = String(u.first_name || '').toLowerCase();
                    const ln = String(u.last_name || '').toLowerCase();
                    const ph = String(u.phone || '').toLowerCase();
                    return em.includes(needle) || fn.includes(needle) || ln.includes(needle) || ph.includes(needle);
                });
            return filtered.slice(off, off + lim);
        }

        let sql = baseSelect;
        const params = [];
        if (role === 'crew') {
            sql += " AND role IN ('dj', 'admin')";
        } else if (role) {
            sql += ' AND role = ?';
            params.push(role);
        }
        if (qTrim && !pii.isEnabled()) {
            const like = `%${qTrim.toLowerCase()}%`;
            sql +=
                " AND (LOWER(email) LIKE ? OR IFNULL(LOWER(first_name), '') LIKE ? OR IFNULL(LOWER(last_name), '') LIKE ? OR IFNULL(LOWER(phone), '') LIKE ?)";
            params.push(like, like, like, like);
        }
        sql += ' ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?';
        params.push(lim, off);
        return db.prepare(sql).all(...params).map((r) => materializeUser(r));
    },

    updateUserPatch(userId, patch) {
        const allowed = [
            'first_name',
            'last_name',
            'phone',
            'email',
            'password_hash',
            'role',
            'capabilities',
            'account_manager_user_id',
            'disabled_at',
            'email_verified_at',
            'allow_photos_social_media',
            'allow_videos_social_media'
        ];
        const keys = Object.keys(patch).filter((k) => allowed.includes(k));
        if (keys.length === 0) return false;
        const raw = getUserRawById(userId);
        if (!raw) return false;

        if (!pii.isEnabled()) {
            const setClause = [];
            const values = [];
            const nextPatch = { ...patch };
            if (nextPatch.capabilities != null && typeof nextPatch.capabilities !== 'string') {
                nextPatch.capabilities = JSON.stringify(nextPatch.capabilities);
            }
            if (nextPatch.email != null) {
                nextPatch.email = normalizeEmail(nextPatch.email);
            }
            for (const [key, value] of Object.entries(nextPatch)) {
                if (!allowed.includes(key)) continue;
                setClause.push(`${key} = ?`);
                if (key === 'allow_photos_social_media' || key === 'allow_videos_social_media') {
                    values.push(
                        value === null || value === undefined
                            ? null
                            : value
                              ? 1
                              : 0
                    );
                } else {
                    values.push(value === undefined ? null : value);
                }
            }
            if (setClause.length === 0) return false;
            setClause.push('updated_at = ?');
            values.push(nowIso());
            values.push(userId);
            const stmt = db.prepare(`UPDATE users SET ${setClause.join(', ')} WHERE id = ?`);
            return stmt.run(...values).changes > 0;
        }

        const u = materializeUser(raw);
        const nextCaps =
            patch.capabilities !== undefined
                ? patch.capabilities == null
                    ? null
                    : typeof patch.capabilities === 'string'
                      ? patch.capabilities
                      : JSON.stringify(patch.capabilities)
                : raw.capabilities;
        const nextEmail = patch.email !== undefined ? normalizeEmail(patch.email) : u.email;
        const nextPhotos =
            patch.allow_photos_social_media !== undefined
                ? patch.allow_photos_social_media === null
                    ? null
                    : patch.allow_photos_social_media
                      ? 1
                      : 0
                : raw.allow_photos_social_media ?? null;
        const nextVideos =
            patch.allow_videos_social_media !== undefined
                ? patch.allow_videos_social_media === null
                    ? null
                    : patch.allow_videos_social_media
                      ? 1
                      : 0
                : raw.allow_videos_social_media ?? null;
        const blob = pii.encryptUserBlob({
            email: nextEmail,
            first_name: patch.first_name !== undefined ? patch.first_name : u.first_name,
            last_name: patch.last_name !== undefined ? patch.last_name : u.last_name,
            phone:
                patch.phone !== undefined
                    ? patch.phone != null && String(patch.phone).trim()
                        ? String(patch.phone).trim()
                        : null
                    : u.phone != null
                      ? String(u.phone).trim()
                      : null
        });

        db.prepare(`
            UPDATE users SET
              email = ?,
              password_hash = ?,
              role = ?,
              capabilities = ?,
              account_manager_user_id = ?,
              disabled_at = ?,
              email_verified_at = ?,
              first_name = NULL,
              last_name = NULL,
              phone = NULL,
              allow_photos_social_media = ?,
              allow_videos_social_media = ?,
              pii_ciphertext = ?,
              updated_at = ?
            WHERE id = ?
        `).run(
            emailStorageKey(nextEmail),
            patch.password_hash !== undefined ? patch.password_hash : raw.password_hash,
            patch.role !== undefined ? patch.role : raw.role,
            nextCaps ?? null,
            patch.account_manager_user_id !== undefined ? patch.account_manager_user_id : raw.account_manager_user_id,
            patch.disabled_at !== undefined ? patch.disabled_at : raw.disabled_at,
            patch.email_verified_at !== undefined ? patch.email_verified_at : raw.email_verified_at,
            nextPhotos,
            nextVideos,
            blob,
            nowIso(),
            userId
        );
        return true;
    },

    /** Find or create customer by email for admin/internal booking flows */
    upsertCustomerForBooking({ email, first_name: firstName, last_name: lastName, phone, account_manager_user_id: am }) {
        const existing = portalDb.getUserByEmail(email);
        if (existing) {
            if (existing.role !== 'customer') {
                return { error: 'email_in_use_non_customer', user: existing };
            }
            return { error: null, user: existing, created: false };
        }
        const id = uuid();
        const em = normalizeEmail(email);
        const capJson = null;
        const tel = phone != null ? String(phone).trim() : null;
        const key = emailStorageKey(em);
        if (pii.isEnabled()) {
            const blob = pii.encryptUserBlob({
                email: em,
                first_name: firstName || null,
                last_name: lastName || null,
                phone: tel
            });
            db.prepare(`
                INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, pii_ciphertext, updated_at)
                VALUES (?, ?, NULL, 'customer', NULL, NULL, NULL, ?, ?, ?, ?)
            `).run(id, key, capJson, am || null, blob, nowIso());
        } else {
            db.prepare(`
                INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, updated_at)
                VALUES (?, ?, NULL, 'customer', ?, ?, ?, ?, ?, ?)
            `).run(id, key, firstName || null, lastName || null, tel, capJson, am || null, nowIso());
        }
        return { error: null, user: portalDb.getUserById(id), created: true };
    },
    getUserByEmail(email) {
        const em = normalizeEmail(email);
        return materializeUser(db.prepare('SELECT * FROM users WHERE email = ?').get(emailStorageKey(em)));
    },

    getUserById(id) {
        return materializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },

    updateUserTimestamp(id) {
        db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    },

    /** @param {string} customerId */
    getCustomerBookingsUpcoming(customerId) {
        const now = nowIso();
        return db
            .prepare(`
            SELECT b.* FROM bookings b
            LEFT JOIN customer_booking_preferences p
              ON p.customer_id = b.customer_id AND p.booking_id = b.id
            WHERE b.customer_id = ?
              AND b.end_datetime >= ?
              AND b.status != 'cancelled'
              AND (p.hidden_from_dashboard IS NULL OR p.hidden_from_dashboard = 0)
            ORDER BY b.start_datetime ASC
        `)
            .all(customerId, now)
            .map((b) => materializeBooking(b));
    },

    /** Past bookings for customer portal history (ended by time, any status). */
    getCustomerBookingsPast(customerId) {
        const now = nowIso();
        return db
            .prepare(`
            SELECT b.* FROM bookings b
            WHERE b.customer_id = ?
              AND b.end_datetime < ?
            ORDER BY b.start_datetime DESC
        `)
            .all(customerId, now)
            .map((b) => materializeBooking(b));
    },

    getBookingById(id) {
        return materializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
    },

    isBookingHidden(customerId, bookingId) {
        const row = db.prepare(`
            SELECT hidden_from_dashboard FROM customer_booking_preferences
            WHERE customer_id = ? AND booking_id = ?
        `).get(customerId, bookingId);
        return row && row.hidden_from_dashboard === 1;
    },

    setBookingHidden(customerId, bookingId, hidden) {
        db.prepare(`
            INSERT INTO customer_booking_preferences (customer_id, booking_id, hidden_from_dashboard)
            VALUES (?, ?, ?)
            ON CONFLICT(customer_id, booking_id) DO UPDATE SET hidden_from_dashboard = excluded.hidden_from_dashboard
        `).run(customerId, bookingId, hidden ? 1 : 0);
    },

    getCustomerBookingNote(customerId, bookingId) {
        const row = db.prepare(`
            SELECT body, updated_at FROM booking_customer_notes WHERE customer_id = ? AND booking_id = ?
        `).get(customerId, bookingId);
        if (!row) return row;
        return { ...row, body: pii.decryptStringMaybe(row.body) };
    },

    upsertCustomerBookingNote(customerId, bookingId, body) {
        const t = nowIso();
        const storedBody = pii.isEnabled() ? pii.encryptString(body) : body;
        db.prepare(`
            INSERT INTO booking_customer_notes (customer_id, booking_id, body, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(customer_id, booking_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
        `).run(customerId, bookingId, storedBody, t);
    },

    getAccountNotes(customerId) {
        const rows = db.prepare(`
            SELECT id, sort_order, body FROM customer_account_notes WHERE customer_id = ? ORDER BY sort_order ASC, id ASC
        `).all(customerId);
        return rows.map((r) => ({ ...r, body: pii.decryptStringMaybe(r.body) }));
    },

    replaceAccountNotes(customerId, lines) {
        const del = db.prepare('DELETE FROM customer_account_notes WHERE customer_id = ?');
        const ins = db.prepare(`
            INSERT INTO customer_account_notes (id, customer_id, sort_order, body) VALUES (?, ?, ?, ?)
        `);
        db.transaction(() => {
            del.run(customerId);
            lines.forEach((body, i) => {
                const line = String(body);
                const stored = pii.isEnabled() ? pii.encryptString(line) : line;
                ins.run(uuid(), customerId, i, stored);
            });
        })();
    },

    getMusicPlanRow(customerId, bookingIdNull) {
        let row = null;
        if (bookingIdNull == null) {
            row = db.prepare('SELECT * FROM music_plans WHERE customer_id = ? AND booking_id IS NULL').get(customerId);
        } else {
            row = db.prepare('SELECT * FROM music_plans WHERE customer_id = ? AND booking_id = ?').get(
                customerId,
                bookingIdNull
            );
        }
        if (!row) return row;
        return { ...row, payload: pii.decryptStringMaybe(row.payload) };
    },

    upsertMusicPlan(customerId, bookingIdNull, payloadObj) {
        const plainJson = JSON.stringify(payloadObj || {});
        const payload = pii.isEnabled() ? pii.encryptString(plainJson) : plainJson;
        const t = nowIso();
        const existing = bookingIdNull == null
            ? db.prepare('SELECT id FROM music_plans WHERE customer_id = ? AND booking_id IS NULL').get(customerId)
            : db.prepare('SELECT id FROM music_plans WHERE customer_id = ? AND booking_id = ?').get(customerId, bookingIdNull);
        if (existing) {
            db.prepare('UPDATE music_plans SET payload = ?, updated_at = ? WHERE id = ?').run(payload, t, existing.id);
            return existing.id;
        }
        const id = uuid();
        db.prepare(`
            INSERT INTO music_plans (id, customer_id, booking_id, payload, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, customerId, bookingIdNull, payload, t);
        return id;
    },

    /** DJ: upcoming assigned bookings + this crew member's assignment row */
    getDjUpcomingBookings(djUserId) {
        const now = nowIso();
        return db.prepare(`
            SELECT b.*,
                   a.crew_role_label AS assignment_crew_role_label,
                   a.crew_capabilities AS assignment_crew_capabilities_json
            FROM bookings b
            INNER JOIN booking_assignments a ON a.booking_id = b.id AND a.dj_user_id = ?
            WHERE b.end_datetime >= ? AND b.status != 'cancelled'
            ORDER BY b.start_datetime ASC
        `).all(djUserId, now).map((row) => {
            const { assignment_crew_role_label: lab, assignment_crew_capabilities_json: caps, ...rest } = row;
            return {
                ...materializeBooking(rest),
                assignment_crew_role_label: lab,
                assignment_crew_capabilities_json: caps
            };
        });
    },

    getAssignmentForDj(bookingId, djUserId) {
        return db.prepare(
            `SELECT * FROM booking_assignments WHERE booking_id = ? AND dj_user_id = ?`
        ).get(bookingId, djUserId);
    },

    /** Partial update — DJ scope or full admin booking fields (+ JSON coercion). */
    updateBooking(bookingId, patch, { admin = false } = {}) {
        const djCols = [
            'status',
            'deposit_paid',
            'deposit_amount',
            'deposit_currency',
            'deposit_paid_at',
            'deposit_note'
        ];
        const adminCols = [
            ...djCols,
            'customer_id',
            'title',
            'start_datetime',
            'end_datetime',
            'venue',
            'service',
            'reference',
            'contact_name',
            'notes_from_company',
            'dj_briefing',
            'guest_count_range',
            'event_type',
            'services_required',
            'enquiry_message',
            'hear_about',
            'newsletter_opt_in',
            'lead_metadata',
            'booking_pii_ciphertext'
        ];
        const normalized = { ...patch };
        if (normalized.services_required != null && typeof normalized.services_required !== 'string') {
            normalized.services_required = JSON.stringify(normalized.services_required);
        }
        if (normalized.lead_metadata != null && typeof normalized.lead_metadata !== 'string') {
            normalized.lead_metadata = JSON.stringify(normalized.lead_metadata);
        }
        if (normalized.newsletter_opt_in !== undefined) {
            normalized.newsletter_opt_in = normalized.newsletter_opt_in ? 1 : 0;
        }
        if (normalized.deposit_paid !== undefined) {
            normalized.deposit_paid = normalized.deposit_paid ? 1 : 0;
        }

        if (admin && pii.isEnabled()) {
            const piiKeys = ['contact_name', 'enquiry_message', 'hear_about'];
            const touchesPii = piiKeys.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
            const rawBk = getBookingRawById(bookingId);
            const hasBlob =
                rawBk &&
                rawBk.booking_pii_ciphertext &&
                String(rawBk.booking_pii_ciphertext).startsWith(pii.PREFIX);
            if (rawBk && (touchesPii || hasBlob)) {
                const prev = materializeBooking(rawBk);
                const merged = {
                    contact_name: patch.contact_name !== undefined ? patch.contact_name : prev.contact_name,
                    enquiry_message:
                        patch.enquiry_message !== undefined ? patch.enquiry_message : prev.enquiry_message,
                    hear_about: patch.hear_about !== undefined ? patch.hear_about : prev.hear_about
                };
                normalized.booking_pii_ciphertext = pii.encryptBookingBlob({
                    contact_name: merged.contact_name ?? '',
                    enquiry_message:
                        merged.enquiry_message != null && merged.enquiry_message !== ''
                            ? String(merged.enquiry_message)
                            : '',
                    hear_about:
                        merged.hear_about != null && merged.hear_about !== ''
                            ? String(merged.hear_about)
                            : ''
                });
                normalized.contact_name = '';
                normalized.enquiry_message = null;
                normalized.hear_about = null;
            }
        }

        const allowed = admin ? adminCols : djCols;
        const setClause = [];
        const values = [];
        for (const [key, value] of Object.entries(normalized)) {
            if (!allowed.includes(key)) continue;
            setClause.push(`${key} = ?`);
            values.push(value === undefined ? null : value);
        }
        if (setClause.length === 0) return false;
        setClause.push('updated_at = ?');
        values.push(nowIso());
        values.push(bookingId);
        const stmt = db.prepare(`UPDATE bookings SET ${setClause.join(', ')} WHERE id = ?`);
        return stmt.run(...values).changes > 0;
    },

    upsertBookingAssignment(bookingId, djUserId, opts = {}) {
        const lblIn = opts.crew_role_label;
        const lbl = lblIn !== undefined && lblIn !== null && String(lblIn).trim() !== '' ? String(lblIn).trim() : null;
        let capsJson = null;
        if (opts.crew_capabilities !== undefined && opts.crew_capabilities !== null) {
            capsJson =
                typeof opts.crew_capabilities === 'string'
                    ? opts.crew_capabilities
                    : JSON.stringify(opts.crew_capabilities);
        }
        db.prepare(`
            INSERT INTO booking_assignments (booking_id, dj_user_id, crew_role_label, crew_capabilities, assigned_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(booking_id, dj_user_id) DO UPDATE SET
                crew_role_label = COALESCE(excluded.crew_role_label, booking_assignments.crew_role_label),
                crew_capabilities = COALESCE(excluded.crew_capabilities, booking_assignments.crew_capabilities)
        `).run(bookingId, djUserId, lbl, capsJson, nowIso());
    },

    assignDj(bookingId, djUserId) {
        db.prepare(`
            INSERT INTO booking_assignments (booking_id, dj_user_id, crew_role_label, crew_capabilities, assigned_at)
            VALUES (?, ?, NULL, NULL, ?)
            ON CONFLICT(booking_id, dj_user_id) DO NOTHING
        `).run(bookingId, djUserId, nowIso());
    },

    deleteBookingAssignment(bookingId, djUserId) {
        return db.prepare('DELETE FROM booking_assignments WHERE booking_id = ? AND dj_user_id = ?').run(
            bookingId,
            djUserId
        ).changes > 0;
    },

    getAssignmentsWithUsers(bookingId) {
        const rows = db.prepare(`
            SELECT a.*
            FROM booking_assignments a
            WHERE a.booking_id = ?
            ORDER BY a.assigned_at ASC
        `).all(bookingId);
        return rows.map((a) => {
            const dj = portalDb.getUserById(a.dj_user_id);
            return {
                ...a,
                user_email: dj?.email ?? null,
                user_first_name: dj?.first_name ?? null,
                user_last_name: dj?.last_name ?? null,
                user_phone: dj?.phone ?? null,
                user_role: dj?.role ?? null
            };
        });
    },

    listBookingsAdmin(filters = {}) {
        const {
            customer_id: customerId,
            status,
            start_from: startFrom,
            start_to: startTo,
            limit = 100,
            offset = 0
        } = filters;
        let sql = 'SELECT * FROM bookings WHERE 1=1';
        const params = [];
        if (customerId) {
            sql += ' AND customer_id = ?';
            params.push(customerId);
        }
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (startFrom) {
            sql += ' AND start_datetime >= ?';
            params.push(startFrom);
        }
        if (startTo) {
            sql += ' AND start_datetime <= ?';
            params.push(startTo);
        }
        sql += ' ORDER BY start_datetime DESC LIMIT ? OFFSET ?';
        params.push(Math.min(Number(limit) || 100, 500), Number(offset) || 0);
        return db.prepare(sql).all(...params).map((row) => materializeBooking(row));
    },

    isDjAssigned(djUserId, bookingId) {
        const row = db.prepare(
            'SELECT 1 FROM booking_assignments WHERE dj_user_id = ? AND booking_id = ?'
        ).get(djUserId, bookingId);
        return !!row;
    },

    getCrewNote(bookingId) {
        return db.prepare('SELECT * FROM booking_crew_notes WHERE booking_id = ?').get(bookingId);
    },

    upsertCrewNote(bookingId, authorUserId, body) {
        const t = nowIso();
        const row = db.prepare('SELECT booking_id FROM booking_crew_notes WHERE booking_id = ?').get(bookingId);
        if (row) {
            db.prepare(
                'UPDATE booking_crew_notes SET body = ?, author_user_id = ?, updated_at = ? WHERE booking_id = ?'
            ).run(body, authorUserId, t, bookingId);
        } else {
            db.prepare(`
                INSERT INTO booking_crew_notes (booking_id, author_user_id, body, updated_at)
                VALUES (?, ?, ?, ?)
            `).run(bookingId, authorUserId, body, t);
        }
    },

    /** Admin/seed: create booking — contact-form parity fields optional */
    insertBooking(row) {
        const depositPaid = row.deposit_paid ? 1 : 0;
        const depositAmount =
            row.deposit_amount != null && row.deposit_amount !== ''
                ? Number(row.deposit_amount)
                : null;
        const depositCurrency =
            row.deposit_currency != null && String(row.deposit_currency).trim()
                ? String(row.deposit_currency).trim().toUpperCase()
                : 'GBP';
        const depositPaidAt = row.deposit_paid_at != null ? String(row.deposit_paid_at) : null;
        const depositNote =
            row.deposit_note != null && String(row.deposit_note).trim()
                ? String(row.deposit_note).trim()
                : null;

        const servicesRequired =
            row.services_required != null
                ? typeof row.services_required === 'string'
                    ? row.services_required
                    : JSON.stringify(row.services_required)
                : null;
        const leadMetadata =
            row.lead_metadata != null
                ? typeof row.lead_metadata === 'string'
                    ? row.lead_metadata
                    : JSON.stringify(row.lead_metadata)
                : null;
        const newsletter = row.newsletter_opt_in ? 1 : 0;

        let bookingPiiCipher = null;
        let contactOut =
            row.contact_name != null && String(row.contact_name).trim()
                ? String(row.contact_name)
                : '';
        let enquiryOut = row.enquiry_message != null ? String(row.enquiry_message) : null;
        let hearOut = row.hear_about != null ? String(row.hear_about) : null;
        if (pii.isEnabled()) {
            bookingPiiCipher = pii.encryptBookingBlob({
                contact_name: contactOut || '',
                enquiry_message: enquiryOut || '',
                hear_about: hearOut || ''
            });
            contactOut = '';
            enquiryOut = null;
            hearOut = null;
        }

        db.prepare(`
            INSERT INTO bookings (
                id, customer_id, title, start_datetime, end_datetime, venue, service, status, reference,
                contact_name, notes_from_company, dj_briefing,
                deposit_paid, deposit_amount, deposit_currency, deposit_paid_at, deposit_note,
                guest_count_range, event_type, services_required, enquiry_message, hear_about,
                newsletter_opt_in, lead_metadata,
                booking_pii_ciphertext,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            row.id,
            row.customer_id,
            row.title,
            row.start_datetime,
            row.end_datetime,
            row.venue,
            row.service,
            row.status,
            row.reference,
            contactOut,
            row.notes_from_company ?? null,
            row.dj_briefing ?? null,
            depositPaid,
            Number.isFinite(depositAmount) ? depositAmount : null,
            depositCurrency,
            depositPaidAt,
            depositNote,
            row.guest_count_range != null ? String(row.guest_count_range) : null,
            row.event_type != null ? String(row.event_type) : null,
            servicesRequired,
            enquiryOut,
            hearOut,
            newsletter,
            leadMetadata,
            bookingPiiCipher,
            nowIso()
        );
    },

    listCatalogProducts({ activeOnly = false } = {}) {
        let sql = 'SELECT * FROM catalog_products';
        if (activeOnly) sql += ' WHERE is_active = 1';
        sql += ' ORDER BY sort_order ASC, name ASC';
        return db.prepare(sql).all().map((r) => materializeCatalogProduct(r));
    },

    getCatalogProductById(id) {
        const row = db.prepare('SELECT * FROM catalog_products WHERE id = ?').get(id);
        if (!row) return null;
        const addons = db
            .prepare(
                `SELECT a.*, p.code AS addon_code, p.name AS addon_name, p.pricing_model AS addon_default_pricing_model
                 FROM catalog_product_addons a
                 INNER JOIN catalog_products p ON p.id = a.addon_product_id
                 WHERE a.parent_product_id = ? AND p.is_active = 1
                 ORDER BY p.sort_order ASC, p.name ASC`
            )
            .all(id)
            .map((a) => ({
                addon_product_id: a.addon_product_id,
                addon_code: a.addon_code,
                addon_name: a.addon_name,
                addon_rate: a.addon_rate,
                addon_pricing_model: a.addon_pricing_model,
                addon_default_pricing_model: a.addon_default_pricing_model
            }));
        return materializeCatalogProduct(row, { addons });
    },

    getCatalogProductByCode(code) {
        const row = db
            .prepare('SELECT * FROM catalog_products WHERE code = ? COLLATE NOCASE')
            .get(String(code || '').trim());
        return row ? materializeCatalogProduct(row) : null;
    },

    insertCatalogProduct(row) {
        const id = row.id || uuid();
        const t = nowIso();
        db.prepare(`
            INSERT INTO catalog_products (
                id, code, name, description, pricing_model, standalone_rate, minimum_hours, currency,
                capability_code, allows_addons, is_active, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            String(row.code).trim().toLowerCase(),
            String(row.name).trim(),
            row.description != null ? String(row.description) : '',
            ['hourly', 'flat', 'unit'].includes(row.pricing_model) ? row.pricing_model : 'hourly',
            Number.isFinite(Number(row.standalone_rate)) ? Number(row.standalone_rate) : 0,
            row.minimum_hours != null && row.minimum_hours !== '' && Number.isFinite(Number(row.minimum_hours))
                ? Number(row.minimum_hours)
                : null,
            row.currency != null && String(row.currency).trim()
                ? String(row.currency).trim().toUpperCase()
                : 'GBP',
            row.capability_code != null && String(row.capability_code).trim()
                ? String(row.capability_code).trim().toLowerCase()
                : null,
            row.allows_addons === false || row.allows_addons === 0 ? 0 : 1,
            row.is_active === false || row.is_active === 0 ? 0 : 1,
            Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
            t,
            t
        );
        return portalDb.getCatalogProductById(id);
    },

    updateCatalogProduct(productId, patch) {
        const existing = db.prepare('SELECT id FROM catalog_products WHERE id = ?').get(productId);
        if (!existing) return null;
        const allowed = [
            'code',
            'name',
            'description',
            'pricing_model',
            'standalone_rate',
            'minimum_hours',
            'currency',
            'capability_code',
            'allows_addons',
            'is_active',
            'sort_order'
        ];
        const sets = [];
        const params = [];
        for (const key of allowed) {
            if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
            let val = patch[key];
            if (key === 'code') val = String(val).trim().toLowerCase();
            else if (key === 'name') val = String(val).trim();
            else if (key === 'description') val = String(val);
            else if (key === 'pricing_model') {
                if (!['hourly', 'flat', 'unit'].includes(val)) continue;
            } else if (key === 'standalone_rate') val = Number(val);
            else if (key === 'minimum_hours') {
                val =
                    val != null && val !== '' && Number.isFinite(Number(val)) ? Number(val) : null;
            } else if (key === 'currency') val = String(val).trim().toUpperCase();
            else if (key === 'capability_code') {
                val =
                    val != null && String(val).trim() ? String(val).trim().toLowerCase() : null;
            } else if (key === 'allows_addons' || key === 'is_active') {
                val = val ? 1 : 0;
            } else if (key === 'sort_order') val = Number(val) || 0;
            sets.push(`${key} = ?`);
            params.push(val);
        }
        if (!sets.length) return portalDb.getCatalogProductById(productId);
        sets.push('updated_at = ?');
        params.push(nowIso());
        params.push(productId);
        db.prepare(`UPDATE catalog_products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        return portalDb.getCatalogProductById(productId);
    },

    deleteCatalogProduct(productId) {
        const used = db
            .prepare('SELECT 1 AS ok FROM booking_line_items WHERE product_id = ? LIMIT 1')
            .get(productId);
        if (used) {
            db.prepare('UPDATE catalog_products SET is_active = 0, updated_at = ? WHERE id = ?').run(
                nowIso(),
                productId
            );
            return { deactivated: true };
        }
        db.prepare('DELETE FROM catalog_products WHERE id = ?').run(productId);
        return { deleted: true };
    },

    upsertCatalogProductAddon(parentProductId, addonProductId, { addon_rate: addonRate, addon_pricing_model: addonPricingModel } = {}) {
        const rate = Number.isFinite(Number(addonRate)) ? Number(addonRate) : 0;
        const model =
            addonPricingModel && ['hourly', 'flat', 'unit'].includes(addonPricingModel)
                ? addonPricingModel
                : null;
        db.prepare(`
            INSERT INTO catalog_product_addons (parent_product_id, addon_product_id, addon_rate, addon_pricing_model)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(parent_product_id, addon_product_id) DO UPDATE SET
                addon_rate = excluded.addon_rate,
                addon_pricing_model = excluded.addon_pricing_model
        `).run(parentProductId, addonProductId, rate, model);
    },

    deleteCatalogProductAddon(parentProductId, addonProductId) {
        db.prepare(
            `DELETE FROM catalog_product_addons WHERE parent_product_id = ? AND addon_product_id = ?`
        ).run(parentProductId, addonProductId);
    },

    getBookingLineItems(bookingId) {
        const rows = db
            .prepare(
                `SELECT li.*, p.code AS product_code, p.pricing_model AS product_pricing_model, p.currency AS product_currency
                 FROM booking_line_items li
                 INNER JOIN catalog_products p ON p.id = li.product_id
                 WHERE li.booking_id = ?
                 ORDER BY li.sort_order ASC, li.created_at ASC`
            )
            .all(bookingId);
        return rows.map((r) => ({
            id: r.id,
            booking_id: r.booking_id,
            product_id: r.product_id,
            product_code: r.product_code,
            product_pricing_model: r.product_pricing_model,
            product_currency: r.product_currency,
            parent_line_item_id: r.parent_line_item_id,
            pricing_context: r.pricing_context,
            quantity: r.quantity,
            hours: r.hours,
            unit_rate: r.unit_rate,
            discount_type: r.discount_type,
            discount_value: r.discount_value,
            line_subtotal: r.line_subtotal,
            label: r.label,
            sort_order: r.sort_order
        }));
    },

    summarizeBookingQuote(lineItems) {
        const items = lineItems || [];
        const subtotal = items.reduce((s, li) => s + (Number(li.line_subtotal) || 0), 0);
        return {
            line_count: items.length,
            quote_subtotal: Math.round(subtotal * 100) / 100,
            quote_total: Math.round(subtotal * 100) / 100
        };
    },

    /** Replace all line items on a booking (admin). Items may use client_key / parent_client_key for new trees. */
    replaceBookingLineItems(bookingId, itemsIn) {
        const items = Array.isArray(itemsIn) ? itemsIn : [];
        const del = db.prepare('DELETE FROM booking_line_items WHERE booking_id = ?');
        const ins = db.prepare(`
            INSERT INTO booking_line_items (
                id, booking_id, product_id, parent_line_item_id, pricing_context,
                quantity, hours, unit_rate, discount_type, discount_value, line_subtotal,
                label, sort_order, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const keyToId = new Map();

        db.transaction(() => {
            del.run(bookingId);
            items.forEach((raw, index) => {
                const product = db.prepare('SELECT * FROM catalog_products WHERE id = ?').get(raw.product_id);
                if (!product) {
                    throw new Error(`Unknown product_id: ${raw.product_id}`);
                }
                const pricingContext =
                    raw.pricing_context === 'addon' ? 'addon' : 'standalone';
                let parentId = raw.parent_line_item_id || null;
                if (!parentId && raw.parent_client_key && keyToId.has(String(raw.parent_client_key))) {
                    parentId = keyToId.get(String(raw.parent_client_key));
                }
                if (pricingContext === 'addon' && !parentId) {
                    throw new Error('Add-on line items require a parent line');
                }

                let unitRate = Number(raw.unit_rate);
                if (!Number.isFinite(unitRate)) {
                    if (pricingContext === 'addon' && parentId) {
                        const parentLine = db
                            .prepare('SELECT product_id FROM booking_line_items WHERE id = ?')
                            .get(parentId);
                        if (parentLine) {
                            const link = db
                                .prepare(
                                    `SELECT addon_rate FROM catalog_product_addons
                                     WHERE parent_product_id = ? AND addon_product_id = ?`
                                )
                                .get(parentLine.product_id, product.id);
                            if (link) unitRate = Number(link.addon_rate);
                        }
                    }
                    if (!Number.isFinite(unitRate)) unitRate = Number(product.standalone_rate) || 0;
                }

                const pricingModel =
                    pricingContext === 'addon'
                        ? (() => {
                              if (parentId) {
                                  const parentLine = db
                                      .prepare('SELECT product_id FROM booking_line_items WHERE id = ?')
                                      .get(parentId);
                                  if (parentLine) {
                                      const link = db
                                          .prepare(
                                              `SELECT addon_pricing_model FROM catalog_product_addons
                                               WHERE parent_product_id = ? AND addon_product_id = ?`
                                          )
                                          .get(parentLine.product_id, product.id);
                                      if (link && link.addon_pricing_model) return link.addon_pricing_model;
                                  }
                              }
                              return product.pricing_model;
                          })()
                        : product.pricing_model;

                let hoursOut =
                    raw.hours != null && raw.hours !== '' ? Number(raw.hours) : null;
                if (pricingModel === 'hourly') {
                    hoursOut = clampHoursToProductMinimum(product, hoursOut);
                    if (!Number.isFinite(hoursOut) || hoursOut <= 0) hoursOut = null;
                }

                const lineSubtotal = computeCatalogLineSubtotal({
                    pricing_model: pricingModel,
                    quantity: raw.quantity,
                    hours: hoursOut,
                    unit_rate: unitRate,
                    discount_type: raw.discount_type,
                    discount_value: raw.discount_value
                });

                const lineId = raw.id && String(raw.id).trim() ? String(raw.id).trim() : uuid();
                const label =
                    raw.label != null && String(raw.label).trim()
                        ? String(raw.label).trim()
                        : String(product.name);
                ins.run(
                    lineId,
                    bookingId,
                    product.id,
                    parentId,
                    pricingContext,
                    Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 1,
                    hoursOut,
                    unitRate,
                    ['none', 'percent', 'fixed'].includes(raw.discount_type) ? raw.discount_type : 'none',
                    Number.isFinite(Number(raw.discount_value)) ? Number(raw.discount_value) : 0,
                    lineSubtotal,
                    label,
                    Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : index,
                    nowIso()
                );
                if (raw.client_key) keyToId.set(String(raw.client_key), lineId);
            });
        })();

        return portalDb.getBookingLineItems(bookingId);
    },

    exportCatalogSnapshot() {
        const rows = portalDb.listCatalogProducts({ activeOnly: false });
        const products = rows.map((p) => {
            const full = portalDb.getCatalogProductById(p.id);
            const addons = (full.addons || []).map((a) => ({
                addon_code: a.addon_code,
                addon_rate: a.addon_rate,
                addon_pricing_model: a.addon_pricing_model || null
            }));
            return {
                code: full.code,
                name: full.name,
                description: full.description || '',
                pricing_model: full.pricing_model,
                standalone_rate: full.standalone_rate,
                minimum_hours: full.minimum_hours != null ? full.minimum_hours : null,
                currency: full.currency || 'GBP',
                capability_code: full.capability_code || null,
                allows_addons: full.allows_addons !== false,
                is_active: full.is_active !== false,
                sort_order: full.sort_order != null ? full.sort_order : 0,
                addons
            };
        });
        return {
            version: 1,
            exported_at: nowIso(),
            products
        };
    },

    importCatalogSnapshot(payload, { replaceAddonLinks = true } = {}) {
        const list = payload && Array.isArray(payload.products) ? payload.products : [];
        const stats = { created: 0, updated: 0, addons_linked: 0, errors: [] };

        const upsertOne = (row) => {
            const code = String(row.code || '').trim().toLowerCase();
            if (!code || !row.name) {
                stats.errors.push({ code: row.code || '', message: 'code and name required' });
                return null;
            }
            const existing = portalDb.getCatalogProductByCode(code);
            const fields = {
                name: String(row.name).trim(),
                description: row.description != null ? String(row.description) : '',
                pricing_model: ['hourly', 'flat', 'unit'].includes(row.pricing_model)
                    ? row.pricing_model
                    : 'hourly',
                standalone_rate: Number.isFinite(Number(row.standalone_rate))
                    ? Number(row.standalone_rate)
                    : 0,
                minimum_hours:
                    row.minimum_hours != null &&
                    row.minimum_hours !== '' &&
                    Number.isFinite(Number(row.minimum_hours))
                        ? Number(row.minimum_hours)
                        : null,
                currency:
                    row.currency != null && String(row.currency).trim()
                        ? String(row.currency).trim().toUpperCase()
                        : 'GBP',
                capability_code:
                    row.capability_code != null && String(row.capability_code).trim()
                        ? String(row.capability_code).trim().toLowerCase()
                        : null,
                allows_addons: !(row.allows_addons === false || row.allows_addons === 0),
                is_active: !(row.is_active === false || row.is_active === 0),
                sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0
            };
            if (existing) {
                portalDb.updateCatalogProduct(existing.id, fields);
                stats.updated += 1;
                return portalDb.getCatalogProductById(existing.id);
            }
            const created = portalDb.insertCatalogProduct({ code, ...fields });
            stats.created += 1;
            return created;
        };

        db.transaction(() => {
            list.forEach((row) => upsertOne(row));
        })();

        const codeToId = new Map();
        portalDb.listCatalogProducts({ activeOnly: false }).forEach((p) => {
            codeToId.set(String(p.code).toLowerCase(), p.id);
        });

        list.forEach((row) => {
            const parentCode = String(row.code || '').trim().toLowerCase();
            const parentId = codeToId.get(parentCode);
            if (!parentId) return;
            const addons = Array.isArray(row.addons) ? row.addons : [];

            if (replaceAddonLinks) {
                const parentFull = portalDb.getCatalogProductById(parentId);
                (parentFull.addons || []).forEach((a) => {
                    portalDb.deleteCatalogProductAddon(parentId, a.addon_product_id);
                });
            }

            addons.forEach((a) => {
                const addonCode = String(a.addon_code || a.code || '').trim().toLowerCase();
                if (!addonCode) {
                    stats.errors.push({
                        code: parentCode,
                        message: 'addon missing addon_code'
                    });
                    return;
                }
                const addonId = codeToId.get(addonCode);
                if (!addonId) {
                    stats.errors.push({
                        code: parentCode,
                        message: 'unknown addon_code: ' + addonCode
                    });
                    return;
                }
                if (addonId === parentId) return;
                portalDb.upsertCatalogProductAddon(parentId, addonId, {
                    addon_rate: a.addon_rate,
                    addon_pricing_model: a.addon_pricing_model
                });
                stats.addons_linked += 1;
            });
        });

        return stats;
    },

    isCrewAssignableUser(u) {
        return !!u && (u.role === 'dj' || u.role === 'admin');
    }
};

module.exports = { portalDb, uuid, normalizeEmail, nowIso };
