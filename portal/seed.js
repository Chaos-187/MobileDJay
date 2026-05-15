/**
 * Dev/demo seed for EYUP portal DB (db/eyup_portal.db).
 * Usage: node portal/seed.js
 */
const { portalDb, uuid } = require('../db/portal-database');
const { hashPassword } = require('./auth-tokens');

const DEMO_CUSTOMER_EMAIL = process.env.EYUP_PORTAL_SEED_CUSTOMER_EMAIL || 'customer@demo.eyupevents.uk';
const DEMO_DJ_EMAIL = process.env.EYUP_PORTAL_SEED_DJ_EMAIL || 'dj@demo.eyupevents.uk';
const DEMO_ADMIN_EMAIL = process.env.EYUP_PORTAL_SEED_ADMIN_EMAIL || 'admin@demo.eyupevents.uk';
const DEMO_PASSWORD = process.env.EYUP_PORTAL_SEED_PASSWORD || 'ChangeMeDemo123!';

async function ensureUser(email, password, role, names = {}) {
    let u = portalDb.getUserByEmail(email);
    if (u) return u;
    const passwordHash = await hashPassword(password);
    const id = portalDb.createUser({
        email,
        passwordHash,
        role,
        firstName: names.first || null,
        lastName: names.last || null
    });
    return portalDb.getUserById(id);
}

async function main() {
    const customer = await ensureUser(DEMO_CUSTOMER_EMAIL, DEMO_PASSWORD, 'customer', {
        first: 'Demo',
        last: 'Customer'
    });
    const dj = await ensureUser(DEMO_DJ_EMAIL, DEMO_PASSWORD, 'dj', { first: 'Demo', last: 'DJ' });
    await ensureUser(DEMO_ADMIN_EMAIL, DEMO_PASSWORD, 'admin', { first: 'Demo', last: 'Admin' });

    let booking = portalDb.db.prepare('SELECT id FROM bookings WHERE reference = ?').get('EY-1042');
    let bookingId;
    if (!booking) {
        bookingId = uuid();
        const start = new Date();
        start.setDate(start.getDate() + 14);
        const end = new Date(start);
        end.setHours(end.getHours() + 5);
        portalDb.insertBooking({
            id: bookingId,
            customer_id: customer.id,
            title: 'Sample Wedding Reception',
            start_datetime: start.toISOString(),
            end_datetime: end.toISOString(),
            venue: 'Grand Hall (demo)',
            service: 'Mobile DJ + lighting',
            status: 'confirmed',
            reference: 'EY-1042',
            contact_name: 'Alex Demo',
            notes_from_company: 'Thank you for booking EYUP EVENTS — this is seeded demo data.',
            dj_briefing: 'Load-in 17:00 · speeches ~18:30 · First dance announced by MC.'
        });
        portalDb.assignDj(bookingId, dj.id);

        portalDb.upsertMusicPlan(customer.id, null, {
            must_play: ['Artist — Celebration hit'],
            dont_play: [],
            dont_play_early: ['Nothing above 120 BPM before speeches'],
            floor_fillers: ['90s dance classics'],
            first_dance: 'Your Song — Artist',
            last_dance: 'Closing track — Artist',
            parent_dances: 'Optional parent dance notes'
        });
    } else {
        bookingId = booking.id;
    }

    console.log('EYUP portal seed complete.');
    console.log(`  Customer login: ${DEMO_CUSTOMER_EMAIL} / ${DEMO_PASSWORD}`);
    console.log(`  DJ login:       ${DEMO_DJ_EMAIL} / ${DEMO_PASSWORD}`);
    console.log(`  Admin login:    ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}  (POST /api/v1/auth/login → /api/v1/admin/*)`);
    console.log(`  Booking ref:    EY-1042  id=${bookingId}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
