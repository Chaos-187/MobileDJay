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

   - `ZohoBooks.estimates.ALL` (quotes for pending-deposit bookings)

   - `ZohoBooks.items.ALL` (catalog product sync)



## OAuth setup (recommended — admin Connect flow)



The portal API stores a long-lived **refresh token** in SQLite after an admin completes OAuth. Access tokens are refreshed server-side automatically.



### 1. Register the client



In the API Console → **Add Client** → **Server-based Applications**:



| Field | Value |

|-------|--------|

| **Client Name** | e.g. `EYUP Events Portal` |

| **Homepage URL** | `https://eyupevents.uk` (or your site) |

| **Authorized Redirect URIs** | `https://requests.eyupevents.uk/api/v1/admin/zoho/oauth/callback` |



For local dev, also add `http://localhost:3000/api/v1/admin/zoho/oauth/callback` (or whatever `PORTAL_API_PUBLIC_ORIGIN` points to).



Copy the **Client ID** and **Client Secret**.



### 2. Set env vars on the API server



| Variable | Purpose |

|----------|---------|

| `ZOHO_BOOKS_CLIENT_ID` | OAuth client ID |

| `ZOHO_BOOKS_CLIENT_SECRET` | OAuth client secret |

| `ZOHO_BOOKS_ORGANIZATION_ID` | Books organisation ID (Settings → Organisation profile) |

| `ZOHO_BOOKS_REGION` | `eu`, `com`, `in`, `com.au`, `jp`, or `ca` (default `eu`) |



Optional:



| Variable | Purpose |

|----------|---------|

| `ZOHO_BOOKS_OAUTH_REDIRECT_URI` | Override callback URL shown in admin UI |

| `PORTAL_API_PUBLIC_ORIGIN` | API origin for default redirect URI (default `https://requests.eyupevents.uk`) |

| `PORTAL_PUBLIC_ORIGIN` | Admin UI origin for post-OAuth redirect (default `https://eyupevents.uk`) |

| `ZOHO_BOOKS_ACCOUNTS_URL`, `ZOHO_BOOKS_API_BASE` | Region URL overrides |



Restart the API after changing env vars.



### 3. Connect in admin



1. Open **Admin → Site → Integrations → Zoho Books**.

2. Confirm the **redirect URI** shown matches what you registered in Zoho.

3. Click **Connect Zoho Books** — sign in at Zoho and approve.

4. You are returned to the admin Site tab; click **Test connection**.



The refresh token is stored in the `portal_zoho_oauth` table. You do **not** need `ZOHO_BOOKS_REFRESH_TOKEN` in `.env` when using Connect.



### 4. Disconnect / reconnect



**Disconnect** removes the stored refresh token from the database. **Connect** again to obtain a new one (Zoho may require `prompt=consent` on re-authorization).



## Manual refresh token (optional fallback)



If you prefer not to use the admin Connect flow, you can still paste a refresh token into `.env`:



```

ZOHO_BOOKS_REFRESH_TOKEN=...

```



Env takes precedence over the database token. Useful for CI or disaster recovery.



### One-time manual OAuth (legacy)



1. Register redirect URI `http://localhost` in Zoho.

2. Open the authorize URL in a browser (EU example):



```

https://accounts.zoho.eu/oauth/v2/auth?scope=ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.estimates.ALL,ZohoBooks.items.ALL&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http://localhost&prompt=consent

```



3. Copy the `code` from the redirect URL and exchange it:



```bash

curl -X POST "https://accounts.zoho.eu/oauth/v2/token" \

  -H "Content-Type: application/x-www-form-urlencoded" \

  -d "grant_type=authorization_code" \

  -d "client_id=YOUR_CLIENT_ID" \

  -d "client_secret=YOUR_CLIENT_SECRET" \

  -d "redirect_uri=http://localhost" \

  -d "code=PASTE_CODE_FROM_BROWSER"

```



4. Save `refresh_token` to `ZOHO_BOOKS_REFRESH_TOKEN` or use **Connect** instead.



## Configuration status



When client ID, secret, organisation ID, and a refresh token (from Connect or env) are present, `GET /api/v1/admin/integrations/status` returns `zoho_books.configured: true`.



OAuth-specific fields:



| Field | Meaning |

|-------|---------|

| `oauth_connected` | Refresh token stored via admin Connect |

| `oauth_redirect_uri` | Callback URL to register in Zoho |

| `has_env_refresh_token` | `ZOHO_BOOKS_REFRESH_TOKEN` set in env |



## Admin API



| Method | Path | Description |

|--------|------|-------------|

| GET | `/admin/integrations/status` | Stripe, Brevo, Zoho config summary |

| GET | `/admin/zoho/oauth/start` | Returns `{ authorize_url, redirect_uri }` |

| GET | `/admin/zoho/oauth/callback` | Public OAuth callback (no Bearer auth) |

| POST | `/admin/zoho/oauth/disconnect` | Clear stored refresh token |

| POST | `/admin/zoho/test` | Verify connection |

| POST | `/admin/zoho/sync-contacts` | Bulk push customers |

| POST | `/admin/zoho/sync-items` | Bulk push catalog products as Zoho Items |

| POST | `/admin/zoho/sync-estimates` | Bulk create quotes for pending-deposit bookings |

| GET | `/admin/users/:id/zoho` | Customer Zoho sync status |

| POST | `/admin/users/:id/zoho/sync` | Push/update contact |

| GET | `/admin/bookings/:id/zoho` | Booking quote + invoice IDs + URLs |

| POST | `/admin/bookings/:id/zoho/estimate` | Create Zoho quote (estimate) for pending-deposit booking |

| POST | `/admin/bookings/:id/zoho/invoice` | Body: `{ "kind": "deposit" \| "balance" \| "full", "force": false }` |

| POST | `/admin/payments/:id/zoho/sync-payment` | Record paid portal payment in Books |



## Data model



### `portal_zoho_oauth`



| Column | Purpose |

|--------|---------|

| `refresh_token` | Long-lived OAuth refresh token (single row, `id = default`) |

| `connected_at` | When Connect completed |

| `connected_by_user_id` | Admin who connected |



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



## Admin UI



- **Site → Integrations → Zoho Books** — **Connect**, **Test connection**, **Sync all customers**.

- **Customer hub → Details** — Zoho Books panel, **Push to Zoho** (single customer).

- **Booking editor → Payments** — Create deposit / balance / full invoices; links open Zoho Books.



Contacts also sync **automatically** when a customer is created or when name/email/phone is updated (if Zoho is configured).



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

| `portal/zoho-oauth.js` | Admin Connect flow + callback |

| `portal/zoho-contact-sync.js` | Customer → contact |

| `portal/zoho-invoice-sync.js` | Booking → invoice |

| `portal/zoho-payment-sync.js` | Paid payment → customer payment |



## Ops checklist



1. Register OAuth client + redirect URI in Zoho API Console.

2. Set `ZOHO_BOOKS_CLIENT_ID`, `CLIENT_SECRET`, `ORGANIZATION_ID`, `REGION` on API; restart.

3. Admin → Site → **Connect Zoho Books** → **Test connection**.

4. Open a customer → **Push to Zoho** (verify contact in Books).

5. Open a booking with line items → **Balance invoice** (or deposit).

6. Take a Stripe or cash payment → confirm customer payment appears in Books (or use manual sync endpoint).

