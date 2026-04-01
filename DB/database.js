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

    -- Create indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
    CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active);
    CREATE INDEX IF NOT EXISTS idx_requests_event ON requests(event_id);
    CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
    CREATE INDEX IF NOT EXISTS idx_replies_event ON replies(event_id);
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
            enable_song_requests = 1,
            enable_karaoke_requests = 1,
            enable_messages = 1,
            enable_tips = 0,
            tip_provider = null,
            tip_payment_link = null,
            tip_links = null
        } = options;
        
        const stmt = db.prepare(`
            INSERT INTO events (slug, name, description, venue, event_date, 
                heading_color, text_color, bg_color, bg_image, accent_color, custom_css,
                enable_song_requests, enable_karaoke_requests, enable_messages,
                enable_tips, tip_provider, tip_payment_link, tip_links)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(slug, name, description, venue, eventDate,
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css,
            enable_song_requests, enable_karaoke_requests, enable_messages,
            enable_tips, tip_provider, tip_payment_link, tip_links);
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

    // Update event
    update: function(id, updates) {
        const allowedFields = ['name', 'description', 'venue', 'event_date', 'is_active', 
                               'heading_color', 'text_color', 'bg_color', 'bg_image', 'accent_color', 'custom_css',
                               'enable_song_requests', 'enable_karaoke_requests', 'enable_messages',
                               'enable_tips', 'tip_provider', 'tip_payment_link', 'tip_links',
                               'display_show_qr', 'display_qr_position', 'display_qr_size', 'display_qr_label',
                               'display_bg_color1', 'display_bg_color2', 'display_bg_image',
                               'display_card_color', 'display_card_opacity'];
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
        
        return {
            totalRequests: requestsStmt.get(eventId).count,
            totalMessages: messagesStmt.get(eventId).count,
            pendingRequests: pendingStmt.get(eventId).count
        };
    }
};

// Request functions
const requestDb = {
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
    ensureDefaultEvent,
    generateSlug
};
