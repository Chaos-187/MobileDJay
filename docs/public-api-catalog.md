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

Multi-site planning: [`../../docs/multi-site-portal/03-api-and-cors.md`](../../docs/multi-site-portal/03-api-and-cors.md)
