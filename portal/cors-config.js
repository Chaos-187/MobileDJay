/**
 * CORS policy for browser calls to /api/v1 from EyUp marketing + portal frontends.
 */

const DEFAULT_PORTAL_CORS_ORIGINS = [
    'https://eyupevents.uk',
    'https://www.eyupevents.uk',
    'https://requests.eyupevents.uk'
];

const DEV_PORTAL_CORS_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
];

function normalizeOrigin(origin) {
    return String(origin || '')
        .trim()
        .replace(/\/$/, '');
}

function parsePortalCorsOrigins() {
    const fromEnv = (process.env.PORTAL_CORS_ORIGINS || '')
        .split(',')
        .map(normalizeOrigin)
        .filter(Boolean);
    const merged = new Set([...DEFAULT_PORTAL_CORS_ORIGINS, ...fromEnv]);
    if (process.env.NODE_ENV !== 'production') {
        for (const o of DEV_PORTAL_CORS_ORIGINS) merged.add(o);
    }
    return [...merged];
}

function isEyupEventsOrigin(origin) {
    if (process.env.PORTAL_CORS_ALLOW_EYUP_SUBDOMAINS === '0') return false;
    try {
        const u = new URL(origin);
        const host = u.hostname.toLowerCase();
        if (host === 'eyupevents.uk' || host.endsWith('.eyupevents.uk')) {
            if (u.protocol === 'https:') return true;
            return process.env.NODE_ENV !== 'production' && u.protocol === 'http:';
        }
    } catch {
        /* ignore */
    }
    return false;
}

function isPortalCorsOriginAllowed(origin, allowedList) {
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (allowedList.includes(normalized)) return true;
    return isEyupEventsOrigin(normalized);
}

function createPortalCorsOptions() {
    const allowedList = parsePortalCorsOrigins();
    return {
        origin(origin, cb) {
            if (isPortalCorsOriginAllowed(origin, allowedList)) {
                return cb(null, origin || true);
            }
            if (process.env.NODE_ENV !== 'production') {
                console.warn(
                    '[portal] CORS rejected origin:',
                    origin,
                    '| configured:',
                    allowedList.join(', ')
                );
            }
            cb(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Portal-Internal-Key'],
        optionsSuccessStatus: 204
    };
}

module.exports = {
    DEFAULT_PORTAL_CORS_ORIGINS,
    parsePortalCorsOrigins,
    isPortalCorsOriginAllowed,
    createPortalCorsOptions
};
