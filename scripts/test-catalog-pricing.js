#!/usr/bin/env node
/**
 * Unit tests for tiered hourly pricing (Phase 2).
 */
const {
    hourlyLineTotal,
    computeLineSubtotal,
    resolveEventDurationHours,
    enrichLeadMetadataFromBody
} = require('../portal/catalog-pricing');

function assert(condition, message) {
    if (!condition) {
        console.error('FAIL:', message);
        process.exitCode = 1;
        return false;
    }
    console.log('OK:', message);
    return true;
}

const tieredProduct = {
    pricing_model: 'hourly',
    standalone_rate: 80,
    minimum_hours: 4,
    additional_hourly_rate: 20
};

assert(hourlyLineTotal(tieredProduct, 4) === 80, 'tiered: 4h pays base package');
assert(hourlyLineTotal(tieredProduct, 6) === 120, 'tiered: 6h pays base + 2 extra hours');
assert(hourlyLineTotal(tieredProduct, 2) === 80, 'tiered: under minimum hours still base package');

const flatHourly = {
    pricing_model: 'hourly',
    standalone_rate: 50,
    minimum_hours: 2,
    additional_hourly_rate: null
};
assert(hourlyLineTotal(flatHourly, 3) === 150, 'flat hourly: rate × hours with min');

assert(
    computeLineSubtotal(tieredProduct, {
        pricing_model: 'hourly',
        quantity: 1,
        hours: 6,
        unit_rate: 80
    }) === 120,
    'computeLineSubtotal uses tiered rules'
);

assert(
    computeLineSubtotal(flatHourly, {
        pricing_model: 'hourly',
        quantity: 1,
        hours: 3,
        unit_rate: 50
    }) === 150,
    'computeLineSubtotal flat hourly unchanged'
);

const duration = resolveEventDurationHours({
    event_start_datetime: '2026-07-01T10:00',
    event_end_datetime: '2026-07-01T16:00'
});
assert(duration === 6, 'resolve duration from datetimes');

const meta = enrichLeadMetadataFromBody(
    {
        event_start_datetime: '2026-07-01T09:00',
        event_end_datetime: '2026-07-01T13:00'
    },
    { form_source: 'eyup_inflatables_website' }
);
assert(meta.hire_duration_hours === 4, 'enrichLeadMetadataFromBody sets hire_duration_hours');
assert(meta.form_source === 'eyup_inflatables_website', 'enrich preserves existing metadata');

if (process.exitCode) {
    console.error('\nCatalog pricing tests failed.');
    process.exit(1);
}
console.log('\nCatalog pricing tests passed.');
