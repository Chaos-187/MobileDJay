const { portalDb } = require('../db/portal-database');
const { getSiteSettings } = require('./site-settings-service');
const { verifyTurnstile } = require('./turnstile');
const brevoMail = require('./brevo-mail');

function jsonError(res, code, message, status = 400, details = {}) {
    res.status(status).json({ error: { code, message, details } });
}

function normalizeUKPhone(phone) {
    if (phone == null) return null;
    let cleaned = String(phone).replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('07')) cleaned = '+447' + cleaned.substring(2);
    else if (/^7\d{9}$/.test(cleaned)) cleaned = '+447' + cleaned.substring(1);
    else if (cleaned.startsWith('447')) cleaned = '+' + cleaned;
    return cleaned || null;
}

function validateEnquiryBody(body) {
    const details = {};
    const enquiryType =
        body.enquiry_type === 'booking' || body.enquiryType === 'booking' ? 'booking' : 'message';
    const firstName = body.first_name != null ? String(body.first_name).trim() : '';
    const lastName = body.last_name != null ? String(body.last_name).trim() : '';
    const email = body.email != null ? String(body.email).trim() : '';
    const phone = body.phone != null ? String(body.phone).trim() : '';
    const eventType = body.event_type != null ? String(body.event_type).trim() : '';
    const eventDate = body.event_date != null ? String(body.event_date).trim() : '';
    const message = body.message != null ? String(body.message).trim() : '';

    if (!firstName) details.first_name = 'is required';
    if (!lastName) details.last_name = 'is required';
    if (!email) details.email = 'is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) details.email = 'must be a valid email';
    if (!phone) details.phone = 'is required';

    const services = Array.isArray(body.services_required)
        ? body.services_required.filter(Boolean)
        : body.services != null
          ? Array.isArray(body.services)
              ? body.services
              : [body.services]
          : [];
    const quoteItems = Array.isArray(body.quote_line_items) ? body.quote_line_items : [];

    if (enquiryType === 'message') {
        if (!message) details.message = 'is required';
    } else {
        if (!eventType) details.event_type = 'is required';
        if (!eventDate) details.event_date = 'is required';
        if (!services.length && !quoteItems.length) {
            details.services = 'Select at least one service or add items to your quote';
        }
    }

    if (Object.keys(details).length) {
        const err = new Error('Validation failed');
        err.code = 'validation_error';
        err.details = details;
        throw err;
    }

    const leadMetadata =
        body.lead_metadata && typeof body.lead_metadata === 'object' ? { ...body.lead_metadata } : {};
    leadMetadata.form_source = leadMetadata.form_source || body.form_source || 'eyup_events_website';
    leadMetadata.form_timestamp =
        leadMetadata.form_timestamp || body.form_timestamp || new Date().toISOString();
    leadMetadata.enquiry_type = enquiryType;

    return {
        enquiryType,
        firstName,
        lastName,
        email,
        phone: normalizeUKPhone(phone),
        eventType: enquiryType === 'booking' ? eventType : null,
        eventDate: enquiryType === 'booking' ? eventDate : null,
        guestCountRange:
            enquiryType === 'booking' && body.guest_count_range != null
                ? String(body.guest_count_range)
                : null,
        venue:
            enquiryType === 'booking' && body.venue != null ? String(body.venue).trim() : null,
        message: message || null,
        hearAbout: body.hear_about != null ? String(body.hear_about) : null,
        newsletterOptIn: !!body.newsletter_opt_in || body.newsletter === 'yes',
        servicesRequired: enquiryType === 'booking' ? services : [],
        quoteLineItems: enquiryType === 'booking' ? quoteItems : [],
        leadMetadata
    };
}

async function createPublicEnquiry(req, res) {
    const settings = getSiteSettings();
    if (settings.contact_form_enabled === false) {
        return jsonError(res, 'forbidden', 'Contact form is currently unavailable', 403);
    }

    const turnstile = await verifyTurnstile(req, req.body && req.body.cf_turnstile_response);
    if (!turnstile.ok) {
        return jsonError(res, 'turnstile_failed', 'Turnstile verification failed', 400, {
            error_codes: turnstile.errorCodes || []
        });
    }

    let parsed;
    try {
        parsed = validateEnquiryBody(req.body || {});
    } catch (err) {
        if (err.code === 'validation_error') {
            return jsonError(res, 'validation_error', 'Invalid enquiry', 422, err.details || {});
        }
        throw err;
    }

    let quotePayload = { quote_line_items: [], quote_subtotal: 0, quote_total: 0 };
    if (parsed.quoteLineItems.length) {
        try {
            quotePayload = portalDb.normalizeEnquiryQuoteLineItems(parsed.quoteLineItems);
        } catch (lineErr) {
            return jsonError(res, 'validation_error', lineErr.message || 'Invalid quote line items', 422);
        }
    }

    const enquiry = portalDb.insertEnquiry({
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        email: parsed.email,
        phone: parsed.phone,
        event_type: parsed.eventType,
        event_date: parsed.eventDate,
        guest_count_range: parsed.guestCountRange,
        venue: parsed.venue,
        message: parsed.message,
        hear_about: parsed.hearAbout,
        newsletter_opt_in: parsed.newsletterOptIn,
        services_required: parsed.servicesRequired,
        quote_line_items: quotePayload.quote_line_items,
        quote_subtotal: quotePayload.quote_subtotal,
        quote_total: quotePayload.quote_total,
        lead_metadata: parsed.leadMetadata
    });

    if (brevoMail.isConfigured()) {
        try {
            await brevoMail.sendCustomerTemplateEmail({
                templateKey: 'contact_autoresponder',
                user: {
                    email: parsed.email,
                    first_name: parsed.firstName,
                    last_name: parsed.lastName
                },
                params: {
                    first_name: parsed.firstName,
                    event_date: parsed.eventDate || '',
                    quote_total:
                        quotePayload.quote_total > 0
                            ? `£${quotePayload.quote_total.toFixed(2)}`
                            : ''
                },
                tags: ['contact-enquiry']
            });
        } catch (mailErr) {
            console.error('[portal] public/enquiries autoresponder', mailErr);
        }
    }

    res.status(201).json({
        id: enquiry.id,
        status: enquiry.status,
        quote_total: enquiry.quote_total,
        message: 'Enquiry received — we will get back to you within 24 hours.'
    });
}

module.exports = { createPublicEnquiry, validateEnquiryBody, normalizeUKPhone };
