#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose build app caddy
./scripts/init-env.sh local
docker compose up -d --wait --wait-timeout 120
for attempt in {1..30}; do
  if curl --fail --silent http://localhost:18080/health/ready >/dev/null; then
    printf 'Feedback Hub: http://localhost:18080\nAdmin: http://localhost:18080/admin\nPassword file: %s/.local/admin-password\n' "$PWD"
    exit 0
  fi
  sleep 1
done
echo 'Application did not become ready. Inspect docker compose logs --tail=50 app.' >&2
exit 1
