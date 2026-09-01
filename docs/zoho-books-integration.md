# Zoho Books integration

Sync EYUP portal customers and booking quotes with **Zoho Books** — contacts, invoices, and (optionally) recorded payments when Stripe or cash marks a booking payment as paid.

## Prerequisites

1. Zoho Books organisation with GBP (or matching catalog currency).
2. OAuth **Server-based Application** in the [Zoho API Console](https://api-console.zoho.com) for your region (`zoho.com`, `zoho.eu`, etc.).
3. Scopes (minimum):
   - `ZohoBooks.contacts.ALL`
   - `ZohoBooks.invoices.ALL`
   - `ZohoBooks.customerpayments.ALL`

Generate a **refresh token** with the authorization code flow and store it on the API server (see Zoho Books API docs → OAuth).

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

- **Customer hub → Details** — Zoho Books panel, **Push to Zoho**.
- **Booking editor → Payments** — Create deposit / balance / full invoices; links open Zoho Books.

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
