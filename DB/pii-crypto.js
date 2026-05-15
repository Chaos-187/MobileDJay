/**
 * Optional at-rest protection for customer PII in SQLite (field-level AES-256-GCM).
 * Set PORTAL_PII_ENCRYPTION_KEY (32-byte hex, base64, or any string — hashed to 32 bytes)
 * to enable. When unset, all fields remain plaintext (legacy behaviour).
 */
const crypto = require('crypto');

const PREFIX = 'p1.';
const USER_BLOB_AAD = Buffer.from('eyup|user_pii|v1');
const BOOKING_BLOB_AAD = Buffer.from('eyup|booking_pii|v1');
const STRING_AAD = Buffer.from('eyup|utf8|v1');
const EMAIL_HMAC_LABEL = 'eyup|email_stable_id|v1';

function parseMasterKey() {
    const raw = process.env.PORTAL_PII_ENCRYPTION_KEY;
    if (raw == null || String(raw).trim() === '') return null;
    const s = String(raw).trim();
    if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
    try {
        const b = Buffer.from(s, 'base64');
        if (b.length === 32) return b;
    } catch {
        /* fall through */
    }
    return crypto.createHash('sha256').update(s, 'utf8').digest();
}

function isEnabled() {
    return parseMasterKey() != null;
}

/** Deterministic pseudonymous id for lookups / UNIQUE(email) surrogate */
function stableEmailId(normalizedEmail) {
    const key = parseMasterKey();
    if (!key) return normalizedEmail;
    return crypto.createHmac('sha256', key).update(`${EMAIL_HMAC_LABEL}\x00${normalizedEmail}`, 'utf8').digest('hex');
}

function seal(plainUtf8, aad) {
    const key = parseMasterKey();
    if (!key) return plainUtf8;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const enc = Buffer.concat([cipher.update(String(plainUtf8), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, enc, tag]).toString('base64url');
}

function open(sealedValue, aad) {
    if (sealedValue == null || sealedValue === '') return sealedValue === '' ? '' : sealedValue;
    if (typeof sealedValue !== 'string' || !sealedValue.startsWith(PREFIX)) {
        return null;
    }
    const key = parseMasterKey();
    if (!key) return null;
    try {
        const raw = Buffer.from(sealedValue.slice(PREFIX.length), 'base64url');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(raw.length - 16);
        const enc = raw.subarray(12, raw.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

function encryptUserBlob(obj) {
    return seal(JSON.stringify(obj), USER_BLOB_AAD);
}

function decryptUserBlob(ciphertext) {
    const utf8 = open(ciphertext, USER_BLOB_AAD);
    if (utf8 == null) return null;
    try {
        return JSON.parse(utf8);
    } catch {
        return null;
    }
}

function encryptBookingBlob(obj) {
    return seal(JSON.stringify(obj), BOOKING_BLOB_AAD);
}

function decryptBookingBlob(ciphertext) {
    const utf8 = open(ciphertext, BOOKING_BLOB_AAD);
    if (utf8 == null) return null;
    try {
        return JSON.parse(utf8);
    } catch {
        return null;
    }
}

/** Free-form UTF-8 (note body, music plan JSON string, …) */
function encryptString(str) {
    if (str == null) return null;
    return seal(String(str), STRING_AAD);
}

function decryptStringMaybe(stored) {
    if (stored == null || stored === '') return stored;
    const s = typeof stored === 'string' ? stored : String(stored);
    if (!s.startsWith(PREFIX)) return s;
    const plain = open(s, STRING_AAD);
    return plain != null ? plain : s;
}

module.exports = {
    PREFIX,
    isEnabled,
    stableEmailId,
    encryptUserBlob,
    decryptUserBlob,
    encryptBookingBlob,
    decryptBookingBlob,
    encryptString,
    decryptStringMaybe
};
