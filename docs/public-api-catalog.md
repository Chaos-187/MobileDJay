# Public API — catalog (marketing sites)

Base path: **`/api/v1/public`** (see `portal/public-router.js`).

## `GET /catalog/quote-products`

Grouped catalog for EYUP EVENTS contact quote builder and EYUP Inflatables hire list.

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `product_type` | No | When set (e.g. `inflatables`), only products with that effective type are returned. Omit for full catalog (Events default). |

Slug normalization: lowercase, spaces → `_` (same as admin `product_type`).

### Response `200`

```json
{
  "products": [ { "…": "see Product object below" } ],
  "groups": [ { "code", "label", "sort_order", "products": [ … ] } ],
  "product_types": [ { "code", "label", "sort_order" } ],
  "product_type_filter": "inflatables"
}
```

`product_type_filter` is present only when the query param was applied.  
`product_types` is narrowed to the filtered type when filtering.

Add-on-only products (`addon_only`) are excluded from public lists.

### Product object (public quote / hire)

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Catalog UUID |
| `name`, `description` | string | |
| `product_type`, `product_type_label` | string | e.g. `inflatables` |
| `pricing_model` | `hourly` \| `flat` \| `unit` | |
| `standalone_rate` | number | Base rate or tier-1 package price |
| `minimum_hours` | number \| null | Hourly minimum / included hours |
| `additional_hourly_rate` | number \| null | Tiered hourly: rate after `minimum_hours` |
| `filter_group` | string \| null | Inflatables hire filters (e.g. `kids-castles`) |
| `highlights` | string[] | Marketing bullets |
| `specs` | object | Key/value specs for product page |
| `hire_only_addon` | boolean | Same as DB `addon_only` (Inflatables client alias) |
| `currency` | string | Default `GBP` |
| `allows_addons` | boolean | |
| `image_url` | string \| null | Public catalog image URL |
| `addons` | array | Linked add-on products with rates |

### Cache

`Cache-Control: public, max-age=120, stale-while-revalidate=600`

---

## `GET /catalog/inflatables-availability`

Blocked hire windows for active inflatable products (live checkout overlap checks).

### Response `200`

```json
{
  "blocks": [
    {
      "product_id": "uuid",
      "start": "2026-06-01T09:00",
      "end": "2026-06-01T17:00",
      "reason": "Booked"
    }
  ]
}
```

`start` / `end` are stored datetimes (typically local-style strings from admin). Clients treat `reason` like `note` in the Inflatables UI.

### Cache

`Cache-Control: public, max-age=60, stale-while-revalidate=300`

---

## `POST /vouchers/validate`

Validate a hire voucher against the current cart product IDs (same shape as Inflatables demo `sample-data.js`).

### Body

```json
{
  "code": "EYUP",
  "product_ids": ["catalog-product-uuid", "…"]
}
```

### Response `200`

```json
{
  "valid": true,
  "code": "EYUP",
  "discount_percent": 25,
  "product_ids": null,
  "applies_to": "",
  "invalid_message": ""
}
```

When invalid, `valid` is `false`, `discount_percent` is `0`, and `message` may explain product restrictions.

Enquiries with `lead_metadata.voucher_code` are re-validated on **`POST /public/enquiries`**; invalid codes return **422**; valid codes adjust server `quote_total` by the computed discount.

---

Multi-site planning: [`../../docs/multi-site-portal/03-api-and-cors.md`](../../docs/multi-site-portal/03-api-and-cors.md)
