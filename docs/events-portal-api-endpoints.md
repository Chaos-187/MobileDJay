# EYUP Events Portal — HTTP API endpoint reference

**Purpose:** Machine- and human-readable contract for consumers (e.g. `eyupevents.uk` static site). Aligns with the implementation in `portal/router.js`.

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
- Protected routes without/bad token → **401** with error envelope (see §2).

**JWT payload (claims)** — informative only; do not trust role from client; server re-validates on each request:

| Claim | Meaning |
|-------|---------|
| `sub` | User UUID |
| `role` | `customer` \| `dj` \| `admin` |
| `email` | Normalised email |
| `exp` | Expiry (Unix time) |
| `jti` | Unique token id |

Role enforcement: endpoints check `role` === `customer` or `dj` as documented per route.

### 1.3 Dates and IDs

- **Booking `id`:** UUID string (e.g. from seed/demo).
- **Datetime fields:** ISO 8601 strings as stored (typically UTC, e.g. `2026-05-29T18:00:00.000Z`). Clients should parse as ISO dates.
- **Booking `status`:** `confirmed` \| `pending` \| `cancelled` (cancelled bookings excluded from “upcoming” lists).

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
| 403 | Wrong role for route |
| 404 | Resource not found **or** forbidden resource hidden as not found (booking id enumeration) |
| 409 | Conflict (e.g. email already registered) |
| 422 | Validation (missing fields, wrong types, illegal query) |
| 500 | Server error |

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
| `internal_error` | 500 |

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

### 3.2 `MusicPlanPayload`

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

**Request body**

```json
{
  "email": "string (required)",
  "password": "string (required)",
  "first_name": "string (optional)",
  "last_name": "string (optional)"
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

**Errors:** `validation_error` (422), `conflict` (409), `internal_error` (500).

---

### `POST /auth/login`

**Must not** send `role` in the body (422 if present).

**Request body**

```json
{
  "email": "string (required)",
  "password": "string (required)"
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

**Errors:** `validation_error` (422), `invalid_credentials` (401), `internal_error` (500).

---

### `POST /auth/logout`

No auth required.

**Response `204`:** empty body.

---

### `GET /auth/me`

**Auth:** Bearer required.

**Response `200`**

```json
{
  "id": "uuid",
  "email": "string",
  "role": "customer | dj | admin",
  "first_name": "string | null",
  "last_name": "string | null"
}
```

**Errors:** `unauthorized` / `invalid_token` (401), `not_found` (404).

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
| `scope` | `next_upcoming` \| `upcoming_all` | `upcoming_all` |

Semantics:

- Returns bookings where `end_datetime >= now`, `status != cancelled`, and not **hidden** from dashboard.
- `next_upcoming`: same ordering by `start_datetime` ascending, then **first only** (0 or 1 item).
- `upcoming_all`: all matching rows.

**Response `200`**

Array items match **BookingCard** (§3.1).

```json
{
  "bookings": []
}
```

**Errors:** `validation_error` (422) if `scope` invalid.

---

### `GET /customer/bookings/:id`

**Response `200`:** `BookingCard` plus customer-visible fields only:

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

Each item is **BookingCard** (§3.1) plus `dj_briefing`.

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
      "dj_briefing": "string"
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

**Response `200`:** **BookingCard** (§3.1) plus `dj_briefing` and `message` string.

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

## 7. Gaps vs full product spec

| Spec idea | Status |
|-----------|--------|
| `POST /auth/magic-link` | Not implemented |
| Refresh tokens / server-side session revocation | Not implemented (client drops JWT on logout) |
| JWT customer/DJ **browser** APIs | Implemented (§4–6) |
| **Internal automation** (n8n, CRM) | **`POST /internal/users`**, **`POST /internal/bookings`** or **`POST /internal/events`** — §9 |
| Per-booking music plan **writes** via customer API | Only **default** plan via `PUT /customer/profile`; per-booking rows may exist in DB for future use |
| Rate limiting | Not implemented (recommended for login in production) |

---

## 8. Quick endpoint index (JWT / browser)

| Method | Path | Auth | Role |
|--------|------|------|------|
| POST | `/api/v1/auth/register` | No | — |
| POST | `/api/v1/auth/login` | No | — |
| POST | `/api/v1/auth/logout` | No | — |
| GET | `/api/v1/auth/me` | Bearer | any |
| GET | `/api/v1/customer/bookings` | Bearer | customer |
| GET | `/api/v1/customer/bookings/:id` | Bearer | customer |
| PATCH | `/api/v1/customer/bookings/:id/note` | Bearer | customer |
| POST | `/api/v1/customer/bookings/:id/hide` | Bearer | customer |
| DELETE | `/api/v1/customer/bookings/:id/hide` | Bearer | customer |
| GET | `/api/v1/customer/events` | Bearer | customer |
| GET | `/api/v1/customer/events/:id` | Bearer | customer |
| PATCH | `/api/v1/customer/events/:id/note` | Bearer | customer |
| POST | `/api/v1/customer/events/:id/hide` | Bearer | customer |
| DELETE | `/api/v1/customer/events/:id/hide` | Bearer | customer |
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
  "deposit_note": "string (optional)"
}
```

- **`customer_email`** must resolve to an existing user with **`role === customer`**.
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

*Document version: 1.3 — DJ cancel booking, deposit fields, PATCH `/dj/bookings/:id`.*

