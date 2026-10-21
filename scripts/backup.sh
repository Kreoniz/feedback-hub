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
# The same pinned pgx parser as the server resolves every selector. This
# read-only CLI prints only a checked name, never the URL or credentials.
database_name=$("${compose[@]}" exec -T app feedback-hub backup-target)
pending=$(mktemp ".local/backups/feedback-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.pending")
target="${pending%.pending}.dump"
trap 'rm -f "$pending"' EXIT
"${compose[@]}" exec -T db pg_dump -U postgres -d "$database_name" --format=custom > "$pending"
test -s "$pending"
"${compose[@]}" exec -T db pg_restore --list < "$pending" >/dev/null
ln "$pending" "$target"
rm "$pending"
printf 'Backup: %s/%s\n' "$PWD" "$target"
