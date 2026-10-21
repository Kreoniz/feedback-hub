# Application review R1

2026-10-21. Independent, read-only review of `backend/**` and its integration with `web/src/api.ts`, `privacy.ts`, public voting/intake and private admin rendering. Read repository `AGENTS.md`, `docs/contract.md`, `docs/skeptic-architecture.md`, `backend/README.md` and `docs/review-infrastructure-r1.md`. Final inspected baseline: `eebf2ec7b9ad9890cf492ab335c8fa9e9ad06f62`; backend implementation includes `2f9d2bd`. Concurrent changes were observed, not staged by this reviewer. No subagents, implementation edits, PRs or production operations.

**Verdict:** one confirmed **P2 privacy finding, A1**, remains against the contract's private-content non-disclosure promise. Resolve it before describing B1 as closed. A2 is a **P3 interface mismatch**. No additional high-confidence authentication bypass, public private-field projection leak, SQL injection, stored-XSS sink or Go data race was found in the inspected paths. This is a bounded review, not unconditional security approval. Infrastructure fixes and their separate re-review are outside this verdict.

## A1 — P2: the next request reveals private deduplication at a quota boundary

Locations: [`backend/internal/store/reports.go:89`](../backend/internal/store/reports.go#L89), [`reports.go:99`](../backend/internal/store/reports.go#L99), [`backend/internal/app/server.go:93`](../backend/internal/app/server.go#L93). Contract: [`docs/contract.md:11`](contract.md#L11).

The direct response correction works: a novel report and an internal duplicate both receive 201, a fresh receipt and `duplicate:false`. However, only a **novel** report advances the persisted daily/lifetime counters. When one admission slot remains, submitting a guessed private report leaves that slot available if the text already exists; otherwise it consumes it. A subsequent unique report distinguishes those cases through 201 versus 429. Checking the cap before deduplication hides matches **at** capacity but does not hide this transition **into** capacity.

Confirmed against actual PostgreSQL through the unchanged application HTTP handler in two fresh random schemas:

1. Create one private bug, using either the guessed description or an unrelated description in the two cases. Move this fixture to the preceding day and clear only its schema's daily ledger, representing a historical report. Both cases start with the same number of historical rows.
2. Issue a different visitor cookie/form proof for the attacker and advance the test clock by three seconds. Accept **499 distinct current-day bugs through `POST /api/reports`**, not by editing budget counters. Use 84 simulated source addresses, at most six submissions per address, preserving the configured per-address limits. No forged-XFF bypass is assumed.
3. From a fresh source address, submit the guessed historical description, then a fresh unique probe. Both requests use the attacker's valid cookie/proof, exact Origin and JSON.

Observed output:

```text
historical guess exists: guess=201, probe=201, Retry-After=""
historical guess absent: guess=201, probe=429, Retry-After="3600"
```

Both guess responses contain `duplicate:false`. The historical bug remains private; no report IDs, admin access or timing measurements are needed to obtain its existence bit. The same accounting condition exists at the global daily and lifetime boundaries; the executable reproduction exercised the project/day boundary.

**Practical limits:** this requires a known or controlled near-full budget, enough genuine source addresses or paced requests to pass existing rate limits, an exact normalized content guess, and a sufficiently quiet window. Other writers introduce uncertainty. It is a limited, costly oracle, not arbitrary report reading or unrestricted enumeration. A low-traffic service's predictable UTC daily reset makes the historical-report case feasible to arrange. This does not contradict the documented limits of anonymous identity or require stronger identity infrastructure.

**Small fix:** make publicly observable admission accounting independent of the dedupe result. For example, charge every accepted real intake, including internal duplicates, to the same persisted acceptance budgets before the fingerprint-dependent branch; keep any separate physical-row accounting bounded. Cover daily **and** lifetime transitions. This deliberately makes successful retries spend acceptance capacity and needs corresponding operational wording. Keep the neutral response and internal deduplication. Add a two-request regression at `cap-1`; the probe must have the same outcome in both cases. Existing at-cap tests should continue passing.

## A2 — P3: admin search promises notes that its SQL never searches

Locations: [`web/src/Admin.tsx:251`](../web/src/Admin.tsx#L251), [`backend/internal/store/reports.go:158`](../backend/internal/store/reports.go#L158).

The admin search placeholder says “Текст сообщения или заметки”. Both public and admin queries search only `title` and `description`; `admin_note` and `details` are absent from the predicate. Confirmed in an isolated PostgreSQL schema: create a report, save a marker only in its admin note, then call `Store.List` with `public=false` and that marker as `Q`. Result: `total=0`, empty items, with the note still present on the report.

The smallest correction is to describe the actual title/description search in the UI. If note search is intended, add it **only to the authenticated admin predicate**, with matching count behavior; expanding the shared public predicate would introduce a private-text search oracle. This is a usability defect, not an authorization failure or a release blocker by itself.

## Evidence and test assessment

- **PASS:** existing `go test -race ./internal/app ./internal/store`, including real PostgreSQL HTTP/store integration. Tests use `testutil.Database`, create random schemas, and drop only those schemas. Initial sandboxed DB access failed; the authorized localhost retry passed. No existing app process, shared application tables or shared test fixtures were mutated.
- **PASS:** independent Go-overlay reproductions of A1 and A2. The first A1 probe used a prepared ledger boundary; a second run filled all 499 slots through actual HTTP intake and reproduced the same result. Overlay files are ignored under `.local/review-application-r1/`; no test file was added to implementation directories. A1's setup is synthetic, but the response difference comes from unchanged handlers and SQL.
- **PASS:** `go vet ./...` and frontend TypeScript checking. **PASS:** all three frontend unit files, **31 tests**, using the installed Vitest runner. The default `pnpm` shim tried to resolve a package manager over unavailable DNS; using the already installed tools avoided any dependency change.
- Existing integration tests are substantive: real migrations/idempotency, concurrent dedupe and same-visitor voting, reciprocal graph edits, moderation/vote races, rollback, persisted caps and restart continuity, session rotation/revocation/expiry, private DTO isolation, Origin/CSRF and minimized context. The SQL deadline test actually cancels `pg_sleep`; it is not a mocked driver assertion. At-cap tests correctly reject duplicates and novel reports uniformly. They do not cover A1's **two-request `cap-1` observation**, explaining why the suite passes despite A1.
- Hostile-input review covered body/depth/field bounds, duplicate JSON keys, UTF-8/control handling, safe context origins/paths, version labels and expired form proofs. A small additional probe found `{"password":"first","PASSWORD":"second"}` is accepted with `second` selected: duplicate detection uses exact key strings while Go struct decoding accepts case aliases. All downstream checks use the selected value; no authentication or privacy bypass was demonstrated, so this is a non-blocking strictness caveat, not another vulnerability finding.
- Source inspection found plain React text rendering in public cards, report details, notes, errors and publication preview, with checked HTTP(S) context links and no raw HTML sink. The feature publication warning and exact title/description preview are now present at [`web/src/Admin.tsx:710`](../web/src/Admin.tsx#L710). Backend bug-approval denial, explicit public SQL/DTO projection, visibility row locking, graph serialization, mandatory Origin, exact proxy-hop policy, purpose-separated signatures, password/secret-bound sessions and API no-store match the coordinated MVP decisions. UI publication behavior and browser XSS payload execution were not independently exercised here.

## Limits

No deployment, DNS, SSH, production access, existing-container restart, shared-app acceptance run, or additional infrastructure was performed. No secrets or student identities were printed or committed. All review caches/fixtures stay in ignored disk-backed `.local` directories.

The lead's earlier 29-check native/Compose acceptance, Docker build and dependency-audit results are supplied prior evidence, not rerun or independently certified here. Playwright's real-backend scenario was inspected, not executed by this reviewer; browser/mobile/keyboard checks remain with the owners. No worst-case 50,000-report performance benchmark, volumetric attack, full Unicode fuzzing or live shared-Caddy verification was attempted. Missing/in-progress tests or documentation were not reported as implementation bugs. The bounded monolith and documented anonymous-vote, NAT, owner-publication and retention tradeoffs do not justify adding infrastructure or identity guarantees for this MVP.
