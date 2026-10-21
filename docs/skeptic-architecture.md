# Feedback Hub: independent architecture skepticism

Review date: **2026-10-21**. Scope: repository `AGENTS.md` and initial `docs/contract.md` at `22298df`; [research evidence](research.md). This is a **contract-level preliminary review**, not approval of the concurrently developing backend, frontend, or deployment. The only implementation metadata inspected was the in-progress Go module; no implementation behavior or tests are certified. README was absent when review began. Only this document and `docs/research.md` are owned by this task.

## Verdict

The chosen monolith is proportionate. Registration, CAPTCHA, a separate message queue, Redis, microservices, and machine-learning classification are unnecessary for the stated version. The security obligations still need executable definitions: “same-origin,” “private,” “bounded,” and “per-IP cooldown” are too ambiguous to be acceptance criteria alone.

**Do not call the current contract release-ready without resolving B1–B10 or recording the precise implemented decision with the lead.** B1 is a direct information-disclosure flaw in the specified response semantics. B2–B10 are missing or ambiguous safety contracts whose actual implementations may already address them; verify rather than asserting code vulnerabilities. No extra infrastructure purchase is needed to fix these application issues. An edge migration has separate gates in E1–E3.

## B1 — exact deduplication exposes private-report existence

**Contract trigger:** `POST /api/reports` returns `{id,duplicate}` and changes 201 to 200 on an exact project/type match. It warns about returning an existing private ID but leaves the status and boolean as an oracle.

An attacker can submit a guessed bug description, compare `duplicate` or status, and learn whether that text already exists. A neutral new UUID does not hide that answer. Non-enumerable IDs prevent guessing IDs; they do not make a disclosed existence bit private. Normalizing broadly or storing a digest changes neither conclusion. The same issue applies to pending/rejected feature text.

**Minimal safe fix:** perform dedupe internally but make every cross-visitor acceptance observationally consistent: a fresh opaque receipt, the same success status, and `duplicate:false` (or remove the field from the public contract). Only a retry attributable to the same visitor may return its existing receipt and a truthful duplicate indicator. A receipt never authorizes reading a private report. Avoid deliberate timing distinctions; do not promise perfect constant-time HTTP behavior. If honeypot receipts use the same shape, do not expose a later public receipt-resolution endpoint.

**Tradeoff:** callers lose a global “someone already reported this” signal. That signal conflicts with the privacy promise. Public feature matching can later be a separate operation over already approved public data.

**Acceptance:** two different visitor cookies submit the same private payload; response status/shape/duplicate semantics expose no prior match and neither receives the other's report ID. Test same-visitor retry and simultaneous identical submissions separately. Coordinate the contract change; this reviewer has not edited it.

## B2 — approving a feature can publish sensitive original text

**Contract trigger:** `Feature` exposes title/description; `Report` extends it. Admin PATCH can approve, but cannot edit or supply a curated public title/description. Reports are free text and may include names, credentials, or personal context in the description itself.

“Technical context is private” does not make the shared description safe. One approval may publish the entire original user narrative. Plain-text rendering prevents markup execution; it does not prevent privacy disclosure.

**Minimal safe fix:** explicitly require the owner to review the exact public title and description before approval. In this version, publish only features whose original public fields are safe; keep sensitive reports pending/rejected. Show the exact proposed public preview and a publication warning in admin. Never allow bug approval, even through conflicting PATCH combinations. Do not automatically promote private `details`, context, notes, or duplicate metadata into public fields.

**Tradeoff:** a useful but sensitive feature cannot be cleaned up through the current API. If editing is required now, add separate curated public fields plus an explicit publish action; preserve the original private submission. Do not quietly mutate original evidence while pretending the present contract supports redaction.

**Acceptance:** a report containing a synthetic secret marker in details/context/notes never exposes it through any public response, error, search count, or cache. A marker placed in the feature description must be visible in the owner's publication preview, and the documented safe workflow must keep it private until deliberately approved. Every bug-approval attempt fails server-side.

## B3 — visibility and vote rules need one transactional definition

**Contract trigger:** “Approved feature only,” “Public duplicates should be hidden,” “No voting on private or unapproved items,” and “preserve originals and votes” are separate statements.

Define one public predicate: `type=feature AND moderation=approved AND duplicate_of IS NULL`. Apply it to lists, totals, search, sort, vote admission and any future feature lookup. Otherwise hidden duplicates may remain votable, or a search count may reveal private matches. Priority and information quality must never be public filters unless explicitly added to the public model.

**Minimal safe fix:** keep separate public/admin response models and explicit public SQL projections. For new votes, check visibility and serialize against moderation/duplicate changes in the same DB transaction; enforce unique `(report_id, visitor_id)` in the database. Count from authoritative votes or update a counter in the same transaction. A duplicate existing vote must remain an idempotent success while the feature is public; a hidden feature gets a uniform not-found response. Preserve old votes on their original row; do not silently transfer them or change public visibility as a side effect of voting.

Duplicate graph validation is also a race: concurrent A→B and B→A updates can both pass a check-then-write cycle test. Serialize graph edits, for example with a project/type advisory lock inside their transaction. Reject cross-project/type, self links and cycles server-side. Specify whether linking to a hidden/rejected target is allowed in admin; never disclose its identity publicly.

**Tradeoff:** short row/graph locks serialize a small amount of work. That is simpler than repairing vote counters or graph cycles later.

**Acceptance:** concurrent same-cookie votes count once; reset-cookie votes racing in the network cooldown count at most once within that window. Race votes with hide/link operations; hide never leaves an API path that accepts new votes. Concurrent cycle creation must fail one transaction. Public totals and item visibility must agree.

## B4 — numeric budgets and overload behavior are absent

**Contract trigger:** bounded pagination is specified, but field sizes, malformed body limits, time, concurrency, limiter cardinality, password-hash work, and storage growth are not.

A hundred distinct attacker addresses/IDs can be more damaging to an unbounded limiter map than a single fast client. A valid signed form token can be collected cheaply. A small JSON report can also become indefinite PostgreSQL and backup growth. Tight write limits alone leave search, counts, form issuance, 404s, and password hashing available for exhaustion.

**Minimal safe fix:** adopt explicit limits such as the proposed starting budgets in research, and publish the actual values as a server contract. Bound body bytes before decode, strings/URL/query separately, header/read/write/DB time, admitted work, pool wait, password verification and active sessions. Require a single JSON object, reject trailing values, and define unknown-field behavior. Use parameterized SQL and validated enum/sort allowlists; do not interpolate client sort text. Expire and cap limiter entries, including invalid-ID keys. Provide a bounded overflow path and a way to pause submissions when the moderation/storage budget is reached. Keep admin/health capacity available.

Cheap validation should precede expensive work; OWASP's DoS guidance supports that ordering. [OWASP DoS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html). Go header timeouts and header sizes do not replace body bounds or DB cancellation. [Go Server](https://pkg.go.dev/net/http#Server).

**Tradeoff:** finite limits reject some legitimate long or bursty input. Clear Russian errors and Retry-After are more defensible than unbounded service failure. A submission pause is operational availability degradation, not a claim that spam has been solved.

**Acceptance:** oversized/chunked/malformed/extra JSON fails before DB work; expensive queries and lock waits have deadlines; unknown-ID and changing-IP bursts cannot grow state indefinitely; slow clients and login attempts do not consume all admitted work. Verify bounded behavior locally, without attacks on shared infrastructure.

## B5 — “same-origin” must mean exact origin, including sibling subdomains

**Contract trigger:** every mutation needs same-origin checks, but the algorithm and missing-header behavior are undefined.

`campus.kreoniz.ru` and `feedback.kreoniz.ru` may be same-site while remaining different origins. SameSite=Strict alone does not defend against a compromised sibling. A suffix check for `kreoniz.ru`, a trusted caller-supplied Host, or permissive credentialed CORS defeats the intended isolation. JSON-only is useful but insufficient if alternate content types are accidentally accepted.

**Minimal safe fix:** compare parsed scheme, host and effective port with configured `PUBLIC_ORIGIN`; use a validated exact-origin Referer fallback when Origin is absent, otherwise reject browser mutations. Reject `Origin: null`, mismatched/multiple malformed origins and unconfigured hosts. Keep credentialed cross-origin CORS off. Apply checks to reports, votes, login and logout, and require a session-bound admin CSRF token for authenticated mutations. Do not compare the full Referer URL or retain it in logs. [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Go's standard `CrossOriginProtection` explicitly permits requests without its relevant headers. It can be useful defense, but its defaults do not establish the stricter missing-header policy above. [Go CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection).

**Tradeoff:** CLI clients must deliberately send the expected origin; this is not a security boundary against bots that can fabricate headers. Browser CSRF defense and automated-abuse defense solve different problems.

**Acceptance:** reject hostile/sibling origins, a lookalike suffix, null origin, bad port/scheme, and missing Origin plus missing/foreign Referer. Accept the legitimate frontend flow and deliberate Referer fallback. Reject admin writes with missing/wrong/stale-session CSRF tokens, including logout. Verify login CSRF separately from authenticated writes.

## B6 — forwarded-IP trust is an end-to-end configuration contract

**Contract trigger:** exact trusted proxy networks are required in AGENTS.md, but the app-to-Caddy handoff and deployment defaults are unspecified.

Behind Caddy, using the socket peer for all limits groups every visitor together; trusting arbitrary X-Forwarded-For lets a client rotate invented addresses. Trusting all private ranges makes every container on broad shared networks a possible header issuer. Adding an external edge creates another trust hop rather than fixing this automatically.

**Minimal safe fix:** document one client-IP header/chain policy, exact trusted peers, IPv4-mapped IPv6 normalization, and malformed/absent-header behavior. Caddy strips/replaces the canonical header; the app uses it only from the intended Caddy peer/network. When Caddy is behind an edge, configure only that edge's source ranges and appropriate right-to-left parsing. Ensure the app has no public host port and do not broaden trust to compensate for a broken network setup. [Caddy trusted proxy behavior](https://caddyserver.com/docs/caddyfile/options#trusted-proxies).

**Tradeoff:** proxy topology changes require a configuration update and verification. Unknown peers should not acquire trusted identity through a convenience fallback.

**Acceptance:** an untrusted peer's forged XFF/X-Real-IP/canonical header cannot choose its limiter key. Test append chains with forged leftmost values, trusted Caddy, malformed values, and real multi-visitor behavior through the intended proxy. A sample environment file is proposed configuration, not deployment evidence.

## B7 — a server-side session still needs lifecycle and XSS protection

**Contract trigger:** opaque sessions, a password hash and CSRF are required, but expiry, renewal, revocation, storage, maximum session count and password-verification admission are unstated.

**Minimal safe fix:** cryptographically random opaque tokens, server-stored token hashes and CSRF state, rotation on successful login, idle/absolute expiry enforced on every request, bounded active state, logout revocation and a password-change invalidation path. Research proposes 30 minutes idle/8 hours absolute, not a universal mandate. Validate the password-hash configuration at startup and fail production startup on missing/invalid secrets or unsafe origin/cookie settings. Bound password input and expensive verification separately from public DB work. Production cookies should be host-only with Secure, HttpOnly and SameSite=Strict; the `__Host-` prefix with Path=/ prevents domain-scoped cookie confusion in supporting browsers. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

All untrusted text needs escaping inside the private admin UI as well as public cards. A stored XSS in a bug can issue authorized admin actions using the owner's browser, despite HttpOnly and CSRF tokens. Keep plain React text rendering, avoid raw HTML/Markdown and unsafe link schemes, and verify CSP in the real build. [OWASP XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

**Tradeoff:** expired sessions require another owner login; server restart can deliberately invalidate in-memory sessions in the one-replica version. Specify that behavior instead of introducing persistence merely for convenience.

**Acceptance:** the pre-login/anonymous cookie never authorizes admin; a captured revoked/expired session fails; a fresh login rotates credentials; logout and password change invalidate intended sessions. An XSS payload is inert in board, report, context, note, error and admin-preview rendering. No auth state in browser localStorage.

## B8 — visitor/network state needs expiry and an honest vote promise

**Contract trigger:** “per-IP cooldown prevent ordinary reset/concurrent duplication” is too broad; there is no duration, key scope, retention or stated restart behavior.

The cookie can be deleted and reissued. University Wi-Fi and mobile CGNAT share addresses. A strict IP/report uniqueness rule disenfranchises unrelated users, while a short cooldown only delays repeat voting. [RFC 6265 cookie semantics](https://httpwg.org/specs/rfc6265.html), [RFC 6269 §13.1](https://www.rfc-editor.org/rfc/rfc6269.html#section-13.1).

**Minimal safe fix:** define uniqueness as issued visitor/report, put it in PostgreSQL, explicitly choose the new-vote cooldown and normalization, and make existing-vote retry idempotent before a new-vote limit. Do not claim cookies or IP establish a unique human. Explain reset/new-device inflation and shared-network delays in Russian. Sign a random visitor ID rather than accepting a chosen ID; bind report form tokens to that ID and purpose. Limit token age without sleeping handlers.

Retain no raw IP in reports, votes or logs. Use a distinct keyed short-lived network tag only where needed for limits, with TTL and hard cardinality cap; a plain IP hash is enumerable. Do not present hashed identifiers as anonymous. Specify visitor-cookie expiry and what happens to the historical vote after expiry/reset. Define report/vote/session/backup retention and deletion; clearing the cookie cannot delete server records automatically.

**Tradeoff:** short-lived network state and restart resets weaken abuse continuity. Longer retention improves continuity but creates linkage and more collateral blocking. Document the choice; do not silently add fingerprinting.

**Acceptance:** existing-vote retries do not receive a spurious cooldown failure; two legitimate visitors sharing an IP receive the documented delay; key expiry/restart is intentional and bounded. Cookie reset outside the cooldown is documented as a bypass, not incorrectly tested as impossible. No public API exposes network/visitor identifiers.

## B9 — removing URL queries does not remove sensitive path data

**Contract trigger:** optional `context.page_url` is reduced to origin plus a “safe pathname.” No safe-path rule is defined.

Private identifiers and password-reset tokens can appear in `/students/12345`, `/reset/token`, or encoded path segments. Arbitrary HTTP(S) URLs are not automatically safe after query/fragment/credentials removal. An allowlisted source origin also does not authenticate project ownership or the reporter.

**Minimal safe fix:** infer a project only from exact allowlisted origins; otherwise use the explicit valid project or the documented default. For saved context, use origin only by default, or retain an explicit allowlist of known static route paths and replace dynamic/sensitive segments. Never fetch submitted context URLs. Validate absolute HTTP(S), reject credentials and sensitive/local hosts per defined policy, enforce lengths, and repeat sanitization server-side. Keep browser/version fields optional and coarse. If the current contract cannot define a safe pathname, drop the path rather than guessing.

**Tradeoff:** losing precise routes makes some bugs harder to reproduce. The user can describe the problem voluntarily; automatically collecting secrets is a worse default.

**Acceptance:** query, fragment, credentials, encoded sensitive segments, deceptive host suffixes and non-HTTP schemes are never retained. Unknown source/referrer cannot pick an internal project. No report creates outgoing HTTP requests. Error and access logs do not retain rejected original context or search strings.

## B10 — session-only no-store is too narrow

**Contract trigger:** `GET /api/admin/session` explicitly sets no-store, while form tokens, admin lists, report receipts and personalized `Feature.voted` have no stated policy.

A shared edge or accidental application cache can distribute a form token/cookie or another visitor's `voted` state. Stale cached public content can also outlive moderation changes. `Set-Cookie` alone does not prohibit HTTP cache reuse. [RFC 6265 §3](https://httpwg.org/specs/rfc6265.html).

**Minimal safe fix:** use no-store on all `/api/*` for this version, including errors, form issuance, login/session/logout and admin reads. Explicitly bypass API caching at any future edge. Cache versioned static assets, and keep admin HTML out of shared cache. Do not rely on a default CDN rule or Vary alone to protect private data. Check both application and proxy error/access logging: no bodies, passwords, cookies, full URLs or raw IP. Retain only route templates, status and aggregate timing where needed.

`GET /api/features` also does not issue a visitor cookie in the contract. The frontend must call `/api/form` on board entry before voting; an initial no-cookie list may show `voted:false`, but voting must wait for a valid issued cookie. Specify first-load behavior and token-expiry retry without losing the user's draft or minting a new identity on every refresh.

**Tradeoff:** public API reads reach the app, which increases load. At this scale that is simpler than a safe split between anonymous cached data and personalized vote state. Optimize later from measurements.

**Acceptance:** inspect final headers through the intended proxy, including error responses. Two independent visitors never share tokens/cookies/voted state through cache. After refresh and expired form-token recovery, the same browser retains its vote identity and its unsubmitted report draft. Synthetic private markers never appear in public JSON, rendered HTML or captured logs.

## Edge-migration gates, separate from application completion

### E1 — neither Caddy nor an ordinary proxy is volumetric protection

VDSina's staff distinguish included L3/L4 filtering from customer-managed L7 protection. Local rate limits preserve application work after requests arrive; they cannot free a saturated network link. An ordinary second VPS has the same finite-link problem. [VDSina primary answer, staff follow-up 2025-08-15](https://vdsina.ru/qa/q/est-li-zashchita-vds-ot-ddos-atak).

**Gate:** if strong attack-time availability is required, obtain provider/edge terms and test the integration before promising it. Provider-only launch can be an explicit limited-availability decision, not a claim of full protection.

### E2 — shared origin and TLS inspection enlarge the trust boundary

A `feedback.kreoniz.ru` proxy does not conceal the shared VPS address if another public hostname reveals it. Blocking the entire shared 443 port to non-edge traffic may break neighboring services; filtering only the Host in Caddy does not stop a direct network flood. Prepare a per-host origin-bypass plan with the lead, not a blanket wildcard firewall recipe.

An L7-terminating edge can see private reports, admin passwords and cookies. Qrator/Curator's HTTP-proxy docs additionally say upstream TLS authenticity is not verified. Resolve that material gap through supported verified TLS or an authenticated transport, and review logs/retention and access before procurement. [Qrator HTTP proxy](https://docs.qrator.net/technologies/reverse-proxies/http.html), [Curator HTTP proxy](https://docs.curator.pro/technologies/reverse-proxies/http.html).

**Gate:** written hostname/TLS/source-IP/cache/privacy/rollback plan and separately authorized rollout. No DNS or shared Caddy changes are authorized by this research.

### E3 — Russian presence and “no CAPTCHA” are trial conditions

Cloudflare still publishes a Russian-disruption warning updated **2026-04-23**. Using its proxy as a mandatory edge would add a documented regional reachability risk. [Cloudflare current support notice](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/service-disruption/).

The alternatives have plausible offerings but no all-ISP guarantee established by this review. A vendor may silently switch to JS checks, cookies or CAPTCHA during attack; procurement must preserve the user's explicit no-CAPTCHA requirement and ordinary form accessibility. Current certificate automation, subdomain limits and edge cache behavior differ by service and tier.

**Gate:** an approved staging trial from the relevant Russian networks, normal-browser form/vote/admin flows, no CAPTCHA including the chosen attack mode, authenticated origin transport, complete assets and correctly preserved CSRF/cookie/429 semantics. Use actual results and a current quote; neither old PDF prices nor a Russian office establishes acceptance.

## What the later independent implementation review must establish

The lead should record which B findings required contract changes and the actual decisions. The next reviewer needs the final commit, current contract, deployment templates and executed evidence, not a verbal assurance that “security is handled.” Prioritize the concrete adversarial cases above: cross-visitor dedupe, hidden/duplicate feature voting under concurrency, sibling-origin CSRF, forged proxy identity, expired/revoked sessions, bounded admission/state, private-text publication and cache/log isolation.

The full project delivery checks remain owned by integration: Go tests/race/vet, PostgreSQL integration, frontend typecheck/build, Playwright and mobile/keyboard browser verification. This documentation-only task does not run or certify their incomplete implementation. A later independent final review remains a separate task.
