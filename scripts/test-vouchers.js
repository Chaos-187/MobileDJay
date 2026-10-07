#!/usr/bin/env node
/**
 * Unit tests for voucher discount math (no SQLite required).
 */
const assert = require('assert');
const { computeVoucherDiscountAmount } = require('../portal/vouchers-service');

function testUnrestrictedPercent() {
    const lines = [
        { product_id: 'a', line_subtotal: 100 },
        { product_id: 'b', line_subtotal: 50 }
    ];
    const amt = computeVoucherDiscountAmount(lines, {
        valid: true,
        discount_percent: 25,
        product_ids: null
    });
    assert.strictEqual(amt, 37.5);
}

function testRestrictedProductIds() {
    const lines = [
        { product_id: 'a', line_subtotal: 100 },
        { product_id: 'b', line_subtotal: 50 }
    ];
    const amt = computeVoucherDiscountAmount(lines, {
        valid: true,
        discount_percent: 50,
        product_ids: ['b']
    });
    assert.strictEqual(amt, 25);
}

function testInvalidVoucher() {
    assert.strictEqual(computeVoucherDiscountAmount([], { valid: false }), 0);
}

function main() {
    testUnrestrictedPercent();
    testRestrictedProductIds();
    testInvalidVoucher();
    console.log('test-vouchers: ok');
}

main();
