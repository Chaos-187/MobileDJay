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

---

## 4. MobileDJay guest & DJ features ✅

- **Shipped:** Public events picker at `/` (`enable_public_events_page` + per-event `show_public`). See [`mobilejay-features.md`](mobilejay-features.md) and [`mobilejay-events-api.md`](mobilejay-events-api.md).
- **Shipped:** Guest moderation (check-in, silence, ban, reinstate, stealth rejection). DJ **Guests** tab and conversation API.
- **Shipped:** Messages inbox filtering, `needsReply` highlight, guest conversation modal.
- **Shipped:** Tracks played logging (now playing + manual), optional guest-page list (`show_tracks_played_guest`).
- **Shipped:** SQLite persistence for requests, messages, replies.

---

## 5. Forgot password (magic reset link + email)

- **API:** `POST /auth/forgot-password` (email, Turnstile) — rate-limited; always generic success response (no email enumeration). Issue one-time token (reuse or parallel **`portal_magic_login_tokens`** / dedicated **`portal_password_reset_tokens`** table); TTL via env (e.g. **`PORTAL_PASSWORD_RESET_TTL_MINUTES`**).
- **API:** `POST /auth/password-reset/consume` `{ token, new_password }` — validate token, set **`password_hash`**, invalidate token; optional sign-in JWT or redirect to login.
- **Email:** Brevo transactional template export under **`EYUP_EVENTS/email-templates/`** (e.g. **`brevo-password-reset.yml`**) with **`{{ params.reset_link }}`** (or **`login_link`** pattern: `/events/login?reset=…` or dedicated **`/events/reset-password`** page). Register **`BREVO_TEMPLATE_PASSWORD_RESET`** in **`brevo-mail.js`** and **`.env.example`**.
- **Portal UI:** “Forgot password?” on **`/events/login`** and customer auth gate; reset page or modal to enter new password after link click.
- **Docs:** **`docs/events-portal-api-endpoints.md`** §4 auth; admin note that this is separate from customer **welcome magic link** (§ account created / reinvite).
- **Security:** Same hardening as magic sign-in (single-use, hashed token storage, disabled accounts rejected); do not revoke all JWTs on reset unless product requires it (document choice).

---

## 6. Payment confirmation email (after Stripe paid)

- **Trigger:** When a **`booking_payments`** row becomes **`paid`** (today: Stripe **`checkout.session.completed`** in **`portal/stripe-webhook.js`**; also cover admin/manual reconcile paths if any mark **`paid`** without webhook).
- **Email:** New Brevo transactional template under **`EYUP_EVENTS/email-templates/`** (e.g. **`brevo-payment-received.yml`**) — event ref, amount, currency, payment kind (deposit / balance / other), link to customer portal (**`/events/customer`**, Transactions tab). Register **`BREVO_TEMPLATE_PAYMENT_RECEIVED`** (or separate deposit/balance IDs) in **`brevo-mail.js`** and **`.env.example`**.
- **Idempotency:** Record send per **`booking_payments.id`** (metadata column or **`payment_email_sent_at`**) so webhook retries do not duplicate emails.
- **Optional:** Attach/link to existing **`GET /customer/payments/:id/receipt`** HTML or Stripe receipt URL from **`payment-receipt.js`** params in template.
- **Docs:** **`docs/events-portal-api-endpoints.md`** — Stripe webhook side effects + env template IDs.

---

*Add completed items beneath each section or strike through when shipped.*
