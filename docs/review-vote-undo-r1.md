# Vote undo security and concurrency review R1

2026-10-21. Independent review of the backend changes finalized in `2c5aae8fda7e0187dc6be0e6959bb80c34151961`. Read `AGENTS.md`, README, backend README, API contract, request/security middleware, vote/list/moderation transactions, migrations 001–004, and relevant tests. Files were changing during the first read; the final implementation and contract were checked again before this verdict. Reviewed/tested file hashes match that commit.

**Verdict: no blocking security, concurrency, or contract issue found in this bounded backend review.**

## Findings

- Bodyless `DELETE /api/features/{id}/vote` returns `{votes,voted:false}` without requiring Content-Type. Optional JSON `{}` follows the existing strict decoder. Both methods retain exact Origin/Host checks, signed visitor validation, general limits and the same `vote` limiter bucket; DELETE introduces no alternate visitor selector.
- The retained `(report_id,visitor)` row distinguishes an existing identity from a new/reset cookie. Own reactivation succeeds immediately, including at lifetime capacity, without spending a slot or modifying any network cooldown. Repeated undo/reactivation leaves the original cooldown expiry unchanged; a different/new cookie on that network remains blocked until expiry. DELETE with no prior vote creates no row.
- POST and DELETE lock the report before checking visibility or changing vote state. Moderation takes the same report lock. The transaction counts active votes before releasing that lock, so concurrent directions cannot return a count from a partly applied operation. Pending, rejected, spam, bug, linked and missing items remain unavailable; hiding a report preserves its existing votes.
- First-ever vote pairs alone acquire the persistent lifetime ledger lock. Concurrent votes on different reports cannot spend the last slot twice. Undo does not decrement the ledger; reactivation does not acquire another slot. Rejected budget admissions roll back their provisional cooldown writes.
- Public and admin projections share the active-only count expression. Personalized `voted` also requires an active row; public popularity sorting uses that count. Public DTOs continue to exclude vote identity/storage metadata and private report fields. Repeatable-read list snapshots keep items and totals consistent.
- Migration004 adds `active boolean NOT NULL DEFAULT true`; existing votes remain active and migration does not rewrite the budget. Migration execution is transactional and versioned under the existing advisory lock. Cleanup removes expired cooldowns without deleting retained vote identities or refunding lifetime slots.

## Independent validation

Used mise Go **1.27.3**, `.local/test.env` exclusively for the disposable PostgreSQL target, the repository's disk-backed `.local/go-cache`, and reviewer temporary files under `.local/review-vote-undo-r1/`. Existing test helpers create random schemas and remove only those schemas. The initial sandboxed connection attempt could not reach PostgreSQL; the successful run used permitted local database access.

Passed with `-race -count=1` in `./internal/app` and `./internal/store`:

- Vote mutation guards and the shared POST/DELETE request limit.
- Real HTTP undo, immediate re-vote, another visitor's preserved vote, reload projection, hidden-feature rejection and POST/DELETE races.
- Store undo/cooldown invariants, concurrent vote directions, lifetime last-slot races/reactivation at capacity, rollback and migration preservation/idempotency.
- Existing atomic vote/dedupe and vote/moderation/deadline tests.

Two additional reviewer tests ran through a Go overlay, with fixture files only in ignored `.local`: bodyless HTTP DELETE without Content-Type, including cookie/Origin/JSON rejection checks; and all hidden-item variants plus **16 simultaneous POST/DELETE/moderation rounds**, preserving another visitor's vote and rejecting both directions after hiding. Both passed under the race detector. No implementation test file was edited or added to the checkout.

`go vet ./internal/app ./internal/store`, gofmt inspection of changed Go files, and scoped `git diff --check` also passed. A final hash check confirmed the tested backend and contract had not changed.

Only this report is committed. No running service or shared test schema was changed; app18080, preview18082 and the lead's port18081 were not accessed. Frontend/browser success, error, reload and re-vote acceptance remains with the lead's planned Playwright run. A material backend revision requires another independent review round.
