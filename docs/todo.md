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

- **Goal:** Repeatable artefact (`Dockerfile`), optional compose for local/stacked deps, CI/CD that builds and deploys.
- **Likely scope:**
  - Dockerfile: Node LTS base, production `npm ci`, expose app port (e.g. `3000`), document env vars (`PORT`, `PORTAL_JWT_SECRET`, `PORTAL_INTERNAL_API_KEY`, `PORTAL_PII_ENCRYPTION_KEY`, `PORT`, CORS, etc.).
  - Volume or external store for **`db/eyup_portal.db`** (and separate song/event DB paths if split) — image must not treat DB as ephemeral only if data must survive redeploys.
  - Compose (optional): `server` + reverse-proxy notes / healthchecks.
  - CI: lint/test/build image; CD: push registry + deploy hook (GitHub Actions, GitLab CI, or host-specific) — **choose stack** when implementation starts.

---

*Add completed items beneath each section or strike through when shipped.*
