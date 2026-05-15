# EYUP EVENTS — Events portal API & database specification

**Audience:** Backend engineer or AI agent implementing the API that will replace the current mock (`events/js/events-mock-data.js`, `events-auth.js`, `events-customer-profile.js`).  
**Frontend reference:** Static pages under `/events/` (`customer.html`, `dj.html`, `login.html`, `event.html`).  
**Company:** EYUP EVENTS UK LTD · live marketing domain `eyupevents.uk`.

---

## 1. Goals

1. Persist **bookings (events/gigs)**, **customer accounts**, **DJ/crew accounts**, and all data that is today stored only in `localStorage` / `sessionStorage`.
2. Enforce **authentication and authorization** so customers only see their bookings; DJs see operational gigs they are allowed to view.
3. Provide a **stable JSON HTTP API** that the existing UI can call (future refactor), or that a thin BFF layer uses.
4. Keep payloads aligned with the shapes implied by the mock so migration is straightforward.

Non-goals for v1 (unless product expands scope):

- Public SEO pages (`/` …) — out of scope.
- Payment capture inside this API (Stripe/etc.) — optional hooks only; invoice/deposit emails may link externally.

---

## 2. Personas & roles

| Role | Description |
|------|-------------|
| `customer` | Booked client; accesses dashboard, single-booking detail, music plan, account notes, per-booking notes to crew. |
| `dj` | Assigned crew / DJ; sees upcoming gigs, briefing, aggregated customer music plan, editable crew notes. |
| `admin` *(recommended)* | Back-office user creating bookings, assigning DJs, editing internal fields — may be separate product (CRM) feeding the same DB; API may expose admin routes later or rely on server-side jobs only. |

The demo frontend uses **email + self-selected role** (`events-login.js`). Production must **derive role from verified identity**, not from client-supmitted role.

---

## 3. Behaviour derived from the current UI (must be supported)

### 3.1 Customer dashboard (`/events/customer`)

- Lists **bookings for the signed-in customer**.
- **Current demo rule:** only the **next upcoming** booking where `booking.customer_email` matches session user (see `getCustomerDashboardBookings`). Product decision:
  - **Option A (matches demo):** `GET /customer/bookings?scope=next_upcoming` returns 0 or 1 row.
  - **Option B:** return all upcoming bookings; UI can filter — preferable long-term.
- Card fields: `status` (`confirmed` \| `pending`), `title`, formatted date range, `venue`, `service`, `reference`, links to `/events/event?id={booking_id}`.
- **Remove from list:** demo hides booking IDs in localStorage. Persist as **`customer_dashboard_hidden_booking_ids`** (junction or JSON array per customer user) so preference survives devices.

### 3.2 Customer booking detail (`/events/event`)

- Load booking **by id**; enforce **customer owns booking** (via `customer_id` or email FK).
- Display: when/end, venue, service, reference, contact name, **Message from EYUP** (`notes_from_company`).
- **Customer note** (free text, saved per booking): today `setCustomerNote` / `getCustomerNote` — store server-side as **`booking_customer_note`** (one text blob per customer + booking, or versioned if you prefer audit).

### 3.3 Customer profile — account notes (`customer.html` Account tab)

- **`account_notes_list`:** ordered list of short strings (add/remove lines). Not tied to a single booking — stored per **customer user**.

### 3.4 Customer profile — music plan (`customer.html` Music tab)

Stored today under `playlist` in `events-customer-profile.js`:

| Field | Type | Notes |
|-------|------|--------|
| `must_play` | `string[]` | Song / artist lines |
| `dont_play` | `string[]` | |
| `dont_play_early` | `string[]` | Ceremony / speeches — “don’t play early” |
| `floor_fillers` | `string[]` | |
| `first_dance` | `string` | Single line |
| `last_dance` | `string` | |
| `parent_dances` | `string` | Free text (multi-line in UI) |

The DJ UI renders a **plain-text summary** via `formatPlaylistSummary()` — API should return either structured JSON **or** a server-generated `music_plan_summary` for convenience.

**Scope:** Music plan may be **global per customer** (demo) or **per booking** (better for repeat clients). **Recommended:** `music_plan` table with **`booking_id` nullable**: if null, treat as default template; if set, overrides for that gig.

### 3.5 DJ dashboard (`/events/dj`)

- Lists **upcoming bookings** where `end_datetime >= now()` ordered by start.
- Views: cards, list, calendar — same data; client-side only.
- Each gig shows: status, title, schedule, venue, service, contact name, reference, **`dj_briefing`** (ops text), **customer music plan** for the linked customer/booking, **`crew_notes`** editable textarea.

Persist **`crew_notes`** per **`booking_id`** (+ **`dj_user_id`** if multiple crew edit independently; otherwise single shared note per booking).

---

## 4. Proposed domain model (relational)

Use UUIDs for primary keys in API responses (`id` fields). Human-readable **`reference`** (e.g. `EY-1042`) unique per booking.

### 4.1 `users`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | |
| `email` | `citext` unique | Normalised lowercase |
| `password_hash` | `text` nullable | If using password login |
| `role` | `enum('customer','dj','admin')` | Derived at signup / invite |
| `first_name` | `text` nullable | |
| `last_name` | `text` nullable | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `email_verified_at` | `timestamptz` nullable | |

Indexes: `(email)`, `(role)`.

### 4.2 `bookings`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | Exposed as `evt-*` style optional string prefix in URLs — either keep UUID only or `short_public_id` |
| `customer_id` | UUID FK → `users` | Owner customer |
| `title` | `text` | Event title |
| `start_datetime` | `timestamptz` | Maps mock `date` |
| `end_datetime` | `timestamptz` | Maps mock `endDate` |
| `venue` | `text` | |
| `service` | `text` | e.g. “Mobile DJ + lighting” |
| `status` | `enum('confirmed','pending','cancelled',…)` | Extend as needed |
| `reference` | `text` unique | e.g. `EY-1042` |
| `contact_name` | `text` | Primary on-site contact |
| `notes_from_company` | `text` nullable | Shown to customer as “Message from EYUP” |
| `dj_briefing` | `text` nullable | Crew-only in UI today; still enforce auth |
| `deposit_paid` | `boolean` | SQLite `INTEGER` 0/1 — DJ/internal may update |
| `deposit_amount` | `real` nullable | Major units (e.g. `250` for £250) |
| `deposit_currency` | `text` | Default `GBP` |
| `deposit_paid_at` | `text` nullable | ISO8601 when marked paid |
| `deposit_note` | `text` nullable | Free-text (reference, method, etc.) |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `(customer_id, start_datetime)`, `(start_datetime)` for DJ queries.

### 4.3 `booking_assignments` *(DJ ↔ gig)*

| Column | Type | Notes |
|--------|------|--------|
| `booking_id` | UUID FK | |
| `dj_user_id` | UUID FK → `users` | |
| `assigned_at` | `timestamptz` | |

Unique `(booking_id, dj_user_id)`. DJ list endpoint returns bookings where user appears here **or** rely on role `dj` + org-wide calendar (product choice). **Recommended:** explicit assignments.

### 4.4 `customer_booking_preferences`

| Column | Type | Notes |
|--------|------|--------|
| `customer_id` | UUID | |
| `booking_id` | UUID | |
| `hidden_from_dashboard` | `boolean` default false | “Remove from list” |

Unique `(customer_id, booking_id)`.

### 4.5 `booking_customer_notes`

Customer’s note for crew (per booking).

| Column | Type | Notes |
|--------|------|--------|
| `customer_id` | UUID | |
| `booking_id` | UUID | |
| `body` | `text` | |
| `updated_at` | `timestamptz` | |

Unique `(customer_id, booking_id)`.

### 4.6 `customer_account_notes`

Ordered bullets for account tab.

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | |
| `customer_id` | UUID | |
| `sort_order` | `int` | |
| `body` | `text` | |

### 4.7 `music_plans`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | |
| `customer_id` | UUID | |
| `booking_id` | UUID nullable | Null = default plan |
| `payload` | `jsonb` | Mirrors playlist object |
| `updated_at` | `timestamptz` | |

Constraint: at most one row per `(customer_id, booking_id)` including NULL booking handling via partial unique index.

### 4.8 `booking_crew_notes`

| Column | Type | Notes |
|--------|------|--------|
| `booking_id` | UUID | |
| `author_user_id` | UUID nullable | DJ who last edited |
| `body` | `text` | |
| `updated_at` | `timestamptz` | |

Either single row per booking or append-only history — v1 single row is enough.

---

## 5. API conventions

- **Base path:** `/api/v1` (example).
- **Format:** JSON UTF-8; dates ISO 8601 in UTC or Europe/London with explicit offset — pick one and document.
- **Errors:** JSON `{ "error": { "code": "...", "message": "...", "details": {} } }` with appropriate HTTP status (400 / 401 / 403 / 404 / 422 / 500).
- **Auth:** `Authorization: Bearer <access_token>` after login; refresh token cookie or body per stack choice.
- **Idempotency:** PUT/PATCH for profile merges; use `If-Match` / version columns optional.

---

## 6. Authentication endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Optional; may be invite-only. |
| `POST` | `/auth/login` | Email + password → tokens. **Reject** arbitrary role from client; set role from `users.role`. |
| `POST` | `/auth/logout` | Invalidate refresh token. |
| `POST` | `/auth/magic-link` | Optional: align with Brevo “account created” / portal login flows. |
| `GET` | `/auth/me` | Current user `{ id, email, role, first_name }`. |

---

## 7. Customer-authenticated endpoints

All require `role = customer`. Authorise every booking by `booking.customer_id === auth.user_id`.

| Method | Path | Body / query | Response sketch |
|--------|------|----------------|-----------------|
| `GET` | `/customer/bookings` | `?scope=next_upcoming \| upcoming_all` | `{ "bookings": [ BookingCard ] }` |
| `GET` | `/customer/bookings/:id` | — | Full booking + `notes_from_company` + customer’s `booking_customer_note` |
| `PATCH` | `/customer/bookings/:id/note` | `{ "body": "..." }` | Updated note |
| `POST` | `/customer/bookings/:id/hide` | — | Sets `hidden_from_dashboard=true` |
| `DELETE` | `/customer/bookings/:id/hide` | — | Clears hide flag |

**BookingCard JSON** (align with UI):

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
  "contact_name": "string"
}
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/customer/profile` | Account notes list + default music plan (`booking_id` null). |
| `PUT` | `/customer/profile` | Replace `account_notes` array and/or `music_plan` payload. |

---

## 8. DJ-authenticated endpoints

Require `role = dj` **and** assignment in `booking_assignments` (unless you intentionally use org-wide visibility).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dj/bookings/upcoming` | Query `end_datetime >= now()`, ordered by `start_datetime`. Include `dj_briefing`, assignment metadata. |
| `GET` | `/dj/bookings/:id` | Detail + joined customer music plan for that booking + `crew_notes`. |
| `PATCH` | `/dj/bookings/:id/crew-notes` | `{ "body": "..." }` |

**Music plan for DJ read:** resolve `music_plan` where `(customer_id = booking.customer_id AND booking_id = :id) OR (customer_id AND booking_id IS NULL)` fallback merge strategy — document explicitly in implementation.

---

## 9. Mapping from mock fields → API

| Mock (`events-mock-data.js`) | API / DB |
|------------------------------|----------|
| `id` | `bookings.id` |
| `customerEmail` | `users.email` on linked `customer_id` |
| `playlistLinkedDemoEmail` | Remove — resolve plans via `customer_id` + `booking_id` |
| `notesFromUs` | `notes_from_company` |
| `djBriefing` | `dj_briefing` |
| Profile `playlist.*` | `music_plans.payload` |
| `accountNotesList` | `customer_account_notes` rows |
| Mock `hideBooking` | `customer_booking_preferences.hidden_from_dashboard` |
| DJ local crew note | `booking_crew_notes` |

---

## 10. Security & privacy

1. **Never expose `dj_briefing` or crew notes to customer endpoints** unless product explicitly allows it.
2. **Customers must not enumerate booking IDs** — use UUIDs and 404 on unauthorised access.
3. Rate-limit login and magic-link endpoints.
4. Log access to personal data for GDPR accountability (who viewed which booking).
5. Portal pages are currently **`noindex`** — keep until marketing decides otherwise.

---

## 11. Suggested implementation order

1. Schema migration + seed matching one demo customer + one DJ + booking `evt-1042` equivalent.
2. Auth + `/auth/me`.
3. Customer bookings list + detail + note + hide flag.
4. Customer profile (account notes + music plan).
5. DJ upcoming list + crew notes + read-only music plan join.
6. Wire frontend: replace `EyupEventsMock` / `EyupEventsCustomerProfile` calls with `fetch` + token storage.

---

## 12. Open questions for product / implementer

1. **Music plan scope:** global vs per-booking (recommended per-booking with fallback).
2. **Customer dashboard:** single next gig vs full list.
3. **Multiple DJs per gig:** separate crew notes per user vs shared notepad.
4. **Admin:** in-band API vs external CRM (HubSpot, etc.) as source of truth for bookings.
5. **Files:** contracts, invoices PDFs — attachment URLs later?
6. **Timezone:** store UTC vs `Europe/London` for wall-clock consistency at venues.

---

## 13. MobileDJay implementation (requests.eyupevents.uk)

This repo hosts the portal API **alongside** the existing song-request app without sharing tables.

**HTTP contract (paths, bodies, responses):** [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md).  
**Song-request gigs** (QR / `/event/:slug`, postpone & cancel): [`mobilejay-events-api.md`](mobilejay-events-api.md).

| Item | Detail |
|------|--------|
| **Base URL** | `https://requests.eyupevents.uk/api/v1` (or local `http://localhost:3000/api/v1`) |
| **Database** | `db/eyup_portal.db` — separate file from `mobiledj.db` (requests/events). |
| **CORS** | Defaults allow `https://eyupevents.uk`, `https://www.eyupevents.uk`, `https://requests.eyupevents.uk`. Override with env `PORTAL_CORS_ORIGINS` (comma-separated origins). |
| **Auth secret** | Set `PORTAL_JWT_SECRET` in production (falls back to a dev-only secret when `NODE_ENV` ≠ `production`). Optional: `PORTAL_JWT_EXPIRES_IN` (default `7d`). |
| **Internal automation key** | `PORTAL_INTERNAL_API_KEY` — minimum **16 characters**. Enables `/api/v1/internal/*` for n8n and other trusted backends (see [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md) §9). If unset or too short, internal routes return **503**. |
| **Self-signup** | `POST /auth/register` creates **`customer`** accounts only; DJs/admins are created out-of-band (e.g. seed script). |
| **Demo seed** | `npm run portal-seed` — demo customer, DJ, booking `EY-1042`, default music plan (password `ChangeMeDemo123!` unless overridden via `EYUP_PORTAL_SEED_*` env vars). |
| **Automation (n8n)** | Server-to-server routes under `/api/v1/internal/*` protected by header `X-Portal-Internal-Key` (env `PORTAL_INTERNAL_API_KEY`, min 16 chars). Use from n8n **HTTP Request** nodes to create users (any role) and bookings. **`POST /internal/events`** mirrors **`POST /internal/bookings`**. JWT routes also expose **`/customer/events`** and **`/dj/events`** as aliases for **`bookings`** (list JSON uses **`events`** key). Details: [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md) §4.5, §8–§10. |

Source layout: `portal/router.js` (routes), `portal/internal-router.js` (n8n/internal), `portal/auth-tokens.js`, `portal/music-plan.js`, `db/portal-database.js`.

**Future:** Link `bookings` to MobileDJay `events` (e.g. optional `mobiledjay_event_id` / slug column) when you automate gig creation.

Document version: 1.0 · Generated from static portal behaviour as implemented in the EYUP_EVENTS repo.
