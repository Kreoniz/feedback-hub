# Infrastructure review R1

2026-10-21. Independent review of `Dockerfile`, `compose.yaml`, `deploy/**`, `scripts/**`, `.github/**`, `README.md`, `docs/deployment.md`, and `docs/architecture.md`. Read `AGENTS.md`, `docs/contract.md`, `docs/skeptic-architecture.md`, and `docs/research.md` first. Final source baseline: `3438fc572305f9bc13b77a9936c64ad3133a0542`; concurrent backend/frontend work is excluded from the verdict. No implementation files were edited.

**Verdict:** resolve R1 and R2 before calling the deployment/backup instructions ready for public use. R3 is a confirmed P2 tooling defect. Suggestions below are not additional release blockers. This review neither certifies the application nor reopens the application findings B1–B10 that other owners are implementing. No production, DNS, SSH, or active shared app/test-database operations were performed.

## R1 — P1: backups silently miss new data after the documented restore

Locations: [`scripts/backup.sh:15–18`](../scripts/backup.sh#L15), [`docs/deployment.md:65`](deployment.md#L65).

The restore procedure switches `database_url` to a **new** database, but every backup still runs `pg_dump -d feedback`. Nothing reads the app's active database name. After following the runbook, the old database normally remains available, so backups exit successfully, pass `pg_restore --list`, and contain no messages/votes written to the restored database. If the old database is later removed, backups fail instead. This affects both local and `--production` modes.

Reproduced with PostgreSQL 18.6 in a new `--network none` container, no published ports, and a disposable volume:

1. Ran the repository's unchanged `deploy/init-db.sh`; created a synthetic marker in `feedback`.
2. Dumped and restored it into `feedback_restored_review`, owned by `feedback`, using `pg_restore --no-owner --role=feedback`. Added a second marker only to the restored database.
3. Copied the unchanged backup script into an ignored fixture, with its `database_url` pointing at `feedback_restored_review`. A Docker-command adapter mapped only `compose exec -T db ...` to the disposable container; the script's dump/list arguments were unchanged.
4. The script returned **0**, its archive passed the real `pg_restore --list`, and extracting its table data contained the first marker but **not** the second. The active restored database contained both markers.

Minimal fix: give app and backup a single explicit database-name setting, or safely derive the selected database from the protected app configuration without logging credentials. Alternatively, make the recovery procedure return the live database to the name `feedback` before service resumes. Add a restore check that writes one synthetic post-restore row and verifies the **next backup** includes it. PostgreSQL documents that [`pg_dump` exports the selected single database](https://www.postgresql.org/docs/current/app-pgdump.html); archive-format validation cannot detect a wrong database selection.

## R2 — P1: the Caddy error-log filter retains raw client IP

Locations: [`deploy/Caddyfile.local:15–22`](../deploy/Caddyfile.local#L15), [`docs/deployment.md:51`](deployment.md#L51), privacy promise in [`README.md:71`](../README.md#L71).

The filter deletes `request>remote_ip`, URI, and headers, but leaves `request>client_ip`. Caddy emits both IP fields even for a direct client without configured trusted proxies. An ordinary upstream failure therefore retains the client's raw IP despite the stated logging policy. Disabling access logging does not disable these error entries.

Reproduced using the repository's cached Caddy image (`feedback-hub-caddy:local`, image ID prefix `0029fc2395e1`, Caddy **v2.11.4**) in a disposable, read-only, non-root, network-isolated container. Loaded the local Caddyfile and issued a synthetic request from inside the container while upstream `app:8080` was unavailable. The resulting `http.log.error` entry had:

```json
{
  "status": 502,
  "request": {
    "client_ip": "127.0.0.1",
    "host": "127.0.0.1:8080",
    "method": "GET",
    "proto": "HTTP/1.1"
  }
}
```

This excerpt omits `remote_port` and unrelated error metadata. `remote_ip`, `uri`, and `headers` were correctly absent. Caddy's [logging documentation explicitly describes both IP fields](https://caddyserver.com/docs/caddyfile/directives/log).

Minimal fix: also delete `request>client_ip`, and assert absence of both address fields on an induced 502. The production site fragment inherits shared global logging, which was **not** inspected here. Make verification of the effective shared error-log filter a required pre-publication check; copying the current local filter would retain the same defect. Do not change shared Caddy as part of this review.

## R3 — P2: local startup checks the wrong port when configured

Locations: [`scripts/local-up.sh:8–9`](../scripts/local-up.sh#L8), [`compose.yaml:61`](../compose.yaml#L61), [`.env.example:4`](../.env.example#L4).

Compose supports `FEEDBACK_PORT`, but `local-up.sh` always probes and prints `http://localhost:18080`. With a consistently configured `FEEDBACK_PORT=18444` and `APP_ORIGIN=http://localhost:18444`, it reports failure after a successful stack start. If an older service answers on 18080, it can instead report success for the wrong service.

Reproduced by copying the unchanged script into an ignored fixture with Docker/init stubs and a curl stub that succeeds only for the configured port. No service was contacted. All **30** probes targeted `http://localhost:18080/health/ready`; exit status was **1**. This verifies script argument handling, not real stack startup.

Minimal fix: resolve the effective Compose port/origin, including values in `.env`, once and use it for readiness and printed links. Keep Host/Origin consistent with the app configuration.

## Non-blocking suggestions

- **S1 — avoid a shared backup staging filename.** [`scripts/backup.sh:12–18`](../scripts/backup.sh#L12) uses second-resolution names and the same `.pending` path for overlapping invocations. Both can pass the existence check, truncate/write the same inode, or remove the other invocation's staging file in the EXIT trap. This is a static finding; no timer or overlapping production runs were assumed or tested. Before scheduling/retrying backups concurrently, use a unique staging file and a lock or collision-safe final publication.
- **S2 — cover deployment files in CI.** [`.github/workflows/ci.yaml:42–43`](../.github/workflows/ci.yaml#L42) validates only local Compose and builds only the app Dockerfile. It never builds `deploy/Dockerfile.caddy`, validates either Caddyfile, or validates production Compose with dummy non-secret settings. These small isolated checks would cover deployment syntax independently of application E2E. Add the R2 synthetic error-log assertion; an application-only build cannot catch it. No completed CI run is claimed here.
- **S3 — make effective ingress prerequisites explicit.** [`docs/deployment.md:51`](deployment.md#L51) describes Caddy server deadlines as desirable; [`deploy/Caddyfile.production:15–17`](../deploy/Caddyfile.production#L15) sets upstream dial/header deadlines only. Record the effective inbound header/body/write/idle limits before publication, with an approved compatible shared configuration if required. Go cannot bound incomplete headers held at Caddy. This is an unverified deployment prerequisite, **not** a claim that the live shared listener is currently unbounded. [Caddy documents the separate inbound server timeouts](https://caddyserver.com/docs/caddyfile/options#timeouts).

## Validation and limits

- Passed `bash -n` on every `scripts/*.sh`, `sh -n deploy/init-db.sh`, and Python AST parsing of `scripts/acceptance.py` without executing it.
- Passed `docker compose config --quiet` and production `config --quiet` with an empty env file plus synthetic `SECRET_DIRECTORY`, image tag, and exact proxy CIDR. This validates schema/interpolation, not bind-mount existence or production reachability.
- Both current Caddyfiles passed `caddy validate --adapter caddyfile` in isolated Caddy v2.11.4 containers; the current local file also reproduced R2. Caddy emitted its non-fatal redundant-XFF warning. Concurrent changes to the body budget (32KB to 64KB), reserved app IP, and bounded local Caddy `/data` tmpfs were inspected; they do not alter R1–R3.
- Executed the isolated R1/R2 reproductions and the stubbed R3 check above. The disposable PostgreSQL init also confirmed app-role flags `rolsuper|rolcreatedb|rolcreaterole = f|f|f`; the documented role-based restore succeeded.
- Review fixtures/results are ignored under `.local/review-infrastructure-r1/`. Test containers and their anonymous PostgreSQL volume were removed. No existing container, app process, shared test DB, production service, DNS, or SSH target was changed; no existing secret was read or printed.
- Did not run the concurrently changing Go/frontend suites, application Docker build, acceptance script, Playwright, full stack boot, GitHub Actions, offsite backup, or an actual disaster-recovery drill. Their absence is not reported as a temporary missing-file bug. Resource ceilings were reviewed statically; host capacity and attack-time availability remain unmeasured.

External documentation above was checked on 2026-10-21; executable evidence is limited to the local versions and scenarios stated here.
