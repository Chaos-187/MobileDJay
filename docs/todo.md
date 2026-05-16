# MobileDJay / EYUP portal — engineering backlog

Short list of planned work tracked outside the domain spec docs.

---

## 1. Change password (portal users)

- **Goal:** Authenticated users can set a new password without admin intervention (customers, DJs, admins).
- **Likely scope:**
  - `POST` or `PATCH` under auth or profile — e.g. `POST /api/v1/auth/change-password` with body `{ current_password, new_password }` (Bearer required).
  - Reject weak passwords consistently with register / internal flows (min length, bcrypt).
  - Optional: revoke existing JWTs server-side — not available today without refresh/session store; acceptable v1 behaviour is “old tokens remain valid until expiry” with a documented note.

---

## 2. Delete account (API)

- **Goal:** A user-initiated delete that removes or anonymizes their account and satisfies “right to erasure” directionally (exact retention rules are a product/legal call).
- **Likely scope:**
  - Authenticated endpoint per role — e.g. `DELETE /api/v1/auth/me` or `POST /api/v1/account/delete` with `{ password }` confirmation for customers at minimum.
  - Define behaviour for ** FK rows** (`bookings` owned by customer, notes, assignments, audit references). Options: cascade delete vs soft-delete + anonymize PII fields vs block delete while active bookings exist.
  - Consider separate **admin-only** deletion/disable (partially overlaps `disabled_at` today).

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
