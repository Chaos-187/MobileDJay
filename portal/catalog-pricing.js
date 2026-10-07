/**
 * Shared catalog line pricing (Events quote builder + Inflatables tiered hourly).
 */

function minimumHours(product) {
    if (!product || product.pricing_model !== 'hourly') return 0;
    const min = Number(product.minimum_hours);
    return Number.isFinite(min) && min > 0 ? min : 1;
}

function usesTieredHourly(product) {
    if (!product || product.pricing_model !== 'hourly') return false;
    const extra = product.additional_hourly_rate;
    return extra != null && extra !== '' && Number.isFinite(Number(extra));
}

function basePackagePrice(product) {
    return Number(product && product.standalone_rate) || 0;
}

function additionalHourlyRate(product) {
    if (!usesTieredHourly(product)) {
        return Number(product && product.standalone_rate) || 0;
    }
    return Number(product.additional_hourly_rate) || 0;
}

function hourlyLineTotal(product, eventHours) {
    if (!product || product.pricing_model !== 'hourly') return 0;
    if (usesTieredHourly(product)) {
        const baseCost = basePackagePrice(product);
        const baseHours = minimumHours(product);
        const extraRate = additionalHourlyRate(product);
        if (eventHours == null || !Number.isFinite(eventHours)) return baseCost;
        if (eventHours <= baseHours) return baseCost;
        return baseCost + (eventHours - baseHours) * extraRate;
    }
    const rate = basePackagePrice(product);
    const billH =
        eventHours == null || !Number.isFinite(eventHours)
            ? minimumHours(product)
            : Math.max(eventHours, minimumHours(product));
    return rate * billH;
}

function parseDateTimeLocal(value) {
    const s = String(value || '').trim();
    if (!s || !s.includes('T')) return null;
    const [datePart, timePart] = s.split('T');
    const dateParts = datePart.split('-');
    const timeParts = (timePart || '').split(':');
    if (dateParts.length < 3 || timeParts.length < 2) return null;
    const y = Number(dateParts[0]);
    const mo = Number(dateParts[1]) - 1;
    const d = Number(dateParts[2]);
    const h = Number(timeParts[0]);
    const min = Number(timeParts[1]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    const dt = new Date(y, mo, d, h, min, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function eventDurationHoursFromDateTimes(startValue, endValue) {
    const start = parseDateTimeLocal(startValue);
    const end = parseDateTimeLocal(endValue);
    if (!start || !end || end <= start) return null;
    return Math.round(((end.getTime() - start.getTime()) / 3600000) * 100) / 100;
}

function resolveEventDurationHours(source) {
    if (!source || typeof source !== 'object') return null;
    const direct = Number(source.hire_duration_hours);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const start = source.event_start_datetime || source.event_start;
    const end = source.event_end_datetime || source.event_end;
    if (start && end) {
        return eventDurationHoursFromDateTimes(start, end);
    }
    return null;
}

function applyLineDiscount(base, discountType, discountValue) {
    const dt = discountType || 'none';
    const dv = Number(discountValue);
    let total = base;
    if (dt === 'percent' && Number.isFinite(dv)) {
        total = base * (1 - Math.min(Math.max(dv, 0), 100) / 100);
    } else if (dt === 'fixed' && Number.isFinite(dv)) {
        total = base - Math.max(dv, 0);
    }
    return Math.round(Math.max(0, total) * 100) / 100;
}

function computeLineSubtotal(
    productRow,
    {
        pricing_model: pricingModel,
        quantity,
        hours,
        unit_rate: unitRate,
        discount_type: discountType,
        discount_value: discountValue
    }
) {
    const product = productRow || {};
    const model = pricingModel || product.pricing_model || 'hourly';
    const qty = Number(quantity);
    const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
    let base = 0;

    if (model === 'hourly') {
        const h = hours != null && hours !== '' ? Number(hours) : null;
        if (usesTieredHourly(product)) {
            base = hourlyLineTotal(product, Number.isFinite(h) && h > 0 ? h : null);
        } else {
            const r = Number.isFinite(Number(unitRate)) ? Number(unitRate) : basePackagePrice(product);
            const billH =
                Number.isFinite(h) && h > 0 ? Math.max(h, minimumHours(product)) : minimumHours(product);
            base = r * billH;
        }
    } else if (model === 'unit') {
        const r = Number.isFinite(Number(unitRate)) ? Number(unitRate) : basePackagePrice(product);
        base = r * q;
    } else {
        const r = Number.isFinite(Number(unitRate)) ? Number(unitRate) : basePackagePrice(product);
        base = r * q;
    }

    return applyLineDiscount(base, discountType, discountValue);
}

function enrichLeadMetadataFromBody(body, leadMetadata) {
    const meta =
        leadMetadata && typeof leadMetadata === 'object' ? { ...leadMetadata } : {};
    const b = body && typeof body === 'object' ? body : {};

    const copyIfMissing = (key) => {
        if (meta[key] != null && String(meta[key]).trim() !== '') return;
        if (b[key] != null && String(b[key]).trim() !== '') meta[key] = String(b[key]).trim();
    };

    [
        'event_start_datetime',
        'event_end_datetime',
        'event_start_time',
        'event_end_time',
        'event_end_date',
        'site'
    ].forEach(copyIfMissing);

    if (meta.hire_duration_hours == null) {
        const resolved = resolveEventDurationHours(meta);
        if (resolved != null) meta.hire_duration_hours = resolved;
    }

    return meta;
}

module.exports = {
    minimumHours,
    usesTieredHourly,
    hourlyLineTotal,
    computeLineSubtotal,
    resolveEventDurationHours,
    eventDurationHoursFromDateTimes,
    enrichLeadMetadataFromBody
};
