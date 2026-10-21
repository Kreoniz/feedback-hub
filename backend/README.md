# Backend

Configuration agreed with lead (2026-10-21): Go `net/http`, pgx, PostgreSQL. One replica initially. No deployment performed by backend task.

| Variable | Meaning |
| --- | --- |
| `LISTEN_ADDR` | Bind address, default `:8080`. |
| `APP_ORIGIN` | Required exact public origin, e.g. `https://feedback.example.org`; HTTP allowed only with `DEVELOPMENT=true`. No path/query/fragment/userinfo. |
| `DATABASE_URL_FILE` / `DATABASE_URL` | Required PostgreSQL URL; file takes precedence. Use TLS for remote databases. |
| `ADMIN_PASSWORD_HASH_FILE` / `ADMIN_PASSWORD_HASH` | Required bcrypt hash, file takes precedence. Cost 12–16. Generate with `hash-password`, below. |
| `APP_SECRET_FILE` / `APP_SECRET` | Required **64 hex characters encoding 32 random bytes**, file takes precedence. Stable across restarts. Generate `openssl rand -hex 32` into a protected file. Never commit it. |
| `STATIC_DIR` | Built frontend directory, default `/app/web`. |
| `DEVELOPMENT` | Boolean; default false. Allows HTTP and omits Secure on localhost cookies. Never enable on public deployment. |
| `TRUSTED_PROXIES` | Optional comma-separated exact proxy IP addresses or host CIDRs (`/32`, `/128`) only. Default empty; ignores all forwarded headers. Caddy must **overwrite** X-Forwarded-For with one client IP; multi-value/list headers are rejected for trusted peers. Restrict application port to that proxy. No wildcard/private subnet trust. |

File values allow one trailing LF/CRLF. Files are limited to 8KiB. Never put passwords on the command line. Example commands from repository root (mise provides Go):

```sh
cd backend
go run ./cmd/feedback-hub hash-password < /path/to/protected-password-file > /path/to/admin-password-hash
# Set the variables above through protected service/Compose configuration.
go run ./cmd/feedback-hub migrate
go run ./cmd/feedback-hub serve
```

`hash-password` reads one 12–72 byte password from stdin (one trailing newline removed); it outputs only its bcrypt cost-12 hash. It rejects terminal input so the password cannot be echoed. `migrate` requires only DATABASE_URL[_FILE], applies embedded versioned migrations transactionally under a database advisory lock. `serve` also runs migrations before listening. Health: `/health/live` process liveness and `/health/ready` a bounded DB ping. SIGINT/SIGTERM drain requests and close the DB pool.

## Contract implementation notes

The lead coordinated the B1 privacy correction in `docs/contract.md` on 2026-10-21: every successful report intake, internal dedupe and honeypot returns **201 `{id,duplicate:false}`**. IDs are fresh non-enumerable receipt IDs, never report IDs. No receipt lookup exists. Dedupe compares project/type and case-folded, whitespace-collapsed title/description/details; optional context does not change the fingerprint. It does not reveal an existing report ID, text, or existence bit. At capacity both novel and duplicate reports receive the same pause response; duplicates never spend another new-report slot.

The public predicate is `type=feature AND moderation=approved AND duplicate_of IS NULL`, shared by public lists/totals/search and transactional vote admission. Separate public DTOs exclude details, context, moderation, priority/information, network tags, duplicate links and admin notes. Only the owner can approve feature title/description for publication, and must review that exact text for sensitive data first. Bugs cannot be approved, including at the SQL constraint level. Linking to an existing hidden target is allowed privately; cross-project/type links, self-links and cycles are rejected. Links hide the source without transferring or deleting votes. Information quality starts `sparse`, priority starts `untriaged`; only explicit independent admin changes alter them.

Initial canonical source origin is `https://campus.kreoniz.ru`. The local Unlikely UI repo has no verified published documentation origin, so its project URL stays empty rather than authorizing a guessed domain. Explicit valid project wins; missing project can be inferred only from an exact known source/context or Referer origin, never a suffix match. Context URLs must match APP_ORIGIN or a canonical project origin. They lose userinfo/query/fragment; private/local hosts and non-HTTP(S) schemes are rejected, unknown paths become `/`. Only `/`, `/new`, `/admin`, `/schedule`, `/compare`, `/settings`, `/docs`, `/components` survive; encoded/raw dynamic paths do not. Browser is reduced to a coarse family and app_version accepts at most 40 ASCII version characters. Context is optional and never fetched by the backend.

## Security and operational limits

Every non-health request validates `Host` against the configured APP_ORIGIN host, including port. Every mutation requires an exact `Origin: APP_ORIGIN`; missing, null, sibling, deceptive suffix and cross-site fetch origins fail. Deliberate API/CLI clients must send Origin; there is no Referer fallback or credentialed CORS. Authenticated admin writes also require their current session's `X-CSRF-Token`. JSON media type is mandatory, objects only; unknown fields, duplicate keys, trailing values, invalid UTF-8 and excessive nesting are rejected. All API responses including errors, form tokens and public personalized lists are `Cache-Control: no-store`.

| Resource | Bound |
| --- | --- |
| Body / header / URL path / raw query | 64KiB / 16KiB / 2,048 bytes / 4,096 bytes |
| Title / description / details / admin note | 160 / 5,000 / 8,000 / 8,000 Unicode code points |
| Context URL / browser input / app version | 2,048 / 200 / 40 code points; stored browser is coarse family only |
| Search / list | 200 code points; limit 1–100 (30 default), offset 0–10,000 |
| Header / read / write / idle timeout | 5s / 10s / 15s / 60s |
| Handler context / SQL statement / lock wait | 8s / 5s / 3s |
| PostgreSQL pool | 10 connections, 5s connect timeout, 10s idle transaction timeout |
| Admitted public / admin / readiness requests | 6 / 4 / 2 separately; liveness needs no admission or DB |
| Password verification | At most 2 concurrent bcrypt operations; password 1–72 bytes; config cost 12–16 |
| General API / form / report / vote limits | Per network: 120/min / 20/min / 6/hour / 30/min; token buckets refill continuously |
| Login limit | Per network 5/15min plus global 30/15min; independent admin limiter |
| Limiter state | At most 10,000 public + 1,000 admin HMAC-keyed entries; hourly-idle eviction at capacity, fail closed when full |
| Reports | Atomic persisted 2,000/UTC day globally, 500/project/UTC day, 50,000 lifetime |
| Votes | 250,000 lifetime, unique issued visitor/report; existing vote retries still succeed at capacity while feature remains public |
| Sessions | At most 8; 12h absolute and 30min idle expiry, checked on every request |

Daily/lifetime caps are persisted in PostgreSQL and checked transactionally; restart or different IPs do not reset them. A report cap pauses all real submissions with 429/Retry-After 3600; the lifetime cap requires owner maintenance before intake resumes. Budget rows retain at most the current and preceding 31 UTC days after hourly cleanup. These are conservative starting limits, not volumetric DDoS protection. The application port must remain private behind the configured proxy. The separate admission classes prevent ordinary public-path saturation from using admin slots or all 10 DB connections; attackers can still target the login/admin path and may cause temporary availability loss.

Production cookies are `__Host-` prefixed, Secure, HttpOnly, Path=/, SameSite=Strict with no Domain. Visitor cookie lifetime is **365 days** and its random ID/signature is never an admin credential. Signed form proofs are visitor-bound, purpose-separated, valid 2s–2h, and require no sleeping handler. Persistent session bearer tokens are stored only as keyed digests; CSRF values stay server-side. Re-login rotates token and CSRF and revokes the current supplied session. Logout, expiry, password-hash configuration change, or APP_SECRET change invalidate the relevant sessions. Restart with unchanged secrets preserves them.

New visitor/report votes from the same exact network address wait **60 seconds**. Existing visitor votes are checked first and remain idempotent. The address is normalized for IPv4-mapped IPv6, then stored only as a purpose-separated keyed network tag in a cooldown table, expiring after 60s and physically deleted by hourly cleanup. The same APP_SECRET survives restart so cooldowns cannot be reset by restarting the application. No raw IP or full UA is retained. Issued visitor vote tags are retained with historical votes; deleting the cookie does not delete the vote. A reset/new device **after the minute**, different IP, or rotating IPv6 can inflate votes. University Wi-Fi and CGNAT users can briefly block each other. This is abuse friction, never one-person-one-vote.

Reports and votes have no automatic deletion in this version; finite lifetime caps bound growth. Export, privacy deletion, retention and backup schedules are explicit owner operations, not an exposed unauthenticated API. SQL maintenance must preserve/reconcile intake_totals and graph/vote constraints under a maintenance pause; schema migrations account for existing rows. Physical DB/WAL and backup retention remain deployment responsibilities. Expired sessions, cooldowns and daily budget history are cleaned hourly. Changing APP_SECRET invalidates visitor identity and dedupe/network tags as well as sessions; keep it stable, back it up securely and treat rotation as deliberate continuity loss.

Logs contain fixed lifecycle/error event text only, never bodies, passwords, IPs, cookies, full URLs, search terms, SQL parameters or driver errors. The standard HTTP error logger is suppressed to prevent its peer-address/panic details leaking. Client disconnect write errors have no retry path and do not log content. Security headers include CSP, nosniff, frame denial, no-referrer, restricted permissions and production HSTS; the built SPA is read through os.Root to prevent symlink escapes and dotfiles. No raw HTML rendering or external resources are introduced by the backend.

## Validation

Run from repository root using normal Go cache defaults if writable. On a restricted Fedora sandbox, these ignored directories keep work on disk, not RAM-backed `/tmp`:

```sh
mkdir -p .local/go-cache .local/go-tmp .local/go-mod
export GOCACHE="$PWD/.local/go-cache" GOTMPDIR="$PWD/.local/go-tmp" GOMODCACHE="$PWD/.local/go-mod"
go -C backend test ./...
go -C backend vet ./...
# Tests create random schemas and drop only their own schemas, never truncate shared tables.
# DATABASE_URL_TEST must point to an explicitly disposable test PostgreSQL database.
set -a
. .local/test.env
set +a
go -C backend test -race ./...
```

Integration tests skip explicitly when DATABASE_URL_TEST is unset. Tests cover real PostgreSQL migrations/idempotency, concurrent dedupe/votes and reciprocal graph edits, visibility/moderation races, rollback, cooldown reset and expiry, intake cap races and restart persistence, context/query deadlines, server sessions and revocation/idle expiry. HTTP tests verify private DTO isolation and search totals, indistinguishable dedupe receipts, CSRF/Origin/Host/proxy rules, honeypot non-storage, malicious JSON/context, config validation, bounded admission and limiter memory, cookie signatures/proof timing, CLI password handling, and SPA traversal/symlink isolation. Actual commands and outcomes are recorded after final validation below.

## Primary sources checked 2026-10-21

- [Go net/http](https://pkg.go.dev/net/http): server timeouts, bounded bodies and graceful shutdown. The local mise toolchain used for tests is Go 1.27.2; module baseline is 1.27.0. Deployment should use the lead's patched toolchain pin.
- [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool): pool/context behavior. Direct dependency pinned to v5.11.0; all transitive versions are in go.mod/go.sum.
- [x/crypto/bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt): bcrypt comparison and 72-byte input limit. Pinned x/crypto v0.58.0, compatible with Go 1.27.
- [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html): unique constraints and ON CONFLICT for atomic dedupe/upsert.
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): exact origin and synchronizer tokens, with SameSite as additional protection.

The independent skeptic's B1–B10 findings are addressed by the concrete choices above. B2 deliberately uses owner review of the exact public text rather than adding a redaction/public-copy model; sensitive feature text must remain unapproved. B5 uses strict mandatory Origin instead of a permissive Referer fallback. B7 uses 30min idle/12h absolute sessions. Source URL availability, distributed attacks beyond local budgets, anonymous vote inflation and owner-managed data/backup retention remain explicit limitations.

Executed backend evidence (2026-10-21, local mise Go 1.27.2, isolated lead-provided localhost PostgreSQL): `go test ./...` including database/HTTP integration **PASS**, `go test -race ./...` including database integration **PASS**, `go vet ./...` **PASS**, `go build -o bin/feedback-hub ./cmd/feedback-hub` **PASS**, backend whitespace checks **PASS**. The final SQL projection/JSON handling adjustment was followed by another full unit/integration pass and vet. Frontend/browser, Caddy/Docker and deployment evidence is owned by the lead and is not claimed here. No deployment or production access was performed.
