const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const cors = require('cors');
const { eventDb, requestDb, messageDb, replyDb, ensureDefaultEvent } = require('./db/database');
const portalRouter = require('./portal/router');
const app = express();

const portalCorsOrigins = (process.env.PORTAL_CORS_ORIGINS ||
    'https://eyupevents.uk,https://www.eyupevents.uk,https://requests.eyupevents.uk'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const PORT = process.env.PORT || 3000;

// Initialize DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// EYUP events portal JSON API (separate SQLite DB — does not touch song-request tables)
app.use(
    '/api/v1',
    cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true);
            if (portalCorsOrigins.includes(origin)) return cb(null, true);
            cb(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Portal-Internal-Key']
    }),
    portalRouter
);

// Global variables to store catalogues
let songCatalogue = [];
let karaokeCatalogue = [];

// Legacy in-memory storage (kept for backwards compatibility during transition)
let djRequests = [];
let djMessages = [];
let djReplies = [];

// Current playing track state (for DMX controller integration)
// Keyed by eventId or 'global' for non-event-specific tracks
let nowPlayingMap = {};

// Helper middleware to get event from slug
function getEventFromSlug(req, res, next) {
    const slug = req.params.eventSlug;
    if (!slug) {
        return next();
    }
    
    const event = eventDb.getBySlug(slug);
    if (!event) {
        return res.status(404).render('error', { 
            error: 'Event not found', 
            customerName: '',
            eventSlug: null
        });
    }
    
    if (!event.is_active) {
        return res.status(403).render('error', { 
            error: 'This event is no longer active', 
            customerName: '',
            eventSlug: slug
        });
    }
    
    req.event = event;
    next();
}

// Storage for karaoke spinner
let karaokeSpinState = {
    shouldSpin: false,
    selectedSong: null,
    timestamp: null
};

// Function to load songs from VirtualDJ XML database
async function loadSongsFromXML() {
    try {
        const xmlPath = path.join(__dirname, 'db', 'Song_Database.xml');
        if (!fs.existsSync(xmlPath)) {
            console.warn('Song_Database.xml not found, using sample data');
            songCatalogue = getSampleSongs();
            return;
        }

        const xmlData = fs.readFileSync(xmlPath, 'utf8');
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlData);
        
        songCatalogue = [];
        let id = 1;

        if (result.VirtualDJ_Database && result.VirtualDJ_Database.Song) {
            result.VirtualDJ_Database.Song.forEach(song => {
                if (song.Tags && song.Tags[0]) {
                    const tags = song.Tags[0].$;
                    if (tags.Title && tags.Author) {
                        songCatalogue.push({
                            id: id++,
                            title: tags.Title,
                            artist: tags.Author,
                            genre: tags.Album || 'Unknown',
                            year: tags.Year || 'Unknown'
                        });
                    }
                }
            });
        }

        console.log(`Loaded ${songCatalogue.length} songs from XML database`);
    } catch (error) {
        console.error('Error loading songs from XML:', error);
        songCatalogue = getSampleSongs();
    }
}

// Function to load karaoke from CSV file
async function loadKaraokeFromCSV() {
    try {
        const csvPath = path.join(__dirname, 'db', 'VirtualDJ_Karaoke_Catalog_2025-12-29.csv');
        if (!fs.existsSync(csvPath)) {
            console.warn('Karaoke CSV not found, using sample data');
            karaokeCatalogue = getSampleKaraoke();
            return;
        }

        karaokeCatalogue = [];
        let id = 1;

        return new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    // Map CSV columns to our format
                    const title = row.Title || row.title;
                    const artist = row.Artist || row.artist;
                    const genre = row.Genre || row.genre || '';
                    
                    // Assign difficulty based on genre or randomly if no genre
                    let difficulty = 'Medium';
                    if (genre) {
                        if (genre.toLowerCase().includes('pop') || genre.toLowerCase().includes('rnb')) {
                            difficulty = 'Easy';
                        } else if (genre.toLowerCase().includes('rock') || genre.toLowerCase().includes('metal')) {
                            difficulty = 'Hard';
                        }
                    } else {
                        // Random difficulty for songs without genre
                        const difficulties = ['Easy', 'Medium', 'Hard'];
                        difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
                    }
                    
                    if (title && artist) {
                        karaokeCatalogue.push({
                            id: id++,
                            title: title.trim(),
                            artist: artist.trim(),
                            difficulty: difficulty,
                            genre: genre.trim()
                        });
                    }
                })
                .on('end', () => {
                    console.log(`Loaded ${karaokeCatalogue.length} karaoke songs from CSV`);
                    resolve();
                })
                .on('error', (error) => {
                    console.error('Error loading karaoke from CSV:', error);
                    karaokeCatalogue = getSampleKaraoke();
                    resolve();
                });
        });
    } catch (error) {
        console.error('Error loading karaoke from CSV:', error);
        karaokeCatalogue = getSampleKaraoke();
    }
}

// Sample data functions (fallback)
function getSampleSongs() {
    return [
        { id: 1, title: "Shape of You", artist: "Ed Sheeran", genre: "Pop", year: "2017" },
        { id: 2, title: "Bohemian Rhapsody", artist: "Queen", genre: "Rock", year: "1975" },
        { id: 3, title: "Billie Jean", artist: "Michael Jackson", genre: "Pop", year: "1983" },
        { id: 4, title: "Hotel California", artist: "Eagles", genre: "Rock", year: "1976" },
        { id: 5, title: "Sweet Caroline", artist: "Neil Diamond", genre: "Classic Rock", year: "1969" },
        { id: 6, title: "Dancing Queen", artist: "ABBA", genre: "Disco", year: "1976" },
        { id: 7, title: "Hey Jude", artist: "The Beatles", genre: "Rock", year: "1968" },
        { id: 8, title: "Imagine", artist: "John Lennon", genre: "Classic Rock", year: "1971" }
    ];
}

function getSampleKaraoke() {
    return [
        { id: 1, title: "I Will Survive", artist: "Gloria Gaynor", difficulty: "Easy" },
        { id: 2, title: "Sweet Child O' Mine", artist: "Guns N' Roses", difficulty: "Hard" },
        { id: 3, title: "Don't Stop Believin'", artist: "Journey", difficulty: "Medium" },
        { id: 4, title: "Livin' on a Prayer", artist: "Bon Jovi", difficulty: "Medium" },
        { id: 5, title: "My Way", artist: "Frank Sinatra", difficulty: "Easy" },
        { id: 6, title: "Wonderwall", artist: "Oasis", difficulty: "Easy" },
        { id: 7, title: "We Are the Champions", artist: "Queen", difficulty: "Medium" },
        { id: 8, title: "Summer of '69", artist: "Bryan Adams", difficulty: "Easy" }
    ];
}

// Initialize catalogues on startup
async function initializeCatalogues() {
    console.log('Loading song and karaoke catalogues...');
    await loadSongsFromXML();
    await loadKaraokeFromCSV();
    console.log('Catalogues loaded successfully');
}

// Function to send data to VirtualDJ
async function sendToVirtualDJ(name, messageText) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            'name': name,
            'message': messageText
        });

        const options = {
            hostname: 'virtualdj.com',
            path: '/ask/HawaiianNight',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'MobileDJay/1.0'
            },
            timeout: 10000 // 10 second timeout
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                // Handle redirects (302, 301, etc.)
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    const redirectUrl = res.headers.location;
                    console.log(`VirtualDJ redirected to: ${redirectUrl}`);
                    
                    if (redirectUrl) {
                        // Follow the redirect
                        followRedirect(redirectUrl, postData, resolve, reject);
                    } else {
                        console.log('VirtualDJ redirect successful (no location header)');
                        resolve(data);
                    }
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('Successfully sent to VirtualDJ:', { name, messageText });
                    resolve(data);
                } else {
                    console.error('VirtualDJ responded with status:', res.statusCode);
                    console.error('Response data:', data);
                    reject(new Error(`VirtualDJ request failed with status: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error sending to VirtualDJ:', error);
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to VirtualDJ timed out'));
        });

        req.write(postData);
        req.end();
    });
}

// Helper function to follow redirects
function followRedirect(redirectUrl, postData, resolve, reject) {
    const url = require('url');
    let parsedUrl;
    
    // Handle relative URLs by making them absolute to virtualdj.com
    if (redirectUrl.startsWith('/')) {
        parsedUrl = {
            protocol: 'https:',
            hostname: 'virtualdj.com',
            path: redirectUrl
        };
    } else {
        parsedUrl = url.parse(redirectUrl);
    }
    
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'MobileDJay/1.0'
        },
        timeout: 10000
    };

    const protocol = parsedUrl.protocol === 'https:' ? https : require('http');
    
    const req = protocol.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('Successfully sent to VirtualDJ after redirect');
                resolve(data);
            } else if (res.statusCode >= 300 && res.statusCode < 400) {
                // Handle multiple redirects if necessary
                const nextRedirectUrl = res.headers.location;
                if (nextRedirectUrl) {
                    followRedirect(nextRedirectUrl, postData, resolve, reject);
                } else {
                    console.log('VirtualDJ redirect chain completed');
                    resolve(data);
                }
            } else {
                console.error('VirtualDJ redirect failed with status:', res.statusCode);
                console.error('Redirect response data:', data);
                reject(new Error(`VirtualDJ redirect failed with status: ${res.statusCode}`));
            }
        });
    });

    req.on('error', (error) => {
        console.error('Error following VirtualDJ redirect:', error);
        reject(error);
    });

    req.on('timeout', () => {
        req.destroy();
        reject(new Error('VirtualDJ redirect request timed out'));
    });

    req.write(postData);
    req.end();
}

// Routes
// ==================== Event Management API ====================

// Get all events (for DJ dashboard)
app.get('/api/events', (req, res) => {
    const events = eventDb.getAll();
    // Add stats to each event
    const eventsWithStats = events.map(event => ({
        ...event,
        stats: eventDb.getStats(event.id)
    }));
    res.json(eventsWithStats);
});

// Create a new event
app.post('/api/events', (req, res) => {
    const { name, description, venue, eventDate, 
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css,
            enable_song_requests, enable_karaoke_requests, enable_messages,
            enable_tips, tip_provider, tip_payment_link, tip_links } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Event name is required' });
    }
    
    try {
        const eventOptions = { 
            heading_color, text_color, bg_color, bg_image, accent_color, custom_css,
            enable_song_requests: enable_song_requests !== undefined ? (enable_song_requests ? 1 : 0) : 1,
            enable_karaoke_requests: enable_karaoke_requests !== undefined ? (enable_karaoke_requests ? 1 : 0) : 1,
            enable_messages: enable_messages !== undefined ? (enable_messages ? 1 : 0) : 1,
            enable_tips: enable_tips ? 1 : 0,
            tip_provider: tip_provider || null,
            tip_payment_link: tip_payment_link || null,
            tip_links: tip_links ? (typeof tip_links === 'string' ? tip_links : JSON.stringify(tip_links)) : null
        };
        const result = eventDb.create(name, description, venue, eventDate, eventOptions);
        const event = eventDb.getById(result.id);
        res.json({ success: true, event });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// Update an event
app.put('/api/events/:id', (req, res) => {
    const eventId = parseInt(req.params.id);
    const updates = req.body;
    
    // Serialize tip_links array to JSON string for storage
    if (updates.tip_links && typeof updates.tip_links !== 'string') {
        updates.tip_links = JSON.stringify(updates.tip_links);
    }
    
    try {
        const success = eventDb.update(eventId, updates);
        if (success) {
            const event = eventDb.getById(eventId);
            res.json({ success: true, event });
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// Cancel event — closes customer-facing request pages (sets is_active = 0). Does not delete data.
app.post('/api/events/:id/cancel', (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    try {
        const existing = eventDb.getById(eventId);
        if (!existing) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const success = eventDb.update(eventId, { is_active: 0 });
        if (!success) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const event = eventDb.getById(eventId);
        res.json({
            success: true,
            action: 'cancelled',
            message: 'Event deactivated; customers will see an inactive notice until reactivated.',
            event
        });
    } catch (error) {
        console.error('Error cancelling event:', error);
        res.status(500).json({ error: 'Failed to cancel event' });
    }
});

// Postpone event — updates scheduled date (and optionally venue). Does not change is_active.
app.post('/api/events/:id/postpone', (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    const body = req.body || {};
    const rawDate = body.event_date ?? body.eventDate;
    if (rawDate == null || typeof rawDate !== 'string' || !rawDate.trim()) {
        return res.status(400).json({
            error: 'event_date is required (use ISO date string or YYYY-MM-DD)'
        });
    }
    const event_date = rawDate.trim();
    try {
        const existing = eventDb.getById(eventId);
        if (!existing) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const updates = { event_date };
        if (body.venue !== undefined && body.venue !== null) {
            updates.venue = String(body.venue).trim();
        }
        const success = eventDb.update(eventId, updates);
        if (!success) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const event = eventDb.getById(eventId);
        res.json({
            success: true,
            action: 'postponed',
            message: 'Event date updated.',
            event
        });
    } catch (error) {
        console.error('Error postponing event:', error);
        res.status(500).json({ error: 'Failed to postpone event' });
    }
});

// Delete an event
app.delete('/api/events/:id', (req, res) => {
    const eventId = parseInt(req.params.id);
    
    try {
        const success = eventDb.delete(eventId);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// Get event by slug (public)
app.get('/api/events/slug/:slug', (req, res) => {
    const event = eventDb.getBySlug(req.params.slug);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event);
});

// ==================== DJ Routes ====================
app.get('/dj', (req, res) => {
    const events = eventDb.getAll();
    res.render('dj-dashboard', { events, requests: djRequests, messages: djMessages });
});

app.get('/dj/events', (req, res) => {
    const events = eventDb.getAll();
    res.render('event-management', { events });
});

// Event-specific display config
app.get('/dj/display-config/:eventSlug', (req, res) => {
    const event = eventDb.getBySlug(req.params.eventSlug);
    if (!event) {
        return res.status(404).render('error', { error: 'Event not found', customerName: '', eventSlug: null });
    }
    res.render('display-config', { event });
});

// Event-specific display
app.get('/dj/display/:eventSlug', (req, res) => {
    const event = eventDb.getBySlug(req.params.eventSlug);
    if (!event) {
        return res.status(404).render('error', { error: 'Event not found', customerName: '', eventSlug: null });
    }
    // Get messages for this event
    const publicMessages = djMessages.filter(msg => !msg.private && msg.eventSlug === event.slug);
    res.render('dj-display', { event, messages: publicMessages });
});

// Legacy global display (redirect or show all)
app.get('/dj/display', (req, res) => {
    // Only pass non-private messages to the public display
    const publicMessages = djMessages.filter(msg => !msg.private);
    res.render('dj-display', { event: null, messages: publicMessages });
});

// API endpoint to update event display config
app.put('/api/events/:id/display-config', (req, res) => {
    const eventId = req.params.id;
    const updates = {
        display_show_qr: req.body.display_show_qr ? 1 : 0,
        display_qr_position: req.body.display_qr_position || 'top-right',
        display_qr_size: parseInt(req.body.display_qr_size) || 120,
        display_qr_label: req.body.display_qr_label || 'Scan to Request Songs!',
        display_bg_color1: req.body.display_bg_color1 || '#000428',
        display_bg_color2: req.body.display_bg_color2 || '#004e92',
        display_bg_image: req.body.display_bg_image || null,
        display_card_color: req.body.display_card_color || '#ffffff',
        display_card_opacity: parseInt(req.body.display_card_opacity) || 85
    };
    
    const success = eventDb.update(eventId, updates);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: 'Failed to update display config' });
    }
});

app.get('/karaoke-spinner', (req, res) => {
    res.render('karaoke-spinner');
});

// New API endpoint for dashboard data (for background refresh)
app.get('/api/dj/dashboard-data', (req, res) => {
    res.json({ 
        requests: djRequests, 
        messages: djMessages 
    });
});

// API endpoint for DJ messages (supports includePrivate with secret)
app.get('/api/dj/messages', (req, res) => {
    const includePrivate = req.query.includePrivate === 'true';

    // Start with messages that haven't been marked displayed
    const pending = djMessages.filter(msg => !msg.displayed);

    if (includePrivate) {
        // Return all pending messages (including private) when requested
        return res.json(pending);
    }

    // Default: return only non-private pending messages
    const publicPending = pending.filter(msg => !msg.private);
    res.json(publicPending);
});

app.post('/api/dj/message/:id/mark-displayed', (req, res) => {
    const messageId = parseInt(req.params.id);
    const message = djMessages.find(msg => msg.id === messageId);
    if (message) {
        message.displayed = true;
    }
    res.json({ success: true });
});

app.delete('/api/dj/request/:id', (req, res) => {
    const requestId = parseInt(req.params.id);
    const index = djRequests.findIndex(req => req.id === requestId);
    if (index !== -1) {
        djRequests.splice(index, 1);
    }
    res.json({ success: true });
});

app.post('/api/dj/reply', (req, res) => {
    const { customerName, replyMessage, originalType, originalId } = req.body;
    
    if (!customerName || !replyMessage) {
        return res.status(400).json({ error: 'Customer name and reply message are required' });
    }
    
    // Create reply entry
    const reply = {
        id: Date.now(),
        customerName,
        replyMessage,
        originalType: originalType || 'request', // Default to 'request' if not provided
        originalId,
        timestamp: new Date().toISOString(),
        displayed: false
    };
    
    djReplies.push(reply);
    
    // Also add to djMessages for display system
    const displayMessage = {
        id: Date.now() + 1,
        customerName: `DJ Reply to ${customerName}`,
        message: replyMessage,
        timestamp: new Date().toISOString(),
        displayed: false,
        isReply: true
    };
    
    djMessages.push(displayMessage);
    
    console.log('DJ reply sent:', reply);
    res.json({ success: true, reply });
});

app.get('/api/dj/replies', (req, res) => {
    res.json(djReplies);
});

app.get('/api/customer/replies/:customerName', (req, res) => {
    const customerName = req.params.customerName;
    const customerReplies = djReplies.filter(reply => 
        reply.customerName.toLowerCase() === customerName.toLowerCase()
    );
    res.json(customerReplies);
});

// Karaoke Spinner API endpoints
app.get('/api/karaoke/all', (req, res) => {
    res.json(karaokeCatalogue);
});

// Shared function to trigger karaoke spin
function triggerKaraokeSpin() {
    // Select a random karaoke song
    if (karaokeCatalogue.length === 0) {
        return { error: 'No karaoke songs available' };
    }
    
    const randomIndex = Math.floor(Math.random() * karaokeCatalogue.length);
    const selectedSong = karaokeCatalogue[randomIndex];
    
    karaokeSpinState = {
        shouldSpin: true,
        selectedSong: selectedSong,
        timestamp: Date.now()
    };
    
    // Add the randomly selected song to DJ requests
    const request = {
        id: Date.now(),
        type: 'karaoke',
        customerName: '🎲 Random Spinner',
        song: selectedSong,
        message: 'Randomly selected by DJ spinner',
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    djRequests.push(request);
    
    console.log('Karaoke spin triggered:', selectedSong.title);
    return { success: true, song: selectedSong };
}

app.post('/api/karaoke/trigger-spin', (req, res) => {
    const result = triggerKaraokeSpin();
    if (result.error) {
        return res.status(400).json(result);
    }
    res.json(result);
});

// GET endpoint for external devices (e.g., Stream Deck, automation)
app.get('/api/karaoke/trigger-spin', (req, res) => {
    const result = triggerKaraokeSpin();
    if (result.error) {
        return res.status(400).json(result);
    }
    res.json(result);
});

app.get('/api/karaoke/spin-status', (req, res) => {
    res.json(karaokeSpinState);
});

app.post('/api/karaoke/clear-spin', (req, res) => {
    karaokeSpinState = {
        shouldSpin: false,
        selectedSong: null,
        timestamp: null
    };
    res.json({ success: true });
});

// Customer Routes
app.get('/', (req, res) => {
    res.render('index', { eventSlug: null, event: null });
});

app.get('/song-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded song catalogue so the song selection page can show songs
    res.render('song-request', { songs: songCatalogue, customerName, eventSlug: null, event: null });
});

app.get('/karaoke-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded karaoke catalogue so the karaoke selection page can show options
    res.render('karaoke-request', { karaoke: karaokeCatalogue, customerName, eventSlug: null, event: null });
});

app.get('/send-message', (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('send-message', { customerName, eventSlug: null }); // Pass customer name
});

// ==================== Event-specific Customer Routes ====================
// Event landing page
app.get('/event/:eventSlug', getEventFromSlug, (req, res) => {
    res.render('index', { eventSlug: req.event.slug, event: req.event });
});

// Event-specific song request
app.get('/event/:eventSlug/song-request', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('song-request', { 
        songs: songCatalogue, 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Event-specific karaoke request
app.get('/event/:eventSlug/karaoke-request', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('karaoke-request', { 
        karaoke: karaokeCatalogue, 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// Event-specific message
app.get('/event/:eventSlug/send-message', getEventFromSlug, (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('send-message', { 
        customerName, 
        eventSlug: req.event.slug,
        event: req.event
    });
});

// API Routes for search functionality
app.get('/api/search/songs', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    // Only return results if query has at least 3 characters
    if (query.length < 3) {
        return res.json([]);
    }
    
    const filteredSongs = songCatalogue.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query) ||
        (song.genre && song.genre.toLowerCase().includes(query)) ||
        (song.year && song.year.toString().includes(query))
    );
    res.json(filteredSongs);
});

app.get('/api/search/karaoke', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    // Only return results if query has at least 3 characters
    if (query.length < 3) {
        return res.json([]);
    }
    
    const filteredKaraoke = karaokeCatalogue.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query) ||
        (song.difficulty && song.difficulty.toLowerCase().includes(query)) ||
        (song.genre && song.genre.toLowerCase().includes(query))
    );
    res.json(filteredKaraoke);
});

// Handle form submissions
app.post('/submit-song-request', async (req, res) => {
    const { customerName, songId, message, eventSlug } = req.body;
    const selectedSong = songCatalogue.find(s => s.id == songId);
    
    // Get event info if eventSlug provided
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;
    
    // Store the request for DJ dashboard
    const request = {
        id: Date.now(),
        type: 'song',
        customerName,
        song: selectedSong,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    djRequests.push(request);
    
    // Also add to djMessages for DJ display screen
    const displayMessage = {
        id: Date.now() + 2,
        customerName: customerName,
        message: `🎵 Song Request: "${selectedSong.title}" by ${selectedSong.artist}`,
        timestamp: new Date().toISOString(),
        displayed: false,
        isReply: false,
        type: 'song-request'
    };
    djMessages.push(displayMessage);
    
    // Prepare message for VirtualDJ
    const djMessage = `Song Request from ${customerName}: "${selectedSong.title}" by ${selectedSong.artist}${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Song request sent to VirtualDJ:', { customerName, songId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'song request',
            details: selectedSong,
            eventSlug: eventSlug || null
        });
    } catch (error) {
        console.error('Error sending song request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName,
            eventSlug: eventSlug || null
        });
    }
});

app.post('/submit-karaoke-request', async (req, res) => {
    const { customerName, karaokeId, message, eventSlug } = req.body;
    const selectedKaraoke = karaokeCatalogue.find(k => k.id == karaokeId);
    
    // Get event info if eventSlug provided
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;
    
    // Store the request for DJ dashboard
    const request = {
        id: Date.now() + 1, // Ensure unique ID
        type: 'karaoke',
        customerName,
        song: selectedKaraoke,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending',
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };
    djRequests.push(request);
    
    // Also add to djMessages for DJ display screen
    const displayMessage = {
        id: Date.now() + 2,
        customerName: customerName,
        message: `🎤 Karaoke Request: "${selectedKaraoke.title}" by ${selectedKaraoke.artist}`,
        timestamp: new Date().toISOString(),
        displayed: false,
        isReply: false,
        type: 'karaoke-request'
    };
    djMessages.push(displayMessage);
    
    // Prepare message for VirtualDJ
    const djMessage = `Karaoke Request from ${customerName}: "${selectedKaraoke.title}" by ${selectedKaraoke.artist} (${selectedKaraoke.difficulty})${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Karaoke request sent to VirtualDJ:', { customerName, karaokeId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'karaoke request',
            details: selectedKaraoke,
            eventSlug: eventSlug || null
        });
    } catch (error) {
        console.error('Error sending karaoke request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName,
            eventSlug: eventSlug || null
        });
    }
});

app.post('/submit-message', async (req, res) => {
    const { customerName, eventSlug } = req.body;
    let { message, messageText } = req.body;
    
    // Get event info if eventSlug provided
    const event = eventSlug ? eventDb.getBySlug(eventSlug) : null;
    
    // djOnly may be submitted as '1', 'on', 'true' or boolean
    const rawDjOnly = req.body.djOnly;
    const djOnly = rawDjOnly === '1' || rawDjOnly === 'on' || rawDjOnly === 'true' || rawDjOnly === true;

    // Handle inline HTML content directly.
    // Fall back to plain text mirror when rich payload is empty.
    messageText = typeof messageText === 'string' ? messageText.trim() : '';
    let richContent = typeof message === 'string' ? message : '';
    if (!richContent.trim() && messageText) {
        richContent = messageText;
    }
    let hasMedia = false;
    
    // Check if message contains inline images
    hasMedia = richContent.includes('<img');
    
    // Sanitize HTML content while preserving inline images
    const cleanMessage = DOMPurify.sanitize(richContent, {
        ALLOWED_TAGS: ['img', 'br', 'p', 'div', 'span', 'strong', 'em', 'u', 'b', 'i'],
        ALLOWED_ATTR: ['src', 'alt', 'style', 'class'],
        ALLOW_DATA_ATTR: false,
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });

    // Extract plain text content for VirtualDJ
    const textContent = DOMPurify.sanitize(richContent, { 
        ALLOWED_TAGS: [],
        KEEP_CONTENT: true 
    }).trim();

    // If cleanMessage is empty but hasMedia is true, there might be an issue with sanitization
    // Use the original richContent if cleanMessage got stripped but we know there's media
    const finalMessage = cleanMessage || (hasMedia ? richContent : '');

    // Store the message for DJ display
    const djDisplayMessage = {
        id: Date.now() + 2,
        customerName,
        message: finalMessage, // Rich HTML with inline images
        textMessage: textContent || (hasMedia ? 'Message with media' : 'Empty message'),
        timestamp: new Date().toISOString(),
        displayed: false,
        private: !!djOnly,
        hasMedia: hasMedia,
        eventId: event ? event.id : null,
        eventSlug: eventSlug || null,
        eventName: event ? event.name : null
    };

    djMessages.push(djDisplayMessage);

    try {
        // Send plain text version to VirtualDJ
        await sendToVirtualDJ(customerName, textContent || 'Message with inline GIFs/images');
        console.log('Inline message sent:', { 
            customerName, 
            hasMedia,
            messageLength: finalMessage.length,
            textLength: textContent.length,
            djOnly,
            containsImg: finalMessage.includes('<img')
        });

        res.render('thank-you', {
            customerName,
            requestType: 'message',
            details: { message: textContent || 'Message with inline GIFs/images' },
            eventSlug: eventSlug || null
        });
    } catch (error) {
        console.error('Error sending message to VirtualDJ:', error);
        res.status(500).render('error', {
            error: 'Failed to send message. Please try again.',
            customerName,
            eventSlug: eventSlug || null
        });
    }
});

// ============================================
// NOW PLAYING API (DMX Controller Integration)
// ============================================

// Helper to get empty now playing object
function getEmptyNowPlaying() {
    return {
        title: null,
        artist: null,
        album: null,
        duration: null,
        elapsed: null,
        artwork: null,
        eventId: null,
        eventSlug: null,
        updatedAt: null
    };
}

// POST endpoint to receive current track info from DMX controller
app.post('/api/now-playing', (req, res) => {
    const { title, artist, album, duration, elapsed, artwork, eventId, eventSlug } = req.body;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    // Determine the key - use eventId, resolve from eventSlug, or use 'global'
    let key = 'global';
    let resolvedEventId = eventId || null;
    let resolvedEventSlug = eventSlug || null;
    
    if (eventId) {
        key = `event_${eventId}`;
        // Try to get slug from event
        const event = eventDb.getById(eventId);
        if (event) {
            resolvedEventSlug = event.slug;
        }
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
            resolvedEventId = event.id;
            resolvedEventSlug = eventSlug;
        } else {
            return res.status(404).json({ error: 'Event not found' });
        }
    }
    
    const nowPlaying = {
        title: title || null,
        artist: artist || null,
        album: album || null,
        duration: duration || null,
        elapsed: elapsed || null,
        artwork: artwork || null,
        eventId: resolvedEventId,
        eventSlug: resolvedEventSlug,
        updatedAt: new Date().toISOString()
    };
    
    nowPlayingMap[key] = nowPlaying;
    
    console.log('Now playing updated:', nowPlaying.title, '-', nowPlaying.artist, key !== 'global' ? `(${key})` : '(global)');
    res.json({ success: true, nowPlaying });
});

// GET endpoint to retrieve current track info
app.get('/api/now-playing', (req, res) => {
    const { eventId, eventSlug } = req.query;
    
    // Determine which now playing to return
    let key = 'global';
    
    if (eventId) {
        key = `event_${eventId}`;
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
        }
    }
    
    // Return event-specific track if exists, otherwise fall back to global
    const nowPlaying = nowPlayingMap[key] || nowPlayingMap['global'] || getEmptyNowPlaying();
    res.json(nowPlaying);
});

// DELETE endpoint to clear now playing (when playback stops)
app.delete('/api/now-playing', (req, res) => {
    const { eventId, eventSlug } = req.query;
    
    let key = 'global';
    
    if (eventId) {
        key = `event_${eventId}`;
    } else if (eventSlug) {
        const event = eventDb.getBySlug(eventSlug);
        if (event) {
            key = `event_${event.id}`;
        }
    }
    
    delete nowPlayingMap[key];
    console.log('Now playing cleared:', key);
    res.json({ success: true });
});

// Start server
async function startServer() {
    await initializeCatalogues();
    
    // Ensure default event exists
    const defaultEvent = ensureDefaultEvent();
    if (defaultEvent) {
        console.log(`Created default event with slug: ${defaultEvent.slug}`);
    }
    
    app.listen(PORT, () => {
        console.log(`MobileDJay server is running on http://localhost:${PORT}`);
        console.log(`Songs loaded: ${songCatalogue.length}`);
        console.log(`Karaoke songs loaded: ${karaokeCatalogue.length}`);
        const events = eventDb.getAll();
        console.log(`Events in database: ${events.length}`);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
