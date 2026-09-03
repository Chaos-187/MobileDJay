const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const catalogRoot = path.join(__dirname, '..', 'uploads', 'catalog');
fs.mkdirSync(catalogRoot, { recursive: true });

const storage = multer.diskStorage({
    destination(_req, _file, cb) {
        cb(null, catalogRoot);
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

const catalogImageUpload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, or GIF images are allowed'), ok);
    }
});

module.exports = { catalogImageUpload, catalogRoot };
