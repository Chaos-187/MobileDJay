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

**GitHub Actions:** GitHub → **Actions → Deploy → Run workflow**.

**On the server (git clone + deploy key):** see [§ Deploy with `scripts/deploy.sh`](#deploy-with-scriptsdeploysh-github-deploy-key) below.

## Deploy with `scripts/deploy.sh` (GitHub deploy key)

Use this when you want to update production **without** the Actions runner — e.g. SSH in and run one command, or a cron job.

The script lives at [`scripts/deploy.sh`](../scripts/deploy.sh). It:

1. **`git fetch`** and fast-forward **`main`** (or **`DEPLOY_BRANCH`**) — or **`--force`** to `git reset --hard origin/main`
2. Refuses to run if the working tree is dirty (unless **`--force`**) so local edits are not lost silently
3. **`npm ci --omit=dev`**
4. **`pm2 reload`** (or **`pm2 start`** on first run) via **`ecosystem.config.cjs`**
5. **Health check** on `http://127.0.0.1:$PORT/` (reads **`PORT`** from **`.env`** when set)

**`--install-only`** skips git (npm + PM2 + health only). The GitHub Actions workflow uses this after **rsync**, so install/reload logic stays in one place.

### One-time: deploy key + clone

On the server, as the user that runs PM2:

```bash
# 1) SSH key used only for GitHub read access
ssh-keygen -t ed25519 -f ~/.ssh/mobiledjay_deploy -N ""
chmod 600 ~/.ssh/mobiledjay_deploy
cat ~/.ssh/mobiledjay_deploy.pub
```

Add the public key in GitHub → **repo → Settings → Deploy keys → Add deploy key** (read-only, no write access).

```bash
# 2) Clone into the live path (adjust ORG/repo)
export GIT_SSH_COMMAND='ssh -i ~/.ssh/mobiledjay_deploy -o IdentitiesOnly=yes'
git clone git@github.com:YOUR_ORG/MobileDJay.git /home/kyle/Documents/MobileDJay-main
cd /home/kyle/Documents/MobileDJay-main

# 3) Production secrets and data (if migrating from rsync-only layout)
cp /path/to/backup/.env .env
# copy db/*.db and uploads/ as needed

npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
```

Optional: add to `~/.ssh/config`:

```
Host github.com-mobiledjay
  HostName github.com
  User git
  IdentityFile ~/.ssh/mobiledjay_deploy
  IdentitiesOnly yes
```

Then set **`DEPLOY_GIT_REMOTE`** / clone URL to `git@github.com-mobiledjay:YOUR_ORG/MobileDJay.git`, or export **`GIT_SSH_COMMAND`** when running deploy.

### Run a deploy

```bash
cd /home/kyle/Documents/MobileDJay-main
chmod +x scripts/deploy.sh   # once
export GIT_SSH_COMMAND='ssh -i ~/.ssh/mobiledjay_deploy -o IdentitiesOnly=yes'   # if not in ssh config

./scripts/deploy.sh
```

Environment overrides:

| Variable | Default |
|----------|---------|
| `DEPLOY_PATH` | Repo root (parent of `scripts/`) |
| `DEPLOY_BRANCH` | `main` |
| `DEPLOY_GIT_REMOTE` | `origin` |
| `PM2_APP_NAME` | `mobiledjay` |

If the tree has local changes you intend to discard (e.g. accidental edit on server):

```bash
./scripts/deploy.sh --force
```

### Git vs Actions rsync

| Method | `.git` in live dir? | Update command |
|--------|---------------------|----------------|
| **Self-hosted Actions** | No (rsync excludes `.git`) | Push to `main` or run workflow; uses **`deploy.sh --install-only`** after sync |
| **Deploy key + clone** | Yes | **`./scripts/deploy.sh`** on the server |

If production was created only via Actions, either keep using the workflow or migrate once to a git clone (copy `.env`, `db/`, `uploads/` into a fresh clone).

---

| Issue | Check |
|-------|--------|
| Runner not picking up jobs | Runner online in repo Settings → Actions → Runners |
| `npm ci` fails on better-sqlite3 | Node version matches dev; build tools installed (`build-essential`) |
| Health check fails | `pm2 logs mobiledjay`; verify `PORT` in `.env` |
| Data missing after deploy | rsync excludes DB/uploads — ensure paths match workflow excludes |
| Permission denied on rsync | Runner user owns or can write `DEPLOY_PATH` |

---

*See also [`todo.md`](todo.md) §3 (Docker) and §8 (`deploy.sh`).*
