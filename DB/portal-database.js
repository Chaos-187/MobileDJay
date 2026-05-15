const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

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
    'ALTER TABLE users ADD COLUMN disabled_at TEXT'
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
`);

function nowIso() {
    return new Date().toISOString();
}

function uuid() {
    return crypto.randomUUID();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

const portalDb = {
    db,

    createUser({ email, passwordHash, role, firstName, lastName, phone, capabilities, accountManagerUserId }) {
        const id = uuid();
        const em = normalizeEmail(email);
        const capJson =
            capabilities != null ? (typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities)) : null;
        db.prepare(`
            INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            em,
            passwordHash ?? null,
            role,
            firstName || null,
            lastName || null,
            phone != null && String(phone).trim() ? String(phone).trim() : null,
            capJson,
            accountManagerUserId || null,
            nowIso()
        );
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

    countActiveAdmins() {
        return db.prepare(`
            SELECT COUNT(*) AS c FROM users
            WHERE role = 'admin' AND (disabled_at IS NULL OR trim(disabled_at) = '')
        `).get().c;
    },

    listUsers({ role, q, limit = 50, offset = 0 }) {
        let sql = `
            SELECT id, email, phone, role, first_name, last_name, capabilities, account_manager_user_id,
                   disabled_at, email_verified_at, created_at, updated_at
            FROM users WHERE 1=1
        `;
        const params = [];
        if (role) {
            sql += ' AND role = ?';
            params.push(role);
        }
        if (q && String(q).trim()) {
            const like = `%${String(q).trim().toLowerCase()}%`;
            sql += ' AND (LOWER(email) LIKE ? OR IFNULL(LOWER(first_name), "") LIKE ? OR IFNULL(LOWER(last_name), "") LIKE ? OR IFNULL(LOWER(phone), "") LIKE ?)';
            params.push(like, like, like, like);
        }
        sql += ' ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?';
        params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
        return db.prepare(sql).all(...params);
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
            'email_verified_at'
        ];
        const setClause = [];
        const values = [];
        const row = portalDb.getUserById(userId);
        if (!row) return false;
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
            values.push(value === undefined ? null : value);
        }
        if (setClause.length === 0) return false;
        setClause.push('updated_at = ?');
        values.push(nowIso());
        values.push(userId);
        const stmt = db.prepare(`UPDATE users SET ${setClause.join(', ')} WHERE id = ?`);
        return stmt.run(...values).changes > 0;
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
        db.prepare(`
            INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, capabilities, account_manager_user_id, updated_at)
            VALUES (?, ?, NULL, 'customer', ?, ?, ?, ?, ?, ?)
        `).run(id, em, firstName || null, lastName || null, phone != null ? String(phone).trim() : null, capJson, am || null, nowIso());
        return { error: null, user: portalDb.getUserById(id), created: true };
    },
    getUserByEmail(email) {
        return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
    },

    getUserById(id) {
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    },

    updateUserTimestamp(id) {
        db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    },

    /** @param {string} customerId */
    getCustomerBookingsUpcoming(customerId) {
        const now = nowIso();
        return db.prepare(`
            SELECT b.* FROM bookings b
            LEFT JOIN customer_booking_preferences p
              ON p.customer_id = b.customer_id AND p.booking_id = b.id
            WHERE b.customer_id = ?
              AND b.end_datetime >= ?
              AND b.status != 'cancelled'
              AND (p.hidden_from_dashboard IS NULL OR p.hidden_from_dashboard = 0)
            ORDER BY b.start_datetime ASC
        `).all(customerId, now);
    },

    getBookingById(id) {
        return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
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
        return db.prepare(`
            SELECT body, updated_at FROM booking_customer_notes WHERE customer_id = ? AND booking_id = ?
        `).get(customerId, bookingId);
    },

    upsertCustomerBookingNote(customerId, bookingId, body) {
        const t = nowIso();
        db.prepare(`
            INSERT INTO booking_customer_notes (customer_id, booking_id, body, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(customer_id, booking_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
        `).run(customerId, bookingId, body, t);
    },

    getAccountNotes(customerId) {
        return db.prepare(`
            SELECT id, sort_order, body FROM customer_account_notes WHERE customer_id = ? ORDER BY sort_order ASC, id ASC
        `).all(customerId);
    },

    replaceAccountNotes(customerId, lines) {
        const del = db.prepare('DELETE FROM customer_account_notes WHERE customer_id = ?');
        const ins = db.prepare(`
            INSERT INTO customer_account_notes (id, customer_id, sort_order, body) VALUES (?, ?, ?, ?)
        `);
        db.transaction(() => {
            del.run(customerId);
            lines.forEach((body, i) => {
                ins.run(uuid(), customerId, i, String(body));
            });
        })();
    },

    getMusicPlanRow(customerId, bookingIdNull) {
        if (bookingIdNull == null) {
            return db.prepare('SELECT * FROM music_plans WHERE customer_id = ? AND booking_id IS NULL').get(customerId);
        }
        return db.prepare('SELECT * FROM music_plans WHERE customer_id = ? AND booking_id = ?').get(
            customerId,
            bookingIdNull
        );
    },

    upsertMusicPlan(customerId, bookingIdNull, payloadObj) {
        const payload = JSON.stringify(payloadObj || {});
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
        `).all(djUserId, now);
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
            'lead_metadata'
        ];
        const allowed = admin ? adminCols : djCols;
        const setClause = [];
        const values = [];
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
        return db.prepare(`
            SELECT a.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name, u.phone AS user_phone
            FROM booking_assignments a
            INNER JOIN users u ON u.id = a.dj_user_id
            WHERE a.booking_id = ?
            ORDER BY a.assigned_at ASC
        `).all(bookingId);
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
        return db.prepare(sql).all(...params);
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

        db.prepare(`
            INSERT INTO bookings (
                id, customer_id, title, start_datetime, end_datetime, venue, service, status, reference,
                contact_name, notes_from_company, dj_briefing,
                deposit_paid, deposit_amount, deposit_currency, deposit_paid_at, deposit_note,
                guest_count_range, event_type, services_required, enquiry_message, hear_about,
                newsletter_opt_in, lead_metadata,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            row.contact_name,
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
            row.enquiry_message != null ? String(row.enquiry_message) : null,
            row.hear_about != null ? String(row.hear_about) : null,
            newsletter,
            leadMetadata,
            nowIso()
        );
    }
};

module.exports = { portalDb, uuid, normalizeEmail, nowIso };
