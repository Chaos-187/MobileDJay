# EYUP Events Portal — HTTP API endpoint reference

**Purpose:** Machine- and human-readable contract for consumers (e.g. `eyupevents.uk` static site). Aligns with `portal/router.js` (including `portal/admin-router.js`).

**Related:** Product/domain notes — [`events-portal-api-spec.md`](events-portal-api-spec.md).  
**Separate:** MobileDJay **song-request event** routes (`/api/events/…`, cancel/postpone) — [`mobilejay-events-api.md`](mobilejay-events-api.md).

---

## 1. General

| Item | Value |
|------|--------|
| **Base path** | `/api/v1` |
| **Full URL (production)** | `https://requests.eyupevents.uk/api/v1` |
| **Content-Type** | `application/json` for bodies where noted |
| **Character encoding** | UTF-8 |

### 1.1 CORS

Browser calls from **`https://eyupevents.uk`** (and configured origins) must target **`https://requests.eyupevents.uk`**. Allowed origins default includes marketing + requests subdomains; override with env `PORTAL_CORS_ORIGINS` (comma-separated).

### 1.2 Authentication

After login or register, send:

```http
Authorization: Bearer <access_token>
```

- Token type: **JWT** (HS256).
- **Access token only** in this version (no refresh-token rotation server-side). `POST /auth/logout` returns **204** with empty body; client discards stored tokens.
- Updating the password (**`POST /auth/change-password`**) does **not** revoke already-issued JWTs; old tokens remain valid until **exp**.
- Protected routes without/bad token → **401** with error envelope (see §2).
- Every **Bearer** request reloads the user row: unknown id → **401**; **`disabled_at` set** → **403** (`forbidden`) even if the JWT is not expired.

**JWT payload (claims)** — informative only; do not trust role from client; server re-validates on each request:

| Claim | Meaning |
|-------|---------|
| `sub` | User UUID |
| `role` | `customer` \| `dj` \| `admin` |
| `email` | Normalised email |
| `exp` | Expiry (Unix time) |
| `jti` | Unique token id |

Role enforcement: each route requires the **documented** `role` (`customer`, `dj`, or **`admin`**) or responds **403** (`forbidden`).

**Login / register — Cloudflare Turnstile (optional):** Set **`CLOUDFLARE_TURNSTILE_SECRET_KEY`** (alias **`TURNSTILE_SECRET_KEY`**) on **`requests.eyupevents.uk`**. When set, **`POST /auth/login`**, **`POST /auth/login/google`**, and **`POST /auth/register`** require **`cf_turnstile_response`** in the JSON body; the server verifies against **`https://challenges.cloudflare.com/turnstile/v0/siteverify`** before issuing JWTs. When unset, verification is skipped (backward compatible).

**Customer Google Sign-In (optional):** Set **`PORTAL_GOOGLE_CLIENT_ID`** (or **`PORTAL_GOOGLE_CLIENT_IDS`** for multiple OAuth Web clients). When unset, **`POST /auth/login/google`** returns **`503`** `service_unavailable`. Frontend GIS must use an **Authorized JavaScript origin** matching the site where **`window.__EYUP_GOOGLE_CLIENT_ID__`** is set (e.g. **`/events/login`**, **`/events/customer`** gate).

### 1.3 Dates and IDs

- **Booking `id`:** UUID string (e.g. from seed/demo).
- **Datetime fields:** ISO 8601 strings as stored (typically UTC, e.g. `2026-05-29T18:00:00.000Z`). Clients should parse as ISO dates.
- **Booking `status`:** `confirmed` \| `pending` \| `cancelled` (cancelled bookings excluded from “upcoming” lists).

### 1.4 Customer PII encryption at rest (SQLite)

When **`PORTAL_PII_ENCRYPTION_KEY`** is set, the portal DB encrypts selected customer-linked fields with **AES-256-GCM** before writing to `db/eyup_portal.db`:

- **`users`:** `email`, `first_name`, `last_name`, `phone` (login uses a stable HMAC id in the `email` column; JWTs still receive real email after decrypt).
- **`bookings`:** `contact_name`, `enquiry_message`, `hear_about`.
- **`booking_customer_notes`**, **`customer_account_notes`**, **`music_plans.payload`** (free-text / JSON preferences).

**Key format:** 64 hex characters (32 bytes), or Base64 decoding to exactly **32 bytes**, or any string (hashed to 32 bytes — weaker; prefer random bytes). **Back up the key**; loss = irrecoverable plaintext from encrypted columns.

On first start with a key, existing plaintext rows are migrated in a single transaction (`p1.`-prefixed ciphertext). If the key is **unset**, behaviour is unchanged (plaintext; production logs a warning).

--- 

## 2. Error response

All error responses use this JSON shape when the handler returns JSON:

```json
{
  "error": {
    "code": "string_machine_readable",
    "message": "Human readable message",
    "details": {}
  }
}
```

`details` is an object; often `{}`.

**Typical HTTP status codes**

| Status | When |
|--------|------|
| 400 | Bad request (generic) |
| 401 | Missing/invalid `Authorization`, invalid credentials, expired JWT |
| 403 | Wrong role for route, or **account disabled** (`disabled_at`), or **explicit** policy reject (e.g. customer **`PATCH /customer/details`** with `email`) |
| 404 | Resource not found **or** forbidden resource hidden as not found (booking id enumeration) |
| 409 | Conflict (e.g. email already registered) |
| 422 | Validation (missing fields, wrong types, illegal query) |
| 500 | Server error |
| 503 | Service unavailable (e.g. internal API disabled — missing `PORTAL_INTERNAL_API_KEY`) |

**Common `error.code` values**

| Code | Typical status |
|------|----------------|
| `unauthorized` | 401 |
| `invalid_token` | 401 |
| `invalid_credentials` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `validation_error` | 422 |
| `turnstile_failed` | 400 |
| `internal_error` | 500 |
| `service_unavailable` | 503 |

---

## 3. Shared JSON types

### 3.1 `BookingCard`

Used in list/detail responses (subset of booking; no internal-only fields unless noted).

```json
{
  "id": "uuid",
  "title": "string",
  "start_datetime": "ISO8601",
  "end_datetime": "ISO8601",
  "venue": "string",
  "service": "string",
  "status": "confirmed",
  "reference": "EY-1042",
  "contact_name": "string",
  "deposit_paid": false,
  "deposit_amount": 250,
  "deposit_currency": "GBP",
  "deposit_paid_at": "ISO8601 | null",
  "deposit_note": "string | null"
}
```

- **`deposit_amount`:** `null` if not set.

### 3.2 `CrewAssignment`

Returned on **DJ** booking payloads as **`assignment`** (this crew member’s row in **`booking_assignments`** for that gig).

```json
{
  "crew_role_label": "string | null",
  "crew_capabilities": ["string"]
}
```

- **`crew_capabilities`:** JSON array of service/skill codes after server parse, or **`null`** if unset / invalid JSON in DB.

### 3.3 `MusicPlanPayload`

Default/global music plan for a customer (`booking_id` null in DB). Normalised on read/write.

```json
{
  "must_play": ["string"],
  "dont_play": ["string"],
  "dont_play_early": ["string"],
  "floor_fillers": ["string"],
  "first_dance": "string",
  "last_dance": "string",
  "parent_dances": "string"
}
```

- Arrays default to `[]` if omitted or invalid.
- String fields default to `""`.

---

## 4. Auth endpoints

### `POST /auth/register`

Creates a **customer** account only. **Must not** send `role` in the body (422 if present).

When **`CLOUDFLARE_TURNSTILE_SECRET_KEY`** (or **`TURNSTILE_SECRET_KEY`**) is set on the server, the body **must** include **`cf_turnstile_response`** (widget token). The server POSTs to **`https://challenges.cloudflare.com/turnstile/v0/siteverify`** before creating the user. If the secret is **unset**, Turnstile is skipped (local/dev).

**Request body**

```json
{
  "email": "string (required)",
  "password": "string (required, min 8 characters)",
  "first_name": "string (optional)",
  "last_name": "string (optional)",
  "cf_turnstile_response": "string (required when Turnstile secret env is set)"
}
```

**Response `201`**

```json
{
  "access_token": "jwt",
  "token_type": "Bearer",
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "customer",
    "first_name": "string | null"
  }
}
```

The embedded **`user`** is a minimal summary. Use **`GET /auth/me`** after login for **`last_name`**, **`phone`**, etc.

**Errors:** `validation_error` (422; includes **`password`** under **min 8 characters**), `conflict` (409), **`turnstile_failed`** (400, see `details.error_codes`), `internal_error` (500).

---

### `POST /auth/login`

**Must not** send `role` in the body (422 if present).

Same Turnstile rule as **register**: if the Turnstile secret env var is set, **`cf_turnstile_response`** is required and verified before tokens are issued.

**Request body**

```json
{
  "email": "string (required)",
  "password": "string (required)",
  "cf_turnstile_response": "string (required when Turnstile secret env is set)"
}
```

**Response `200`**

```json
{
  "access_token": "jwt",
  "token_type": "Bearer",
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "customer | dj | admin",
    "first_name": "string | null"
  }
}
```

Same minimal **`user`** shape as **`POST /auth/register`**; use **`GET /auth/me`** for full profile fields.

**Errors:** `validation_error` (422), `invalid_credentials` (401), `forbidden` (**403** — account disabled), **`turnstile_failed`** (400, see `details.error_codes`), `internal_error` (500).

---

### `POST /auth/login/google`

**Customer portal — Google Sign-In.** Same **`access_token` + `user`** response as **`POST /auth/login`**, but only when a portal user exists with **`role === customer`** whose **`email`** matches **`email`** in a verified Google **ID token** (payload **`email_verified`** true).

**Must not** send `role` in the body (**422** if present).

**Server responsibilities:** **`google-auth-library`** verifies JWT signature, **`iss`** (accounts.google.com / https://accounts.google.com), **`aud`** (must match **`PORTAL_GOOGLE_CLIENT_ID`** values), **`exp`**, and checks **`email_verified`**.

Turnstile: same rule as **`POST /auth/login`** (**§1.2**) when **`CLOUDFLARE_TURNSTILE_SECRET_KEY`** is set.

**Request body**

```json
{
  "id_token": "string (required — GIS credential JWT)",
  "cf_turnstile_response": "string (required when Turnstile secret env is set)"
}
```

**Response `200`:** Same shape as **`POST /auth/login`** (**`role`** `"customer"` for Google path).

**Errors:** `validation_error` (422), `invalid_credentials` (**401** — bad token / no portal customer email), **`forbidden`** (**403** — disabled, **`email_verified` false**, or matching user **`role`** is not **`customer`**), **`turnstile_failed`** (400), **`service_unavailable`** (**503** — Google client ID env not configured), `internal_error` (500).

---

### `POST /auth/logout`

No auth required.

**Response `204`:** empty body.

---

### `POST /auth/change-password`

**Auth:** Bearer required. Any role (**customer**, **dj**, **admin**) with a **`password_hash`** (password login enabled).

**Request body**

```json
{
  "current_password": "string (required)",
  "new_password": "string (required, min 8 characters)"
}
```

**Response `204`:** empty body.

**Errors:** `validation_error` (422; missing fields, same as current password, no password login on account), `invalid_credentials` (401 — wrong current password), `internal_error` (500).

Issued JWTs are **unchanged**: clients may keep using existing tokens until they expire (**§1.2**).

---

### `POST /auth/delete-account`

**Auth:** Bearer required — user deletes **their own** row only.

**Request body**

- If **`password_hash` is set** (normal login account): **`password`** — required plain password for confirmation (**401** if wrong).
- If **passwordless** (e.g. customer created via internal/admin without password): **`confirm_passwordless_delete`:** **`true`** (boolean) — required so deletion is deliberate (**422** if missing/false).

**Response `204`:** empty body on success.

**Conflicts (**`409`** `conflict`):**

| `details.reason` | Meaning |
|------------------|--------|
| `customer_has_bookings` | Customer accounts with **any** booking row (any status) cannot self-delete here (preserve records; contact support). |
| `dj_has_upcoming` | DJs with an assignment on a **non-cancelled** booking whose **`end_datetime` ≥ now** cannot self-delete yet. |
| `last_admin` | The **last active** admin cannot delete their account. |

**Errors:** `validation_error` (422), `invalid_credentials` (401 — wrong **`password`**), `not_found` (404), `conflict` (409), `internal_error` (500).

---

### `GET /auth/me`

**Auth:** Bearer required.

**Response `200`** — common fields:

```json
{
  "id": "uuid",
  "email": "string",
  "role": "customer | dj | admin",
  "first_name": "string | null",
  "last_name": "string | null",
  "phone": "string | null"
}
```

For **`role`** **`dj`** or **`admin`** only, **`capabilities`** is also present: **`["string"] | null`** (parsed from DB). **`customers`** do not receive **`capabilities`**.

**Errors:** `unauthorized` / `invalid_token` (401), `forbidden` (**403** — disabled account), `not_found` (404).

---

## 4.5 Portal “events” (`/events` aliases)

In the database, scheduled gigs are stored in the **`bookings`** table. For product copy that says **event** instead of booking, the same JWT and internal routes are mirrored under **`/events`**:

| Use | Path prefix | List response key |
|-----|-------------|---------------------|
| Customer | `/customer/events` | `{ "events": [ … ] }` on **`GET`** (same items as **BookingCard** §3.1) |
| Customer | `/customer/bookings` | `{ "bookings": [ … ] }` |
| DJ / crew | `/dj/events/upcoming` | `{ "events": [ … ] }` |
| DJ / crew | `/dj/bookings/upcoming` | `{ "bookings": [ … ] }` |
| Internal (n8n) | `POST /internal/events` | Same as **`POST /internal/bookings`** |

**Unchanged between aliases:** `GET`/`PATCH`/`POST`/`DELETE` path params and response field names (e.g. **`booking_customer_note`**, **`crew_notes`**) stay the same so one client can migrate by path only.

---

## 5. Customer endpoints

All require **Bearer** and **`role === customer`**.

### `GET /customer/bookings`

**Query**

| Parameter | Values | Default |
|-----------|--------|---------|
| `scope` | `next_upcoming` \| `upcoming_all` \| `past_all` | `upcoming_all` |

Semantics:

- `next_upcoming` and `upcoming_all`: bookings where `end_datetime >= now`, `status != cancelled`, and not **hidden** from dashboard (ordered by `start_datetime` ascending).
- `next_upcoming`: **first only** (0 or 1 item).
- `upcoming_all`: all matching rows.
- `past_all`: bookings that have **ended** (`end_datetime < now`) for this customer, newest first (any status). Does not apply the dashboard hide filter.

**Response `200`**

Array items match **BookingCard** (§3.1).

```json
{
  "bookings": []
}
```

**Errors:** `validation_error` (422) if `scope` invalid (allowed: `next_upcoming`, `upcoming_all`, `past_all`).

---

### `GET /customer/bookings/:id`

**Response `200`:** **BookingCard** (§3.1), including **deposit** fields, plus customer-visible fields only:

```json
{
  "id": "uuid",
  "title": "string",
  "start_datetime": "ISO8601",
  "end_datetime": "ISO8601",
  "venue": "string",
  "service": "string",
  "status": "string",
  "reference": "string",
  "contact_name": "string",
  "deposit_paid": false,
  "deposit_amount": null,
  "deposit_currency": "GBP",
  "deposit_paid_at": null,
  "deposit_note": null,
  "notes_from_company": "string",
  "booking_customer_note": "string"
}
```

- `notes_from_company` is the “Message from EYUP” field (empty string if null in DB).
- Does **not** include `dj_briefing` or crew notes.

**Errors:** `not_found` (404) if id unknown or not owned by customer.

---

### `PATCH /customer/bookings/:id/note`

**Request body**

```json
{
  "body": "string (required, customer's note to crew)"
}
```

**Response `200`**

```json
{
  "booking_customer_note": "string",
  "updated_at": "ISO8601 or DB datetime string"
}
```

**Errors:** `not_found` (404), `validation_error` (422).

---

### `POST /customer/bookings/:id/hide`

Marks booking hidden from customer dashboard list (preference persists server-side).

**Response `200`**

```json
{
  "hidden_from_dashboard": true
}
```

**Errors:** `not_found` (404).

---

### `DELETE /customer/bookings/:id/hide`

Clears hide flag.

**Response `200`**

```json
{
  "hidden_from_dashboard": false
}
```

**Errors:** `not_found` (404).

---

### `GET /customer/details`

Contact-form parity profile (Your details tab). **Does not** include booking-specific fields.

**Response `200`**

```json
{
  "first_name": "string | null",
  "last_name": "string | null",
  "email": "string",
  "phone": "string | null"
}
```

---

### `PATCH /customer/details`

Partial update of **`first_name`**, **`last_name`**, **`phone`**. At least one field required.

- **`email`:** must **not** appear in the body (422) — identity changes require a separate verified flow.

**Response `200`:** same shape as **`GET /customer/details`**.

**Errors:** `validation_error` (422).

---

### `GET /customer/profile`

Returns **default** music plan (`booking_id` null) and ordered account note lines.

**Response `200`**

```json
{
  "account_notes": ["string"],
  "music_plan": {
    "must_play": ["string"],
    "dont_play": ["string"],
    "dont_play_early": ["string"],
    "floor_fillers": ["string"],
    "first_dance": "string",
    "last_dance": "string",
    "parent_dances": "string"
  },
  "music_plan_summary": "plain text derived server-side"
}
```

---

### `PUT /customer/profile`

Partial update: include only fields to change.

**Request body**

```json
{
  "account_notes": ["string"],
  "music_plan": {
    "must_play": ["string"],
    "dont_play": ["string"],
    "dont_play_early": ["string"],
    "floor_fillers": ["string"],
    "first_dance": "string",
    "last_dance": "string",
    "parent_dances": "string"
  }
}
```

- If `account_notes` is present: must be **array of strings**; replaces all account notes order.
- If `music_plan` is present: replaces **default** plan only (not per-booking overrides).

**Response `200`:** same shape as `GET /customer/profile`.

**Errors:** `validation_error` (422).

---

## 6. DJ endpoints

All require **Bearer** and **`role === dj`**. Booking access is limited to rows in **`booking_assignments`** for that DJ.

### `GET /dj/bookings/upcoming`

**Response `200`**

Each item is **BookingCard** (§3.1) plus **`dj_briefing`** and per-row **`assignment`** (this crew member on this gig).

```json
{
  "bookings": [
    {
      "id": "uuid",
      "title": "string",
      "start_datetime": "ISO8601",
      "end_datetime": "ISO8601",
      "venue": "string",
      "service": "string",
      "status": "confirmed",
      "reference": "string",
      "contact_name": "string",
      "deposit_paid": false,
      "deposit_amount": null,
      "deposit_currency": "GBP",
      "deposit_paid_at": null,
      "deposit_note": null,
      "dj_briefing": "string",
      "assignment": {
        "crew_role_label": "string | null",
        "crew_capabilities": ["string"]
      }
    }
  ]
}
```

- Filter: assigned to DJ, `end_datetime >= now`, `status != cancelled`, ordered by `start_datetime` ascending.

---

### `GET /dj/bookings/:id`

**Music plan resolution**

1. If a **per-booking** music plan exists for `booking.customer_id` + this `booking.id`, use it.
2. Else if a **default** plan exists (`booking_id` null), use it.
3. Else empty `MusicPlanPayload`.

**Response `200`**

Booking fields match **BookingCard** (§3.1); additional fields below.

```json
{
  "id": "uuid",
  "title": "string",
  "start_datetime": "ISO8601",
  "end_datetime": "ISO8601",
  "venue": "string",
  "service": "string",
  "status": "confirmed",
  "reference": "string",
  "contact_name": "string",
  "deposit_paid": false,
  "deposit_amount": null,
  "deposit_currency": "GBP",
  "deposit_paid_at": null,
  "deposit_note": null,
  "dj_briefing": "string",
  "assignment": {
    "crew_role_label": "string | null",
    "crew_capabilities": ["string"]
  },
  "music_plan": {
    "must_play": ["string"],
    "dont_play": ["string"],
    "dont_play_early": ["string"],
    "floor_fillers": ["string"],
    "first_dance": "string",
    "last_dance": "string",
    "parent_dances": "string"
  },
  "music_plan_summary": "string",
  "crew_notes": "string",
  "crew_notes_updated_at": "string | null"
}
```

**Errors:** `not_found` (404) if not assigned.

---

### `PATCH /dj/bookings/:id/crew-notes`

**Request body**

```json
{
  "body": "string (required)"
}
```

**Response `200`**

```json
{
  "crew_notes": "string",
  "updated_at": "string"
}
```

**Errors:** `not_found` (404), `validation_error` (422).

---

### `POST /dj/bookings/:id/cancel`

Sets the booking **`status`** to **`cancelled`**. Assigned DJ only. Idempotent if already cancelled.

**Request body:** optional (ignored).

**Response `200`:** **BookingCard** fields, **`dj_briefing`**, **`assignment`** (§3.2), and **`message`**. Does **not** include **`music_plan`**, **`crew_notes`**, or deposit-only echoes beyond **BookingCard** — use **`GET /dj/bookings/:id`** after cancel if you need the full detail payload.

Same path under **`/dj/events/:id/cancel`**.

---

### `PATCH /dj/bookings/:id`

Update **deposit** fields and/or **cancel** via **`status`** (DJ may set **`status`** to **`cancelled`** only). At least one allowed field required. Assigned DJ only.

**Request body** (all optional; include at least one key)

```json
{
  "status": "cancelled",
  "deposit_paid": true,
  "deposit_amount": 250,
  "deposit_currency": "GBP",
  "deposit_paid_at": "ISO8601",
  "deposit_note": "Received via bank transfer"
}
```

- **`deposit_paid`:** when set to **`true`**, **`deposit_paid_at`** defaults to **now** unless you send **`deposit_paid_at`**. When **`false`**, **`deposit_paid_at`** is cleared.
- **`deposit_amount`:** send **`null`** or omit unchanged sections via separate requests — clearing use **`null`**.
- **`status`:** only **`cancelled`** accepted (same effect as **`POST …/cancel`**).

**Response `200`:** Same shape as **`GET /dj/bookings/:id`** (full detail including music plan and crew notes).

**Errors:** `not_found` (404), `validation_error` (422).

Mirror path: **`PATCH /dj/events/:id`**.

---

## 6.5 Admin portal API

All routes require **Bearer** JWT and **`role === admin`**. Mutating actions append a row to **`admin_audit_log`** (who / what / entity id / JSON details).

### `GET /admin/users`

**Query (optional):** `role`, `q` (search email/name/phone), `limit`, `offset`.

**Response `200`:** `{ "users": [ UserPublic … ] }` — password hashes never returned; **`capabilities`** is parsed JSON for crew/admins.

---

### `POST /admin/users`

Creates a user (same roles as internal automation). If **`password`** is omitted, a **`temporary_password`** is returned once (plus **`_warning`**), mirroring **`POST /internal/users`**.

**Response `201`:** user object (plus optional **`temporary_password`**).

**Errors:** `validation_error` (422), `conflict` (409).

---

### `GET /admin/users/:id`

**Response `200`:** one user (includes **`account_manager_user_id`** for customers when set).

---

### `PATCH /admin/users/:id`

Partial update. Allowed inputs include **`first_name`**, **`last_name`**, **`email`**, **`phone`**, **`role`**, **`capabilities`** (JSON array or value accepted by server), **`account_manager_user_id`**, **`disabled_at`**, **`email_verified_at`**, and **`password`** (plain; min 8 characters → hashed server-side). **Cannot** disable or demote the last active admin (`409` **`conflict`**).

---

### `POST /admin/users/:id/reinvite`

Sends the **account created** Brevo template to an existing **customer** (same as **`POST /admin/users/:id/send-email`** with **`template`: `"account_created"`**). Requires **`BREVO_API_KEY`** and **`BREVO_TEMPLATE_ACCOUNT_CREATED`**.

**Response `204`:** empty body on success.

**Errors:** `503` if Brevo or template not configured; `404` user not found; `422` if not a customer or missing email; `502` upstream Brevo failure.

---

### `POST /admin/users/:id/send-email`

**Body (JSON):** `{ "template": "account_created" | "account_created_temporary_password" }` — default **`account_created`**.

- **`account_created`:** welcome email; passes **`login_link`** param ( **`PORTAL_PUBLIC_ORIGIN`** / CORS default + `/events/login` ).
- **`account_created_temporary_password`:** resets the customer password, emails the new plaintext password in **`params.temp_password`**, and returns **`_warning`** in the JSON response (password not shown again).

**Response `200`:** `{ "ok": true, "template", "to", "message_id", … }`

**Auth:** Bearer **admin**.

---

### `GET /admin/email-templates`

Lists template keys configured via env (numeric Brevo template IDs present). **`{ "brevo_configured": boolean, "templates": [ { "key", "label", "template_id" } ] }`**

---

### Stripe payments

Requires **`STRIPE_SECRET_KEY`** on the API server. Register webhook **`POST /api/v1/stripe/webhook`** (raw JSON body, **no** Bearer auth) with **`STRIPE_WEBHOOK_SECRET`**. Listen for **`checkout.session.completed`** and **`checkout.session.expired`**.

**`POST /admin/bookings/:id/payments/checkout`** — admin creates a Checkout Session.

**Body:** `{ "kind": "deposit" | "balance" | "full", "amount"?: number, "success_url"?, "cancel_url"? }`

- **deposit** — uses booking **`deposit_amount`** (or **`amount`** override) unless deposit already paid.
- **balance** — **`quote_total`** minus paid deposit and prior paid **`balance`/`full`** rows; deposit must be paid if **`deposit_amount` > 0**.
- **full** — remaining quote total.

**Response `201`:** `{ payment_id, checkout_url, stripe_checkout_session_id, amount, currency, kind, … }`

**`GET /admin/bookings/:id/payments`** — `{ payments[], quote_total, stripe_configured, deposit_paid, deposit_amount }`

**`POST /customer/bookings/:id/payments/checkout`** — same body/rules; customer must own the booking.

On successful **`checkout.session.completed`**, the matching **`booking_payments`** row is **`paid`**; **deposit** payments set booking **`deposit_paid`**, **`deposit_paid_at`**, and **`deposit_amount`**.

---

### `GET /admin/bookings`

**Query (optional):** `customer_id`, `status`, `start_from`, `start_to`, `limit`, `offset`.

**Response `200`:** `{ "bookings": [ … ] }` — rows from **`bookings`**.

---

### `POST /admin/bookings`

Creates a booking. Supply **`customer_id`** **or** **`customer_email`**; if the email is new, a **customer** user is created (**passwordless** until invite) using optional **`first_name`**, **`last_name`**, **`phone`**, **`account_manager_user_id`**.

Contact-form parity fields (optional): **`guest_count_range`**, **`event_type`**, **`services_required`**, **`enquiry_message`**, **`hear_about`**, **`newsletter_opt_in`**, **`lead_metadata`**, plus deposit columns as in **BookingCard**.

**Response `201`:** `{ …booking, "assignments": [] }`.

---

### `GET /admin/bookings/:id`

**Response `200`:** booking row plus **`assignments`** (joined crew user + **`crew_role_label`** / **`crew_capabilities`**).

---

### `PATCH /admin/bookings/:id`

Admin-scope booking patch (all booking fields + **`customer_id`** per DB whitelist). **Response `200`:** updated booking row.

---

### `POST /admin/bookings/:id/assignments`

**Body:** `{ "dj_user_id": "uuid", "crew_role_label"?: "string", "crew_capabilities"?: ["code"] }` — upserts **`booking_assignments`**.

**Response `201`:** assignment row (parsed **`crew_capabilities`**).

---

### `DELETE /admin/bookings/:id/assignments/:dj_user_id`

Removes one assignment. **Response `204`**.

---

### Catalog products & booking line items

SQLite tables: **`catalog_products`**, **`catalog_product_addons`** (parent → add-on rate, optional pricing model override), **`booking_line_items`** (quote lines with discounts).

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/admin/catalog/products` | Query `?active=1` for booking picker |
| `POST` | `/admin/catalog/products` | Body: `code`, `name`, `pricing_model` (`hourly` \| `flat` \| `unit`), `standalone_rate`, optional `minimum_hours` (hourly), optional `capability_code`, `allows_addons`, `is_active`, `sort_order` |
| `GET` | `/admin/catalog/products/:id` | Includes **`addons[]`** |
| `PATCH` | `/admin/catalog/products/:id` | Partial update |
| `DELETE` | `/admin/catalog/products/:id` | Hard delete or deactivate if used on bookings |
| `POST` | `/admin/catalog/products/:id/addons` | Body: `addon_product_id`, `addon_rate`, optional `addon_pricing_model` |
| `DELETE` | `/admin/catalog/products/:id/addons/:addonProductId` | **204** |

**Booking create/patch** optional **`line_items`**: array of `{ product_id, pricing_context: "standalone"|"addon", client_key?, parent_client_key?, hours?, quantity?, unit_rate?, discount_type?, discount_value?, label? }`. Parent add-ons must reference a root line via **`parent_client_key`** on create.

**GET booking** includes **`line_items`**, **`quote_subtotal`**, **`quote_total`**.

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/admin/catalog/export` | Full catalog JSON (`version`, `exported_at`, `products[]` with `addons[]` by **code**) |
| `POST` | `/admin/catalog/import` | Body: `{ "products": [...], "replace_addon_links"?: true }` — upsert by **code**; returns `{ created, updated, addons_linked, errors[] }` |

---

## 7. Gaps vs full product spec

| Spec idea | Status |
|-----------|--------|
| `POST /auth/magic-link` | Not implemented |
| Refresh tokens / server-side session revocation | Not implemented (client drops JWT on logout) |
| JWT customer / DJ / **admin** **browser** APIs | Implemented (§4–6.5); **`POST /auth/change-password`**, **`POST /auth/delete-account`** §4 |
| **`GET/PATCH /customer/details`** | Implemented (§5) |
| **Admin back-office API** (`/admin/*`) | Implemented (§6.5); audit log on mutating calls |
| **Internal automation** (n8n, CRM) | **`POST /internal/users`**, **`POST /internal/bookings`** or **`POST /internal/events`** — §9 (**customer_email** may **upsert** a new customer) |
| Per-booking music plan **writes** via customer API | Only **default** plan via `PUT /customer/profile`; per-booking rows may exist in DB for future use |
| Rate limiting | Not implemented (recommended for login in production) |
| **Cloudflare Turnstile** on login / login-google / register | Optional — when env secret is set (§1.2 / §4) |

---

## 8. Quick endpoint index (JWT / browser)

| Method | Path | Auth | Role |
|--------|------|------|------|
| POST | `/api/v1/auth/register` | No | — |
| POST | `/api/v1/auth/login` | No | — |
| POST | `/api/v1/auth/login/google` | No | — |
| POST | `/api/v1/auth/logout` | No | — |
| POST | `/api/v1/auth/change-password` | Bearer | any (password-login accounts) |
| POST | `/api/v1/auth/delete-account` | Bearer | any |
| GET | `/api/v1/auth/me` | Bearer | any |
| GET | `/api/v1/customer/bookings` | Bearer | customer |
| GET | `/api/v1/customer/bookings/:id` | Bearer | customer |
| PATCH | `/api/v1/customer/bookings/:id/note` | Bearer | customer |
| POST | `/api/v1/customer/bookings/:id/payments/checkout` | Bearer | customer |
| POST | `/api/v1/customer/bookings/:id/hide` | Bearer | customer |
| DELETE | `/api/v1/customer/bookings/:id/hide` | Bearer | customer |
| GET | `/api/v1/customer/events` | Bearer | customer |
| GET | `/api/v1/customer/events/:id` | Bearer | customer |
| PATCH | `/api/v1/customer/events/:id/note` | Bearer | customer |
| POST | `/api/v1/customer/events/:id/hide` | Bearer | customer |
| DELETE | `/api/v1/customer/events/:id/hide` | Bearer | customer |
| GET | `/api/v1/customer/details` | Bearer | customer |
| PATCH | `/api/v1/customer/details` | Bearer | customer |
| GET | `/api/v1/customer/profile` | Bearer | customer |
| PUT | `/api/v1/customer/profile` | Bearer | customer |
| GET | `/api/v1/dj/bookings/upcoming` | Bearer | dj |
| GET | `/api/v1/dj/bookings/:id` | Bearer | dj |
| PATCH | `/api/v1/dj/bookings/:id/crew-notes` | Bearer | dj |
| POST | `/api/v1/dj/bookings/:id/cancel` | Bearer | dj |
| PATCH | `/api/v1/dj/bookings/:id` | Bearer | dj |
| GET | `/api/v1/dj/events/upcoming` | Bearer | dj |
| GET | `/api/v1/dj/events/:id` | Bearer | dj |
| PATCH | `/api/v1/dj/events/:id/crew-notes` | Bearer | dj |
| POST | `/api/v1/dj/events/:id/cancel` | Bearer | dj |
| PATCH | `/api/v1/dj/events/:id` | Bearer | dj |
| GET | `/api/v1/admin/users` | Bearer | admin |
| POST | `/api/v1/admin/users` | Bearer | admin |
| GET | `/api/v1/admin/users/:id` | Bearer | admin |
| PATCH | `/api/v1/admin/users/:id` | Bearer | admin |
| POST | `/api/v1/admin/users/:id/reinvite` | Bearer | admin |
| POST | `/api/v1/admin/users/:id/send-email` | Bearer | admin |
| GET | `/api/v1/admin/email-templates` | Bearer | admin |
| GET | `/api/v1/admin/users/:id/bookings` | Bearer | admin |
| GET | `/api/v1/admin/users/:id/payments` | Bearer | admin |
| GET | `/api/v1/admin/bookings/:id/payments` | Bearer | admin |
| POST | `/api/v1/admin/bookings/:id/payments/checkout` | Bearer | admin |
| POST | `/api/v1/stripe/webhook` | — | Stripe signature |
| GET | `/api/v1/admin/bookings` | Bearer | admin |
| POST | `/api/v1/admin/bookings` | Bearer | admin |
| GET | `/api/v1/admin/bookings/:id` | Bearer | admin |
| PATCH | `/api/v1/admin/bookings/:id` | Bearer | admin |
| POST | `/api/v1/admin/bookings/:id/assignments` | Bearer | admin |
| DELETE | `/api/v1/admin/bookings/:id/assignments/:dj_user_id` | Bearer | admin |

**`/customer/events`** and **`/dj/events`** mirror **`bookings`** routes; see §4.5 for response shape (**`events`** vs **`bookings`** list key).

---

## 9. Internal automation API (n8n, CRM)

Server-to-server only (no browser JWT). **Disabled** until `PORTAL_INTERNAL_API_KEY` is set to a **long random secret** (minimum **16 characters**); otherwise routes respond with **503**.

### Authentication

Every request:

```http
X-Portal-Internal-Key: <PORTAL_INTERNAL_API_KEY>
Content-Type: application/json
```

Use n8n’s **HTTP Request** node with **Send Headers**. Keep the key in n8n credentials or environment variables, not in client-side code.

### `POST /api/v1/internal/users`

Creates a portal user with any allowed **`role`**. Use this instead of `POST /auth/register` when automation must create **DJ** or **admin** accounts, or when you want a controlled password policy.

**Request body**

```json
{
  "email": "string (required)",
  "role": "customer | dj | admin (required)",
  "password": "string (optional, min 8 chars when provided)",
  "first_name": "string (optional)",
  "last_name": "string (optional)"
}
```

If **`password` is omitted or empty**, the server generates a random password and returns it **once** in **`temporary_password`** (use the next n8n step to email it via Brevo, etc.). Response also includes **`_warning`** reminding you not to log it insecurely.

**Response `201`**

```json
{
  "id": "uuid",
  "email": "string",
  "role": "customer",
  "first_name": "string | null",
  "last_name": "string | null",
  "temporary_password": "only when password was auto-generated",
  "_warning": "only when temporary_password is present"
}
```

**Errors:** `validation_error` (422), `conflict` (409), `unauthorized` (401), `service_unavailable` (503), `internal_error` (500).

---

### `POST /api/v1/internal/bookings`

Creates a **booking** and optionally assigns **DJs** already present in the portal DB.

**Request body**

```json
{
  "customer_id": "uuid (optional if customer_email set)",
  "customer_email": "string (optional if customer_id set)",
  "title": "string (required)",
  "start_datetime": "ISO8601 (required)",
  "end_datetime": "ISO8601 (required)",
  "venue": "string (optional)",
  "service": "string (optional)",
  "status": "confirmed | pending | cancelled (optional, default pending)",
  "reference": "string (optional; unique; auto-generated like EY-1234 if omitted)",
  "contact_name": "string (optional)",
  "notes_from_company": "string (optional)",
  "dj_briefing": "string (optional)",
  "dj_user_ids": ["uuid", "..."],
  "dj_emails": ["string", "..."],
  "deposit_paid": false,
  "deposit_amount": 250,
  "deposit_currency": "GBP",
  "deposit_paid_at": "ISO8601 (optional)",
  "deposit_note": "string (optional)",
  "first_name": "string (optional, used when upserting new customer)",
  "last_name": "string (optional)",
  "phone": "string (optional)",
  "account_manager_user_id": "uuid (optional)",
  "guest_count_range": "string (optional)",
  "event_type": "string (optional)",
  "services_required": ["string"],
  "enquiry_message": "string (optional)",
  "hear_about": "string (optional)",
  "newsletter_opt_in": false,
  "lead_metadata": {}
}
```

- **`customer_email`:** must resolve to **`role === customer`**, **or** if no user exists a new **customer** row is created (no password until invite) using optional **`first_name`**, **`last_name`**, **`phone`**, **`account_manager_user_id`**.
- **`dj_emails`** / **`dj_user_ids`**: only users with **`role === dj`** are assigned; unknown IDs/emails are **skipped** (no error).

**Response `201`**

```json
{
  "id": "uuid",
  "customer_id": "uuid",
  "title": "string",
  "start_datetime": "ISO8601",
  "end_datetime": "ISO8601",
  "venue": "string",
  "service": "string",
  "status": "pending",
  "reference": "string",
  "contact_name": "string",
  "notes_from_company": "string",
  "dj_briefing": "string",
  "deposit_paid": false,
  "deposit_amount": null,
  "deposit_currency": "GBP",
  "deposit_paid_at": null,
  "deposit_note": null,
  "guest_count_range": "string | null",
  "event_type": "string | null",
  "services_required": ["string"],
  "enquiry_message": "string | null",
  "hear_about": "string | null",
  "newsletter_opt_in": false,
  "lead_metadata": {},
  "assigned_dj_user_ids": ["uuid"]
}
```

**Errors:** `validation_error` (422), `not_found` (404), `conflict` (409), `unauthorized` (401), `service_unavailable` (503), `internal_error` (500).

---

### `POST /api/v1/internal/events`

Alias for **`POST /internal/bookings`** (same JSON body and **`201`** response). Use whichever naming fits your automation (“event” vs “booking”).

---

### n8n workflow hints

1. **New enquiry → customer**: `POST …/internal/users` with `role: customer`; branch on `temporary_password` to send portal invite email.
2. **Confirmed gig**: `POST …/internal/bookings` or **`POST …/internal/events`** with `customer_email` from CRM and `dj_emails` from roster.
3. Run workflows against **`https://requests.eyupevents.uk`** (production) or your staging host; TLS protects the shared secret in transit.
4. **Windows local dev:** Set `PORTAL_INTERNAL_API_KEY` in the **same** shell that starts Node (for example run `$env:PORTAL_INTERNAL_API_KEY='your-long-secret'; node server.js` in PowerShell **directly**, or `cmd /c "set PORTAL_INTERNAL_API_KEY=...&& node server.js"`). Nested commands often strip `$env:…`, so the internal API stays disabled (**503**) until the variable is applied correctly.

---

## 10. Quick index — internal routes

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/internal/users` | `X-Portal-Internal-Key` |
| POST | `/api/v1/internal/bookings` | `X-Portal-Internal-Key` |
| POST | `/api/v1/internal/events` | `X-Portal-Internal-Key` |

---

*Document version: 1.9 — **`POST /auth/login/google`** (customer Google ID token → JWT; **`PORTAL_GOOGLE_CLIENT_ID`**); Turnstile on **`login` / login/google / `register`**; **`POST /auth/change-password`**, **`POST /auth/delete-account`**.*

*Prior: v1.8 self-service **`change-password`** & **`delete-account`**; **`register`** min **`password`** **8**. v1.7 Turnstile on **`login` & `register`**.*

