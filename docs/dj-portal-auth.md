# DJ portal sign-in (`/dj`)

MobileDJay’s DJ tools use the **same user accounts** as the EYUP events portal (`eyupevents.uk`). DJs sign in at the requests host; admins retain full access; venue **display** and **guest** URLs stay public.

Production example: **https://requests.eyupevents.uk/dj**

## What requires login

| Area | Path / API | Auth |
|------|------------|------|
| DJ dashboard | `/dj` | Portal user, role `dj` or `admin` |
| Event management | `/dj/events` | Same |
| Global settings | `/dj/settings` | **`admin` only** |
| Photo / display config pages | `/dj/photos/:slug`, `/dj/display-config/:slug` | Same as dashboard; event must be assigned (or admin) |
| DJ APIs | `/api/dj/*`, `/api/events/*` (management), photo/track/display **trigger** APIs | Cookie session or `Authorization: Bearer` JWT |
| Sign-in | `/dj/login` | Public |
| Guest hub | `/event/:slug`, song/karaoke/message flows | Public |
| Venue display | `/dj/display/:slug` (and display **poll** APIs) | Public (screens at the venue) |

Unauthenticated browser requests to protected pages redirect to `/dj/login?next=…`. API calls return **401** JSON; the DJ UI redirects to login when it sees 401.

## Who can sign in

- Users in the portal SQLite DB (`db/eyup_portal.db`) with role **`dj`** or **`admin`**.
- Customer (`customer`) accounts are rejected at login with a message to use the customer portal.
- Disabled accounts (`disabled_at` set) cannot sign in.

Passwords and JWT signing use the same code as the main portal (`portal/auth-tokens.js`, `portal-database.js`).

## Which events a DJ sees

Admins see **all** MobileDJay events.

DJs only see events whose **`slug`** matches a **`requests_event_slug`** on at least one **non-cancelled** booking they are assigned to:

1. Row in **`booking_assignments`** linking `booking_id` → `dj_user_id`.
2. That booking’s **`requests_event_slug`** must match the MobileDJay event slug (case-insensitive).

Office staff set `requests_event_slug` when linking a booking to the guest-requests event (same flow as elsewhere in the EYUP portal). Until that link exists, the DJ may see an empty dashboard with a pointer to [eyupevents.uk/events/dj.html](https://eyupevents.uk/events/dj.html) for their schedule.

The dashboard can show an **upcoming gigs** banner from assigned bookings (title, date, linked slug or “not linked yet”).

## Environment variables

Set these in the **project root** `.env` (see [`.env.example`](../.env.example)). MobileDJay and the portal API share several values.

### Required in production

| Variable | Purpose |
|----------|---------|
| `PORTAL_JWT_SECRET` (or `JWT_SECRET`) | Signs the HttpOnly cookie `mdj_portal_token` and portal API tokens. **Must match** the value used for the EYUP portal on the same deployment. |

If the secret differs between services, login may succeed on one host but sessions will not validate correctly.

### DJ auth toggles

| Variable | Default | Purpose |
|----------|---------|---------|
| `MDJ_DJ_AUTH_DISABLED` | off | Set to `1` or `true` to **bypass login** locally (acts as a dev admin user). **Do not enable in production.** |
| `MDJ_COOKIE_SECURE` | Secure when `NODE_ENV=production` or `req.secure` | Set to `1` to force `Secure` on the auth cookie (HTTPS). |

### Login hardening (recommended in production)

| Variable | Purpose |
|----------|---------|
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` (or `TURNSTILE_SECRET_KEY`) | Server-side Turnstile verification on `POST /dj/auth/login`. |
| Turnstile site key | Passed to the login page from `CLOUDFLARE_TURNSTILE_SITE_KEY` / `TURNSTILE_SITE_KEY`, or a built-in test key in dev. |

If Turnstile secrets are unset, verification is **skipped** (convenient for local dev).

### Database

| Path | Purpose |
|------|---------|
| `db/eyup_portal.db` | Portal users, bookings, assignments, `requests_event_slug` |
| `db/mobiledj.db` (or app DB path in your install) | MobileDJay events, requests, messages |

Both must be present and kept in sync on the server that serves `requests.eyupevents.uk`.

## Local development

1. Copy `.env.example` → `.env` and set `PORTAL_JWT_SECRET` to any long random string for local use.
2. Optional: `MDJ_DJ_AUTH_DISABLED=1` to work on `/dj` without logging in.
3. Seed portal users if needed: `npm run portal-seed` (see comments in `.env.example` for `EYUP_PORTAL_SEED_*`).
4. Ensure a DJ user exists and, for scoped testing, a booking assignment + `requests_event_slug` matching a test event slug.

```bash
cd MobileDJay
npm install
npm run dev
```

Open `http://localhost:3000/dj/login` (or `/dj` if auth is disabled).

## Production checklist

1. **`PORTAL_JWT_SECRET`** set and identical wherever portal auth is validated.
2. **`MDJ_DJ_AUTH_DISABLED`** unset or `0`.
3. **HTTPS** in front of the app so session cookies are sent securely (`MDJ_COOKIE_SECURE=1` if you terminate TLS at a proxy and need to force Secure).
4. **Turnstile** keys configured if you want bot protection on DJ login.
5. Portal DB contains DJ users and booking assignments with correct **`requests_event_slug`** values.
6. After deploy, smoke-test: guest `/event/:slug` and `/dj/display/:slug` work **without** login; `/dj` redirects to login; DJ user sees only assigned events.

## Session details

- Cookie name: **`mdj_portal_token`** (HttpOnly, `SameSite=Lax`, path `/`, max age 7 days).
- Login: `POST /dj/auth/login` with JSON `{ "email", "password", "cf_turnstile_response" }`.
- Logout: `POST /dj/auth/logout` (requires valid session).
- Front-end DJ pages use **`/js/dj-api.js`** (`mdjFetch`) to send `credentials: 'include'` on API calls.

API clients can send `Authorization: Bearer <portal access token>` instead of the cookie.

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| Redirect loop or instant logout | `PORTAL_JWT_SECRET` mismatch; cookie blocked (wrong domain/Secure); clock skew |
| “DJ or admin account required” | User role is `customer` or missing |
| Empty event list after login | No `booking_assignments` for that user, or bookings missing/wrong `requests_event_slug`, or slug doesn’t match any MobileDJay event |
| 401 from API in browser | Session expired; call sites must use `credentials: 'include'` or `mdjFetch` |
| Turnstile errors on login | Site/secret key pair, domain allowed in Cloudflare Turnstile widget settings |
| Stream Deck / automation `GET /api/karaoke/trigger-spin` fails | That route now requires DJ auth; use a bearer token or trigger via authenticated POST from the dashboard |

## Related code

| File | Role |
|------|------|
| [`portal/dj-web-auth.js`](../portal/dj-web-auth.js) | Cookie JWT, middleware, login/logout, event filtering |
| [`DB/portal-database.js`](../DB/portal-database.js) | `getDjAssignedRequestsEventSlugs`, `getDjUpcomingBookings` |
| [`views/dj-login.ejs`](../views/dj-login.ejs) | Sign-in UI |
| [`public/js/dj-api.js`](../public/js/dj-api.js) | Authenticated fetch helper |
| [`server.js`](../server.js) | Route wiring for `/dj` and protected APIs |

For deployment paths and PM2, see [`deploy-self-hosted.md`](deploy-self-hosted.md).
