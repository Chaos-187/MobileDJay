# MobileDJay / EYUP portal — engineering backlog

Short list of planned work tracked outside the domain spec docs.

---

## 1. Change password (portal users) ✅

- **Shipped:** **`POST /api/v1/auth/change-password`** (Bearer): `{ current_password, new_password }` — min length **8** for **`new_password`**; bcrypt; JWTs unchanged until expiry. See **`docs/events-portal-api-endpoints.md`** §4.

---

## 2. Delete account (API) ✅

- **Shipped:** **`POST /api/v1/auth/delete-account`** (Bearer): **`password`** if the account has a password; else **`confirm_passwordless_delete`: `true`**. **`409`** if customer has any booking row, DJ has upcoming assignment, or last active admin — **`details.reason`**. Cleans **`admin_audit_log`** / **`account_manager_user_id`** FKs before delete. Same doc §4.

---

## 3. Docker packaging and automated deployment

- **Shipped (PM2 path):** Self-hosted GitHub Actions workflow — [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), [`docs/deploy-self-hosted.md`](deploy-self-hosted.md), [`ecosystem.config.cjs`](../ecosystem.config.cjs). Deploy target: `/home/kyle/Documents/MobileDJay-main/`.
- **Future:** Dockerfile / compose for containerised deploys.
- **Shipped:** Server-side **`scripts/deploy.sh`** + deploy-key docs — see [§8](#8-deploysh-server-deploy-via-github-deploy-key-).

---

## 4. MobileDJay guest & DJ features ✅

- **Shipped:** Public events picker at `/` (`enable_public_events_page` + per-event `show_public`). See [`mobilejay-features.md`](mobilejay-features.md) and [`mobilejay-events-api.md`](mobilejay-events-api.md).
- **Shipped:** Guest moderation (check-in, silence, ban, reinstate, stealth rejection). DJ **Guests** tab and conversation API.
- **Shipped:** Messages inbox filtering, `needsReply` highlight, guest conversation modal.
- **Shipped:** Tracks played logging (now playing + manual), optional guest-page list (`show_tracks_played_guest`).
- **Shipped:** SQLite persistence for requests, messages, replies.

---

## 5. Forgot password (magic reset link + email) ✅

- **Shipped:** **`POST /auth/forgot-password`** (email + Turnstile) — generic **`200`** message; rate limit **`portal/forgot-password-rate.js`**; **`portal_password_reset_tokens`** table + **`portal-password-reset.js`**.
- **Shipped:** **`POST /auth/password-reset/consume`** — sets **`password_hash`**, returns JWT (same shape as login); all roles.
- **Shipped:** Brevo template **`EYUP_EVENTS/email-templates/brevo-password-reset.yml`** — **`{{ params.reset_link }}`**; **`BREVO_TEMPLATE_PASSWORD_RESET`** in **`brevo-mail.js`** and **`.env.example`**.
- **Shipped:** Portal UI — **`/events/forgot-password`**, **`/events/login?reset=…`**, links on login + customer gate.
- **Shipped:** **`docs/events-portal-api-endpoints.md`** §4.
- **Ops:** Import template in Brevo and set **`BREVO_TEMPLATE_PASSWORD_RESET`** on the server before emails send.

---

## 6. Payment confirmation email (after Stripe paid) ✅

- **Shipped:** When **`booking_payments`** → **`paid`** via **`portal/stripe-checkout-sync.js`** (`checkout.session.completed` webhook or checkout sync), sends Brevo template **`payment_received`** if **`BREVO_TEMPLATE_PAYMENT_RECEIVED`** is set.
- **Shipped:** Idempotency — **`booking_payments.payment_email_sent_at`**; retries and duplicate webhooks skip (or retry after a failed send clears the claim).
- **Shipped:** **`EYUP_EVENTS/email-templates/brevo-payment-received.yml`** — event ref, amount, kind, **`params.PORTAL_LINK`** (`/events/customer?tab=transactions`), optional **`params.RECEIPT_LINK`** (Stripe hosted receipt).
- **Shipped:** **`portal/payment-received-email.js`**, **`brevo-mail.js`** registry + **`portalCustomerUrl()`**.
- **Shipped:** **`docs/events-portal-api-endpoints.md`** — Stripe webhook side effects.
- **Ops:** Import template in Brevo and set **`BREVO_TEMPLATE_PAYMENT_RECEIVED`** on the API server.

---

## 7. Zoho Books integration (invoices & customers)

- **Goal:** Sync portal customers and booking billing with **Zoho Books** — create/update **contacts (customers)**, raise **invoices** (deposit, balance, or full quote), and optionally record **payments** when Stripe marks a booking payment paid.
- **Auth:** Zoho OAuth2 (organization-scoped refresh token) — env: **`ZOHO_BOOKS_CLIENT_ID`**, **`ZOHO_BOOKS_CLIENT_SECRET`**, **`ZOHO_BOOKS_REFRESH_TOKEN`**, **`ZOHO_BOOKS_ORGANIZATION_ID`**, **`ZOHO_BOOKS_REGION`** (`com` / `eu` / `in` / etc. for API base URL).
- **Customer sync:** On portal user create/update (customer role) — map name, email, phone, billing address if stored; persist **`zoho_contact_id`** on **`portal_users`** (or PII extension table). Admin “Sync to Zoho” / retry on failure.
- **Invoice creation:** From admin booking (Payments tab or post-booking action) — line items from quote/catalog; currency GBP; due dates aligned with **`deposit_due_at`** / **`balance_due_at`**; store **`zoho_invoice_id`** on booking or **`booking_payments`** row.
- **Payment sync (optional phase 2):** When **`booking_payments.status`** → **`paid`**, create Zoho **customer payment** applied to invoice; idempotency key per payment id.
- **Webhooks / polling:** Handle Zoho invoice status changes if staff edit in Books; or periodic reconcile job — document source of truth (portal vs Zoho).
- **Admin UI:** Connection status, last sync error, manual “Create invoice in Zoho” / “Push customer”.
- **Docs:** New **`docs/zoho-books-integration.md`** (scopes, env, flows); cross-links in **`events-portal-api-endpoints.md`** for any admin endpoints.

---

## 8. `deploy.sh` (server deploy via GitHub deploy key) ✅

- **Shipped:** [`scripts/deploy.sh`](../scripts/deploy.sh) — git fetch/ff-only (or **`--force`** reset), **`npm ci --omit=dev`**, PM2 reload, health check; **`--install-only`** for git-less runs.
- **Shipped:** [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) calls **`bash scripts/deploy.sh --install-only`** after rsync so PM2/health logic is shared.
- **Shipped:** [`docs/deploy-self-hosted.md`](deploy-self-hosted.md) — deploy key setup, clone, env vars, git vs Actions rsync table.
- **Optional later:** Cron example; wire **`DEPLOY_GIT_REMOTE`** in server profile.

---

*Add completed items beneath each section or strike through when shipped.*
