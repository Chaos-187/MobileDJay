/**
 * Push portal customer accounts to Zoho Books contacts.
 */

const zohoBooks = require('./zoho-books');
const { portalDb } = require('../db/portal-database');

function contactDisplayName(user) {
    const parts = [user.first_name, user.last_name].filter(Boolean);
    if (parts.length) return parts.join(' ');
    if (user.email) return String(user.email).split('@')[0];
    return 'Portal customer';
}

function buildContactPayload(user) {
    const name = contactDisplayName(user);
    const email = user.email ? String(user.email).trim() : '';
    const phone = user.phone ? String(user.phone).trim() : '';
    const payload = {
        contact_name: name,
        contact_type: 'customer',
        notes: `EYUP portal user ${user.id}`
    };
    if (email) {
        payload.email = email;
        payload.contact_persons = [
            {
                email,
                first_name: user.first_name || name,
                last_name: user.last_name || '',
                phone: phone || undefined,
                is_primary_contact: true
            }
        ];
    }
    if (phone) payload.phone = phone;
    return payload;
}

/**
 * Sync a portal customer to Zoho Books (create or update contact).
 * @returns {Promise<{ ok: boolean, contact_id?: string, skipped?: boolean, reason?: string }>}
 */
async function syncCustomerToZoho(userId) {
    if (!zohoBooks.isConfigured()) {
        return { ok: false, skipped: true, reason: 'not_configured' };
    }
    const user = portalDb.getUserById(userId);
    if (!user) {
        return { ok: false, reason: 'user_not_found' };
    }
    if (user.role !== 'customer') {
        return { ok: false, skipped: true, reason: 'not_customer' };
    }
    if (!user.email) {
        await portalDb.updateUserZohoSync(userId, {
            zoho_contact_sync_error: 'Customer has no email address'
        });
        return { ok: false, reason: 'no_email' };
    }

    const payload = buildContactPayload(user);
    let contactId = user.zoho_contact_id ? String(user.zoho_contact_id) : null;
    let contact = null;

    try {
        if (contactId) {
            contact = await zohoBooks.updateContact(contactId, payload);
        } else {
            const existing = await zohoBooks.searchContactByEmail(user.email);
            if (existing && existing.contact_id) {
                contactId = String(existing.contact_id);
                contact = await zohoBooks.updateContact(contactId, payload);
            } else {
                contact = await zohoBooks.createContact(payload);
                contactId = contact && contact.contact_id ? String(contact.contact_id) : null;
            }
        }
        if (!contactId) {
            throw new Error('Zoho did not return a contact_id');
        }
        const now = new Date().toISOString();
        portalDb.updateUserZohoSync(userId, {
            zoho_contact_id: contactId,
            zoho_contact_synced_at: now,
            zoho_contact_sync_error: null
        });
        return {
            ok: true,
            contact_id: contactId,
            contact,
            synced_at: now
        };
    } catch (err) {
        const msg = err && err.message ? String(err.message) : 'Zoho contact sync failed';
        portalDb.updateUserZohoSync(userId, {
            zoho_contact_sync_error: msg.slice(0, 500)
        });
        throw err;
    }
}

function scheduleZohoContactSync(userId) {
    if (!userId || !zohoBooks.isConfigured()) return;
    setImmediate(() => {
        syncCustomerToZoho(userId).catch((err) => {
            console.error('[portal] zoho contact sync', userId, err.message || err);
        });
    });
}

function zohoStatusForUser(user) {
    if (!user) return null;
    return {
        zoho_books_configured: zohoBooks.isConfigured(),
        zoho_contact_id: user.zoho_contact_id || null,
        zoho_contact_synced_at: user.zoho_contact_synced_at || null,
        zoho_contact_sync_error: user.zoho_contact_sync_error || null
    };
}

module.exports = {
    syncCustomerToZoho,
    scheduleZohoContactSync,
    zohoStatusForUser,
    contactDisplayName
};
