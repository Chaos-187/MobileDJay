# Site settings — backend implementation guide

**Audience:** Developers implementing handlers on **`requests.eyupevents.uk`** (portal Node server: `portal/router.js`, `portal/admin-router.js`, SQLite `db/eyup_portal.db`).

**Consumer contract (HTTP):** [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md) §6.6.

**Marketing site (already shipped):**

| Piece | Path |
|-------|------|
| Public loader | `js/site-settings.js` |
| Admin UI | `events/admin.html` → **Website** tab, `events/js/events-admin-site.js` |
| API client | `events/js/events-api.js` → `getPublicSiteSettings`, `getAdminSiteSettings`, `putAdminSiteSettings` |
| Static fallback | `data/site-settings.json` (used when API is down) |

---

## 1. Goals

1. **Single source of truth** for navbar link visibility and contact-form availability across all public HTML pages.
2. **No auth** on public read; **admin JWT** on read/write in back-office.
3. **Safe validation** — reject unknown keys, coerce booleans, cap message length, always return a complete object (merged with defaults).
4. **CORS** — allow browser `fetch` from `eyupevents.uk` (and dev origins) without cookies.
5. **Audit** — log admin updates like other `/admin/*` mutations.

---

## 2. Routes

Mount under existing `/api/v1` prefix.

| Method | Path | Auth | Handler module (suggested) |
|--------|------|------|---------------------------|
| `GET` | `/public/site-settings` | None | `portal/public-router.js` (or top-level public routes) |
| `GET` | `/admin/site-settings` | Bearer + `role === admin` | `portal/admin-router.js` |
| `PUT` | `/admin/site-settings` | Bearer + `role === admin` | `portal/admin-router.js` |

**Do not** require Turnstile on these routes.

**Preflight:** `OPTIONS` for the public path must succeed for allowed origins (same global CORS middleware as auth/login).

---

## 3. CORS

Reuse the portal’s existing CORS helper (env **`PORTAL_CORS_ORIGINS`**, comma-separated).

### 3.1 Origins that must work

| Origin | Why |
|--------|-----|
| `https://eyupevents.uk` | Production marketing site |
| `https://www.eyupevents.uk` | www alias (if used) |
| `https://requests.eyupevents.uk` | Admin portal loads settings while signed in |
| `http://localhost:*` / `http://127.0.0.1:*` | Local static server + local API (dev only) |

Default allow-list should already include marketing + requests subdomains per §1.1 of the endpoint reference. If not, add `https://eyupevents.uk` explicitly.

### 3.2 Headers and credentials

Public marketing pages call:

```http
GET /api/v1/public/site-settings
Accept: application/json
```

with **`credentials: 'omit'`** (no cookies). CORS response:

| Header | Value |
|--------|--------|
| `Access-Control-Allow-Origin` | Request `Origin` if allowed, else omit / 403 on preflight |
| `Access-Control-Allow-Methods` | `GET, OPTIONS` (public); `GET, PUT, OPTIONS` (admin from browser) |
| `Access-Control-Allow-Headers` | `Accept, Content-Type, Authorization` |
| `Access-Control-Max-Age` | `86400` (optional) |

**Do not** set `Access-Control-Allow-Credentials: true` for the public route unless you also restrict origins tightly; the client does not send cookies.

Admin `PUT` from `https://eyupevents.uk/events/admin` sends **`Authorization: Bearer …`**. That is a “non-simple” request → browser sends **`OPTIONS`** first; ensure **`Authorization`** is in `Access-Control-Allow-Headers`.

### 3.3 Caching (public GET)

Marketing pages fetch on every load. Recommended response headers:

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

Optional: **`ETag`** / **`If-None-Match`** → **304** when unchanged (reduces bandwidth). Not required for v1.

Admin GET/PUT should use **`Cache-Control: no-store`**.

---

## 4. Storage

### 4.1 Recommended model: singleton row

Site settings are global config, not per-user. Store **one JSON document** in SQLite.

**Table:** `portal_site_settings` (or reuse a generic `portal_kv` with `key = 'site_settings'`).

```sql
CREATE TABLE IF NOT EXISTS portal_site_settings (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_user_id TEXT REFERENCES users(id)
);

-- Seed once (idempotent)
INSERT OR IGNORE INTO portal_site_settings (id, payload_json, updated_at)
VALUES ('default', '{}', datetime('now'));
```

**Read:** `SELECT payload_json, updated_at, updated_by_user_id FROM portal_site_settings WHERE id = 'default'`.

**Write:** `UPDATE portal_site_settings SET payload_json = ?, updated_at = datetime('now'), updated_by_user_id = ? WHERE id = 'default'`.

If no row exists on first read, treat as `{}` and merge defaults in application code (same as marketing `js/site-settings.js`).

### 4.2 Alternative: file on disk

Acceptable for single-node deploys only:

- Path e.g. `data/site-settings.json` next to the API process.
- **Downside:** no `updated_by`, harder in multi-instance / container deploys.
- Prefer SQLite for consistency with `admin_audit_log` and backups.

### 4.3 Payload shape (canonical)

Persist **only** the API shape (snake_case at top level). Example stored document after merge:

```json
{
  "nav": {
    "home": true,
    "services": true,
    "mobile_dj": true,
    "pa_rental": true,
    "karaoke": true,
    "photo_booth": true,
    "audio_guestbook": true,
    "inflatables": true,
    "outdoor_games": true,
    "for_djs": true,
    "mobile_requests_app": true,
    "dmx_lighting": true,
    "gallery": true,
    "about": true,
    "your_portal": true,
    "requests": true,
    "contact": true
  },
  "contact_form_enabled": true,
  "contact_form_disabled_message": "Sorry, we are currently fully booked. Please check back soon or call us on 07868 134663."
}
```

**Versioning (optional):** add `"schema_version": 1` inside JSON for future migrations; ignore on read if missing.

---

## 5. Defaults and merge

Server-side defaults **must match** `js/site-settings.js` (`EyupSiteSettings.DEFAULTS` / `mergeSettings`) so API and static fallback behave the same.

**Algorithm (`mergeSiteSettings(raw)`):**

1. Start from a hard-coded `DEFAULTS` object (copy from `js/site-settings.js`).
2. If `raw.nav` is an object, for each key in `DEFAULTS.nav`, if `typeof raw.nav[k] === 'boolean'`, set `out.nav[k] = raw.nav[k]`.
3. Ignore **unknown** `nav` keys (do not persist them).
4. If `typeof raw.contact_form_enabled === 'boolean'`, copy it.
5. If `raw.contact_form_disabled_message` is a non-empty string after trim, copy it (max length — see §6).
6. Return `out`.

**Never** return partial `nav` — always all 16 keys.

---

## 6. Validation (`PUT /admin/site-settings`)

Reject invalid bodies with **422** `validation_error` (see §8).

| Field | Rules |
|-------|--------|
| Body | Must be JSON object |
| `nav` | Optional; if present must be object |
| `nav.<key>` | Each value must be **boolean**; `<key>` must be in allow-list (§5) |
| `contact_form_enabled` | Optional; if present must be boolean |
| `contact_form_disabled_message` | Optional; string, trim, **1–500** chars after trim (HTML not allowed — strip tags or reject if `/<[a-z]/i.test`) |
| Extra top-level keys | **Reject** with `details.unknown_fields: ["foo"]` OR strip silently (prefer **reject** in admin API for clarity) |

**Partial PUT:** For v1, require **full** document from the admin UI (simpler). If you support partial PATCH later, document separately.

**When `contact_form_enabled === false`:** require non-empty `contact_form_disabled_message` **or** substitute server default message on save.

---

## 7. Handlers (outline)

### 7.1 Shared service `portal/site-settings-service.js`

```text
getSiteSettings()           → merged object
putSiteSettings(body, adminUserId) → validate → merge → UPDATE → audit → merged object
```

Keep DB and validation out of route files.

### 7.2 `GET /public/site-settings`

```text
1. settings = siteSettingsService.getSiteSettings()
2. res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
3. res.status(200).json(settings)
```

No JWT middleware. Rate-limit lightly if desired (e.g. 120/min per IP) — optional.

### 7.3 `GET /admin/site-settings`

```text
1. requireAdmin(req, res, next)
2. settings = siteSettingsService.getSiteSettings()
3. res.status(200).json(settings)
```

Same body as public route.

### 7.4 `PUT /admin/site-settings`

```text
1. requireAdmin(req, res, next)
2. body = parseJsonBody(req)  // 400 if invalid JSON
3. validated = validateSiteSettingsBody(body)  // 422 on failure
4. merged = mergeSiteSettings(validated)
5. siteSettingsService.save(merged, req.user.id)
6. auditLog.append({
     actor_user_id: req.user.id,
     action: 'site_settings.update',
     entity_type: 'site_settings',
     entity_id: 'default',
     details_json: { nav_keys_disabled: [...], contact_form_enabled: merged.contact_form_enabled }
   })
7. res.status(200).json(merged)
```

---

## 8. Error responses

Use the standard portal envelope ([`events-portal-api-endpoints.md`](events-portal-api-endpoints.md) §2):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid site settings",
    "details": {
      "nav.mobile_dj": "must be a boolean",
      "contact_form_disabled_message": "must be at most 500 characters"
    }
  }
}
```

| Status | `code` | When |
|--------|--------|------|
| 401 | `unauthorized` | Admin routes: missing/invalid JWT |
| 403 | `forbidden` | Valid JWT but not `admin`, or user disabled |
| 422 | `validation_error` | PUT body fails validation |
| 500 | `internal_error` | DB failure |

---

## 9. Admin audit log

Match existing **`admin_audit_log`** pattern (§6.5):

| Column | Example |
|--------|---------|
| `actor_user_id` | Admin UUID |
| `action` | `site_settings.update` |
| `entity_type` | `site_settings` |
| `entity_id` | `default` |
| `details` | JSON: `{ "contact_form_enabled": false, "nav_disabled": ["contact", "karaoke"] }` |

Do not store the full message text in audit if it might contain PII; storing booleans + disabled nav keys is enough.

---

## 10. Router wiring (sketch)

**`portal/public-router.js`** (or equivalent):

```javascript
router.get('/site-settings', async (req, res, next) => {
  try {
    const settings = await siteSettingsService.getSiteSettings();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(settings);
  } catch (e) { next(e); }
});
```

**`portal/admin-router.js`:**

```javascript
router.get('/site-settings', requireAdmin, async (req, res, next) => { ... });
router.put('/site-settings', requireAdmin, async (req, res, next) => { ... });
```

Ensure mount paths are:

- `app.use('/api/v1/public', publicRouter)` → **`/api/v1/public/site-settings`**
- `app.use('/api/v1/admin', adminRouter)` → **`/api/v1/admin/site-settings`**

---

## 11. Security notes

| Topic | Guidance |
|-------|----------|
| **Public read** | No secrets in settings; safe to expose. |
| **Write** | Admin only; no internal API key bypass. |
| **XSS** | Store plain text only; marketing site sets `textContent` on the message paragraph. |
| **CSRF** | Not applicable with Bearer token + no cookies on public fetch. |
| **Spam** | Disabling the contact form is a UI gate only; if enquiries POST to another endpoint, block there too when `contact_form_enabled === false`. |

---

## 12. Deployment checklist

- [ ] Migration creates `portal_site_settings` (or KV row).
- [ ] `GET /public/site-settings` returns merged defaults on empty DB.
- [ ] CORS preflight from `https://eyupevents.uk` succeeds.
- [ ] Admin `PUT` persists and `GET` returns same payload.
- [ ] `admin_audit_log` row on each `PUT`.
- [ ] Marketing site: disable **Contact** in admin → link hidden on homepage; contact form shows “fully booked” message.
- [ ] Remove reliance on static `data/site-settings.json` in production (optional keep as CDN fallback).

---

## 13. Local testing

```bash
# Public read (no auth)
curl -s -H "Origin: https://eyupevents.uk" \
  https://requests.eyupevents.uk/api/v1/public/site-settings | jq

# Admin write (replace TOKEN)
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @data/site-settings.json \
  https://requests.eyupevents.uk/api/v1/admin/site-settings | jq
```

**PowerShell** (portal repo): start API with same env as other admin routes; sign in via `/events/login` as admin and copy JWT from devtools / session storage.

---

## 14. Optional follow-ups (out of scope for v1)

- **Webhook / cache purge** after PUT to invalidate CDN edge cache for static HTML (usually unnecessary — settings are loaded via JS).
- **History table** `portal_site_settings_revisions` for rollback.
- **Feature flag** env `PORTAL_SITE_SETTINGS_ENABLED=false` → public route returns defaults only (kill switch).

---

*Document version: 1.0 — aligns with marketing site `js/site-settings.js` and API reference §6.6.*
