# MobileDJay — Song-request events HTTP API

These routes manage **MobileDJay request events** (SQLite `events` table / DJ gig links such as `/event/:slug`). They are **not** the EYUP portal bookings API (`/api/v1/…` — see [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md)).

**Base URL:** same host as the app (e.g. `https://requests.eyupevents.uk`).

**Auth:** No authentication is enforced on these endpoints today (same as existing `PUT /api/events/:id`). Restrict access at the network layer (VPN, firewall, or future API key) if the server is exposed publicly.

**Content-Type:** `application/json` for bodies where noted.

---

## Existing event routes (summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | List all events (+ stats) |
| POST | `/api/events` | Create event |
| PUT | `/api/events/:id` | Full/partial update (allowed fields only) |
| DELETE | `/api/events/:id` | Delete event and related rows |
| GET | `/api/events/slug/:slug` | Lookup by public slug |

Event `id` is a **numeric** SQLite primary key.

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

*Document version: 1.0*
