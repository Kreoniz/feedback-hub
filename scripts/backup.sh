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
# Follow the app's selected database after a restore. Read the protected URL
# locally; never pass or print its credentials. The URL-file mount is canonical.
database_name=$("${compose[@]}" config --format json | python3 -c '
import json,re,sys,urllib.parse
from pathlib import Path
config=json.load(sys.stdin)
app=config["services"]["app"]
target=app["environment"]["DATABASE_URL_FILE"]
mount=next(v for v in app["volumes"] if v["target"]==target)
name=urllib.parse.unquote(urllib.parse.urlsplit(Path(mount["source"]).read_text().strip()).path.lstrip("/"))
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,62}",name):
    raise SystemExit("Unsupported database name in app configuration")
print(name)
')
pending=$(mktemp ".local/backups/feedback-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.pending")
target="${pending%.pending}.dump"
trap 'rm -f "$pending"' EXIT
"${compose[@]}" exec -T db pg_dump -U postgres -d "$database_name" --format=custom > "$pending"
test -s "$pending"
"${compose[@]}" exec -T db pg_restore --list < "$pending" >/dev/null
ln "$pending" "$target"
rm "$pending"
printf 'Backup: %s/%s\n' "$PWD" "$target"
