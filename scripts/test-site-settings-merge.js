#!/usr/bin/env node
const assert = require('assert');
const {
    mergeSiteSettings,
    inferEnquirySiteKey,
    isContactFormEnabledForSite,
    isMaintenanceModeForSite,
    getPublicSiteSettingsResponse
} = require('../portal/site-settings-service');

function testLegacyTopLevelOnly() {
    const merged = mergeSiteSettings({
        nav: { home: true },
        contact_form_enabled: false,
        contact_form_disabled_message: 'Closed for now'
    });
    assert.strictEqual(merged.contact_form_enabled, false);
    assert.strictEqual(merged.sites.events.contact_form_enabled, false);
    assert.strictEqual(merged.sites.inflatables.contact_form_enabled, false);
}

function testInflatablesIndependentContact() {
    const merged = mergeSiteSettings({
        nav: { home: true },
        contact_form_enabled: true,
        contact_form_disabled_message: 'Events closed',
        sites: {
            inflatables: {
                contact_form_enabled: false,
                contact_form_disabled_message: 'Inflatables closed',
                deposit_rate: 0.3
            }
        }
    });
    assert.strictEqual(merged.contact_form_enabled, true);
    assert.strictEqual(merged.sites.inflatables.contact_form_enabled, false);
    assert.strictEqual(merged.sites.inflatables.deposit_rate, 0.3);
}

function testPublicInflatablesSlice() {
    const merged = mergeSiteSettings({
        nav: { home: true },
        contact_form_enabled: true,
        contact_form_disabled_message: 'Events msg',
        sites: {
            inflatables: {
                contact_form_enabled: true,
                contact_form_disabled_message: 'Inf msg',
                deposit_rate: 0.2,
                featured_product_ids: ['a', 'b']
            }
        }
    });
    const pub = getPublicSiteSettingsResponse(merged, 'inflatables');
    assert.strictEqual(pub.site, 'inflatables');
    assert.strictEqual(pub.deposit_rate, 0.2);
    assert.deepStrictEqual(pub.featured_product_ids, ['a', 'b']);
}

function testMaintenanceBlocksCheckout() {
    const merged = mergeSiteSettings({
        nav: { home: true },
        contact_form_enabled: true,
        contact_form_disabled_message: 'Events msg',
        sites: {
            inflatables: {
                contact_form_enabled: true,
                maintenance_mode: true,
                maintenance_message: 'Back soon'
            }
        }
    });
    assert.strictEqual(isMaintenanceModeForSite(merged, 'inflatables'), true);
    assert.strictEqual(isContactFormEnabledForSite(merged, 'inflatables'), false);
    const pub = getPublicSiteSettingsResponse(merged, 'inflatables');
    assert.strictEqual(pub.maintenance_mode, true);
    assert.strictEqual(pub.maintenance_message, 'Back soon');
}

function testInferSite() {
    assert.strictEqual(
        inferEnquirySiteKey({ form_source: 'eyup_inflatables_website' }),
        'inflatables'
    );
    assert.strictEqual(inferEnquirySiteKey({ lead_metadata: { site: 'eyupinflatables' } }), 'inflatables');
    assert.strictEqual(isContactFormEnabledForSite(mergeSiteSettings({ contact_form_enabled: false }), 'events'), false);
}

function main() {
    testLegacyTopLevelOnly();
    testInflatablesIndependentContact();
    testPublicInflatablesSlice();
    testMaintenanceBlocksCheckout();
    testInferSite();
    console.log('test-site-settings-merge: ok');
}

main();
