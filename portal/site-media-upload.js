const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const siteMediaRoot = path.join(__dirname, '..', 'uploads', 'site-media');
fs.mkdirSync(siteMediaRoot, { recursive: true });

const storage = multer.diskStorage({
    destination(_req, _file, cb) {
        cb(null, siteMediaRoot);
    },
    filename(_req, file, cb) {
        const ext =
            {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',
                'image/gif': '.gif'
            }[file.mimetype] || '.jpg';
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
});

const siteMediaUpload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, or GIF images are allowed'), ok);
    }
});

module.exports = { siteMediaUpload, siteMediaRoot };
