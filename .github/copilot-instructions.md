<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# MobileDJay Project Instructions

Node.js Express app for EYUP EVENTS — guests request songs, karaoke, and messages; DJs run a live dashboard, events, display screens, and moderation.

## Project structure

- `server.js` — Express routes, guest/DJ logic, VirtualDJ integration
- `db/database.js` — SQLite schema, migrations, `eventDb`, `guestDb`, `trackDb`, etc.
- `views/` — EJS templates (`index.ejs`, `dj-dashboard.ejs`, `events-list.ejs`, …)
- `public/css/` — `style.css`, `eyup-site-chrome.css`
- `public/js/` — `app.js`, `dj-dashboard.js`, request page scripts
- `portal/` — separate EYUP portal API (`/api/v1`)
- `docs/` — feature guide and API docs

## Key features

- **Multi-event** — `/event/:slug` per gig; optional public picker at `/` (`enable_public_events_page` + `show_public`)
- **DJ dashboard** (`/dj`) — requests panel + messages sidebar; Guests tab; tracks played; display prompts
- **Guest moderation** — stealth silence/ban via `event_guests` table and `PUT /api/events/:id/guests/moderate`
- **Messages inbox** — `filterDjInboxMessages()`, `needsReply` enrichment, guest conversation API
- **Persistence** — requests, messages, replies in SQLite (not memory-only)
- **Tracks played** — `tracks_played` table; guest list when `show_tracks_played_guest` enabled

## Code style

- ES6+ where appropriate; match existing patterns in surrounding files
- Bootstrap 5 + Font Awesome; mobile-first
- Minimal scope on changes; reuse `eventDb`, `guestDb`, existing EJS/JS patterns

## Documentation

- `README.md` — overview and quick start
- `docs/mobilejay-features.md` — operator feature guide
- `docs/mobilejay-events-api.md` — HTTP API reference

## Main routes

| Route | Purpose |
|-------|---------|
| `/` | Public event picker (if enabled) or legacy landing |
| `/event/:slug` | Guest landing |
| `/dj` | DJ dashboard |
| `/dj/events` | Event management |
| `/dj/settings` | Global settings |
| `/api/events` | Event CRUD |
| `/api/public/events` | Public listing JSON |
