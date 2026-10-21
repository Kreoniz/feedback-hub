#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Pass --production to use the separate shared-Caddy template.
compose=(docker compose)
if [[ "${1:-}" == --production ]]; then
  compose+=(--env-file .env -f deploy/compose.production.yaml)
fi
umask 077
mkdir -p .local/backups
chmod 700 .local/backups
target=".local/backups/feedback-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$target"
trap 'rm -f "$target.pending"' EXIT
"${compose[@]}" exec -T db pg_dump -U postgres -d feedback --format=custom > "$target.pending"
test -s "$target.pending"
"${compose[@]}" exec -T db pg_restore --list < "$target.pending" >/dev/null
mv "$target.pending" "$target"
printf 'Backup: %s/%s\n' "$PWD" "$target"
