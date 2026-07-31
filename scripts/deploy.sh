#!/usr/bin/env bash
# Deploy MobileDJay on the production server (git pull + npm ci + PM2 reload).
#
# Typical use (from the live app directory):
#   ./scripts/deploy.sh
#
# Environment (optional):
#   DEPLOY_PATH      — app directory (default: directory containing this script's repo root)
#   DEPLOY_BRANCH    — branch to track (default: main)
#   DEPLOY_GIT_REMOTE — remote name (default: origin)
#   PM2_APP_NAME     — PM2 process name (default: mobiledjay)
#   GIT_SSH_COMMAND  — e.g. ssh -i ~/.ssh/mobiledjay_deploy -o IdentitiesOnly=yes
#
# Flags:
#   --install-only   Skip git; run npm ci, PM2 reload, and health check only
#   --force          git reset --hard origin/$DEPLOY_BRANCH (discards local commits/changes)
#   --help

set -euo pipefail

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_GIT_REMOTE="${DEPLOY_GIT_REMOTE:-origin}"
PM2_APP_NAME="${PM2_APP_NAME:-mobiledjay}"
INSTALL_ONLY=0
FORCE=0

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \?//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --install-only)
      INSTALL_ONLY=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_PATH="${DEPLOY_PATH:-$REPO_ROOT}"

cd "$DEPLOY_PATH"
echo "Deploy path: $DEPLOY_PATH"

if [ ! -f "$DEPLOY_PATH/package.json" ]; then
  echo "error: package.json not found in DEPLOY_PATH" >&2
  exit 1
fi

if [ "$INSTALL_ONLY" -eq 0 ]; then
  if [ ! -d "$DEPLOY_PATH/.git" ]; then
    echo "error: $DEPLOY_PATH is not a git clone (missing .git). Clone with a deploy key first — see docs/deploy-self-hosted.md" >&2
    exit 1
  fi

  if [ -n "$(git status --porcelain 2>/dev/null || true)" ] && [ "$FORCE" -eq 0 ]; then
    echo "error: working tree has local changes. Commit/stash them or re-run with --force (git reset --hard origin/$DEPLOY_BRANCH)." >&2
    git status --short >&2 || true
    exit 1
  fi

  SHA_BEFORE="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  echo "Git before: $SHA_BEFORE ($DEPLOY_BRANCH)"

  git fetch "$DEPLOY_GIT_REMOTE" "$DEPLOY_BRANCH"

  if [ "$FORCE" -eq 1 ]; then
    echo "Resetting to $DEPLOY_GIT_REMOTE/$DEPLOY_BRANCH (--force)…"
    git checkout "$DEPLOY_BRANCH"
    git reset --hard "$DEPLOY_GIT_REMOTE/$DEPLOY_BRANCH"
  else
    git checkout "$DEPLOY_BRANCH"
    git merge --ff-only "$DEPLOY_GIT_REMOTE/$DEPLOY_BRANCH"
  fi

  SHA_AFTER="$(git rev-parse --short HEAD)"
  echo "Git after:  $SHA_AFTER ($DEPLOY_BRANCH)"
  if [ "$SHA_BEFORE" = "$SHA_AFTER" ]; then
    echo "Already up to date at $SHA_AFTER."
  fi
fi

echo "Installing production dependencies…"
npm ci --omit=dev

echo "Reloading PM2 ($PM2_APP_NAME)…"
export PM2_APP_NAME="$PM2_APP_NAME"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

PORT="${PORT:-3000}"
if [ -f .env ]; then
  ENV_PORT="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -n "$ENV_PORT" ]; then
    PORT="$ENV_PORT"
  fi
fi

echo "Health check on http://127.0.0.1:${PORT}/ …"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${PORT}/" -o /dev/null; then
    echo "Health check passed on port ${PORT}."
    exit 0
  fi
  echo "Waiting for app on port ${PORT} (attempt ${i}/10)…"
  sleep 2
done

echo "Health check failed — recent PM2 logs:" >&2
pm2 logs "$PM2_APP_NAME" --lines 40 --nostream || true
exit 1
