# Self-hosted deployment (GitHub Actions + PM2)

MobileDJay deploys to your server when **`main`** is pushed (or when you run the workflow manually). The job runs on a **self-hosted GitHub Actions runner** on the same machine as the app.

## Server layout

| Path | Purpose |
|------|---------|
| `/home/kyle/Documents/MobileDJay-main/` | Live app (code, `node_modules`, PM2 cwd) |
| `.env` | Production secrets (never overwritten by deploy) |
| `db/mobiledj.db` | Song-request SQLite DB |
| `db/eyup_portal.db` | Portal SQLite DB |
| `uploads/` | Guest photos and theme uploads |

Override the deploy path with a repository **Variable** `DEPLOY_PATH` if needed.

## One-time server setup

### 1. Install dependencies

```bash
# Node.js 20 LTS recommended (better-sqlite3 native module)
node -v
npm -v
sudo npm install -g pm2
```

### 2. Prepare the app directory

```bash
mkdir -p /home/kyle/Documents/MobileDJay-main
cd /home/kyle/Documents/MobileDJay-main

# Copy or create production .env (see .env.example)
cp .env.example .env
# edit .env — set PORT, PORTAL_JWT_SECRET, etc.

# First manual start (optional — deploy workflow can also register PM2)
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow printed instructions so PM2 survives reboot
```

### 3. Register the self-hosted runner

On the server (or a user that can write to the deploy path):

1. GitHub repo → **Settings → Actions → Runners → New self-hosted runner**
2. Follow the Linux instructions (download, configure, `./run.sh` or install as a service)
3. Use the default **`self-hosted`** label (or add labels and update `.github/workflows/deploy.yml`)

The runner user must be able to:

- Write to `DEPLOY_PATH`
- Run `npm ci` and `pm2` (same user that already runs the app is simplest)

## What the workflow does

Workflow file: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

1. **Checkout** the commit on the runner
2. **rsync** into `DEPLOY_PATH` with `--delete`, preserving:
   - `.env`
   - `db/*.db` (and other SQLite files)
   - `uploads/`
   - `node_modules/` (rebuilt in next step)
3. **`npm ci --omit=dev`** in the deploy directory
4. **`pm2 reload`** (or `pm2 start` on first deploy) via [`ecosystem.config.cjs`](../ecosystem.config.cjs)
5. **`pm2 save`**
6. **Health check** — HTTP GET to `http://127.0.0.1:$PORT/`

## PM2 process name

Default process name: **`mobiledjay`**.

If your existing PM2 app uses a different name, either:

- Set repository Variable **`PM2_APP_NAME`** to match, or
- Rename once: `pm2 delete old-name && pm2 start ecosystem.config.cjs && pm2 save`

Useful commands on the server:

```bash
cd /home/kyle/Documents/MobileDJay-main
pm2 status
pm2 logs mobiledjay
pm2 reload mobiledjay
```

## Manual deploy

GitHub → **Actions → Deploy → Run workflow**.

## Troubleshooting

| Issue | Check |
|-------|--------|
| Runner not picking up jobs | Runner online in repo Settings → Actions → Runners |
| `npm ci` fails on better-sqlite3 | Node version matches dev; build tools installed (`build-essential`) |
| Health check fails | `pm2 logs mobiledjay`; verify `PORT` in `.env` |
| Data missing after deploy | rsync excludes DB/uploads — ensure paths match workflow excludes |
| Permission denied on rsync | Runner user owns or can write `DEPLOY_PATH` |

---

*See also [`todo.md`](todo.md) §3 for future Docker-based deployment.*
