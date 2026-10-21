#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL_TEST:?Set an isolated disposable PostgreSQL DATABASE_URL_TEST}"
mkdir -p .local
chmod 700 .local
umask 077
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('.local/e2e-password')
if not p.exists(): p.write_text(secrets.token_urlsafe(32)+'\n')
p.chmod(0o600)
PY
mkdir -p backend/bin
(cd backend && go build -trimpath -o bin/feedback-hub ./cmd/feedback-hub)
backend/bin/feedback-hub hash-password < .local/e2e-password > .local/e2e-hash
export ADMIN_PASSWORD_HASH_FILE="$PWD/.local/e2e-hash"
export APP_SECRET
APP_SECRET=$(openssl rand -hex 32)
export DATABASE_URL="$DATABASE_URL_TEST"
export APP_ORIGIN=http://localhost:18080 DEVELOPMENT=true LISTEN_ADDR=127.0.0.1:18080
export STATIC_DIR="$PWD/web/dist"
export FEEDBACK_TEST_PASSWORD
FEEDBACK_TEST_PASSWORD=$(cat .local/e2e-password)
backend/bin/feedback-hub serve > .local/e2e-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in {1..30}; do
  kill -0 "$server_pid" 2>/dev/null || { echo 'E2E server exited; see .local/e2e-server.log'; exit 1; }
  if curl --fail --silent "$APP_ORIGIN/health/ready" >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'E2E readiness timed out'; exit 1; }
pnpm --dir web test:e2e
