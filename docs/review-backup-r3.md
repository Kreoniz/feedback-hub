# Backup review R3

2026-10-21. Bounded independent review of `68eea62f9dd451c69cc0e6da26c3da5b044b5340`, following `AGENTS.md`, README, deployment instructions, and the R1/R2 reports. Scope: local Compose backup selection only; previous Caddy, port, concurrency, CI, and timeout conclusions remain unchanged.

**Verdict: F1's query overrides are resolved, but one P1 backup-selection defect remains.** Rejecting unsupported URL forms is sufficient; remote database support is unnecessary.

## Resolved

- Both `dbname` and `database` still override the path in the application's pinned `pgx/v5 v5.11.0`, confirmed by a no-connection `pgxpool.ParseConfig` probe using Go 1.27.3. The new allowlist rejects both before `mktemp`/`pg_dump`; the unchanged regression also rejects host/port/user overrides without another archive.
- The unchanged current `scripts/test-backup.py` passed independently against a fresh PostgreSQL 18.6 container: real dump/restore, report/vote counts, changed URL path, and the post-restore marker in the next backup. Additional duplicate-SSL, options, encoded/blank `dbname`, and service query cases failed without archives or pending files.
- The runbook explicitly restricts backup to local Compose and requires app recreation after atomic URL-file replacement, addressing the bind-mount inode mismatch.

## F2 — P1: accepted path normalization still selects the wrong database

Locations: [`scripts/backup.sh:25`](../scripts/backup.sh#L25), [`scripts/backup.sh:27`](../scripts/backup.sh#L27).

Two URLs outside the documented subset pass the guard:

```text
postgres://feedback@db:5432//feedback
postgres://feedback@db:5432/feedback#
```

The pinned pgx parser selects `/feedback` and `feedback#`, respectively. Python's `lstrip("/")` removes the extra slash; `url.fragment` is empty for a trailing `#`, so that check does not reject it. In both cases the script instead dumps `feedback`.

Independently reproduced both with synthetic credentials/data in a new network-isolated PostgreSQL container, no published ports, and its own anonymous volume. Created the pgx-selected databases with a marker table absent from `feedback`. Each unchanged backup returned **0**, passed real `pg_restore --list`, and restored successfully into another fresh database; the restored archive lacked the selected database's marker table. This is the original silent wrong-database failure with a different accepted URL spelling.

Minimal correction: enforce exactly one leading path slash before validating the decoded name, and reject a raw fragment delimiter even when its suffix is empty. Add both rejection cases to the regression, requiring failure before staging/dumping and no published archive. These database names need not be supported.

## Evidence and limits

Fixtures/probe results remain ignored under `.local/review-backup-r3/`; only Compose transport was adapted to the unique reviewer container. The actual init, backup, regression, dump, list, and restore commands were unchanged. Shell syntax and Python AST checks passed. The reviewer container and anonymous volume were removed.

No implementation edits, existing credentials, running application/test database, VPS, SSH, DNS, or shared Caddy were accessed. No full application-schema recovery, offsite delivery, application/browser suites, image build, or production deployment is certified. Only this report is committed.
