#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="feedback-hub-log-test-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /data:rw,noexec,nosuid,size=8m,uid=10001,gid=10001 \
  -v "$PWD/deploy/Caddyfile.local:/etc/caddy/Caddyfile:ro,z" \
  "${CADDY_TEST_IMAGE:-feedback-hub-caddy:local}" \
  caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# Upstream cannot resolve on --network none. Exercise the real 502 error logger.
for attempt in {1..10}; do
  docker exec "$name" wget -qO- \
    --header='Cookie: SYNTHETIC_COOKIE' \
    'http://127.0.0.1:8080/probe?SYNTHETIC_QUERY=1' >/dev/null 2>&1 || true
  if docker logs "$name" 2>&1 | python3 -c '
import json,sys
entries=[]
for line in sys.stdin:
    try: entries.append(json.loads(line))
    except ValueError: pass
requests=[r["request"] for r in entries if "request" in r]
if not requests: raise SystemExit(1)
for r in requests:
    assert not set(r).intersection({"remote_ip","client_ip","uri","headers","remote_port"}), "Sensitive request fields remain"
assert "SYNTHETIC_" not in json.dumps(entries), "Synthetic cookie/query leaked"
print("PASS: Caddy 502 logs omit client/remote IP, URL, headers and cookies")
'; then exit 0; fi
  sleep 1
done
echo 'Caddy error-log regression failed' >&2
exit 1
