# Backup review R4

2026-10-21. Final bounded independent verification of backup selection in `b696d6a50a1cb8130f1ade16a891a325f545ac36`; checkout/build baseline `c378245db4ff1455699654ca1333da81f684b50c` also contains the regression's explicit stdout extraction fix. Read `AGENTS.md`, README, [R1](review-infrastructure-r1.md), [R2](review-infrastructure-r2.md), [R3](review-backup-r3.md), and [deployment instructions](deployment.md). No subagents or implementation edits.

**Verdict: original R1, F1 and F2 are resolved for the documented local Compose topology. No remaining blocker found in this bounded backup-selection review.** Remote database support is unnecessary.

## Independently verified

- Built the current CLI from source with mise Go **1.27.3**; binary build information confirms **pgx/v5 v5.11.0**. All ten `TestBackupTargetMatchesEffectivePGXSelection` cases passed independently. The server and CLI both call `pgxpool.ParseConfig`; server-side pool/time-limit adjustments do not change the database target. The separate Python DSN parser is gone.
- Used a new PostgreSQL **18.6** container with `--network none`, no published ports, its own anonymous volume, the unchanged init script, and synthetic data only. Restored two reports and one vote into a new database, then wrote a marker only there. Ran the unchanged `scripts/backup.sh` through a fixture adapter invoking the freshly built CLI and real PostgreSQL dump/list/restore commands. The URL path and **both `dbname` and `database` aliases overriding `/feedback`** each produced archives restored into separate fresh databases with exactly **2 reports, 1 vote, and the post-restore marker**. An additional `--production` argument-path run passed through the same isolated transport; this does not certify production startup.
- Both old F2 inputs, `postgres://feedback@db:5432//feedback` and `postgres://feedback@db:5432/feedback#`, now fail. Including those shapes, twelve invalid-target cases covered authority/query host, port and user changes, alternate fallback hosts/ports, an unsupported database name, and malformed configuration. Transport traces contained only the CLI call: **no `pg_dump` or `pg_restore` invocation**, no new archive/pending file, and no synthetic credential output. Successful archives were `0600`.
- Verified URL-file precedence over a conflicting environment URL, failure on a missing URL file, and acceptance of a TLS fallback to the same `db:5432` target. Reviewed the CLI's generic errors and no-connection control flow. Shell syntax and the updated regression's Python AST passed.

## Operational limits

The script now executes the CLI inside the running app container, using its environment and mounted URL file, before staging the dump. The runbook correctly requires backup before stopping app and app recreation after URL-file replacement; this review did not restart or reconfigure the existing app. Unsupported effective targets fail closed.

No residual selector blocker remains. Full application-schema disaster recovery, protected offsite delivery/retention, the integration owner's rebuilt-image regression, and the existing production authorization/ingress prerequisites remain outside this independent evidence. Previous Caddy and other infrastructure conclusions are unchanged.

Reviewer fixtures/results are ignored under `.local/review-backup-r4/`. The reviewer container and anonymous volume were removed. No real credentials, existing database/app, VPS, SSH, DNS, or shared Caddy were accessed or changed. Only this report is committed.
