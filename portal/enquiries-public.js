const { portalDb } = require('../db/portal-database');
const {
    getSiteSettings,
    inferEnquirySiteKey,
    isContactFormEnabledForSite,
    contactFormDisabledMessageForSite
} = require('./site-settings-service');
const { verifyTurnstile } = require('./turnstile');
const brevoMail = require('./brevo-mail');
const {
    enrichLeadMetadataFromBody,
    resolveEventDurationHours
} = require('./catalog-pricing');
const {
    validateVoucherForContext,
    computeVoucherDiscountAmount
} = require('./vouchers-service');

function jsonError(res, code, message, status = 400, details = {}) {
    res.status(status).json({ error: { code, message, details } });
}

const INFLATABLES_PUBLIC_ORIGIN =
    process.env.EYUP_INFLATABLES_PUBLIC_ORIGIN || 'https://eyupinflatables.uk';

function contactAutoresponderTemplateKey(leadMetadata) {
    const siteKey = inferEnquirySiteKey({
        form_source: leadMetadata && leadMetadata.form_source,
        lead_metadata: leadMetadata
    });
    if (siteKey === 'inflatables' && brevoMail.getTemplateId('contact_autoresponder_inflatables')) {
        return 'contact_autoresponder_inflatables';
    }
    return 'contact_autoresponder';
}

function contactAutoresponderParams(parsed, quotePayload) {
    const base = {
        first_name: parsed.firstName,
        event_date: parsed.eventDate || '',
        quote_total:
            quotePayload.quote_total > 0 ? `£${quotePayload.quote_total.toFixed(2)}` : ''
    };
    const meta = parsed.leadMetadata || {};
    if (inferEnquirySiteKey({ lead_metadata: meta, form_source: meta.form_source }) === 'inflatables') {
        const origin = String(INFLATABLES_PUBLIC_ORIGIN).replace(/\/$/, '');
        return {
            ...base,
            site_name: 'EYUP! Inflatables',
            brand_name: 'EYUP! Inflatables',
            hire_list_link: `${origin}/hire.html`,
            checkout_link: `${origin}/checkout.html`
        };
    }
    return {
        ...base,
        site_name: 'EYUP EVENTS',
        brand_name: 'EYUP EVENTS'
    };
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

    let leadMetadata = enrichLeadMetadataFromBody(
        body,
        body.lead_metadata && typeof body.lead_metadata === 'object' ? { ...body.lead_metadata } : {}
    );
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
    const siteKey = inferEnquirySiteKey(req.body || {});
    if (!isContactFormEnabledForSite(settings, siteKey)) {
        return jsonError(
            res,
            'forbidden',
            contactFormDisabledMessageForSite(settings, siteKey) ||
                'Contact form is currently unavailable',
            403
        );
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
            const eventDurationHours = resolveEventDurationHours(parsed.leadMetadata);
            quotePayload = portalDb.normalizeEnquiryQuoteLineItems(parsed.quoteLineItems, {
                eventDurationHours
            });
        } catch (lineErr) {
            return jsonError(res, 'validation_error', lineErr.message || 'Invalid quote line items', 422);
        }
    }

    const voucherCode =
        parsed.leadMetadata &&
        (parsed.leadMetadata.voucher_code || parsed.leadMetadata.voucherCode);
    if (voucherCode) {
        const cartIds = quotePayload.quote_line_items
            .map((line) => line.product_id)
            .filter(Boolean);
        const vResult = validateVoucherForContext(voucherCode, cartIds);
        if (!vResult.valid) {
            return jsonError(
                res,
                'validation_error',
                vResult.message || 'Invalid voucher code',
                422,
                { voucher: { code: vResult.code, valid: false } }
            );
        }
        const discountAmt = computeVoucherDiscountAmount(quotePayload.quote_line_items, vResult);
        parsed.leadMetadata.voucher_code = vResult.code;
        parsed.leadMetadata.voucher_valid = true;
        parsed.leadMetadata.voucher_discount_percent = vResult.discount_percent;
        parsed.leadMetadata.voucher_discount_amount_server = discountAmt;
        parsed.leadMetadata.voucher_discount_amount = discountAmt;
        if (vResult.product_ids && vResult.product_ids.length) {
            parsed.leadMetadata.voucher_product_ids = vResult.product_ids;
        }
        if (vResult.applies_to) {
            parsed.leadMetadata.voucher_applies_to = vResult.applies_to;
        }
        if (discountAmt > 0 && quotePayload.quote_total > 0) {
            quotePayload.quote_total =
                Math.round(Math.max(0, quotePayload.quote_total - discountAmt) * 100) / 100;
        }
    }

    const clientHireTotal =
        parsed.leadMetadata && parsed.leadMetadata.hire_total != null
            ? Number(parsed.leadMetadata.hire_total)
            : null;
    if (
        Number.isFinite(clientHireTotal) &&
        quotePayload.quote_total > 0 &&
        Math.abs(clientHireTotal - quotePayload.quote_total) > 0.02
    ) {
        parsed.leadMetadata.quote_total_server = quotePayload.quote_total;
        parsed.leadMetadata.quote_total_client = clientHireTotal;
        parsed.leadMetadata.quote_total_mismatch = true;
        if (process.env.NODE_ENV !== 'production') {
            console.warn(
                '[portal] enquiry quote total mismatch — server:',
                quotePayload.quote_total,
                'client:',
                clientHireTotal
            );
        }
    } else if (quotePayload.quote_total > 0) {
        parsed.leadMetadata.quote_total_server = quotePayload.quote_total;
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
            const templateKey = contactAutoresponderTemplateKey(parsed.leadMetadata);
            const siteKey = inferEnquirySiteKey({
                lead_metadata: parsed.leadMetadata,
                form_source: parsed.leadMetadata && parsed.leadMetadata.form_source
            });
            await brevoMail.sendCustomerTemplateEmail({
                templateKey,
                user: {
                    email: parsed.email,
                    first_name: parsed.firstName,
                    last_name: parsed.lastName
                },
                params: contactAutoresponderParams(parsed, quotePayload),
                tags: [
                    'contact-enquiry',
                    siteKey === 'inflatables' ? 'inflatables-enquiry' : 'events-enquiry'
                ]
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
