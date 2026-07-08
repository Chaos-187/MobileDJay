# MobileDJay

Mobile-first web app for **EYUP EVENTS** DJs and guests. Customers request songs, karaoke, and messages from their phones; DJs manage everything from a live dashboard, display screens, and event settings.

## Features

### Guest experience
- **Per-event landing pages** at `/event/:slug` with themed branding (colors, logo, background)
- **Song & karaoke requests** with live catalogue search
- **Messages to the DJ** with optional replies shown in-app
- **Guest photos** (when enabled per event)
- **DJ tipping** via configurable payment links
- **Recently played tracks** on the guest page (optional per event)
- **Public event picker** at `/` when enabled — guests choose which event they are at before requesting

### DJ dashboard (`/dj`)
- Full-width layout with **requests** (main panel) and **messages** (right sidebar)
- **Messages inbox** shows guest messages only (no DJ replies or auto-generated request notifications)
- **Awaiting reply** highlight and badge for unreplied guest messages
- **Reply** from the messages panel or from a guest’s full conversation timeline
- **Guests tab** — check-in list, silence (timed), ban, reinstate; click a guest for conversation history
- **Tracks played** tab — view log, add manually, or capture from now playing
- **Display prompts** — push animated prompts to venue screens
- **Photo showcase** — push a guest photo to the display screen

### Event management (`/dj/events`)
- Create and edit events with feature toggles (songs, karaoke, messages, photos, tips)
- **Show on public events page** per event (listed at `/` when global setting is on)
- **Show played tracks on guest page** per event
- Customer URLs, QR codes, gallery share links, display configuration
- Cancel / postpone / activate events

### Global settings (`/dj/settings`)
- DJ name, public base URL (for share links and QR codes)
- **Enable public events page** — home page becomes an event picker
- VirtualDJ integration (forward requests/messages, now playing)
- Music catalogue upload paths
- Photo limits and slideshow defaults

### Venue display
- Per-event display screen at `/dj/display/:slug`
- Now playing, requests, QR code, photo slideshow, DJ prompts

### Data & integration
- **SQLite persistence** for requests, messages, replies, events, photos, tracks, and guest moderation
- **VirtualDJ** XML song database and CSV karaoke catalogue
- **Now playing API** — see [`docs/NOW-PLAYING-API.md`](docs/NOW-PLAYING-API.md)
- **Stealth guest moderation** — silenced/banned guests see generic success or silent thank-you pages (no visible ban message)

## Quick start

```bash
cd MobileDJay
npm install
npm run dev
```

Open `http://localhost:3000`

| URL | Purpose |
|-----|---------|
| `/` | Guest home — event picker (if enabled) or legacy landing |
| `/event/:slug` | Guest requests for a specific event |
| `/dj` | DJ dashboard |
| `/dj/events` | Event management |
| `/dj/settings` | Global DJ settings |
| `/dj/display/:slug` | Venue display screen |

## Public events page

1. **DJ Settings → Sharing & Links** — enable **Enable public events page**
2. **Event Management → Edit event** — enable **Show on public events page** for each event to list
3. Share your site root URL (`/`). Guests pick an event, then land on `/event/:slug`

Only **active** events with **show public** enabled appear. `/events` redirects to `/` for backwards compatibility.

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/mobilejay-features.md`](docs/mobilejay-features.md) | Feature guide for DJs and operators |
| [`docs/mobilejay-events-api.md`](docs/mobilejay-events-api.md) | HTTP API for events, guests, tracks, public listing |
| [`docs/NOW-PLAYING-API.md`](docs/NOW-PLAYING-API.md) | Now playing endpoint for VirtualDJ / integrations |
| [`docs/events-portal-api-endpoints.md`](docs/events-portal-api-endpoints.md) | Separate EYUP portal API (`/api/v1/…`) |

## Technology stack

- **Backend:** Node.js, Express
- **Database:** SQLite (`db/database.js`)
- **Templates:** EJS
- **Frontend:** Bootstrap 5, Font Awesome, vanilla JavaScript
- **Catalogues:** VirtualDJ XML + karaoke CSV

## Project structure

```
MobileDJay/
├── server.js                 # Express app, routes, DJ/guest logic
├── db/
│   └── database.js           # Schema, migrations, data access
├── views/                    # EJS templates
│   ├── index.ejs             # Guest event landing
│   ├── events-list.ejs       # Public event picker (home page)
│   ├── dj-dashboard.ejs      # DJ dashboard
│   ├── event-management.ejs  # Event CRUD
│   ├── dj-settings.ejs       # Global settings
│   └── …
├── public/
│   ├── css/                  # style.css, eyup-site-chrome.css
│   └── js/                   # app.js, dj-dashboard.js, …
├── portal/                   # EYUP portal API (separate DB)
└── docs/                     # API and feature documentation
```

## Configuration

Environment variables are optional; see `.env` support in `server.js`. Key paths:

- **Songs:** `DB/Song_Database.xml` (VirtualDJ format)
- **Karaoke:** `DB/VirtualDJ_Karaoke_Catalog_*.csv`

Catalogues can also be uploaded from **DJ Settings**.

## License

ISC License
