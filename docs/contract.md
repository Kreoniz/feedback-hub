# API contract — 2026-10-21

Same origin API; JSON only. Errors `{error: string}` with Russian user-safe messages and Retry-After on 429. IDs UUID strings. Timestamps ISO8601. Bounded lists: limit 30 default, max100; offset <=10000. Read/search/filter query strings.

`GET /api/projects` → `{projects:[{slug,name,description,url}]}`. Initial slugs `campus`, `unlikely-ui`, `other`.

`GET /api/form` → `{token:string}` and anonymous signed HttpOnly cookie. Token expires in 2h; reports require age >=2 seconds. Obtain at page mount; refresh on expired token. Visitor cookie is used for voting. Form does not require login.

`GET /api/features?project=campus&q=&status=&sort=votes|new&limit=30&offset=0` → `{items: Feature[], total:number}`. All projects if project empty. Feature `{id,project,project_name,title,description,status,votes,voted,created_at}`. Approved feature only. Never return bug content, moderation metadata, technical context, network identifiers or admin notes.

`POST /api/reports` → 201 `{id,duplicate:boolean}` (200 on exact dedupe). Body `{project,type:'feature'|'bug',title?:string,description:string,details?:string,context?:{page_url?:string,browser?:string,app_version?:string},website?:string,form_token:string}`. Description is the only required content for bugs; title required for features. Context URL must lose query/fragment/credentials on server. Reject sensitive/non-http URLs; context optional. Honeypot website populated: generic success, no report stored. Feature moderation pending; bugs always private. Exact normalized content dedupe within project/type avoids repeated entries without leaking existing text or private details. Response ID must not expose a preexisting private report to a different visitor; use non-enumerable neutral receipt if needed.

`POST /api/features/{id}/vote` with JSON `{}` and same-origin → `{votes:number,voted:true}`. Idempotent positive vote only; no downvote or toggle. Requires anonymous cookie (GET form first). DB uniqueness visitor+report and per-IP cooldown prevent ordinary reset/concurrent duplication; document NAT tradeoff and limits. No voting on private or unapproved items.

`POST /api/admin/login` `{password:string}` → `{authenticated:true,csrf_token:string}`; single configured owner, password hash, opaque HttpOnly server session, Secure production, SameSite Strict.

`GET /api/admin/session` → `{authenticated:boolean,csrf_token?:string}`. `POST /api/admin/logout` → 204. Admin mutations after login require `X-CSRF-Token` and same-origin. All /api/admin except login/session require session, unauthorized 401. Session GET sets no-store.

`GET /api/admin/reports?project=&type=&status=&moderation=&priority=&information=&q=&sort=new|old|priority&limit=30&offset=0` → `{items:Report[],total:number}`.

`GET /api/admin/reports/{id}` → Report. Report extends Feature with `{type,details,context,moderation,priority,information,duplicate_of,admin_note,updated_at}`; title may be empty for bugs. `priority`: untriaged|low|normal|high|critical. `information`: sparse|useful|detailed (descriptive score, independent of priority). `moderation`: pending|approved|rejected|spam. Status `new|planned|in_progress|done|closed`.

`PATCH /api/admin/reports/{id}` body optional `{status,priority,information,moderation,duplicate_of:string|null,admin_note}` → Report. Enforce same-project/type duplicates, no self/cycles, reject bug approval. Public duplicates should be hidden when linked; preserve originals and votes without silently transferring votes.

`GET /health/live`, `/health/ready` minimal health, no config. Serve frontend SPA at `/`, `/new?project=campus&type=bug`, `/admin`. Source linking: explicit project wins; otherwise infer only from allowlisted source URL/referrer origin. Context minimized to origin + safe pathname. Do not send location query/fragment. Backend repeats sanitization.
