# Feedback Hub redesign — independent UX review R1

2026-10-21. Review only. Read `AGENTS.md`, root/frontend READMEs, API contract, prior UX reviews, current frontend changes and the installed published Unlikely UI component implementations. Reviewed the working-tree redesign, not a claim that it was already committed. HEAD at completion of browser checks: `2c5aae8fda7e0187dc6be0e6959bb80c34151961`.

**Verdict: no release-blocking redesign defect found. One optional, low-priority keyboard cue improvement below. Undo voting still requires the integration owner's real-backend verification.**

## Finding

### P3, non-blocking — pagination destination has no visible focus cue

With a synthetic GET fixture containing 31 results, focus “Дальше” and press Enter. The URL correctly changes to `?offset=30`, and focus correctly moves to H1 “Предложения”; browser Back restores the same focus destination. However, [`styles.css:946`](../web/src/styles.css#L946) explicitly removes the heading's outline. The former visible pagination focus cue is lost, although the focus-management fix itself still works.

Optional localized improvement: provide a visible `:focus-visible` treatment for this destination. This is not a reproduced keyboard trap, lost focus, or an axe-reported WCAG failure, and it does not block this redesign.

## Verified behavior

- **Proposal-first layout:** Firefox at 320×568, 390×844 and 1280×900. At 320px the first card begins at **y=299px** and ends at approximately **y=511px**. One “Написать” creation link is present. Tall hero, sidebar and footer are absent. Filtering preserves the project in the creation URL by code inspection.
- **Actual PhysicalButton:** imported from the public `unlikely-ui/physical-button` export, with documented props and semantic colors. The vote target measures **60×80px**, without transform-scaling the target. Its cap, arrow/check and counts 1, 123 and 1000 were visually checked in light/dark appearance; the selected state remains distinguishable. Placement does not obstruct the proposal title or project link.
- **Touch and overflow:** navbar buttons, creation action, select triggers, select items and form type choices meet **44px** height in the coarse-pointer Firefox context. Project links measure 24px high. No document or dialog horizontal overflow was found. Long unbroken title/description fixtures wrap within cards. Form textareas and project controls retain **16px** typography.
- **Select edges:** opened board, form and admin menus. Selected and keyboard-highlighted rows fill the popup interior up to its border, with **0px list padding** and **0px item radius**. Screenshots confirm no white inset strip. Menu items remain 44px high; Escape restores trigger focus. Dark popup colors inherit the active theme.
- **Navbar help:** keyboard opening, Escape and explicit close restore focus to “Как это работает”; clicking uncovered header space dismisses it. Privacy details expand with the keyboard. At 320×568 the expanded popup stays within **y=64–556px**, scrolls internally (`clientHeight=490`, `scrollHeight=541`, `overflow-y:auto`), and Tab scrolls the admin link fully into view. No inaccessible clipped bottom action was found.
- **Logo/assets/links:** the mint bulb and local project icons load. Campus and Unlikely UI icon hashes exactly match the cited local project originals. Campus links to `https://campus.kreoniz.ru/`; Unlikely UI uses the supplied verified npm fallback. Both use `_blank` with `noopener noreferrer`. “Другое” remains a plain label with its local icon. The built HTML references the local favicon and touch icon.
- **Form routes:** `/new?project=campus&type=bug` and `type=feature` retain the project and correct mode at 320/390/1280px. Bugs still require no title; optional details/context remain available. No submission was attempted.
- **Admin regression:** real unauthenticated login page checked at all three widths. Authenticated inbox/editor used separately identified synthetic GET fixtures, without login or credentials. After focusing Save, dialog `clientWidth=scrollWidth`: **270px** at 320px and **340px** at 390px. Mobile Cancel/Save targets remain fully inside the dialog and measure **230×44px** / **300×44px**. Nested selects work. Cancelling the dirty-Escape confirmation preserves the unsaved note. Light/dark editor scans passed. No PATCH was attempted.

## Evidence and limits

Used the repository's documented Playwright/Firefox workflow, as requested after the recorded T3 failures `Preview automation snapshot timed out after 15000ms.` Firefox **157.0**, Russian locale, touch/coarse pointer and reduced motion. Browser temporary files and artifacts stayed on disk in ignored `.local/review-redesign-ux-r1/`.

The running old preview at `http://localhost:18082` served `web/dist`: `index-BaVYylsA.js` and `index-hjmFmXo9.css`. Main checks used its real GET API. Additional long-content, multi-project, voted, pagination and authenticated-admin states were **browser-only synthetic GET fixtures**, not real-backend acceptance results. Source/build hashes remained unchanged throughout the main checks and through the follow-up check.

**29 axe scans, zero violations**, using `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`; **zero page errors**, failed HTTP responses or attempted mutation requests in the main run. Screenshots were visually inspected, including 320px board/menu/help/form/admin states, desktop board, and selected vote colors in both themes. Detailed measurements and source hashes are in ignored `evidence.json`; supplemental popup scrolling/routes/pagination results are in `followup.json`.

No application reports, votes, PATCH, login/logout, database changes, service restarts or implementation edits were made. The old API lacks DELETE, so actual vote/undo/revote, reload persistence, cooldown and failed-undo recovery were deliberately not executed or certified here. No physical phone, Safari, screen-reader, production or performance certification is implied. Only this review document is intended for commit.
