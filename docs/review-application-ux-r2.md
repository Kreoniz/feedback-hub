# Application and UX review — R2

2026-10-21. Independent final verification of the findings in [application R1](review-application-r1.md) and [UX R1](review-ux-r1.md). Read repository `AGENTS.md`, READMEs, [contract](contract.md), [architecture skepticism](skeptic-architecture.md), the relevant implementation and published regression tests. Inspected fixes: `bdfe9ca`, `3c777d9`, `9de313f`, `077f099`. Final inspected HEAD: `ad5ee3ffdf42eaa3996d302d2606693da94ae117`; its additional change is infrastructure-review documentation. Hashes of the relevant implementation files remained unchanged through verification.

**Verdict: no residual application/UX release blocker found in this R2 scope.** A1, A2 and UX R1–R4 are resolved by concrete fixes and passing checks below. This closes the original findings; it does not certify production deployment or stronger anonymous-identity guarantees.

## Resolved application findings

### A1 — private-content quota oracle

The chosen correction changes the dedupe scope rather than charging duplicates. [`handlers.go:136`](../backend/internal/app/handlers.go#L136) derives the fingerprint with the purpose-separated `dedupe-visitor` HMAC over the verified visitor identity and canonical payload. A different visitor's identical text therefore creates an independent row and consumes the same quota as unrelated text. The handler still returns neutral 201 receipts without exposing report IDs or the internal duplicate result.

[`reports.go:85`](../backend/internal/store/reports.go#L85) locks the persistent intake ledger before admission, duplicate lookup and insert. The lookup at line 98 suppresses only matching fingerprints from the preceding 24 hours whose status is neither `done` nor `closed`. [Migration 003](../backend/internal/store/migrations/003_bounded_deduplication.sql) removes permanent fingerprint uniqueness. This preserves concurrent retry suppression while allowing later recurrences. Same-visitor retry accounting does not disclose another visitor's private text under the updated contract.

Executed evidence:

- `TestHTTPPrivateDedupeQuotaBoundary`: **all six cases PASS** under `-race`, covering existing/absent private guesses at project/day, global/day and lifetime `cap-1`. Each case requires guess **201**, unique probe **429** with Retry-After, and **two physical rows** for the distinct visitors.
- Independently adapted the ignored R1 reproduction, without implementation edits. In each fresh schema, the historical private fixture was aged **23 hours**, keeping it inside the new dedupe window, and its current-day ledger cleared. Then **499 distinct current-day reports** were accepted through the actual HTTP handler, across simulated source addresses within the network submission limit. Both the matching and nonmatching history produced **guess=201, probe=429, Retry-After=3600**, with **501 physical rows**. The original observable difference is gone even when the current-day budget is filled through real intake rather than prepared counters.
- `TestDatabaseDedupeAllowsRecurrences` and `TestDatabaseAtomicDedupeAndVotes`: **PASS**, including immediate retry suppression, acceptance after 25 hours, acceptance after resolution and 20 concurrent same-fingerprint submissions creating one row. Real migrations, including idempotent reapplication, ran in the isolated schemas.

### A2 — private admin-note search

[`reports.go:170`](../backend/internal/store/reports.go#L170) adds `details` and `admin_note` only when `public=false`; public search retains title/description. Count and items use the same predicate and database snapshot. The admin UI's existing notes-search wording now matches the implementation.

`TestDatabasePrivateSearchScope` **PASS**. An independent SQL overlay also searched separate note-only and details-only markers on an **approved feature**, so public visibility could not mask an accidental private search match. For each marker, authenticated-list scope returned **total=1, items=1**; public scope returned **total=0, items=0**.

## Resolved UX findings

Browser evidence below comes from a **fresh current-source Vite production build**, Firefox, touch context with `(pointer: coarse)=true`, Russian locale and reduced motion. Reused the prior review's browser-fixture structure, but served the new assets and synthetic GET responses entirely through Playwright routing at `http://feedback-review-r2.test`. All other requests were intercepted; no running app or database supplied these UI responses.

### UX R1 — 320px dialog action overflow

[`styles.css:1164`](../web/src/styles.css#L1164) stacks the actions in a single shrinkable grid column. Repeated the original dirty-note → focus Save sequence:

- **320 × 568:** dialog `clientWidth=270`, `scrollWidth=270`, `scrollLeft=0`; both buttons span x=45–275 inside dialog x=24–296, each **230 × 44px**.
- **390 × 844:** dialog `clientWidth=340`, `scrollWidth=340`, `scrollLeft=0`; both buttons span x=45–345 inside dialog x=24–366, each **300 × 44px**.

Document width also equals viewport width in both cases. Visually inspected the 320px screenshot: both complete action labels and the note remain visible after Save receives focus. The previous inner overflow is resolved without hiding it. The published E2E now checks the dialog's own scroll width after Save focus at [`app.spec.ts:118`](../web/tests/app.spec.ts#L118), addressing the R1 test blind spot.

### UX R2 — dirty Escape dismissal

[`Admin.tsx:457`](../web/src/Admin.tsx#L457) consults a ref updated from the editor's dirty state and asks for native confirmation before unmounting. In the fresh browser run, Escape raised `confirm` with “Закрыть сообщение без сохранения изменений?”. Dismissing that confirmation kept the dialog open and preserved the exact unsaved note. Explicitly cancelling the edits then allowed Escape without confirmation and restored focus to the report-opening button. No PATCH was sent. Draft state remains in React memory; this fix adds no persistent browser storage. The published real-backend test also asserts cancelled confirmation and retained draft.

### UX R3 — pagination focus

[`usePaginationFocus`](../web/src/hooks.ts#L5) focuses a stable element on offset changes: the board heading at [`Board.tsx:110`](../web/src/Board.tsx#L110), or the inbox region at [`Admin.tsx:244`](../web/src/Admin.tsx#L244). With a synthetic 31-result fixture, keyboard activation of “Дальше” changed the URL to `offset=30`; focus remained on **H2 “Доска идей”** and **SECTION “Список входящих”**, respectively, after results loaded. Browser Back returned to offset zero and focused the same targets. Neither transition left focus on BODY; computed focus outlines were present.

### UX R4 — coarse-pointer control font size

The global reset now sets only `font-family` at [`styles.css:14`](../web/src/styles.css#L14). The fresh touch-context run measured **16px** on the bug-description textarea, project combobox and admin-note textarea. The published public E2E explicitly enables touch and checks the description's computed 16px size. No physical iOS zoom behavior is claimed.

## Executed checks and limits

- **PASS:** mise Go **1.27.3**, `go -C backend test -race ./internal/app ./internal/store -count=1 -v`, including real PostgreSQL integration with no skipped database tests. Both packages passed; independent R2 SQL-overlay tests also passed under `-race`.
- **PASS:** `go -C backend vet ./...`; frontend TypeScript `--noEmit`; **31 Vitest tests in 3 files**.
- **PASS:** isolated Vite production build: `index-DkC0qHcG.js` **432.60kB / 139.18kB gzip**, `index-DU4645rk.css` **54.92kB / 10.88kB gzip**. These are build estimates, not measured deployment transfer sizes.
- **PASS:** independent Firefox checks above; **five axe scans**, zero violations for `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, covering the 320px bug form, dirty light editor, dark editor, board and inbox. **Zero mutation requests and zero page errors** in the browser fixture run.

Reproducers, raw outputs, source hashes and synthetic screenshots remain ignored under `.local/review-application-ux-r2/`. The first sandboxed SQL attempt could not connect to the explicitly configured localhost test database; the approved localhost retry passed. Database helpers created random schemas and dropped only their own schemas. No shared application rows were changed.

**Unresolved blockers: none established.** No implementation edits, subagents, PRs, watchers, SSH, DNS or production operations. Port **18081 was neither queried nor interrupted**; no stale Docker assets on 18080 were used. The lead's full real-backend E2E, 29-check API acceptance, Docker and vulnerability-audit results are separate evidence and are not claimed as rerun here. Physical devices, Safari/WebKit, assistive-technology testing and load profiling remain outside this bounded re-review. Documented anonymous-vote, NAT and privacy-cap tradeoffs do not introduce a new finding or require extra features for this MVP.
