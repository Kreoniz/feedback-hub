#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:-local}
case "$mode" in local|production) ;; *) echo 'Usage: scripts/init-env.sh local|production' >&2; exit 1;; esac
mkdir -p .local/secrets
chmod 700 .local .local/secrets
python3 - "$mode" <<'PY'
from pathlib import Path
import secrets, sys
root = Path.cwd()
directory = root / '.local/secrets'
for name in ('postgres_password', 'db_password', 'app_secret'):
    p = directory / name
    if not p.exists():
        with p.open('x') as f: f.write(secrets.token_hex(32) + '\n')
    p.chmod(0o444) # Parent0700; bind mounts readable by container UID10001.
p = root / '.local/admin-password'
if not p.exists():
    with p.open('x') as f: f.write(secrets.token_urlsafe(32) + '\n')
p.chmod(0o600)
p = directory / 'database_url'
if not p.exists():
    password = (directory / 'db_password').read_text().strip()
    with p.open('x') as f: f.write(f'postgres://feedback:{password}@db:5432/feedback?sslmode=disable\n')
p.chmod(0o444)
env = root / '.env'
if not env.exists():
    production = sys.argv[1] == 'production'
    origin = 'https://feedback.kreoniz.ru' if production else 'http://localhost:18080'
    trusted = 'REPLACE_WITH_VERIFIED_CADDY_IP/32' if production else '172.30.42.2/32'
    env.write_text(f'APP_ORIGIN={origin}\nDEVELOPMENT={str(not production).lower()}\nFEEDBACK_PORT=18080\nSECRET_DIRECTORY={directory}\nTRUSTED_PROXIES={trusted}\nEDGE_NETWORK=beszel-edge\nFEEDBACK_IMAGE=feedback-hub:local\n')
    env.chmod(0o600)
PY
if [[ ! -s .local/secrets/admin_hash ]]; then
  # The hash command reads stdin; no clear password in arguments, environment or logs.
  umask 077
  docker run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges \
    "${FEEDBACK_IMAGE:-feedback-hub:local}" hash-password \
    < .local/admin-password > .local/secrets/admin_hash.pending
  test -s .local/secrets/admin_hash.pending
  mv .local/secrets/admin_hash.pending .local/secrets/admin_hash
fi
chmod 444 .local/secrets/admin_hash
printf 'Configuration prepared. Admin password: %s/.local/admin-password\n' "$PWD"
if [[ "$mode" == production ]]; then
  printf 'Before production: set immutable FEEDBACK_IMAGE and verified Caddy peer IP in .env.\n'
fi
