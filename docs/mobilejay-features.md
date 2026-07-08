# MobileDJay — feature guide

Operator-facing overview of DJ and guest features. For HTTP details see [`mobilejay-events-api.md`](mobilejay-events-api.md).

---

## Guest pages

### Event landing (`/event/:slug`)

Each event has its own URL. Guests enter their name (check-in is recorded silently), then choose song request, karaoke, message, photos, or tips depending on what is enabled for that event.

Inactive events show a closed notice instead of the request UI.

### Public event picker (home page `/`)

When **Enable public events page** is on in DJ Settings, the site root lists active events that are marked **Show on public events page**. Guests tap an event card to open `/event/:slug`.

When the setting is off, `/` shows the legacy generic MobileDJay landing (no event context).

### Recently played tracks

Per event: **Edit event → Show recently played on song request page**.

When enabled, the song request screen shows a **Recently Played** button that opens a scrollable modal. Tracks are logged automatically from VirtualDJ now playing (when integrated) and can be added manually from the DJ dashboard **Tracks Played** tab.

### Stealth moderation

Guests who are **silenced** or **banned** do not see moderation UI. Their submissions are rejected silently:

- Song/karaoke/message: generic error or thank-you page (no “you are banned” message)
- Check-in and photo upload: `{ "success": true }` with no visible effect

---

## DJ dashboard (`/dj`)

### Layout

- **Left:** Requests queue (song and karaoke), filters, karaoke spinner
- **Right:** Messages panel — guest messages only

DJ replies and auto-generated messages from song/karaoke submissions do **not** appear in the messages inbox.

### Messages

- **Awaiting reply** — blue highlight and badge when a guest message has no DJ reply linked to it
- **Reply** — button on each message card, or from the guest conversation modal
- **Event filter** — filter message cards by event (reply controls stay visible)

### Guests tab

Lists everyone who checked in or interacted with the selected event.

| Action | Effect |
|--------|--------|
| **Silence** | Block submissions for a chosen duration (presets or custom minutes) |
| **Ban** | Block until reinstated |
| **Reinstate** | Return guest to active |

Click a guest row to open a **conversation modal** — full timeline of messages, DJ replies, and requests for that name at that event.

### Tracks played tab

- View tracks logged for the selected event
- **Add track** manually (title, artist)
- **Log from now playing** — captures current VirtualDJ now playing for the event

### Display integration

- **Prompts** — send animated on-screen prompts to `/dj/display/:slug`
- **Photo showcase** — push a guest photo to the display

---

## Event management (`/dj/events`)

### Feature toggles (per event)

| Toggle | Guest effect |
|--------|----------------|
| Song requests | Song search and submit |
| Karaoke requests | Karaoke search and submit |
| Messages | Send message to DJ |
| Guest photos | Camera/upload flow |
| Enable tips | Tip modal with payment links |
| **Show recently played on song request page** | Recently Played button + modal on song request screen |
| **Show on public events page** | Listed on `/` when global setting enabled |

### Sharing

Each event card shows the customer URL (`/event/:slug`), copy button, QR code, and share links (including gallery token URL).

### Display

**Display** opens the venue screen; **Configure** opens display theme, QR position, background, and slideshow options.

---

## Global settings (`/dj/settings`)

### Sharing & links

- **Public base URL** — used for share links and QR codes when the app is behind a proxy
- **Enable public events page** — `/` becomes the event picker

### Events defaults

Default on/off for song, karaoke, messages, photos, and tips when creating a new event.

### VirtualDJ

- Forward requests and messages to VirtualDJ ask path
- Now playing feeds the guest “now playing” card and automatic track logging

### Photos

Max photos per guest, slideshow interval, banner style for display showcase.

---

## Persistence

Requests, messages, replies, photos, tracks played, and guest records are stored in SQLite. The DJ dashboard reloads live data from the database on refresh; in-memory mirrors are kept in sync on each write.

---

## Related docs

- [`mobilejay-events-api.md`](mobilejay-events-api.md) — REST endpoints
- [`NOW-PLAYING-API.md`](NOW-PLAYING-API.md) — now playing integration
- [`events-portal-api-endpoints.md`](events-portal-api-endpoints.md) — separate customer/DJ portal (`/api/v1`)

*Document version: 1.1 — Jul 2026*
