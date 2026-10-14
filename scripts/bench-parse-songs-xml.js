/**
 * Quick benchmark for streaming VirtualDJ XML parse (no SQLite).
 * Usage: node scripts/bench-parse-songs-xml.js [path-to-database.xml]
 */
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const xmlPath = process.argv[2] || path.join(__dirname, '..', 'db', 'Song_Database.xml');

function decodeXmlAttr(value) {
    return String(value)
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function readVdjTagAttr(line, name) {
    const re = new RegExp(`\\b${name}="([^"]*)"`);
    const match = line.match(re);
    return match ? decodeXmlAttr(match[1]) : null;
}

async function parseSongsXML(filePath) {
    const songs = [];
    let id = 1;
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity
    });
    for await (const line of rl) {
        if (!line.includes('<Tags')) continue;
        const title = readVdjTagAttr(line, 'Title');
        const artist = readVdjTagAttr(line, 'Author');
        if (!title || !artist) continue;
        songs.push({ id: id++, title, artist });
    }
    return songs;
}

(async () => {
    const t0 = Date.now();
    const songs = await parseSongsXML(xmlPath);
    console.log(`Parsed ${songs.length} songs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
