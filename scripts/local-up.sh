#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose build app caddy
./scripts/init-env.sh local
docker compose up -d --wait --wait-timeout 120
origin=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["app"]["environment"]["APP_ORIGIN"])')
for attempt in {1..30}; do
  if curl --fail --silent "$origin/health/ready" >/dev/null; then
    printf 'Feedback Hub: %s\nAdmin: %s/admin\nPassword file: %s/.local/admin-password\n' "$origin" "$origin" "$PWD"
    exit 0
  fi
  sleep 1
done
echo 'Application did not become ready. Inspect docker compose logs --tail=50 app.' >&2
exit 1
