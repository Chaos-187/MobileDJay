const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Global variables to store catalogues
let songCatalogue = [];
let karaokeCatalogue = [];

// Storage for DJ requests and messages
let djRequests = [];
let djMessages = [];
let djReplies = [];

// Function to load songs from VirtualDJ XML database
async function loadSongsFromXML() {
    try {
        const xmlPath = path.join(__dirname, 'DB', 'Song_Database.xml');
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
        const csvPath = path.join(__dirname, 'DB', 'VirtualDJ_Karaoke_Catalog_2025-07-26.csv');
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
// DJ Routes
app.get('/dj', (req, res) => {
    res.render('dj-dashboard', { requests: djRequests, messages: djMessages });
});

app.get('/dj/display', (req, res) => {
    // Only pass non-private messages to the public display
    const publicMessages = djMessages.filter(msg => !msg.private);
    res.render('dj-display', { messages: publicMessages });
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

// Customer Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/song-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded song catalogue so the song selection page can show songs
    res.render('song-request', { songs: songCatalogue, customerName });
});

app.get('/karaoke-request', (req, res) => {
    const customerName = req.query.customerName || '';
    // Pass the loaded karaoke catalogue so the karaoke selection page can show options
    res.render('karaoke-request', { karaoke: karaokeCatalogue, customerName });
});

app.get('/send-message', (req, res) => {
    const customerName = req.query.customerName || '';
    res.render('send-message', { customerName }); // Pass customer name
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
    const { customerName, songId, message } = req.body;
    const selectedSong = songCatalogue.find(s => s.id == songId);
    
    // Store the request for DJ dashboard
    const request = {
        id: Date.now(),
        type: 'song',
        customerName,
        song: selectedSong,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    djRequests.push(request);
    
    // Prepare message for VirtualDJ
    const djMessage = `Song Request from ${customerName}: "${selectedSong.title}" by ${selectedSong.artist}${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Song request sent to VirtualDJ:', { customerName, songId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'song request',
            details: selectedSong
        });
    } catch (error) {
        console.error('Error sending song request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName
        });
    }
});

app.post('/submit-karaoke-request', async (req, res) => {
    const { customerName, karaokeId, message } = req.body;
    const selectedKaraoke = karaokeCatalogue.find(k => k.id == karaokeId);
    
    // Store the request for DJ dashboard
    const request = {
        id: Date.now() + 1, // Ensure unique ID
        type: 'karaoke',
        customerName,
        song: selectedKaraoke,
        message: message || '',
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    djRequests.push(request);
    
    // Prepare message for VirtualDJ
    const djMessage = `Karaoke Request from ${customerName}: "${selectedKaraoke.title}" by ${selectedKaraoke.artist} (${selectedKaraoke.difficulty})${message ? ` - Additional message: ${message}` : ''}`;
    
    try {
        // Send to VirtualDJ endpoint
        await sendToVirtualDJ(customerName, djMessage);
        console.log('Karaoke request sent to VirtualDJ:', { customerName, karaokeId, message });
        
        res.render('thank-you', { 
            customerName, 
            requestType: 'karaoke request',
            details: selectedKaraoke
        });
    } catch (error) {
        console.error('Error sending karaoke request to VirtualDJ:', error);
        res.status(500).render('error', { 
            error: 'Failed to send request. Please try again.',
            customerName
        });
    }
});

app.post('/submit-message', async (req, res) => {
    const { customerName, message } = req.body;
    // djOnly may be submitted as '1', 'on', 'true' or boolean
    const rawDjOnly = req.body.djOnly;
    const djOnly = rawDjOnly === '1' || rawDjOnly === 'on' || rawDjOnly === 'true' || rawDjOnly === true;

    // Store the message for DJ display; mark private if djOnly is true
    const djDisplayMessage = {
        id: Date.now() + 2, // Ensure unique ID
        customerName,
        message,
        timestamp: new Date().toISOString(),
        displayed: false,
        private: !!djOnly
    };

    // Always keep the message in the djMessages array so DJs can view private messages
    djMessages.push(djDisplayMessage);

    try {
        // Send to VirtualDJ endpoint (still send regardless of privacy)
        await sendToVirtualDJ(customerName, message);
        console.log('Message sent to VirtualDJ:', { customerName, message, djOnly });

        res.render('thank-you', {
            customerName,
            requestType: 'message',
            details: { message }
        });
    } catch (error) {
        console.error('Error sending message to VirtualDJ:', error);
        res.status(500).render('error', {
            error: 'Failed to send message. Please try again.',
            customerName
        });
    }
});

// Start server
async function startServer() {
    await initializeCatalogues();
    
    // Add some test replies for debugging
    djReplies.push({
        id: Date.now(),
        customerName: 'TestUser',
        replyMessage: 'Hello TestUser, this is a test reply from the DJ!',
        originalType: 'request',
        originalId: '123',
        timestamp: new Date().toISOString()
    });
    
    app.listen(PORT, () => {
        console.log(`MobileDJay server is running on http://localhost:${PORT}`);
        console.log(`Songs loaded: ${songCatalogue.length}`);
        console.log(`Karaoke songs loaded: ${karaokeCatalogue.length}`);
        console.log(`Test replies added: ${djReplies.length}`);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
