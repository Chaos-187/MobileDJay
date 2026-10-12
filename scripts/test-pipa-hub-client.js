/**
 * Offline tests for PIPA Hub mapping (no API key required).
 */
const assert = require('assert');
const pipa = require('../portal/pipa-hub-client');

const sampleDevice = {
    Result_Value: 10,
    Result_Label: 'Valid',
    Tag_Current: 987654,
    Type_Label: 'Castle',
    Name: 'Test Castle',
    Description: 'A bouncy castle',
    Manufacturer: 'Acme Inflatables',
    SerialNo: 'SN-1',
    Status_Label: 'Pass',
    CertificateExpiry: '2026-12-01T00:00:00',
    Size_Length: 4.5,
    Size_Width: 3.2,
    Size_Height: 2.8,
    Owner_Name: 'EYUP Events'
};

const summary = pipa.summarizeDevice(sampleDevice);
assert.strictEqual(summary.lookup_ok, true);
assert.strictEqual(summary.tag_current, 987654);
assert.ok(summary.dimensions.includes('4.5'));

const { metadata, productFields } = pipa.buildCatalogMetadataPatch(sampleDevice, {}, {});
assert.strictEqual(metadata.pipa_hub_asset_id, '987654');
assert.strictEqual(metadata.specs['PIPA tag'], '987654');
assert.ok(Array.isArray(metadata.highlights) && metadata.highlights.length >= 1);
assert.strictEqual(Object.keys(productFields).length, 0);

const withName = pipa.buildCatalogMetadataPatch(sampleDevice, {}, { apply_name: true });
assert.strictEqual(withName.productFields.name, 'Test Castle');

assert.strictEqual(pipa.parseTagNumber('123'), 123);
assert.strictEqual(pipa.parseTagNumber('abc'), null);

try {
    pipa.buildCatalogMetadataPatch({ Result_Value: 0, Result_Label: 'Invalid' }, {}, {});
    assert.fail('expected throw for invalid device');
} catch (e) {
    assert.strictEqual(e.code, 'validation_error');
}

console.log('test-pipa-hub-client.js: OK');
