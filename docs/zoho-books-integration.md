# Zoho Books integration

Sync EYUP portal customers and booking quotes with **Zoho Books** — contacts, invoices, and (optionally) recorded payments when Stripe or cash marks a booking payment as paid.

## Prerequisites

1. Zoho Books organisation with GBP (or matching catalog currency).
2. OAuth **Server-based Application** in the Zoho API Console for your region:
   - **EU:** [api-console.zoho.eu](https://api-console.zoho.eu)
   - **US / global:** [api-console.zoho.com](https://api-console.zoho.com)
3. Scopes (minimum):
   - `ZohoBooks.contacts.ALL`
   - `ZohoBooks.invoices.ALL`
   - `ZohoBooks.customerpayments.ALL`

The portal API **does not expose an OAuth callback route**. It only stores a long-lived **refresh token** in `.env` and refreshes access tokens server-side. The redirect URI below is used **once** when you generate that refresh token.

## OAuth setup (Server-based Application)

### 1. Register the client

In the API Console → **Add Client** → **Server-based Applications**:

| Field | Value |
|-------|--------|
| **Client Name** | e.g. `EYUP Events Portal` |
| **Homepage URL** | `https://eyupevents.uk` (or your site) |
| **Authorized Redirect URIs** | `http://localhost` |

Use **`http://localhost` exactly** (no path, no trailing slash). You can add `http://127.0.0.1` as a second URI if Zoho allows multiple entries.

Do **not** use `https://requests.eyupevents.uk/...` unless we add a callback handler — the API does not serve one today.

Copy the **Client ID** and **Client Secret**.

### 2. Get an authorization code (browser, one time)

Replace `YOUR_CLIENT_ID` and open this URL in a browser (EU example):

```
https://accounts.zoho.eu/oauth/v2/auth?scope=ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.customerpayments.ALL&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http://localhost&prompt=consent
```

For **US / `.com`**, use `https://accounts.zoho.com/oauth/v2/auth` with the same query parameters.

Sign in and approve. The browser redirects to something like:

```
http://localhost/?code=1000.xxxxxxxxxxxxx&location=eu&accounts-server=...
```

The page may fail to load — that is expected. Copy the **`code`** query parameter from the address bar (it expires in a few minutes).

### 3. Exchange the code for tokens

EU example (must use the **same** `redirect_uri` as step 1):

```bash
curl -X POST "https://accounts.zoho.eu/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost" \
  -d "code=PASTE_CODE_FROM_BROWSER"
```

US / `.com` token URL: `https://accounts.zoho.com/oauth/v2/token`

From the JSON response, save:

- **`refresh_token`** → `ZOHO_BOOKS_REFRESH_TOKEN` (this is what the server uses ongoing)
- **`access_token`** — short-lived; the portal refreshes this automatically

If no `refresh_token` appears, repeat step 2 with `prompt=consent` and ensure `access_type=offline` is in the auth URL.

### 4. Organisation ID

In Zoho Books: **Settings → Organisation profile** → copy **Organization ID** → `ZOHO_BOOKS_ORGANIZATION_ID`.

## Environment variables

Set on the MobileDJay / portal API host (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `ZOHO_BOOKS_CLIENT_ID` | OAuth client ID |
| `ZOHO_BOOKS_CLIENT_SECRET` | OAuth client secret |
| `ZOHO_BOOKS_REFRESH_TOKEN` | Long-lived refresh token |
| `ZOHO_BOOKS_ORGANIZATION_ID` | Books organisation ID (Settings → Organisation profile) |
| `ZOHO_BOOKS_REGION` | `eu`, `com`, `in`, `com.au`, `jp`, or `ca` (default `eu`) |

Optional overrides: `ZOHO_BOOKS_ACCOUNTS_URL`, `ZOHO_BOOKS_API_BASE`.

When all required vars are set, `GET /api/v1/admin/integrations/status` returns `zoho_books.configured: true`.

## Data model

### `users` (customers)

| Column | Purpose |
|--------|---------|
| `zoho_contact_id` | Linked Zoho Books contact |
| `zoho_contact_synced_at` | Last successful sync |
| `zoho_contact_sync_error` | Last error message |

Contacts sync automatically when a **customer** is created or when name/email/phone is patched. Manual retry: admin **Push to Zoho** or `POST /admin/users/:id/zoho/sync`.

### `bookings`

| Column | Purpose |
|--------|---------|
| `zoho_deposit_invoice_id` | Deposit invoice |
| `zoho_balance_invoice_id` | Balance invoice |
| `zoho_full_invoice_id` | Full quote invoice |
| `deposit_due_at` / `balance_due_at` | Optional explicit due dates (else derived) |

### `booking_payments`

| Column | Purpose |
|--------|---------|
| `zoho_invoice_id` | Invoice this payment applies to |
| `zoho_payment_id` | Zoho customer payment ID |
| `zoho_payment_synced_at` | Idempotency timestamp |
| `zoho_sync_error` | Last payment sync error |

## Admin API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/integrations/status` | Stripe, Brevo, Zoho config summary |
| GET | `/admin/users/:id/zoho` | Customer Zoho sync status |
| POST | `/admin/users/:id/zoho/sync` | Push/update contact |
| GET | `/admin/bookings/:id/zoho` | Booking invoice IDs + URLs |
| POST | `/admin/bookings/:id/zoho/invoice` | Body: `{ "kind": "deposit" \| "balance" \| "full", "force": false }` |
| POST | `/admin/payments/:id/zoho/sync-payment` | Record paid portal payment in Books |

Booking detail (`GET /admin/bookings/:id`) includes `zoho_books_configured` and `zoho` summary.

## Admin UI

- **Site → Integrations → Zoho Books** — **Test connection** and **Sync all customers**.
- **Customer hub → Details** — Zoho Books panel, **Push to Zoho** (single customer).
- **Booking editor → Payments** — Create deposit / balance / full invoices; links open Zoho Books.

Contacts also sync **automatically** when a customer is created or when name/email/phone is updated (if Zoho env vars are set).

## Payment sync (automatic)

When a `booking_payments` row becomes **`paid`** (Stripe webhook/sync or manual cash), the portal schedules a Zoho **customer payment** if:

- Zoho is configured
- The customer has a `zoho_contact_id`
- A matching invoice exists on the booking (or payment row)

Failures are stored in `zoho_sync_error`; retry with `POST /admin/payments/:id/zoho/sync-payment`.

## Source of truth

- **Portal settlement** (`quote_total`, `amount_paid`, `balance_remaining`) remains authoritative for the customer portal and DJ views.
- **Zoho Books** is the accounting record. Staff edits in Books are not automatically pulled back yet (future reconcile job).

## Module layout

| File | Role |
|------|------|
| `portal/zoho-books.js` | OAuth + REST client |
| `portal/zoho-contact-sync.js` | Customer → contact |
| `portal/zoho-invoice-sync.js` | Booking → invoice |
| `portal/zoho-payment-sync.js` | Paid payment → customer payment |

Patterns mirror `stripe-portal.js`, `brevo-mail.js`, and `payment-received-email.js`.

## Ops checklist

1. Set env vars and restart the API (`pm2 reload` / deploy).
2. Open a customer in admin → **Push to Zoho** (verify contact in Books).
3. Open a booking with line items → **Balance invoice** (or deposit).
4. Take a Stripe or cash payment → confirm customer payment appears in Books (or use manual sync endpoint).
