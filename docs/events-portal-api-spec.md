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
| `customer` | Booked client; accesses dashboard, booking detail, **details tab** (contact-parity profile), music plan, account notes, per-booking notes to crew. |
| `dj` | **Crew / field staff** account (API role slug remains `dj` for compatibility). Assigned to gigs for operational execution — includes mobile DJ, karaoke tech, inflatable attendant, PA runner, etc. Sees assigned bookings and crew tooling (`booking_assignments`). |
| `admin` | Back-office staff: create/manage **customers**, **crew**, and **other admins**; create/edit **bookings**; assign crew; set internal briefing and customer-visible notes. Implemented via **admin JWT routes** and/or **`POST /internal/*`** automation (see §11). |

The demo frontend historically labelled crew as “DJ”. Production UI should use **Crew** where appropriate while keeping `role: "dj"` in tokens unless you migrate to `crew` with a breaking API change.

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

### 3.3 Customer portal — “Your details” tab (contact-form parity)

Customers should have a **fourth tab** on `/events/customer` (alongside Bookings, Music plan, Account notes) labelled e.g. **Your details**, used to maintain the same core identity and reachability fields captured on the public **contact form** (`contact.html`). Keeps CRM, bookings, and portal aligned.

**Recommended editable fields (customer):**

| Field | Source | Notes |
|-------|--------|--------|
| `first_name`, `last_name` | Contact: First / Last name | Sync to `users` |
| `email` | Contact: Email | Prefer **read-only** in portal with “request change” flow (verification), or guarded PATCH |
| `phone` | Contact: Phone | `users.phone` |
| Future | Billing address, company name | Optional v2 |

**Not duplicated here:** event-specific data lives on **bookings** (dates, venue, services); music preferences stay on **Music plan**; free-form reminders stay on **Account notes**.

**API sketch:** `GET /customer/details` → `{ first_name, last_name, email, phone }`; `PATCH /customer/details` → partial update (exclude or constrain `email` per policy).

### 3.4 Customer profile — account notes (`customer.html` Account tab)

- **`account_notes_list`:** ordered list of short strings (add/remove lines). Not tied to a single booking — stored per **customer user**.

### 3.5 Customer profile — music plan (`customer.html` Music tab)

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

### 3.6 DJ / crew dashboard (`/events/dj`)

- Lists **upcoming bookings** where `end_datetime >= now()` ordered by start.
- Views: cards, list, calendar — same data; client-side only.
- Each gig shows: status, title, schedule, venue, service, contact name, reference, **`dj_briefing`** (ops text), **customer music plan** for the linked customer/booking, **`crew_notes`** editable textarea.

Persist **`crew_notes`** per **`booking_id`** (+ **`dj_user_id`** if multiple crew edit independently; otherwise single shared note per booking). **Rename in UI:** “DJ cockpit” → **Crew** where product prefers inclusive language; API role remains `dj`.

---

## 4. Proposed domain model (relational)

Use UUIDs for primary keys in API responses (`id` fields). Human-readable **`reference`** (e.g. `EY-1042`) unique per booking.

### 4.1 `users`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | |
| `email` | `citext` unique | Normalised lowercase |
| `phone` | `text` nullable | E.164 or national format; aligns with **contact form** |
| `password_hash` | `text` nullable | If using password login |
| `role` | `enum('customer','dj','admin')` | Derived at signup / invite |
| `first_name` | `text` nullable | |
| `last_name` | `text` nullable | |
| `capabilities` | `jsonb` nullable | Optional list of service / skill codes for **crew** rostering (`karaoke`, `pa_rental`, …); admins edit; irrelevant for customers. |
| `account_manager_user_id` | `uuid` nullable FK → `users.id` | **Customers only:** primary internal owner (admin user). Enforced in application layer (`role = admin`). |
| `disabled_at` | `timestamptz` nullable | Soft-disable logins for any role (admin action). |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `email_verified_at` | `timestamptz` nullable | |

Indexes: `(email)`, `(role)`, `(account_manager_user_id)` where non-null (partial optional).

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
| `guest_count_range` | `text` nullable | e.g. `51-100`, `500+` — mirrors contact form select |
| `event_type` | `text` nullable | e.g. `wedding`, `corporate`, `birthday`, … — mirrors **`eventType`** on contact |
| `services_required` | `jsonb` nullable | Array of service codes, e.g. `["mobile_dj","karaoke","lighting"]` — mirrors contact checkboxes |
| `enquiry_message` | `text` nullable | Long-form “additional details” copied from lead → booking (`contact.html` **`message`**) |
| `hear_about` | `text` nullable | Mirrors **`hearAbout`** (marketing attribution) |
| `newsletter_opt_in` | `boolean` default false | Mirrors **`newsletter`** checkbox |
| `lead_metadata` | `jsonb` nullable | Optional `{ "form_source", "form_timestamp" }` from hidden fields when enquiry becomes a booking |
| `notes_from_company` | `text` nullable | Shown to customer as “Message from EYUP” |
| `dj_briefing` | `text` nullable | Crew-only in UI today; still enforce auth |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `(customer_id, start_datetime)`, `(start_datetime)` for DJ queries.

### 4.3 `booking_assignments` *(DJ ↔ gig)*

| Column | Type | Notes |
|--------|------|--------|
| `booking_id` | UUID FK | |
| `dj_user_id` | UUID FK → `users` | Crew user (`role = dj`) |
| `crew_role_label` | `text` nullable | Human label for roster printouts, e.g. “Lead DJ”, “Karaoke tech”, “Inflatable attendant” |
| `crew_capabilities` | `jsonb` nullable | Optional subset of service codes this crew member covers **on this gig** (subset of `bookings.services_required`) |
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
| `POST` | `/auth/login/google` | Google **ID token** → tokens **only** for existing **`customer`** matched by verified **`email`**. Requires **`PORTAL_GOOGLE_CLIENT_ID`** on server (see **`portal/router.js`**). |
| `POST` | `/auth/logout` | Invalidate refresh token. |
| `POST` | `/auth/change-password` | Bearer; `current_password` + `new_password` (JWTs unchanged until expiry). |
| `POST` | `/auth/delete-account` | Bearer; confirms with `password` or passwordless flag; constraints on bookings / DJs / last admin. |
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
| `GET` | `/customer/details` | — | `{ "first_name", "last_name", "email", "phone" }` — contact parity (§3.3). |
| `PATCH` | `/customer/details` | Partial JSON | Same shape; **`email`** updates require explicit policy (verification flow vs forbidden). |
| `GET` | `/customer/profile` | — | Account notes list + default music plan (`booking_id` null). |
| `PUT` | `/customer/profile` | Replace `account_notes` and/or `music_plan` JSON | Echo saved profile. |

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

Optional extra keys may mirror **`bookings`** dashboard usefulness (`event_type`, `guest_count_range`, `services_required`) — omit until the UI consumes them.

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

### Contact form (`contact.html`) → persistence

Single enquiry often becomes **one `users` row (customer)** plus **one `bookings` row** once qualified. Map fields as follows (website names → DB/API):

| Contact field | Typical persistence | Notes |
|---------------|---------------------|--------|
| `firstName`, `lastName` | `users.first_name`, `users.last_name` | Customer record |
| `email` | `users.email` | Unique login identity |
| `phone` | `users.phone` | |
| `eventType` | `bookings.event_type` | |
| `services[]` | `bookings.services_required` | Normalise checkbox values to stable codes (`mobile_dj`, `pa_rental`, …) |
| `eventDate` | `bookings.start_datetime` (and derive **`title`** / **`end_datetime`** if unknown) | May remain **`pending`** until confirmed slot |
| `guestCount` | `bookings.guest_count_range` | |
| `venue` | `bookings.venue` | |
| `message` | `bookings.enquiry_message` | |
| `hearAbout` | `bookings.hear_about` | Attribution |
| `newsletter` | `bookings.newsletter_opt_in` **and/or** marketing consent store | If consent is account-wide, copy to a marketing preference keyed by `customer_id` in a future table |
| `form_source`, `form_timestamp` | `bookings.lead_metadata` | Audit trail |

**`contact_name`** on the booking can default to `first_name + " " + last_name` until a distinct on-site contact is known.

---

## 10. Security & privacy

1. **Never expose `dj_briefing` or crew notes to customer endpoints** unless product explicitly allows it.
2. **Customers must not enumerate booking IDs** — use UUIDs and 404 on unauthorised access.
3. Rate-limit login and magic-link endpoints.
4. Log access to personal data for GDPR accountability (who viewed which booking).
5. Portal pages are currently **`noindex`** — keep until marketing decides otherwise.
6. **`/admin/*`:** require `role = admin`; audit mutating actions (`who`, `what`, `booking_id` / `user_id`, timestamp). Prefer separate admin tokens or scopes from customer/crew if using a shared issuer.

---

## 11. Admin portal & API

Back-office staff provision **customers**, **crew** (`role = dj`), and **admins**; maintain **bookings** and **assignments**. This can sit beside CRM automation (`POST /internal/*`, n8n) — either CRM stays canonical and pushes here, or this API is canonical and CRM syncs outbound (**§13**).

### 11.1 UX sketch (aligned with customer portal)

Suggested areas or tabs in an **`/events/admin`** style shell:

| Area | Purpose |
|------|---------|
| **Customers** | Search/list; open record → **Details** (same fields as §3.3 / contact form identity), **Bookings** list, read/write **account notes** and **music plan** if ops edits on behalf of client, **Account manager** (`users.account_manager_user_id`). |
| **Crew** | Manage field staff (DJ, karaoke, inflatables, PA, etc.): names, phone, **`capabilities`** (§4.1), `disabled_at`, invite / reset access. Per-gig focus still set on **`booking_assignments.crew_capabilities`**. |
| **Admins** | Create/disable admin users (optional **super-admin** gate later). |
| **Bookings** | Full CRUD with **`contact.html` parity** fields on `bookings`; **Message from EYUP** (`notes_from_company`); internal **`dj_briefing`**; manage **`booking_assignments`** including **`crew_role_label`** / **`crew_capabilities`** per row. |

### 11.2 Rules

- **Role elevation:** clients must never `PATCH` their own `role`; only **`/admin/users`** (or server-side invite worker) sets `role`.
- **Customer record:** creating a booking for a new email should **upsert** customer `users` row (`role = customer`) or leave orphan bookings forbidden — pick one; upsert is usual.
- **Assignments:** a crew user sees a gig in **`GET /dj/bookings/*`** only if listed in **`booking_assignments`** (recommended).

### 11.3 Admin-authenticated endpoints (sketch)

All require **`role = admin`** unless noted. Paths sit under `/api/v1/admin/…`.

| Method | Path | Body / query | Notes |
|--------|------|--------------|-------|
| `GET` | `/admin/users` | `role` (optional), `q` search, pagination | List/filter |
| `POST` | `/admin/users` | `{ email, role, first_name?, last_name?, phone? }` | Invite-only: sends magic link / sets pending verification |
| `GET` | `/admin/users/:id` | — | Includes `account_manager_user_id` when customer |
| `PATCH` | `/admin/users/:id` | Partial user fields + `account_manager_user_id` + `disabled_at` | Cannot demote last admin without guard |
| `POST` | `/admin/users/:id/reinvite` | — | Re-issue onboarding email |
| `GET` | `/admin/bookings` | date range, `customer_id`, `status` | Ops calendar / pipeline |
| `POST` | `/admin/bookings` | Full booking create (customer id or inline email for upsert) | Sets `reference`, status |
| `GET` | `/admin/bookings/:id` | — | Includes assignments join |
| `PATCH` | `/admin/bookings/:id` | Partial booking | All fields customers cannot self-edit |
| `POST` | `/admin/bookings/:id/assignments` | `{ dj_user_id, crew_role_label?, crew_capabilities? }` | Idempotent upsert on `(booking_id, dj_user_id)` |
| `DELETE` | `/admin/bookings/:id/assignments/:dj_user_id` | — | Un-assign |

**Customer-facing parity:** `PATCH /admin/users/:id` may update the same identity columns exposed by **`GET/PATCH /customer/details`** so ops and client stay aligned.

---

## 12. Suggested implementation order

1. Schema migration + seed matching one demo customer + one DJ + booking `evt-1042` equivalent.
2. Auth + `/auth/me`.
3. Customer bookings list + detail + note + hide flag.
4. Customer **details** (`/customer/details`) + profile (account notes + music plan).
5. DJ upcoming list + crew notes + read-only music plan join.
6. **Admin** users + bookings CRUD + assignments (`/admin/*`) + audit logging.
7. Wire frontend: replace `EyupEventsMock` / `EyupEventsCustomerProfile` calls with `fetch` + token storage; add admin shell when ready.

---

## 13. Open questions for product / implementer

1. **Music plan scope:** global vs per-booking (recommended per-booking with fallback).
2. **Customer dashboard:** single next gig vs full list.
3. **Multiple DJs per gig:** separate crew notes per user vs shared notepad.
4. **CRM vs portal:** does HubSpot (or similar) remain **source of truth** with n8n pushing into this API, or does **`/admin/*`** replace spreadsheet workflows with periodic CRM sync?
5. **Files:** contracts, invoices PDFs — attachment URLs later?
6. **Timezone:** store UTC vs `Europe/London` for wall-clock consistency at venues.

---

*Document version: 1.1 · Adds admin portal sketch, contact-form mapping, customer details API, and assignment metadata for crew roles.*
