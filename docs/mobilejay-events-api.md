# MobileDJay — Song-request events HTTP API

These routes manage **MobileDJay request events** (SQLite `events` table / DJ gig links such as `/event/:slug`). They are **not** the EYUP portal bookings API (`/api/v1/…` — see [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md)).

**Base URL:** same host as the app (e.g. `https://requests.eyupevents.uk`).

**Auth:** No authentication is enforced on these endpoints today. Restrict access at the network layer (VPN, firewall, or future API key) if the server is exposed publicly.

**Content-Type:** `application/json` for bodies where noted.

For a feature-oriented guide see [`mobilejay-features.md`](mobilejay-features.md).

---

## Global settings

**`GET /api/settings`** — returns merged global DJ settings.

**`PUT /api/settings`** — partial update. Known keys include:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dj_name` | string | `DJ Chaos` | Label for DJ replies on guest pages |
| `public_base_url` | string | `""` | Base URL for share links / QR (empty = request host) |
| `enable_public_events_page` | boolean | `false` | When true, `/` renders public event picker |
| `virtualdj_enabled` | boolean | `true` | Forward requests/messages to VirtualDJ |
| `virtualdj_ask_path` | string | `/ask/…` | VirtualDJ ask path |
| `default_enable_song_requests` | boolean | `true` | Default for new events |
| `default_enable_karaoke_requests` | boolean | `true` | Default for new events |
| `default_enable_messages` | boolean | `true` | Default for new events |
| `default_enable_photos` | boolean | `false` | Default for new events |
| `default_enable_tips` | boolean | `false` | Default for new events |
| `photo_max_per_guest` | number | `20` | Upload limit per guest per event |
| `photo_slideshow_enabled` | boolean | `false` | Display slideshow |
| `photo_slideshow_minutes` | number | `5` | Slideshow interval |
| `photo_banner_style` | string | `party` | `party` \| `neon` \| `elegant` \| `minimal` |

---

## Event CRUD (summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | List all events (+ stats) |
| POST | `/api/events` | Create event |
| PUT | `/api/events/:id` | Partial update (allowed fields only) |
| DELETE | `/api/events/:id` | Delete event and related rows |
| GET | `/api/events/slug/:slug` | Lookup by public slug |
| POST | `/api/events/:id/cancel` | Set `is_active = 0` |
| POST | `/api/events/:id/postpone` | Update `event_date` / optional `venue` |
| GET | `/api/events/:id/links` | Share URLs for event |
| POST | `/api/events/:id/regenerate-share-token` | Rotate gallery share token |
| PUT | `/api/events/:id/display-config` | Venue display options |

Event `id` is a **numeric** SQLite primary key.

### Notable event fields

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | URL segment for `/event/:slug` |
| `is_active` | 0/1 | Inactive events reject guest traffic |
| `show_public` | 0/1 | Include in public listing when global setting enabled |
| `show_tracks_played_guest` | 0/1 | Show recently played on song request page |
| `enable_song_requests` | 0/1 | Song request feature |
| `enable_karaoke_requests` | 0/1 | Karaoke feature |
| `enable_messages` | 0/1 | Messages feature |
| `enable_photos` | 0/1 | Guest photo uploads |
| `enable_tips` | 0/1 | Tipping modal |
| `share_token` | string | Gallery download token |

**`POST /api/events`** body accepts `show_public` (boolean) among other create fields.

**`PUT /api/events/:id`** accepts `show_public` and `show_tracks_played_guest` among allowed fields.

---

## Public events listing

Requires **`enable_public_events_page`** in global settings.

### Home page

**`GET /`** — when the setting is enabled, renders the event picker HTML (`events-list` view). When disabled, renders the legacy generic guest landing.

**`GET /events`** — redirects to `/` (legacy alias).

### JSON

**`GET /api/public/events`**

**Response `200`** — array of active events with `show_public = 1`:

```json
[
  {
    "id": 1,
    "slug": "friday-night",
    "name": "Friday Night Party",
    "description": "…",
    "venue": "Club Downtown",
    "event_date": "2026-07-15",
    "logo_image": "/uploads/themes/1/logo.png",
    "heading_color": "#007bff",
    "accent_color": "#0d6efd"
  }
]
```

**Response `404`** when public page is disabled: `{ "error": "Public events page is not enabled" }`

---

## Guest check-in and moderation

Guests are keyed by **`customer_name`** per event (case-insensitive). Check-in happens silently when a guest submits their name on the landing page.

### Check-in (guest)

**`POST /api/event/:eventSlug/guest-checkin`**

```json
{ "customerName": "Alex" }
```

**Response `200`:** `{ "success": true }`

### List guests (DJ)

**`GET /api/events/:id/guests`**

Returns array of guest records: `customerName`, `status` (`active` \| `silenced` \| `banned`), `silencedUntil`, `note`, `firstSeenAt`, `lastSeenAt`, interaction counts.

### Guest status (DJ)

**`GET /api/events/:id/guests/:customerName/status`**

```json
{ "status": "active", "until": null }
```

`status` may be `silenced` or `banned` when not allowed.

### Conversation timeline (DJ)

**`GET /api/events/:id/guests/:customerName/conversation`**

```json
{
  "eventId": 1,
  "eventName": "Friday Night",
  "customerName": "Alex",
  "items": [
    { "kind": "message", "id": 12, "timestamp": "…", "body": "Great set!", "private": false },
    { "kind": "reply", "id": 3, "timestamp": "…", "body": "Thanks!", "direct": true },
    { "kind": "request", "id": 8, "timestamp": "…", "type": "song", "title": "…", "artist": "…" }
  ]
}
```

### Moderate (DJ)

**`PUT /api/events/:id/guests/moderate`**

```json
{ "customerName": "Alex", "action": "silence", "durationMinutes": 30, "note": "optional" }
```

| `action` | Body | Effect |
|----------|------|--------|
| `silence` | `durationMinutes` (1–1440) | Block submissions until expiry |
| `ban` | optional `note` | Block until reinstated |
| `active` or `reinstate` | — | Clear silence/ban |

**Response `200`:** `{ "success": true, "guest": { … } }`

### Stealth behaviour on guest submit

When a guest is silenced or banned, submission endpoints do not reveal moderation state:

- JSON APIs may return `{ "success": true }` without persisting the action
- Form posts may render a generic thank-you or error page

---

## Tracks played

### Guest list (public)

**`GET /api/event/:eventSlug/tracks-played?limit=20`**

Returns `[]` if `show_tracks_played_guest` is off. Max `limit` 50.

```json
[
  { "id": 1, "title": "Song", "artist": "Artist", "playedAt": "2026-07-08T20:00:00.000Z", "source": "now-playing" }
]
```

### DJ APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events/:id/tracks-played?limit=100` | List (max 500) |
| POST | `/api/events/:id/tracks-played` | Manual add `{ title, artist?, album?, playedAt? }` |
| POST | `/api/events/:id/tracks-played/from-now-playing` | Log current now playing |
| DELETE | `/api/tracks-played/:id` | Remove one entry |

---

## DJ dashboard APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dj/dashboard-data` | `{ requests, messages }` — messages are inbox-filtered with `needsReply` |
| GET | `/api/dj/messages` | Pending display messages (`?includePrivate=true` for all) |
| POST | `/api/dj/message/:id/mark-displayed` | Mark message shown on display |
| DELETE | `/api/dj/request/:id` | Remove request from queue |
| POST | `/api/dj/reply` | Send reply to guest |
| GET | `/api/dj/replies` | All DJ replies |
| GET | `/api/customer/replies/:customerName` | Replies for a guest (polling) |

**`needsReply`** on inbox messages: `true` when the message is a guest message with no linked reply (`originalType: "message"`, `originalId`).

---

## Cancel an event

**`POST /api/events/:id/cancel`**

Sets **`is_active`** to **`0`**. Customers hitting `/event/:slug` get the standard inactive / closed behaviour (same as manual “deactivate”). No rows are deleted.

**Request body:** optional (ignored).

**Response `200`**

```json
{
  "success": true,
  "action": "cancelled",
  "message": "Event deactivated; customers will see an inactive notice until reactivated.",
  "event": { }
}
```

`event` is the full row after update (same shape as `GET /api/events` items without the `stats` wrapper).

**Errors:** `400` invalid id, `404` not found, `500` server error (`{ "error": "string" }`).

**Re-open:** Use `PUT /api/events/:id` with `{ "is_active": 1 }` (or the existing DJ UI toggle).

---

## Postpone an event

**`POST /api/events/:id/postpone`**

Updates **`event_date`** (required). Optionally updates **`venue`**. Does **not** change **`is_active`**.

**Request body**

```json
{
  "event_date": "2026-06-01",
  "venue": "optional new venue text"
}
```

- **`event_date`** (required): `YYYY-MM-DD` or any string stored as-is (consistent with existing `PUT` behaviour).
- Alias: **`eventDate`** is accepted instead of **`event_date`**.
- **`venue`**: omit to leave venue unchanged; send `""` to clear.

**Response `200`**

```json
{
  "success": true,
  "action": "postponed",
  "message": "Event date updated.",
  "event": { }
}
```

**Errors:** `400` missing/invalid body, `404` not found, `500` server error.

---

## Automation (e.g. n8n)

Use **HTTP Request** nodes with `POST` to:

- `https://<host>/api/events/123/cancel`
- `https://<host>/api/events/123/postpone` and JSON body `{"event_date":"2026-07-15","venue":"Grand Hall"}`

---

*Document version: 1.1 — Jul 2026*
