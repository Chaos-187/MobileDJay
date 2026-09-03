/**
 * Product catalog export/import as CSV (products + add-on link rows).
 */
const CSV_HEADERS = [
    'record_type',
    'code',
    'name',
    'description',
    'product_type',
    'image_url',
    'pricing_model',
    'standalone_rate',
    'minimum_hours',
    'currency',
    'capability_code',
    'allows_addons',
    'is_active',
    'sort_order',
    'parent_code',
    'addon_code',
    'addon_rate',
    'addon_pricing_model'
];

function escapeCsvField(value) {
    if (value == null || value === '') return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function csvRow(values) {
    return values.map(escapeCsvField).join(',');
}

function parseCsvBool(raw) {
    if (raw == null || String(raw).trim() === '') return true;
    const s = String(raw).trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no' || s === 'n') return false;
    return true;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQuotes) {
            if (c === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\r') {
            /* skip */
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function snapshotToCsv(snapshot) {
    const lines = [csvRow(CSV_HEADERS)];
    const products = snapshot && Array.isArray(snapshot.products) ? snapshot.products : [];
    products.forEach((p) => {
        lines.push(
            csvRow([
                'product',
                p.code,
                p.name,
                p.description || '',
                p.product_type || 'general',
                p.image_url || '',
                p.pricing_model || 'hourly',
                p.standalone_rate != null ? p.standalone_rate : '',
                p.minimum_hours != null && p.minimum_hours !== '' ? p.minimum_hours : '',
                p.currency || 'GBP',
                p.capability_code || '',
                p.allows_addons === false ? '0' : '1',
                p.is_active === false ? '0' : '1',
                p.sort_order != null ? p.sort_order : 0,
                '',
                '',
                '',
                ''
            ])
        );
        (p.addons || []).forEach((a) => {
            lines.push(
                csvRow([
                    'addon',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    p.code,
                    a.addon_code,
                    a.addon_rate != null ? a.addon_rate : '',
                    a.addon_pricing_model || ''
                ])
            );
        });
    });
    return lines.join('\r\n') + '\r\n';
}

function csvToImportPayload(csvText) {
    const table = parseCsv(csvText);
    if (!table.length) {
        throw new Error('CSV file is empty');
    }
    const header = table[0].map((h) => String(h).trim().toLowerCase());
    const idx = (name) => header.indexOf(name);

    const iType = idx('record_type');
    const iCode = idx('code');
    const iName = idx('name');
    if (iType < 0 || iCode < 0 || iName < 0) {
        throw new Error(
            'CSV must include columns: record_type, code, name (and other catalog fields)'
        );
    }

    const col = (row, key) => {
        const i = idx(key);
        return i >= 0 && row[i] != null ? String(row[i]).trim() : '';
    };

    const byCode = new Map();

    for (let r = 1; r < table.length; r++) {
        const row = table[r];
        const type = col(row, 'record_type').toLowerCase() || 'product';
        if (type === 'addon') {
            const parentCode = col(row, 'parent_code').toLowerCase();
            const addonCode = col(row, 'addon_code').toLowerCase();
            if (!parentCode || !addonCode) continue;
            let parent = byCode.get(parentCode);
            if (!parent) {
                parent = { code: parentCode, name: parentCode, addons: [] };
                byCode.set(parentCode, parent);
            }
            if (!Array.isArray(parent.addons)) parent.addons = [];
            const rateRaw = col(row, 'addon_rate');
            parent.addons.push({
                addon_code: addonCode,
                addon_rate: rateRaw === '' ? null : Number(rateRaw),
                addon_pricing_model: col(row, 'addon_pricing_model') || null
            });
            continue;
        }

        const code = col(row, 'code').toLowerCase();
        const name = col(row, 'name');
        if (!code || !name) continue;
        const minH = col(row, 'minimum_hours');
        const product = {
            code,
            name,
            description: col(row, 'description'),
            product_type: col(row, 'product_type') || 'general',
            image_url: col(row, 'image_url') || null,
            pricing_model: col(row, 'pricing_model') || 'hourly',
            standalone_rate: col(row, 'standalone_rate') === '' ? 0 : Number(col(row, 'standalone_rate')),
            minimum_hours: minH === '' ? null : Number(minH),
            currency: col(row, 'currency') || 'GBP',
            capability_code: col(row, 'capability_code') || null,
            allows_addons: parseCsvBool(col(row, 'allows_addons')),
            is_active: parseCsvBool(col(row, 'is_active')),
            sort_order: col(row, 'sort_order') === '' ? 0 : Number(col(row, 'sort_order')),
            addons: []
        };
        const existing = byCode.get(code);
        if (existing && Array.isArray(existing.addons) && existing.addons.length) {
            product.addons = existing.addons.slice();
        }
        byCode.set(code, product);
    }

    return { products: [...byCode.values()] };
}

module.exports = { CSV_HEADERS, snapshotToCsv, csvToImportPayload, parseCsv };
