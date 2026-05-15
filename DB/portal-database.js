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

    createUser({ email, passwordHash, role, firstName, lastName }) {
        const id = uuid();
        const em = normalizeEmail(email);
        db.prepare(`
            INSERT INTO users (id, email, password_hash, role, first_name, last_name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, em, passwordHash, role, firstName || null, lastName || null, nowIso());
        return id;
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

    /** DJ: upcoming assigned bookings */
    getDjUpcomingBookings(djUserId) {
        const now = nowIso();
        return db.prepare(`
            SELECT b.* FROM bookings b
            INNER JOIN booking_assignments a ON a.booking_id = b.id AND a.dj_user_id = ?
            WHERE b.end_datetime >= ? AND b.status != 'cancelled'
            ORDER BY b.start_datetime ASC
        `).all(djUserId, now);
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

    /** Partial update for bookings (DJ/internal use). Whitelisted columns only. */
    updateBooking(bookingId, patch) {
        const allowed = [
            'status',
            'deposit_paid',
            'deposit_amount',
            'deposit_currency',
            'deposit_paid_at',
            'deposit_note'
        ];
        const setClause = [];
        const values = [];
        for (const [key, value] of Object.entries(patch)) {
            if (!allowed.includes(key)) continue;
            setClause.push(`${key} = ?`);
            values.push(value);
        }
        if (setClause.length === 0) return false;
        setClause.push('updated_at = ?');
        values.push(nowIso());
        values.push(bookingId);
        const stmt = db.prepare(`UPDATE bookings SET ${setClause.join(', ')} WHERE id = ?`);
        return stmt.run(...values).changes > 0;
    },

    /** Admin/seed: create booking */
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

        db.prepare(`
            INSERT INTO bookings (
                id, customer_id, title, start_datetime, end_datetime, venue, service, status, reference,
                contact_name, notes_from_company, dj_briefing,
                deposit_paid, deposit_amount, deposit_currency, deposit_paid_at, deposit_note,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            nowIso()
        );
    },
    assignDj(bookingId, djUserId) {
        db.prepare(`
            INSERT OR IGNORE INTO booking_assignments (booking_id, dj_user_id) VALUES (?, ?)
        `).run(bookingId, djUserId);
    }
};

module.exports = { portalDb, uuid, normalizeEmail, nowIso };
