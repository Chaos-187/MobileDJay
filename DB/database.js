const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Initialize database
const dbPath = path.join(__dirname, 'mobiledj.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    -- Events table
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        venue TEXT,
        event_date TEXT,
        is_active INTEGER DEFAULT 1,
        heading_color TEXT DEFAULT '#007bff',
        text_color TEXT DEFAULT '#212529',
        bg_color TEXT DEFAULT '#ffffff',
        bg_image TEXT,
        accent_color TEXT DEFAULT '#0d6efd',
        custom_css TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Requests table (song/karaoke requests per event)
    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('song', 'karaoke')),
        customer_name TEXT NOT NULL,
        song_id INTEGER,
        song_title TEXT,
        song_artist TEXT,
        song_genre TEXT,
        song_year TEXT,
        song_difficulty TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'played', 'rejected')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    -- Messages table (customer messages per event)
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        message TEXT NOT NULL,
        text_message TEXT,
        is_private INTEGER DEFAULT 0,
        has_media INTEGER DEFAULT 0,
        displayed INTEGER DEFAULT 0,
        is_reply INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    -- DJ Replies table
    CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        reply_message TEXT NOT NULL,
        original_type TEXT,
        original_id INTEGER,
        displayed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    -- Guest photos table (photos taken/uploaded by guests, attached to an event)
    CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        customer_name TEXT,
        filename TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        caption TEXT,
        is_hidden INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    -- Global app settings (key/value) for DJ-wide configuration
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
    CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active);
    CREATE INDEX IF NOT EXISTS idx_requests_event ON requests(event_id);
    CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
    CREATE INDEX IF NOT EXISTS idx_replies_event ON replies(event_id);
    CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
`);

// Migration: Add custom CSS columns if they don't exist
try {
    db.exec(`ALTER TABLE events ADD COLUMN heading_color TEXT DEFAULT '#007bff'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN text_color TEXT DEFAULT '#212529'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN bg_color TEXT DEFAULT '#ffffff'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN bg_image TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN accent_color TEXT DEFAULT '#0d6efd'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN custom_css TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN enable_song_requests INTEGER DEFAULT 1`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN enable_karaoke_requests INTEGER DEFAULT 1`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN enable_messages INTEGER DEFAULT 1`);
} catch (e) { /* Column already exists */ }

// Display config columns
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_show_qr INTEGER DEFAULT 1`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_qr_position TEXT DEFAULT 'top-right'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_qr_size INTEGER DEFAULT 120`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_qr_label TEXT DEFAULT 'Scan to Request Songs!'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_bg_color1 TEXT DEFAULT '#000428'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_bg_color2 TEXT DEFAULT '#004e92'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_bg_image TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_card_color TEXT DEFAULT '#ffffff'`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_card_opacity INTEGER DEFAULT 85`);
} catch (e) { /* Column already exists */ }

// Tipping columns
try {
    db.exec(`ALTER TABLE events ADD COLUMN enable_tips INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN tip_provider TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN tip_payment_link TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN tip_links TEXT`);
} catch (e) { /* Column already exists */ }

// Photo feature columns
try {
    db.exec(`ALTER TABLE events ADD COLUMN enable_photos INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
// Event logo shown on guest pages
try {
    db.exec(`ALTER TABLE events ADD COLUMN logo_image TEXT`);
} catch (e) { /* Column already exists */ }
// Per-event photo popup banner style (NULL = use global setting)
try {
    db.exec(`ALTER TABLE events ADD COLUMN photo_banner_style TEXT`);
} catch (e) { /* Column already exists */ }
try {
    // Secret token protecting the customer-facing gallery link (/gallery/:slug/:token)
    db.exec(`ALTER TABLE events ADD COLUMN share_token TEXT`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN show_tracks_played_guest INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN show_public INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_bg_slideshow_enabled INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE events ADD COLUMN display_bg_slideshow_seconds INTEGER DEFAULT 15`);
} catch (e) { /* Column already exists */ }

// Display screen background slideshow images (ordered per event)
db.exec(`
    CREATE TABLE IF NOT EXISTS event_display_slides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_display_slides_event ON event_display_slides(event_id, sort_order);
`);

// Tracks played per event (DJ log + optional guest-facing list)
db.exec(`
    CREATE TABLE IF NOT EXISTS tracks_played (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        source TEXT DEFAULT 'manual',
        played_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_played_event ON tracks_played(event_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_played_played_at ON tracks_played(played_at);
`);

// Event guests — check-in on landing page + DJ moderation (silence / ban)
db.exec(`
    CREATE TABLE IF NOT EXISTS event_guests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL COLLATE NOCASE,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'silenced', 'banned')),
        silenced_until TEXT,
        note TEXT,
        first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        UNIQUE(event_id, customer_name)
    );
    CREATE INDEX IF NOT EXISTS idx_event_guests_event ON event_guests(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_guests_status ON event_guests(event_id, status);
`);

// Backfill share tokens for existing events
{
    const missing = db.prepare(`SELECT id FROM events WHERE share_token IS NULL OR share_token = ''`).all();
    if (missing.length > 0) {
        const setToken = db.prepare(`UPDATE events SET share_token = ? WHERE id = ?`);
        for (const row of missing) {
            setToken.run(crypto.randomBytes(12).toString('hex'), row.id);
        }
    }
}

// ── Migration: requests/messages/replies are now the persistent store for the
// DJ dashboard. event_id must be optional (spinner picks, legacy pages and DJ
// replies aren't tied to an event), and a couple of columns are new. SQLite
// can't drop NOT NULL, so tables created with the old schema are rebuilt. ──
{
    function eventIdIsNotNull(table) {
        const col = db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === 'event_id');
        return !!col && col.notnull === 1;
    }

    const rebuild = db.transaction(() => {
        if (eventIdIsNotNull('requests')) {
            db.exec(`
                CREATE TABLE requests_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id INTEGER,
                    type TEXT NOT NULL CHECK(type IN ('song', 'karaoke')),
                    customer_name TEXT NOT NULL,
                    song_id INTEGER,
                    song_title TEXT,
                    song_artist TEXT,
                    song_genre TEXT,
                    song_year TEXT,
                    song_difficulty TEXT,
                    message TEXT,
                    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'played', 'rejected')),
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
                );
                INSERT INTO requests_new (id, event_id, type, customer_name, song_id, song_title, song_artist, song_genre, song_year, song_difficulty, message, status, created_at)
                    SELECT id, event_id, type, customer_name, song_id, song_title, song_artist, song_genre, song_year, song_difficulty, message, status, created_at FROM requests;
                DROP TABLE requests;
                ALTER TABLE requests_new RENAME TO requests;
                CREATE INDEX IF NOT EXISTS idx_requests_event ON requests(event_id);
            `);
        }
        if (eventIdIsNotNull('messages')) {
            db.exec(`
                CREATE TABLE messages_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id INTEGER,
                    customer_name TEXT NOT NULL,
                    message TEXT NOT NULL,
                    text_message TEXT,
                    type TEXT,
                    is_private INTEGER DEFAULT 0,
                    has_media INTEGER DEFAULT 0,
                    displayed INTEGER DEFAULT 0,
                    is_reply INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
                );
                INSERT INTO messages_new (id, event_id, customer_name, message, text_message, is_private, has_media, displayed, is_reply, created_at)
                    SELECT id, event_id, customer_name, message, text_message, is_private, has_media, displayed, is_reply, created_at FROM messages;
                DROP TABLE messages;
                ALTER TABLE messages_new RENAME TO messages;
                CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
            `);
        }
        if (eventIdIsNotNull('replies')) {
            db.exec(`
                CREATE TABLE replies_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id INTEGER,
                    customer_name TEXT NOT NULL,
                    reply_message TEXT NOT NULL,
                    original_type TEXT,
                    original_id INTEGER,
                    direct INTEGER DEFAULT 0,
                    displayed INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
                );
                INSERT INTO replies_new (id, event_id, customer_name, reply_message, original_type, original_id, displayed, created_at)
                    SELECT id, event_id, customer_name, reply_message, original_type, original_id, displayed, created_at FROM replies;
                DROP TABLE replies;
                ALTER TABLE replies_new RENAME TO replies;
                CREATE INDEX IF NOT EXISTS idx_replies_event ON replies(event_id);
            `);
        }
    });
    rebuild();

    // Belt and braces for databases created between versions
    try { db.exec(`ALTER TABLE messages ADD COLUMN type TEXT`); } catch (e) { /* exists */ }
    try { db.exec(`ALTER TABLE replies ADD COLUMN direct INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
}

// Generate a unique slug for events
function generateSlug(length = 8) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// Event functions
const eventDb = {
    // Create a new event
    create: function(name, description = '', venue = '', eventDate = null, options = {}) {
        let slug = generateSlug();
        // Ensure slug is unique
        while (this.getBySlug(slug)) {
            slug = generateSlug();
        }
        
        const {
            heading_color = null,
            text_color = null,
            bg_color = null,
            bg_image = null,
            accent_color = null,
            custom_css = null,
            logo_image = null,
            enable_song_requests = 1,
            enable_karaoke_requests = 1,
            enable_messages = 1,
            enable_tips = 0,
            enable_photos = 0,
            show_public = 0,
            tip_provider = null,
            tip_payment_link = null,
            tip_links = null
        } = options;
        
        const shareToken = crypto.randomBytes(12).toString('hex');
        const stmt = db.prepare(`
            INSERT INTO events (slug, name, description, venue, event_date, 
                heading_color, text_color, bg_color, bg_image, accent_color, custom_css, logo_image,
                enable_song_requests, enable_karaoke_requests, enable_messages,
                enable_tips, enable_photos, show_public, tip_provider, tip_payment_link, tip_links, share_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(slug, name, description, venue, eventDate,
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css, logo_image,
            enable_song_requests, enable_karaoke_requests, enable_messages,
            enable_tips, enable_photos, show_public ? 1 : 0, tip_provider, tip_payment_link, tip_links, shareToken);
        return { id: result.lastInsertRowid, slug };
    },

    // Get event by ID
    getById: function(id) {
        const stmt = db.prepare('SELECT * FROM events WHERE id = ?');
        return stmt.get(id);
    },

    // Get event by slug
    getBySlug: function(slug) {
        const stmt = db.prepare('SELECT * FROM events WHERE slug = ?');
        return stmt.get(slug);
    },

    // Get all events
    getAll: function() {
        const stmt = db.prepare('SELECT * FROM events ORDER BY created_at DESC');
        return stmt.all();
    },

    // Get active events
    getActive: function() {
        const stmt = db.prepare('SELECT * FROM events WHERE is_active = 1 ORDER BY created_at DESC');
        return stmt.all();
    },

    // Active events listed on the public events picker page
    getPublicListing: function() {
        const stmt = db.prepare(`
            SELECT id, slug, name, description, venue, event_date, logo_image, heading_color, accent_color
            FROM events
            WHERE is_active = 1 AND show_public = 1
            ORDER BY (event_date IS NULL OR event_date = ''), event_date DESC, name COLLATE NOCASE ASC
        `);
        return stmt.all();
    },

    // Update event
    update: function(id, updates) {
        const allowedFields = ['name', 'description', 'venue', 'event_date', 'is_active', 
                               'heading_color', 'text_color', 'bg_color', 'bg_image', 'accent_color', 'custom_css', 'logo_image',
                               'enable_song_requests', 'enable_karaoke_requests', 'enable_messages',
                               'enable_tips', 'enable_photos', 'tip_provider', 'tip_payment_link', 'tip_links',
                               'display_show_qr', 'display_qr_position', 'display_qr_size', 'display_qr_label',
                               'display_bg_color1', 'display_bg_color2', 'display_bg_image',
                               'display_bg_slideshow_enabled', 'display_bg_slideshow_seconds',
                               'display_card_color', 'display_card_opacity', 'photo_banner_style',
                               'show_tracks_played_guest', 'show_public'];
        const setClause = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                setClause.push(`${key} = ?`);
                values.push(value);
            }
        }
        
        if (setClause.length === 0) return false;
        
        setClause.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        
        const stmt = db.prepare(`UPDATE events SET ${setClause.join(', ')} WHERE id = ?`);
        return stmt.run(...values).changes > 0;
    },

    // Delete event
    delete: function(id) {
        const stmt = db.prepare('DELETE FROM events WHERE id = ?');
        return stmt.run(id).changes > 0;
    },

    // Get event statistics
    getStats: function(eventId) {
        const requestsStmt = db.prepare('SELECT COUNT(*) as count FROM requests WHERE event_id = ?');
        const messagesStmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE event_id = ?');
        const pendingStmt = db.prepare("SELECT COUNT(*) as count FROM requests WHERE event_id = ? AND status = 'pending'");
        const photosStmt = db.prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND is_hidden = 0');
        
        return {
            totalRequests: requestsStmt.get(eventId).count,
            totalMessages: messagesStmt.get(eventId).count,
            pendingRequests: pendingStmt.get(eventId).count,
            totalPhotos: photosStmt.get(eventId).count
        };
    },

    // Rotate the customer gallery share token (invalidates old links)
    regenerateShareToken: function(id) {
        const token = crypto.randomBytes(12).toString('hex');
        const stmt = db.prepare('UPDATE events SET share_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(token, id).changes > 0 ? token : null;
    }
};

// Request functions
const requestDb = {
    // Persist a dashboard request object (shape used by server.js in-memory list)
    add: function(r) {
        const stmt = db.prepare(`
            INSERT INTO requests (event_id, type, customer_name, song_id, song_title, song_artist, song_genre, song_year, song_difficulty, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            r.eventId || null,
            r.type,
            r.customerName || '',
            r.song?.id ?? null,
            r.song?.title || '',
            r.song?.artist || '',
            r.song?.genre || '',
            r.song?.year || '',
            r.song?.difficulty || '',
            r.message || '',
            r.status || 'pending',
            r.timestamp || new Date().toISOString()
        );
        return result.lastInsertRowid;
    },

    // Load every stored request in the in-memory dashboard shape (oldest first)
    getAllLive: function() {
        const rows = db.prepare(`
            SELECT r.*, e.slug AS event_slug, e.name AS event_name
            FROM requests r LEFT JOIN events e ON e.id = r.event_id
            ORDER BY r.created_at ASC, r.id ASC
        `).all();
        return rows.map(row => ({
            id: row.id,
            type: row.type,
            customerName: row.customer_name,
            song: {
                id: row.song_id,
                title: row.song_title,
                artist: row.song_artist,
                genre: row.song_genre,
                year: row.song_year,
                difficulty: row.song_difficulty
            },
            message: row.message,
            timestamp: row.created_at,
            status: row.status,
            eventId: row.event_id,
            eventSlug: row.event_slug || null,
            eventName: row.event_name || null
        }));
    },

    // Create a new request
    create: function(eventId, type, customerName, song, message = '') {
        const stmt = db.prepare(`
            INSERT INTO requests (event_id, type, customer_name, song_id, song_title, song_artist, song_genre, song_year, song_difficulty, message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            eventId,
            type,
            customerName,
            song?.id || null,
            song?.title || '',
            song?.artist || '',
            song?.genre || '',
            song?.year || '',
            song?.difficulty || '',
            message
        );
        return result.lastInsertRowid;
    },

    // Get requests by event
    getByEvent: function(eventId) {
        const stmt = db.prepare('SELECT * FROM requests WHERE event_id = ? ORDER BY created_at DESC');
        const rows = stmt.all(eventId);
        // Transform to match the existing format
        return rows.map(row => ({
            id: row.id,
            type: row.type,
            customerName: row.customer_name,
            song: {
                id: row.song_id,
                title: row.song_title,
                artist: row.song_artist,
                genre: row.song_genre,
                year: row.song_year,
                difficulty: row.song_difficulty
            },
            message: row.message,
            timestamp: row.created_at,
            status: row.status
        }));
    },

    // Update request status
    updateStatus: function(id, status) {
        const stmt = db.prepare('UPDATE requests SET status = ? WHERE id = ?');
        return stmt.run(status, id).changes > 0;
    },

    // Delete request
    delete: function(id) {
        const stmt = db.prepare('DELETE FROM requests WHERE id = ?');
        return stmt.run(id).changes > 0;
    },

    // Delete all requests for an event
    deleteByEvent: function(eventId) {
        const stmt = db.prepare('DELETE FROM requests WHERE event_id = ?');
        return stmt.run(eventId).changes;
    }
};

// Message functions
const messageDb = {
    // Persist a dashboard/display message object (shape used by server.js in-memory list)
    add: function(m) {
        const stmt = db.prepare(`
            INSERT INTO messages (event_id, customer_name, message, text_message, type, is_private, has_media, displayed, is_reply, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            m.eventId || null,
            m.customerName || '',
            m.message || '',
            m.textMessage || null,
            m.type || null,
            m.private ? 1 : 0,
            m.hasMedia ? 1 : 0,
            m.displayed ? 1 : 0,
            m.isReply ? 1 : 0,
            m.timestamp || new Date().toISOString()
        );
        return result.lastInsertRowid;
    },

    // Load every stored message in the in-memory dashboard shape (oldest first)
    getAllLive: function() {
        const rows = db.prepare(`
            SELECT m.*, e.slug AS event_slug, e.name AS event_name
            FROM messages m LEFT JOIN events e ON e.id = m.event_id
            ORDER BY m.created_at ASC, m.id ASC
        `).all();
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            message: row.message,
            textMessage: row.text_message,
            type: row.type || undefined,
            private: row.is_private === 1,
            hasMedia: row.has_media === 1,
            displayed: row.displayed === 1,
            isReply: row.is_reply === 1,
            timestamp: row.created_at,
            eventId: row.event_id,
            eventSlug: row.event_slug || null,
            eventName: row.event_name || null
        }));
    },

    // Create a new message
    create: function(eventId, customerName, message, textMessage = '', isPrivate = false, hasMedia = false, isReply = false) {
        const stmt = db.prepare(`
            INSERT INTO messages (event_id, customer_name, message, text_message, is_private, has_media, is_reply)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(eventId, customerName, message, textMessage, isPrivate ? 1 : 0, hasMedia ? 1 : 0, isReply ? 1 : 0);
        return result.lastInsertRowid;
    },

    // Get messages by event
    getByEvent: function(eventId, includePrivate = true) {
        let sql = 'SELECT * FROM messages WHERE event_id = ?';
        if (!includePrivate) {
            sql += ' AND is_private = 0';
        }
        sql += ' ORDER BY created_at DESC';
        
        const stmt = db.prepare(sql);
        const rows = stmt.all(eventId);
        
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            message: row.message,
            textMessage: row.text_message,
            private: row.is_private === 1,
            hasMedia: row.has_media === 1,
            displayed: row.displayed === 1,
            isReply: row.is_reply === 1,
            timestamp: row.created_at
        }));
    },

    // Get pending messages (not displayed)
    getPending: function(eventId, includePrivate = false) {
        let sql = 'SELECT * FROM messages WHERE event_id = ? AND displayed = 0';
        if (!includePrivate) {
            sql += ' AND is_private = 0';
        }
        sql += ' ORDER BY created_at ASC';
        
        const stmt = db.prepare(sql);
        const rows = stmt.all(eventId);
        
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            message: row.message,
            textMessage: row.text_message,
            private: row.is_private === 1,
            hasMedia: row.has_media === 1,
            displayed: row.displayed === 1,
            isReply: row.is_reply === 1,
            timestamp: row.created_at
        }));
    },

    // Mark message as displayed
    markDisplayed: function(id) {
        const stmt = db.prepare('UPDATE messages SET displayed = 1 WHERE id = ?');
        return stmt.run(id).changes > 0;
    },

    // Mark all messages as displayed for an event
    markAllDisplayed: function(eventId) {
        const stmt = db.prepare('UPDATE messages SET displayed = 1 WHERE event_id = ?');
        return stmt.run(eventId).changes;
    },

    // Delete message
    delete: function(id) {
        const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
        return stmt.run(id).changes > 0;
    }
};

// Reply functions
const replyDb = {
    // Persist a DJ reply object (shape used by server.js in-memory list)
    add: function(r) {
        const stmt = db.prepare(`
            INSERT INTO replies (event_id, customer_name, reply_message, original_type, original_id, direct, displayed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            r.eventId || null,
            r.customerName || '',
            r.replyMessage || '',
            r.originalType || 'request',
            r.originalId ?? null,
            r.direct ? 1 : 0,
            r.displayed ? 1 : 0,
            r.timestamp || new Date().toISOString()
        );
        return result.lastInsertRowid;
    },

    // Load every stored reply in the in-memory shape (oldest first)
    getAllLive: function() {
        const rows = db.prepare('SELECT * FROM replies ORDER BY created_at ASC, id ASC').all();
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            replyMessage: row.reply_message,
            originalType: row.original_type,
            originalId: row.original_id,
            direct: row.direct === 1,
            displayed: row.displayed === 1,
            timestamp: row.created_at
        }));
    },

    // Create a new reply
    create: function(eventId, customerName, replyMessage, originalType = 'request', originalId = null) {
        const stmt = db.prepare(`
            INSERT INTO replies (event_id, customer_name, reply_message, original_type, original_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(eventId, customerName, replyMessage, originalType, originalId);
        return result.lastInsertRowid;
    },

    // Get replies by event
    getByEvent: function(eventId) {
        const stmt = db.prepare('SELECT * FROM replies WHERE event_id = ? ORDER BY created_at DESC');
        const rows = stmt.all(eventId);
        
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            replyMessage: row.reply_message,
            originalType: row.original_type,
            originalId: row.original_id,
            displayed: row.displayed === 1,
            timestamp: row.created_at
        }));
    },

    // Get replies for a customer
    getByCustomer: function(eventId, customerName) {
        const stmt = db.prepare(`
            SELECT * FROM replies 
            WHERE event_id = ? AND LOWER(customer_name) = LOWER(?)
            ORDER BY created_at DESC
        `);
        const rows = stmt.all(eventId, customerName);
        
        return rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            replyMessage: row.reply_message,
            originalType: row.original_type,
            originalId: row.original_id,
            displayed: row.displayed === 1,
            timestamp: row.created_at
        }));
    },

    // Mark reply as displayed
    markDisplayed: function(id) {
        const stmt = db.prepare('UPDATE replies SET displayed = 1 WHERE id = ?');
        return stmt.run(id).changes > 0;
    }
};

// Photo functions
const photoDb = {
    create: function(eventId, { customerName = null, filename, originalName = null, mimeType = null, sizeBytes = null, caption = null }) {
        const stmt = db.prepare(`
            INSERT INTO photos (event_id, customer_name, filename, original_name, mime_type, size_bytes, caption)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(eventId, customerName, filename, originalName, mimeType, sizeBytes, caption);
        return result.lastInsertRowid;
    },

    getById: function(id) {
        return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    },

    // includeHidden=true for the DJ view; guests/customers only see visible photos
    getByEvent: function(eventId, includeHidden = false) {
        let sql = 'SELECT * FROM photos WHERE event_id = ?';
        if (!includeHidden) sql += ' AND is_hidden = 0';
        sql += ' ORDER BY created_at DESC';
        return db.prepare(sql).all(eventId);
    },

    countByEvent: function(eventId, includeHidden = false) {
        let sql = 'SELECT COUNT(*) as count FROM photos WHERE event_id = ?';
        if (!includeHidden) sql += ' AND is_hidden = 0';
        return db.prepare(sql).get(eventId).count;
    },

    setHidden: function(id, hidden) {
        const stmt = db.prepare('UPDATE photos SET is_hidden = ? WHERE id = ?');
        return stmt.run(hidden ? 1 : 0, id).changes > 0;
    },

    delete: function(id) {
        return db.prepare('DELETE FROM photos WHERE id = ?').run(id).changes > 0;
    },

    deleteByEvent: function(eventId) {
        return db.prepare('DELETE FROM photos WHERE event_id = ?').run(eventId).changes;
    }
};

// Tracks played functions
const trackDb = {
    add: function(eventId, { title, artist = null, album = null, source = 'manual', playedAt = null }) {
        const stmt = db.prepare(`
            INSERT INTO tracks_played (event_id, title, artist, album, source, played_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            eventId,
            title,
            artist || null,
            album || null,
            source || 'manual',
            playedAt || new Date().toISOString()
        );
        return result.lastInsertRowid;
    },

    getById: function(id) {
        return db.prepare('SELECT * FROM tracks_played WHERE id = ?').get(id);
    },

    getLatest: function(eventId) {
        const row = db.prepare(`
            SELECT * FROM tracks_played WHERE event_id = ?
            ORDER BY played_at DESC, id DESC LIMIT 1
        `).get(eventId);
        return row ? trackDb._toJson(row) : null;
    },

    getByEvent: function(eventId, limit = 100) {
        const rows = db.prepare(`
            SELECT t.*, e.name AS event_name
            FROM tracks_played t
            LEFT JOIN events e ON e.id = t.event_id
            WHERE t.event_id = ?
            ORDER BY t.played_at DESC, t.id DESC
            LIMIT ?
        `).all(eventId, limit);
        return rows.map(trackDb._toJson);
    },

    getAllLive: function(limit = 200) {
        const rows = db.prepare(`
            SELECT t.*, e.name AS event_name, e.slug AS event_slug
            FROM tracks_played t
            LEFT JOIN events e ON e.id = t.event_id
            ORDER BY t.played_at DESC, t.id DESC
            LIMIT ?
        `).all(limit);
        return rows.map(trackDb._toJson);
    },

    delete: function(id) {
        return db.prepare('DELETE FROM tracks_played WHERE id = ?').run(id).changes > 0;
    },

    deleteByEvent: function(eventId) {
        return db.prepare('DELETE FROM tracks_played WHERE event_id = ?').run(eventId).changes;
    },

    _toJson: function(row) {
        return {
            id: row.id,
            eventId: row.event_id,
            eventName: row.event_name || null,
            eventSlug: row.event_slug || null,
            title: row.title,
            artist: row.artist,
            album: row.album,
            source: row.source,
            playedAt: row.played_at
        };
    }
};

function normalizeGuestName(name) {
    return (name || '').toString().trim().slice(0, 50);
}

// Event guest check-in and moderation
const guestDb = {
    checkIn: function(eventId, customerName) {
        const name = normalizeGuestName(customerName);
        if (!name || !eventId) return null;
        const now = new Date().toISOString();
        const stmt = db.prepare(`
            INSERT INTO event_guests (event_id, customer_name, status, first_seen_at, last_seen_at)
            VALUES (?, ?, 'active', ?, ?)
            ON CONFLICT(event_id, customer_name) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                customer_name = CASE
                    WHEN length(event_guests.customer_name) >= length(excluded.customer_name)
                    THEN event_guests.customer_name
                    ELSE excluded.customer_name
                END
        `);
        stmt.run(eventId, name, now, now);
        return this.getByName(eventId, name);
    },

    syncFromActivity: function(eventId) {
        const rows = db.prepare(`
            SELECT customer_name, MIN(ts) AS first_seen, MAX(ts) AS last_seen
            FROM (
                SELECT TRIM(customer_name) AS customer_name, created_at AS ts
                FROM requests WHERE event_id = ? AND TRIM(customer_name) != ''
                UNION ALL
                SELECT TRIM(customer_name), created_at FROM messages WHERE event_id = ? AND TRIM(customer_name) != ''
                UNION ALL
                SELECT TRIM(customer_name), created_at FROM photos
                WHERE event_id = ? AND customer_name IS NOT NULL AND TRIM(customer_name) != ''
            )
            GROUP BY LOWER(customer_name)
        `).all(eventId, eventId, eventId);

        const upsert = db.prepare(`
            INSERT INTO event_guests (event_id, customer_name, status, first_seen_at, last_seen_at)
            VALUES (?, ?, 'active', ?, ?)
            ON CONFLICT(event_id, customer_name) DO UPDATE SET
                first_seen_at = CASE
                    WHEN excluded.first_seen_at < event_guests.first_seen_at THEN excluded.first_seen_at
                    ELSE event_guests.first_seen_at
                END,
                last_seen_at = CASE
                    WHEN excluded.last_seen_at > event_guests.last_seen_at THEN excluded.last_seen_at
                    ELSE event_guests.last_seen_at
                END
        `);
        for (const row of rows) {
            upsert.run(eventId, row.customer_name, row.first_seen, row.last_seen);
        }
    },

    getByName: function(eventId, customerName) {
        const name = normalizeGuestName(customerName);
        if (!name) return null;
        return db.prepare(`
            SELECT * FROM event_guests WHERE event_id = ? AND customer_name = ? COLLATE NOCASE
        `).get(eventId, name);
    },

    _resolveStatus: function(row) {
        if (!row) return { status: 'active', silencedUntil: null };
        if (row.status === 'silenced' && row.silenced_until) {
            if (new Date(row.silenced_until) <= new Date()) {
                db.prepare(`
                    UPDATE event_guests SET status = 'active', silenced_until = NULL WHERE id = ?
                `).run(row.id);
                return { status: 'active', silencedUntil: null };
            }
        }
        return { status: row.status, silencedUntil: row.silenced_until };
    },

    getModerationStatus: function(eventId, customerName) {
        const name = normalizeGuestName(customerName);
        if (!name || !eventId) return { allowed: true };
        const row = this.getByName(eventId, name);
        if (!row) return { allowed: true };
        const resolved = this._resolveStatus(row);
        if (resolved.status === 'banned') {
            return { allowed: false, reason: 'banned' };
        }
        if (resolved.status === 'silenced') {
            return { allowed: false, reason: 'silenced', until: resolved.silencedUntil };
        }
        return { allowed: true };
    },

    getByEvent: function(eventId) {
        this.syncFromActivity(eventId);

        const guests = db.prepare(`
            SELECT * FROM event_guests WHERE event_id = ? ORDER BY last_seen_at DESC
        `).all(eventId);

        const countRequests = db.prepare(`
            SELECT LOWER(TRIM(customer_name)) AS key, COUNT(*) AS n
            FROM requests WHERE event_id = ? GROUP BY LOWER(TRIM(customer_name))
        `).all(eventId);
        const countMessages = db.prepare(`
            SELECT LOWER(TRIM(customer_name)) AS key, COUNT(*) AS n
            FROM messages WHERE event_id = ? AND (is_reply IS NULL OR is_reply = 0) GROUP BY LOWER(TRIM(customer_name))
        `).all(eventId);
        const countPhotos = db.prepare(`
            SELECT LOWER(TRIM(customer_name)) AS key, COUNT(*) AS n
            FROM photos WHERE event_id = ? AND customer_name IS NOT NULL GROUP BY LOWER(TRIM(customer_name))
        `).all(eventId);

        const toMap = (rows) => {
            const m = {};
            for (const r of rows) m[r.key] = r.n;
            return m;
        };
        const reqMap = toMap(countRequests);
        const msgMap = toMap(countMessages);
        const photoMap = toMap(countPhotos);

        return guests.map((row) => {
            const resolved = this._resolveStatus(row);
            const key = row.customer_name.toLowerCase();
            return {
                id: row.id,
                eventId: row.event_id,
                customerName: row.customer_name,
                status: resolved.status,
                silencedUntil: resolved.silencedUntil,
                note: row.note,
                firstSeenAt: row.first_seen_at,
                lastSeenAt: row.last_seen_at,
                requestCount: reqMap[key] || 0,
                messageCount: msgMap[key] || 0,
                photoCount: photoMap[key] || 0
            };
        });
    },

    setSilenced: function(eventId, customerName, durationMinutes, note = null) {
        const name = normalizeGuestName(customerName);
        if (!name) return null;
        this.checkIn(eventId, name);
        const until = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        db.prepare(`
            UPDATE event_guests
            SET status = 'silenced', silenced_until = ?, note = COALESCE(?, note)
            WHERE event_id = ? AND customer_name = ? COLLATE NOCASE
        `).run(until, note, eventId, name);
        return this.getByName(eventId, name);
    },

    setBanned: function(eventId, customerName, note = null) {
        const name = normalizeGuestName(customerName);
        if (!name) return null;
        this.checkIn(eventId, name);
        db.prepare(`
            UPDATE event_guests
            SET status = 'banned', silenced_until = NULL, note = COALESCE(?, note)
            WHERE event_id = ? AND customer_name = ? COLLATE NOCASE
        `).run(note, eventId, name);
        return this.getByName(eventId, name);
    },

    setActive: function(eventId, customerName) {
        const name = normalizeGuestName(customerName);
        if (!name) return null;
        db.prepare(`
            UPDATE event_guests
            SET status = 'active', silenced_until = NULL, note = NULL
            WHERE event_id = ? AND customer_name = ? COLLATE NOCASE
        `).run(eventId, name);
        return this.getByName(eventId, name);
    }
};

// Display screen background slideshow slides
const slideshowDb = {
    _toJson: function(row) {
        return {
            id: row.id,
            eventId: row.event_id,
            imageUrl: row.image_url,
            sortOrder: row.sort_order,
            createdAt: row.created_at
        };
    },

    getById: function(id) {
        const row = db.prepare('SELECT * FROM event_display_slides WHERE id = ?').get(id);
        return row ? this._toJson(row) : null;
    },

    getByEvent: function(eventId) {
        const rows = db.prepare(`
            SELECT * FROM event_display_slides
            WHERE event_id = ?
            ORDER BY sort_order ASC, id ASC
        `).all(eventId);
        return rows.map((row) => this._toJson(row));
    },

    add: function(eventId, imageUrl) {
        const maxRow = db.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) AS max_order
            FROM event_display_slides WHERE event_id = ?
        `).get(eventId);
        const sortOrder = (maxRow?.max_order ?? -1) + 1;
        const result = db.prepare(`
            INSERT INTO event_display_slides (event_id, image_url, sort_order)
            VALUES (?, ?, ?)
        `).run(eventId, imageUrl, sortOrder);
        return this.getById(result.lastInsertRowid);
    },

    reorder: function(eventId, orderedIds) {
        const ids = Array.isArray(orderedIds) ? orderedIds.map((id) => parseInt(id, 10)).filter(Number.isFinite) : [];
        const reorderTxn = db.transaction((slideIds) => {
            slideIds.forEach((id, index) => {
                db.prepare(`
                    UPDATE event_display_slides SET sort_order = ?
                    WHERE id = ? AND event_id = ?
                `).run(index, id, eventId);
            });
        });
        reorderTxn(ids);
        return this.getByEvent(eventId);
    },

    delete: function(id, eventId) {
        const row = db.prepare('SELECT image_url FROM event_display_slides WHERE id = ? AND event_id = ?').get(id, eventId);
        if (!row) return null;
        const changes = db.prepare('DELETE FROM event_display_slides WHERE id = ? AND event_id = ?').run(id, eventId).changes;
        return changes > 0 ? row.image_url : null;
    }
};

// Global settings (key/value store with JSON values)
const settingsDb = {
    get: function(key, fallback = null) {
        const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
        if (!row || row.value == null) return fallback;
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    },

    set: function(key, value) {
        const stmt = db.prepare(`
            INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(key, JSON.stringify(value));
    },

    getAll: function() {
        const rows = db.prepare('SELECT key, value FROM app_settings').all();
        const out = {};
        for (const row of rows) {
            try {
                out[row.key] = JSON.parse(row.value);
            } catch {
                out[row.key] = row.value;
            }
        }
        return out;
    }
};

// Create a default event if none exists
function ensureDefaultEvent() {
    const events = eventDb.getAll();
    if (events.length === 0) {
        const result = eventDb.create('Default Event', 'Default event for backwards compatibility', '', null);
        console.log(`Created default event with slug: ${result.slug}`);
        return result;
    }
    return null;
}

module.exports = {
    db,
    eventDb,
    requestDb,
    messageDb,
    replyDb,
    photoDb,
    trackDb,
    guestDb,
    slideshowDb,
    settingsDb,
    ensureDefaultEvent,
    generateSlug
};
