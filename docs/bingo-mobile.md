# Mobile bingo — games, cards, and guest play

How to run UK-style 90-ball bingo with printable cards, multiple games per event, DJ verification on the venue display, and phone play from the guest requests hub.

---

## Enable for an event

1. Open **Event management** → edit the event.
2. Turn on **Mobile bingo** (create/edit forms under guest features).
3. Save.

Guests only see Bingo on the hub when this flag is on. The play URL still exists but returns an error page if bingo is disabled.

| URL | Who |
|-----|-----|
| `/event/:slug` | Guest hub (Bingo tile when enabled) |
| `/event/:slug/bingo` | Guest play — join game, card, claims |
| `/dj/display/:slug` | Venue screen — balls, intro, claim flashes |
| DJ dashboard → **Games** tab | Run calls, verify serials, manage games |

---

## DJ workflow (recommended)

### 1. Create a game and cards

On the dashboard **Games** tab → **Prepare** → **Games & players**:

- Enter a **title** (e.g. “Eyes down — Game 1”).
- Set **Cards** (how many digital/printable cards to generate).
- Optionally keep **Open join on hub** checked so guests can self-join.
- Tap **Create game**.

This creates a `bingo_games` row, generates a card batch linked to that game, and can open the print PDF in a new tab.

You can also add cards later with **Generate & print** (Prepare → Cards) while the desired game is selected in the **Game** dropdown at the top of the Games tab.

### 2. Open join (mobile self-service)

Games start in **preparing**. For guests to join from their phones:

- In the game list, tap **Open join**, or
- Create the game with **Open join on hub** already checked.

Status **join_open** exposes the game in the guest API and hub. Guests need a display name on the hub before joining.

### 3. Select the active game

Use the **Game** dropdown above the bingo console. Start/stop, next ball, config, verify, and card generation all use this `gameId` when set.

If nothing is selected, the server falls back to legacy session (`gameId` 0) or whichever game is currently **live**.

### 4. Run the game

**Control** tab (same as before):

- Set balls, intro, auto-call, voice on display.
- **Start** — marks the selected game **live** (only one live game per event at a time).
- **Next ball** / auto-call, **Pause** via claim flash flow, **Stop** ends the game.

The venue display polls bingo state for the live game context.

### 5. Assign cards manually (optional)

If you prefer not to use self-join:

- Select the game.
- **Assign card to name** → guest display name → **Assign**.

Assigns the next free card in that game’s pool.

### 6. Verify claims

Guests tap **1 Line / 2 Lines / Full house** on their phone (self-check only; does not pause the game).

On the DJ side:

- **Claims** flash buttons for the big screen, or
- Enter **card serial** + claim type → **Verify & flash** (checks against called balls and flashes valid/invalid on the display).

---

## Guest workflow

1. Open `/event/:slug`, enter name if prompted.
2. Tap **Bingo** (home quick action or **More**).
3. On `/event/:slug/bingo`, pick an open game (**join_open** or **live**).
4. The server assigns the next available card for that game (409 if sold out).
5. The card auto-marks numbers as balls are called; guest can submit claims for the DJ to verify.

Deep link: `/event/:slug/bingo?game={id}` skips the picker when returning to the same game.

---

## Game statuses

| Status | Meaning |
|--------|---------|
| `preparing` | Cards exist; join closed on hub |
| `join_open` | Guests can join from mobile |
| `live` | DJ has started calls for this game |
| `ended` | Game finished (stop from DJ) |

---

## Data model (SQLite)

| Table / module | Purpose |
|----------------|---------|
| `bingo_games` | Per-event games (title, batch, ball count, status) |
| `bingo_cards` | Serial, grid, `game_id`, `assigned_to`, optional `device_id` |
| `bingo_player_claims` | Guest claim attempts (for DJ visibility) |
| `events.enable_bingo` | Guest hub + API gate |

In-memory call state is keyed by `eventSlug::gameId` in `lib/bingo-session.js`.

---

## HTTP API (summary)

**DJ (authenticated)** — prefix `/api/events/:id/bingo`:

| Method | Path | Notes |
|--------|------|-------|
| GET | `/games` | List games + unassigned counts |
| POST | `/games` | Create (`title`, `cardCount`, `openJoin`, `ballCount`) |
| PUT | `/games/:gameId` | Update title/status |
| POST | `/games/:gameId/assign` | `customerName` or `serial` |
| GET | `/games/:gameId/players` | Assignments + pending claims |
| POST | `/cards/generate` | Optional `gameId` in body |
| POST | `/verify` | `serial`, `claimType`, optional `gameId` |

**Display / DJ bingo control** — `/api/display/:eventSlug/games/bingo/*`  
Pass `gameId` in query or JSON body on start/stop/call/config when multiple games matter.

**Guest (public, slug-scoped)**:

| Method | Path |
|--------|------|
| GET | `/api/event/:slug/bingo/games` |
| POST | `/api/event/:slug/bingo/games/:gameId/join` |
| GET | `/api/event/:slug/bingo/games/:gameId/play?customerName=` |
| POST | `/api/event/:slug/bingo/games/:gameId/claim` |

---

## Key files

| Area | Path |
|------|------|
| Session + calls | `lib/bingo-session.js`, `lib/bingo.js` |
| Database | `DB/database.js` (`bingoGameDb`, `bingoDb`, `bingoClaimDb`) |
| Routes | `server.js` (bingo section) |
| DJ UI | `views/dj-dashboard.ejs`, `public/js/dj-bingo.js` |
| Display | `views/dj-display.ejs`, `public/js/dj-display-bingo.js` |
| Guest hub | `views/guest-v2/hub.ejs`, `public/js/guest-v2/guest-hub-spa.js` |
| Guest play | `views/bingo-play.ejs`, `public/js/guest-bingo.js` |

---

## Security (guest APIs)

Bingo guest endpoints are **public** (no login), scoped by **event slug** and **`enable_bingo`**. Threat model: other guests or anonymous clients on the internet.

| Control | What it does |
|---------|----------------|
| **Active event only** | `getEventFromSlugJson` returns 403 when the event is inactive. |
| **Feature flag** | Bingo APIs return empty/disabled when `enable_bingo` is off. |
| **Device binding** | Join assigns `device_id` on the card. Play and claim require matching `deviceId` (browser `localStorage` via `guest-session.js`). Another device cannot read your card by guessing your display name. |
| **Name lock** | If a name already has a card with a different device, join returns **409** (same idea as guest check-in `name_taken`). |
| **DJ-assigned cards** | Cards assigned from the dashboard without a device bind to the **first** guest device that joins/plays with that name — encourage guests to use the hub name quickly after a manual assign. |
| **Moderation** | Silenced/banned guests get a generic **503** on join/play/claim (not a separate “you are banned” bingo message). |
| **Name validation** | Trimmed, max 50 chars; spinner/system names rejected. |
| **Claim rate limit** | ~2s minimum between claims per game + device (in-memory). |

**Not secret:** called balls, game title, and joinable game list are visible to anyone who can hit the event APIs (needed to play). **Card grids** are only returned after device checks.

There is **no cryptographic proof** of identity — security matches the rest of the guest hub (display name + device id). For high-stakes games, rely on DJ **serial verify** on the venue screen.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| No Bingo on hub | `enable_bingo` off for event |
| “No games open yet” | No game in `join_open` or `live` |
| “No cards left” | Pool exhausted — generate more cards for that game |
| Wrong board on display | Another game is live; stop one, start the intended game |
| Guest “join first” on play | Name mismatch, never joined, or wrong device — use same phone/browser as join |
| “Another device” / 403 | Card bound to a different browser — use original device or ask DJ to reassign |
| Verify fails | Wrong serial, wrong claim type, or numbers not called yet |

---

## Related docs

- [`mobilejay-features.md`](mobilejay-features.md) — guest hub and event toggles
- [`dj-portal-auth.md`](dj-portal-auth.md) — DJ login and event access

*Document version: 1.0 — Nov 2026*
