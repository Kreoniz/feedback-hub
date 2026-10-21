# Independent admin compactness / UX review, round 1

Date: 2026-10-21, Asia/Omsk. Review only; implementation remains owned by the lead.

No blocking regression found in the compact inbox or editor exit transition. One nonblocking UX finding remains.

## Finding

### P3 — Collapsing filters conceals a nondefault sort without an indicator or reset

Location: `web/src/Admin.tsx`, `Inbox`: initialization of `more`, `filtered` / `reset`, and the toolbar filter toggle (approximately lines 220–252 and 350–365).

Reproduce: open `/admin?sort=old`; the extra controls correctly start expanded. Click “Скрыть фильтры”. The only remaining toggle reads “Фильтры”, the sort control is absent, and there is no “Сбросить фильтры” button. The active old-first order is now indistinguishable from the default order in the toolbar. Changing another filter and resetting it also leaves the nondefault sort in place, because `reset` omits `sort`.

Evidence: reproduced in Firefox on Docker asset `/assets/index-BtiAAbUN.js`; the collapsed toggle text was “Фильтры”, with zero reset buttons. A hidden moderation filter does retain a reset button, so it has at least a general active-filter signal; sorting has none.

Suggested change: show a nondefault-sort indicator on the collapsed toggle, or keep the sort visible. If reset is intended to restore the default view, include `sort: "new"` in it. Add a synthetic GET-only regression for a nondefault sort followed by collapse/reset.

## What was actually tested

- Read repository `AGENTS.md`, root/frontend READMEs, relevant API contract, the uncommitted frontend/test diff, and installed published Unlikely UI implementations/types. `Dialog.Root.onOpenChangeComplete`, `Dialog.Content.finalFocus` (including the latest function callback), and the Button label wrapper exist in the installed release. No unsupported component API was found. Styling `.u-button-label` still depends on the pinned library's DOM contract.
- Used the repository's Playwright Firefox workflow against the lead-managed Docker app at `http://localhost:18080`. The provided preview timeout history permitted this fallback. Verified the compact heading and successful PNG response for `/projects/unlikely-ui.png` before claiming new-build browser coverage. The final supplemental run served `/assets/index-BtiAAbUN.js`.
- `PLAYWRIGHT_BROWSER=firefox FEEDBACK_TEST_URL=http://localhost:18080 mise exec -- pnpm --dir web exec playwright test tests/admin.spec.ts`: final run **1 passed (7.3s)**. This covers desktop row dimensions, mobile lists/expanded filters, axe checks, technical disclosure, removal of the note input, a sampled closing fade with editor content retained until removal, final focus, and reduced motion with zero transition duration. An earlier run failed during Select portal exit; the lead updated the test's wait, and subsequent runs passed. That earlier run is not counted as successful coverage.
- Additional in-memory Firefox scripts used synthetic session/list/detail GET responses and aborted every non-GET API request. They made **zero mutation attempts**. No real private reports or credentials were read.
- Measured full-width list rows at 1280/390/320px without document overflow. Inspected a synthetic 390px screenshot: compact heading/filters and left-aligned report summaries were visible, including the bug row without a duplicate excerpt.
- Checked the dialog's own scroll width at 320 and 390px. A final 320×568 touch check with a long unbroken synthetic detail string measured `scrollWidth === clientWidth === 270`; both focused-action bounds stayed inside the dialog and viewport. An earlier touch check measured 44px action heights.
- Dirty-priority edits survived rejected Escape and close-button confirmations. Accepted discard closed the editor and restored focus. The final asset also passed three forced reopen attempts during closing, each remaining open after the old transition could finish; an earlier build passed five. This is a bounded race check, not exhaustive scheduling coverage.
- Selecting approval displayed the privacy warning and exactly one copy of the public description, with private details separately labelled. Existing notes remain in the draft/legacy patch model; their removal from the UI does not add them to outgoing changed fields in the inspected code.
- Separate open-Select audits initially produced varying results. Three settled-menu samples on the final asset reported no violations for `aria-input-field-name` / `aria-hidden-focus`, but axe marked the latter **incomplete**. This does not establish a confirmed Select defect or certify assistive-technology behavior.

## Limits and handoff

No successful PATCH, post-save list refresh/focus fallback, real intake, server-side publication/privacy enforcement, database integration, or production behavior was exercised. The real mutation scenario in `app.spec.ts` was inspected, not run. Browser evidence applies to the identified Docker build; later source edits require their own verification. Backdrop dismissal and dirty edits during full-page navigation were not independently tested.

No implementation edits, staging, commits, pushes, Docker/service changes, or database operations were performed by this reviewer. Only this review document was intentionally added; Playwright generated its normal ignored test-result metadata.
