# Frontend UX, accessibility and performance review — R1

Date: 2026-10-21. Independent read-only review; no implementation or test changes.

**Recommendation: fix R1 before calling the 320px mobile admin ready.** R2–R4 are non-blocking improvements. No additional frontend privacy blocker was found in the reviewed paths.

## Release blocker

### R1 · P1 · Admin actions overflow the dialog at 320px

Locations: [`web/src/styles.css:1161`](../web/src/styles.css#L1161), [`web/src/Admin.tsx:785`](../web/src/Admin.tsx#L785).

Reproduce at **320 × 568**, coarse pointer: open any incoming report, edit the admin note, scroll vertically to the actions, then focus “Сохранить”. No save is necessary. The two-column action grid retains both buttons' minimum content widths. The dialog acquires horizontal scrolling; focusing Save scrolls its entire contents left and clips labels and text on the left. Before that horizontal scroll, part of Save is clipped on the right.

Measured on the current source build: dialog `clientWidth=270`, `scrollWidth=334`; action row width **230px**, contents **314px**; button widths **166.57px + 139.33px**, with an 8px gap. Save ends at x=**358.90** while the dialog ends at x=**296**. After focus-driven scrolling, the action row starts at x=**−19**. At 390px the buttons still exceed their row by 14px, but fit inside the dialog's remaining padding.

`document.documentElement.scrollWidth === innerWidth` and axe both pass: the overflow is **inside the modal**, so the existing document-width assertion misses it.

Small fix: stack the action buttons at the narrow breakpoint, preserving their touch heights. Verify the dialog's own scroll width and both complete labels at 320px, including after keyboard focus and with a dirty note. Do not merely hide horizontal overflow.

Evidence: ignored local screenshots `.local/review-ux-r1/admin320-unscrolled.png` (Save clipped), `admin320-actions.png` (content shifted after focus/scroll), `admin390-actions.png`; measurements in `latest-evidence.json` and `focus-sizing-evidence.json` in the same directory. The same overflowing controls were observed in the real authenticated local stack; the detailed measurements were repeated against the current build with browser-only synthetic GET fixtures.

## Non-blocking improvements

### R2 · P2 · Escape silently discards an admin draft

Locations: [`web/src/Admin.tsx:453`](../web/src/Admin.tsx#L453), [`web/src/Admin.tsx:550`](../web/src/Admin.tsx#L550).

Open a report, enter a note, press Escape, then reopen it. The UI first says “Есть несохранённые изменения.”, but dismissal immediately clears `selected`, unmounts the editor and loses the draft without confirmation. Reproduced both in the real local admin session and on the current build; no PATCH was sent.

Consider asking before discarding a dirty editor, or retaining that draft in memory until explicit cancellation. Keep private notes out of persistent browser storage. This is a data-entry usability risk, not evidence of lost saved server data.

### R3 · P2 · Pagination drops keyboard focus onto the document

Locations: [`web/src/Board.tsx:188`](../web/src/Board.tsx#L188), [`web/src/Board.tsx:217`](../web/src/Board.tsx#L217), [`web/src/hooks.ts:14`](../web/src/hooks.ts#L14).

With more than 30 results, activate “Дальше” using the keyboard. Loading replaces the results and paginator, destroying the focused button. After the next page appears, `document.activeElement` is `BODY`; focus does not return to the pager or move to the new results. This makes repeated keyboard browsing unnecessarily difficult. Reproduced with a **31-result synthetic browser fixture**, since the live board had one approved idea. The URL correctly changes to `?offset=30`, and Back restores the previous page.

Keep the pager mounted while loading, or deliberately focus a results heading after a page change. The admin list uses the same loading/pagination pattern and deserves the same check.

### R4 · P3 · Global font reset overrides Unlikely UI's coarse-pointer text sizing

Location: [`web/src/styles.css:11`](../web/src/styles.css#L11).

The unlayered `button, input, textarea { font: inherit }` wins over the package's layered control typography. With `(pointer: coarse)` true, the report description and project select compute to **14px**, although the published component contract and stylesheet provide **16px** coarse-pointer text. The 44px control heights remain intact. The live board search input also measured 14px.

Prefer a narrower font-family reset, or allow the components' own font size and line height to apply. This is a measured contract/sizing regression; physical iOS focus/zoom behavior was not tested and is not claimed as a reproduced failure.

## Checks and observations

- Read repository `AGENTS.md`, root/frontend READMEs, `docs/contract.md`, frontend implementation/configuration/tests, Unlikely UI's local `USAGE.md` and `docs/components.md`, and the installed package manifest and declarations for all used components, including Theme.
- Dependencies are pinned to published `unlikely-ui@0.1.0-alpha.1`, `react@19.3.1` and `react-dom@19.3.1`; the package's peers match. Imports use public subpaths, styles are imported once, compound controls use documented composition, and portals inherit Theme tokens. No copied/private components or extra UI framework were found.
- Firefox real-stack checks covered public board at 320/390/1440px, light/dark appearance, idea dialog, bug/idea form, login, authenticated mobile inbox, extra filters and report editor. One admin login and one logout; password was read privately, never printed or captured. No reports, votes or report patches were sent. No page errors occurred.
- Fresh-source checks used an isolated production build and **synthetic GET-only browser fixtures**, including malicious-looking literal text, 31-result pagination, empty lists and 503/retry paths. These are UI checks, not successful real-backend acceptance tests. Every non-GET fixture request was blocked; none occurred. **15 axe scans** across current-build board/form/admin states and nested overlays had zero violations for `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`.
- Skip link focuses main; invalid forms focus the first invalid project/description control and associate errors/descriptions. Select keyboard dismissal restores trigger focus. Dialog Tab navigation stays inside the dialog, nested-select Escape preserves the dialog, and dialog Escape restores the report/idea trigger when it remains mounted. R1 and R3 remain outside those passing checks.
- Bug content requires no title. Current context defaults on, is disclosed beside submission, can be disabled, and previews the sanitized allowlisted source URL without query/fragment. Code limits context to browser family, safe source and validated version; no local/session storage, raw HTML rendering or report-content logging was found in the frontend.
- Literal `<img ... onerror=...>` and Markdown-like strings remain text in public/admin dialogs and publication preview: no image node or injected action appeared. The approval preview contains the exact title and description, excluding private details. Backend authorization/privacy guarantees remain the backend review's responsibility.
- The older running assets had a dark-theme primary-link contrast failure (axe measured 1.26:1) and joined “голоспомогает”. Both were already corrected in current source and are **excluded from open findings**. Current-build dark primary link computes to `#102818` on `#88f19e`; dark board/dialog/form/inbox/nested-select scans pass. The earlier context and filter fixes mentioned in the brief are not re-raised.

## Performance assessment

The isolated current-source Vite production build succeeded: **432.12kB JS / 139.03kB gzip**, **54.91kB CSS / 10.88kB gzip**. These are build compression estimates, not measured production transfer sizes. The inspected pages need no external font or image service; lists are bounded at 30 items. No performance release blocker is established by this review.

The entry point eagerly imports Board, NewReport and Admin (`web/src/main.tsx:8`). If mobile measurements later justify reducing startup cost, route-level lazy imports are a contained first experiment using the existing React stack; measure the resulting chunks before adopting them. No dependency addition or framework rewrite is warranted from bundle size alone. Production Caddy already proposes compression; local Caddy does not, so localhost transfer size is not representative of that production configuration.

## Evidence and limits

The initial live assets were `index-CkelsP7M.js` / `index-DLEhj9jC.css`. To avoid reporting fixes already made by the frontend owner, current source was independently compiled into ignored `.local/review-ux-r1/dist`: `index-zE0rUvst.js` / `index-CZvNJVV-.css`. Source hashes, scripts, screenshots and JSON measurements remain in `.local/review-ux-r1/`; they contain synthetic data and are intentionally uncommitted. Source line references above describe this review snapshot and may move as concurrent work lands.

Used the repository's documented Playwright/Firefox workflow in a separate headless browser context. The task brief records two prior T3 preview snapshot failures: `Preview automation snapshot timed out after15000ms`. This review's first sandboxed browser attempt could not open local sockets; the successful checks used approved local browser execution. No server restart, shared-data mutation, SSH, production action or PR polling occurred.

Not performed: physical phone/Safari/WebKit testing, screen-reader testing, Lighthouse/Core Web Vitals or CPU/network-throttled profiling, full mutation E2E, and backend abuse/security acceptance. The lead's reported 29 passing black-box checks were not rerun or counted as this review's evidence. Temporary documentation/test work was not treated as a defect.
