# Infrastructure review R2

2026-10-21. Independent re-review of the production-ready **local** FeedbackHub MVP infrastructure: Go/PostgreSQL/React with published Unlikely UI, Docker, local Caddy, and a staged shared-Caddy production runbook. No deployment, DNS/service changes, SSH, application implementation, or PR work was authorized. Source baseline: `077f099956af2d54386cb394b877396662439fd1`; application/frontend certification remains with their reviewers and integration owner.

Read `AGENTS.md`, README, architecture/contract/research/skeptic context, the complete [R1 report](review-infrastructure-r1.md), every `scripts/**` and `deploy/**` file, both Dockerfiles, Compose, `.github/**`, and [deployment.md](deployment.md). This report preserves the original R1 finding identifiers; R2 below means the original logging finding, not this review round.

**Verdict: one P1 backup-selection gap remains.** The documented path-based restore case now passes, but R1 is only partially closed: an accepted database-query override still produces a successful backup of the wrong database. R2/R3 and S1–S3 are addressed within the limits below. Resolve F1 before claiming that backups follow the application's selected database. No other infrastructure blocker was found in the reviewed scope.

## F1 — P1: backup ignores database-query overrides accepted by the application

Locations: [`scripts/backup.sh:21`](../scripts/backup.sh#L21), [`backend/internal/store/store.go:20`](../backend/internal/store/store.go#L20), [`docs/deployment.md:63`](deployment.md#L63).

The replacement selector reads only the URL path. The application passes the complete URL to pinned `pgxpool.ParseConfig`, which lets `dbname` and `database` query parameters override that path. Both names in this example satisfy the backup script's documented name restrictions:

```text
postgres://feedback@db:5432/feedback?dbname=feedback_restored_r2&sslmode=disable
```

The app selects `feedback_restored_r2`; the backup runs `pg_dump -d feedback`. As long as the old database remains, the script exits 0 and its archive validates, silently omitting writes to the selected database. This retains the original R1 data-loss failure for a different valid way of switching databases. The generated default URL and an ordinary `/feedback_restored_r2` path switch are unaffected.

Independent evidence, using synthetic data only:

1. A small parser probe against this repository's `pgx/v5 v5.11.0`, built with Go 1.27.3, returned `feedback_restored_r2` for **both** query spellings, without connecting to a database.
2. In a new PostgreSQL 18.6 container with `--network none`, no published ports, its own anonymous volume, and the unchanged init script, restored fixture data into `feedback_restored_r2` and wrote a marker only there. PostgreSQL's URL-based query also selected that database and read the marker.
3. Pointed an isolated fixture URL file at the example above and ran the **unchanged** backup script. Only Compose transport was adapted to the reviewer container; dump/list/publication commands were real. The script succeeded.
4. Restored its archive into another fresh fixture database. The marker table was absent: the archive contained the old path-selected database.

Minimal fix: use the application's effective database selection, or explicitly restrict the supported URL form and **reject** database overrides before dumping. For the current single local-PostgreSQL topology, failing closed on unsupported selectors is sufficient; no new dependency is required. Add regression cases for both `dbname` and `database` so an override either selects the right database or fails without publishing a backup. Documentation alone must not leave an accepted selector silently backing up another database.

## Original R1 findings and fix verification

- **R1 — partially resolved; F1 remains.** `4cadae6` replaces hard-coded `-d feedback` with a database name read from the app's `DATABASE_URL_FILE` bind mount resolved through Compose JSON. Credentials are not passed to `pg_dump` or printed in the successful synthetic runs. The unchanged `scripts/test-backup.py` from `de3dbef` passed in a copied reviewer fixture: real dump/restore into two fresh databases, report/vote count preservation, a post-restore marker, and a next backup selecting the changed URL **path**. The seed contained two reports and one vote with a foreign key; this was infrastructure fixture data, not a full application-schema recovery drill. `--production` argument handling also passed through the isolated transport; real local/production Compose mount resolution was checked separately with synthetic paths. Unsupported dotted database names failed without publishing an archive or printing the synthetic credential. These successes do not cover F1.

- **R2 — resolved locally; production verification remains mandatory.** `4cadae6` deletes `request>client_ip` and `request>remote_port` alongside the existing remote-IP, URI, and header deletions. Executed the unchanged `scripts/test-caddy-logs.sh` from `4bd48d8` in its own disposable, network-isolated, read-only, non-root Caddy container. Its induced upstream-failure logging assertion passed: neither IP field, port, URI, headers, nor synthetic cookie/query markers remained in request logs. This used cached hardened image `feedback-hub-caddy:local`, ID prefix `0029fc2395e1`, with the current mounted configuration. The production site fragment inherits shared global logging; no live shared logger was inspected. Runbook line 51 now requires verification of both address fields and a synthetic upstream failure before publication.

- **R3 — resolved for consistently configured port/origin.** `scripts/local-up.sh` now reads effective `APP_ORIGIN` from Compose and uses it for readiness and displayed links. An unchanged-script fixture used actual Compose configuration resolution, stubbed build/start/init commands, and a curl stub accepting only the expected URL. `.env` with port/origin `18444` passed; shell overrides to `18445` also passed and produced matching application/admin links. No HTTP service was contacted. `FEEDBACK_PORT` and `APP_ORIGIN` still need to agree, as in the original reproduction; this change does not infer a new origin from a port-only edit.

- **S1 — resolved.** `mktemp` gives each invocation its own staging inode; `ln` publishes the completed archive without replacing an existing destination. Two simultaneous unchanged-script backups, with `date` fixed to the same timestamp, produced two different valid archives on different inodes, both `0600`, with no remaining `.pending` files. Both passed real `pg_restore --list`. This closes the shared-staging/trap collision; it does not establish power-loss durability or offsite delivery.

- **S2 — addressed in CI configuration.** `72f4241` adds the hardened Caddy build, validation of **both** Caddyfiles, and production Compose validation; `4bd48d8` adds the real logging regression. The production validation command also passed locally with `.env.example`. Both Caddyfiles independently passed validation in disposable containers using the cached hardened image. This review did not rebuild either image or execute GitHub Actions, so it does not claim a completed CI run. The backup restore regression remains a separate operator/local check.

- **S3 — resolved as a mandatory deployment prerequisite.** Runbook line 51 replaces optional wording with a required check of the effective shared inbound limits and compatible configuration for neighboring sites. The local template has header/body/write/idle deadlines of 5/10/20/60 seconds, a 16KB header ceiling, and a 64KB request-body ceiling. The production site fragment still provides upstream dial/header deadlines of 3/15 seconds; those do not prove inbound listener limits. Live effective settings remain unverified until the separately authorized deployment step.

## Other changes and validation limits

`3438fc5` provides an 8 MiB `/data` tmpfs owned by UID/GID 10001 for read-only local Caddy; the Caddy validation/log checks ran with the matching hardened runtime restrictions and the logging check used that tmpfs. `fe5e457` reserves distinct local ingress addresses: Caddy `.2`, app `.3`, with app trust limited to `.2/32`. Real normalized Compose configuration confirmed those values, the internal data network, no published app/database ports, and the expected read-only/capability settings. No stack recreation, network reassignment, or reachability/load test was performed.

Go 1.27.3 is consistently selected in `mise.toml`, the app Dockerfile, and CI; CI includes pinned `govulncheck@v1.9.0`. The lead's reported zero-reachable-vulnerability result was not independently rerun here. The small selector probe above is not an application test or vulnerability scan.

Additional checks passed: `bash -n` for every shell script, `sh -n deploy/init-db.sh`, AST parsing of both Python scripts, and local/production Compose schema validation. Synthetic normalized configuration was inspected in memory; existing URL files, passwords, and unrelated service logs were not read or printed. The initial nested reviewer adapter hit a local mise Python-shim recursion; rerunning the unchanged repository scripts with a fixture PATH using the system Python resolved it. This was a reviewer harness issue, not a repository regression.

Fixtures remain ignored under `.local/review-infrastructure-r2/`. Every reviewer-created PostgreSQL container and anonymous volume was removed; the Caddy regression removed its own container. The existing app, test database, port-18080 UX review, and concurrent app image build were untouched. No full Go/frontend suites, application acceptance/E2E, image rebuild, production Compose startup, external backup, SSH, DNS, or shared-Caddy inspection was performed.

## Remaining production prerequisites

- Resolve F1 and rerun the backup-selection regression, then retain evidence for a full application-schema restore and the next backup after switching databases. During the eventual restore, account for file bind-mount inodes: an atomically replaced `database_url` requires recreating the app container so the running app and the backup read the same file.
- Obtain the separately scoped deployment/DNS/shared-Caddy authorization. Verify actual host capacity, network membership, the exact Caddy peer address, and the immutable tested app image before starting the new stack. The local address reservation does not establish the shared production address.
- Validate the effective shared Caddy configuration, inbound deadlines/header ceiling, request-body limit, and privacy filtering with synthetic errors; keep access logging disabled for this site. Preserve and smoke-test neighboring routes during the authorized change.
- Set protected independent/offsite backup delivery, retention/capacity monitoring, and separate recovery copies of credentials/signing material. A local archive plus `pg_restore --list` is not disaster-recovery evidence.
- Complete the integration owner's application/browser/image checks and the runbook's synthetic HTTPS, secure-cookie, privacy, moderation, voting, and mobile acceptance after deployment. Select any external ingress protection separately; this review establishes no attack-time availability or live edge capability.

No implementation files were changed by this review. The only tracked deliverable is this report.
