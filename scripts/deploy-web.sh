#!/usr/bin/env bash
# Deploy the web app (spec §23.4): build the standalone bundle, upload a release, swap `current`, reload PM2.
# Usage: scripts/deploy-web.sh [git-ref]      (default: HEAD)
# Env:   DEPLOY_HOST (81.17.98.186), DEPLOY_USER (tarteeba), DEPLOY_KEY (ssh key path, optional)
# The server's /var/www/tarteeba/web/shared/.env.production provides NEXT_PUBLIC_* values at build time.
set -euo pipefail

REF="${1:-HEAD}"
HOST="${DEPLOY_HOST:-81.17.98.186}"
USER_="${DEPLOY_USER:-tarteeba}"
APP_ROOT=/var/www/tarteeba/web
KEEP_RELEASES=5
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
[ -n "${DEPLOY_KEY:-}" ] && SSH_OPTS+=(-i "$DEPLOY_KEY")

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA="$(git -C "$REPO_DIR" rev-parse --short "$REF")"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$SHA"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "== build $RELEASE"
git -C "$REPO_DIR" archive "$REF" | tar -x -C "$BUILD"
scp "${SSH_OPTS[@]}" -q "$USER_@$HOST:$APP_ROOT/shared/.env.production" "$BUILD/.env.production"
( cd "$BUILD" && pnpm install --frozen-lockfile --silent && pnpm build )
# Standalone output needs static assets and public/ copied next to server.js.
cp -r "$BUILD/.next/static" "$BUILD/.next/standalone/.next/static"
[ -d "$BUILD/public" ] && cp -r "$BUILD/public" "$BUILD/.next/standalone/public"
cp "$BUILD/ecosystem.config.cjs" "$BUILD/.next/standalone/"
echo "$SHA" > "$BUILD/.next/standalone/REVISION"

echo "== upload"
ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "mkdir -p $APP_ROOT/releases/$RELEASE"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$BUILD/.next/standalone/" "$USER_@$HOST:$APP_ROOT/releases/$RELEASE/"

echo "== activate"
ssh "${SSH_OPTS[@]}" "$USER_@$HOST" bash -s -- "$APP_ROOT" "$RELEASE" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
APP_ROOT="$1"; RELEASE="$2"; KEEP="$3"
ln -sfn "$APP_ROOT/releases/$RELEASE" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
cd "$APP_ROOT/current"
if pm2 describe tarteeba-web >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env >/dev/null
else
  pm2 start ecosystem.config.cjs >/dev/null
fi
pm2 save >/dev/null
for i in $(seq 1 20); do curl -fsS -o /dev/null http://127.0.0.1:3000/admin/login && break; sleep 1; done
sudo /usr/local/sbin/tarteeba-activate web
ls -1dt "$APP_ROOT"/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf
REMOTE

echo "== check"
curl -fsS -o /dev/null -w 'admin login %{http_code}\n' https://tarteeba.shiplytechnologies.com/admin/login
echo "deployed $RELEASE"
