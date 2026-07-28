# CostFlow — White-Box QA Audit

**Status: DONE** — H-1, M-1, L-1, L-4 fixed and verified (tests + live). L-2, L-3, and the
Subscription Entitlement Audit (E-1..E-8) are genuine findings but out of scope for this
pass (JWT/JWKS verification, a file-split refactor, and a full billing/entitlement layer,
respectively) — left as backlog, not attempted, so as not to ship a half-built billing
system. See status lines under each.

Date: 2026-07-27
Scope: full repository (`apps/web`, `apps/cli`, `packages/*`), with emphasis on the
recently-changed navigation (`apps/web/src/html.ts`, commits "Fix nav" / "Update").
Method: architecture mapping, full static review of the security-critical modules,
empirical verification of suspected issues in Node, and a live smoke test of the running
server (dev/memory mode) including logged-out and logged-in navigation.

---

## Architecture Overview

CostFlow is a pnpm monorepo (Node >= 20, TypeScript, ESM). It converts organizational
"friction" (delays, rework, blocked work) imported from Jira/ClickUp/CSV into ranged cost
estimates, and renders explainable reports.

- **Pure domain packages** (`packages/*`): `domain` (canonical model), `ingestion`,
  `analysis` (detectors/signals), `cost-engine` (money math + formatting), `reporting`
  (builds the report model and its markdown), `friction`, `telemetry`. These hold no I/O
  and no crypto by design (dependency-cruiser enforces the boundaries).
- **`apps/cli`**: the batch pipeline (`costflow analyze ...`) used for golden tests and
  partner runs.
- **`apps/web`**: a **server-rendered Fastify 5 app** — no SPA, no client JS at all. Key
  modules:
  - `main.ts` — boot, graceful SIGTERM drain, store selection.
  - `config.ts` — strict startup validation (production refuses dev auth, memory store,
    non-https, missing keys).
  - `auth.ts` — Auth0 OIDC authorization-code flow + a dev email-only mode; signed
    session cookie `{userId, tenantId, csrf, exp}`.
  - `crypto.ts` — AES-256-GCM secret encryption, HMAC-signed sessions, constant-time MAC.
  - `security.ts` — CSP/security headers, health/readiness probes, redacted request log,
    branded error/404 handlers.
  - `server.ts` — **2901-line** file holding essentially every route (onboarding,
    dashboard, runs, reports, org/member management, settings, and the cross-tenant admin
    console).
  - `html.ts` / `landing.ts` / `marketing.ts` — the inline design system and marketing
    pages.
  - `store/` — a `Store` contract with two implementations: `PgStore` (Postgres, `pg`
    pool, `schema.sql` migrations) and `MemoryStore`; a shared contract test suite.
  - `connectors/` — Jira and ClickUp gateways behind a registry (ADR-0005).
- **Data layer**: Postgres in production, in-memory for throwaway demos. All tenant data
  queries are parameterized and scoped by `tenant_id`.
- **Rendering**: reports have two paths — a **structured** HTML builder
  (`report-view.ts`, HTML-escapes everything) and a **markdown fallback** that runs the
  stored `report.md` through `marked` (this is where the main finding below lives).

Overall the codebase is unusually disciplined: no `TODO`/`FIXME`/`@ts-ignore`/
`eslint-disable` anywhere in app/package source, no hardcoded secrets, current dependency
versions (fastify ^5.2, marked ^15, pg ^8.13 — none known-vulnerable), a strict CSP with
`script-src 'none'`, complete CSRF coverage, robust multi-tenancy scoping, and careful
crypto. The findings below are therefore mostly edge cases and one genuine injection gap,
not systemic problems.

---

## Findings (most severe first)

### HIGH

#### H-1 · Stored HTML injection in the raw/fallback report renderer
> **Status: FIXED.** Reporting's `esc()` stayed markdown-only (it's shared with the CLI's
> plain-markdown output — HTML-escaping it there broke golden-file tests). Instead added
> `renderReportMdSafely()` in [server.ts](apps/web/src/server.ts), which HTML-escapes
> `&`/`<`/`>` immediately before every `marked.parse(reportMd)` call (raw, print, and the
> structured-report fallback branch) — the one boundary where markdown actually becomes
> HTML. Verified: `<img src=x onerror=...>` now renders as literal text; full test suite
> (441 tests) passes.
- **Category**: security (XSS / HTML injection)
- **Files / lines**:
  - `packages/reporting/src/markdown.ts:23-31` — the `esc()` used to build the report
    markdown.
  - `apps/web/src/server.ts:2400` (`GET /reports/:runId/raw`), and the fallback branches
    `apps/web/src/server.ts:2384` (`GET /reports/:runId`) and
    `apps/web/src/server.ts:2421` (`GET /reports/:runId/print`), all of which do
    `marked.parse(loaded.record.reportMd)`.
- **Description**: The report markdown embeds user-controlled work-item titles (e.g.
  `packages/reporting/src/markdown.ts:206,217,230` — `esc(evidence?.title ?? '')`) and
  other imported strings. That `esc()` escapes only **markdown** metacharacters
  (`\`, `|`, `` ` ``, `[`, `]`, newlines) — it does **not** escape HTML
  (`<`, `>`, `&`, `"`). The stored markdown is then rendered by `marked.parse()`, which
  passes inline HTML through untouched. I verified this empirically:

  ```
  marked.parse('Report title: <img src=x onerror=alert(1)> and <b>bold</b>')
  => "<p>Report title: <img src=x onerror=alert(1)> and <b>bold</b></p>"
  ```

  So a Jira/ClickUp issue titled `<img src=x onerror=...>` (or any HTML) is rendered as
  live markup on the `/reports/:runId/raw` page (always) and on the structured report/
  print pages when the run JSON fails to parse (the `catch` fallback).
- **Root cause**: two different `esc()` functions with different contracts. The structured
  path (`apps/web/src/report-view.ts`, which imports the HTML-escaping `esc` from
  `html.ts`) is safe; the markdown path relies on `reporting`'s markdown-only `esc()` and
  then hands the result to an HTML renderer that does not sanitize. The escaping guarantee
  the structured path carefully maintains is silently dropped on the `/raw` path.
- **Impact**: Stored injection of third-party-controlled data. **Script execution is
  currently blocked** by the strict CSP (`default-src 'none'; script-src 'none'`), which
  is why this is High rather than Critical — but it is still exploitable as content
  injection / defacement / phishing markup, and `img-src 'self' data:` plus
  `style-src 'unsafe-inline'` allow `<img src=data:...>` and inline-styled elements. The
  moment the CSP is relaxed (or bypassed on any single page) this becomes full stored XSS.
  In a multi-user tenant, one member can inject markup that an owner sees when viewing the
  report.
- **Suggested fix**: HTML-escape at the boundary. Cleanest: make `reporting`'s `esc()`
  also HTML-escape (`&`, `<`, `>`, `"`) so the stored markdown is HTML-safe regardless of
  renderer. Alternatively, sanitize `marked` output server-side (e.g. run through a
  sanitizer / an allowlist renderer) before sending, or drop the `/raw` route and always
  render via the structured, HTML-escaping path. Keep the CSP as defense-in-depth, but do
  not let it be the only thing standing between a ticket title and the DOM.

---

### MEDIUM

#### M-1 · Logged-in header nav is mis-aligned (regression from the uncommitted "Fix nav" edit)
> **Status: FIXED.** Added a `.nb-row--app` modifier (applied only when logged in) that
> keeps `.nb-col-r` at `flex-end` for the authenticated header, while the logged-out
> marketing header keeps the new symmetric hug-the-logo layout. Verified live: signed-in
> "Home / Runs / Sign out" is back in the top-right corner.
- **Category**: UX / bug (visual regression)
- **File / lines**: `apps/web/src/html.ts:121-122` (the uncommitted change), with the
  header markup at `apps/web/src/html.ts:469-478`.
- **Description**: The working-tree change flips the nav column alignment to
  `.nb-col-l{justify-content:flex-end}` and `.nb-col-r{justify-content:flex-start}` so
  both side columns "hug the logo". This looks correct for **logged-out** pages (verified
  live: Pricing/Docs/Sample on the left, About/Blog/Sign-in/Get-started on the right,
  symmetric around the centered logo). But the **logged-in** header renders no
  `.nb-left`/`.nb-right` content (see `html.ts:472,476` — those navs are gated on
  `loggedOut`); the only content in the right column is the `.nb-auth` cluster
  (Home / Runs / Sign out). With `justify-content:flex-start` that cluster now hugs the
  **center** (immediately right of the logo) and leaves a large empty gap at the far
  right. Verified live after signing in: "Home Runs Sign out" floats center-right with
  dead space to the right edge, instead of sitting in the top-right corner.
- **Root cause**: the grid is `1fr auto 1fr`; the "both columns hug the logo" idea assumes
  both side columns carry links. For a signed-in user the left column is empty, so
  centering the right column has no left-column counterweight — the symmetry the change
  was designed around does not exist on authenticated pages.
- **Impact**: Every authenticated page renders a visibly unbalanced header. Cosmetic (no
  functional break, no console errors), but it affects the whole signed-in surface.
- **Suggested fix**: Apply the "hug the logo" alignment only when the side navs are
  present (logged-out). Simplest: keep `.nb-col-r` at `flex-end` for the authenticated
  header (e.g. add a modifier class such as `nb-row--app` toggled on `csrf !== undefined`
  in `renderHeader`, and scope `nb-col-r{justify-content:flex-start}` to the logged-out
  variant), so the auth cluster returns to the top-right corner for signed-in users while
  the marketing header keeps its new symmetric layout.
- **Note**: I specifically checked the memory note about the `clamp()`/`calc()` missing-
  space bug — the nav change contains no such defect; the `clamp()` declarations in
  `html.ts` are well-formed.

---

### LOW

#### L-1 · `/runs` double-submit guard is a non-atomic TOCTOU check
> **Status: FIXED.** Added a partial unique index (`jobs_one_active_per_workspace`, `schema.sql`)
> enforcing at most one queued/running job per workspace, plus a new atomic
> `Store.createJobIfNoneActive()` (implemented in both `pg.ts` — insert + catch
> `23505`/unique-violation — and `memory.ts` — synchronous check-then-set, no `await` in
> between). `/runs` in `server.ts` now calls this instead of the old
> list-then-create race. Full test suite passes.
- **Category**: bug / concurrency
- **Files / lines**: `apps/web/src/server.ts:2213-2217` (check-then-create) and
  `apps/web/src/jobs.ts:81` (`updateJob(..., { status: 'running' })` with no atomic
  claim).
- **Description**: The guard reads the workspace's active jobs, finds none queued/running,
  then creates a job — not atomic. Two near-simultaneous POSTs can both pass the check and
  both enqueue+execute. `executeJob` likewise sets `status='running'` unconditionally
  rather than atomically claiming a `queued` row.
- **Root cause**: read-modify-write across separate statements with no DB-level uniqueness
  or conditional update.
- **Impact**: Low. Run IDs are a content hash that also includes `nowIso`, and fetches are
  read-only against the tracker, so the realistic worst case is duplicated work and two
  near-identical stored runs — not corruption. Still wasteful and can double-hit the
  customer's Jira/ClickUp rate limits.
- **Suggested fix**: Make the claim atomic — e.g. a partial unique index enforcing at most
  one active job per workspace, or claim with
  `UPDATE jobs SET status='running' WHERE id=$1 AND status='queued' RETURNING ...` and
  no-op if no row is returned.

#### L-2 · OIDC callback does not validate the ID token (no nonce, no `email_verified`)
> **Status: Deferred (backlog).** Real fix needs JWKS fetch/cache, signature/`aud`/`iss`/`exp`
> verification, and a per-request nonce threaded through the authorize/callback round-trip —
> a genuine feature addition to `auth.ts`, not a targeted patch. Left unimplemented this pass
> rather than rushed.
- **Category**: security (defense-in-depth) / architecture
- **File / lines**: `apps/web/src/auth.ts:335-452` (`/auth/callback`).
- **Description**: The callback validates the `state` cookie (good CSRF protection), then
  exchanges the code and reads the email from the **userinfo** endpoint. It never
  validates the `id_token` (signature / `aud` / `iss` / `exp`), sends no `nonce` on the
  authorize request, and does not check the `email_verified` claim before provisioning a
  tenant from the email.
- **Root cause**: identity is trusted transitively via the TLS server-to-server token +
  userinfo calls rather than via a verified ID token; email-verification gating is
  delegated to IdP Actions (per the comments) rather than enforced in-app.
- **Impact**: Low in practice for a single trusted Auth0 tenant over TLS, but it means the
  app cannot detect a replayed/forged assertion on its own and will happily create a
  tenant for an unverified email if the IdP ever returns one. Provisioning keys off email,
  so an unverified/spoofable email is an account-takeover primitive if IdP config drifts.
- **Suggested fix**: Verify the `id_token` (JWKS signature, `iss`/`aud`/`exp`, and a
  per-request `nonce`) and require `email_verified === true` before `completeSignIn`.

#### L-3 · `server.ts` is a 2901-line monolith
> **Status: Deferred (backlog).** Maintainability issue, not a runtime defect. Splitting into
> route-domain plugins is a structural refactor of a 127KB file — out of scope for this fix
> pass; flagged for a dedicated refactor.
- **Category**: architecture / maintainability
- **File**: `apps/web/src/server.ts` (127 KB); also `html.ts` (52 KB), `landing.ts`/
  `marketing.ts` (30 KB+ each).
- **Description**: Nearly every route — public marketing, onboarding, runs, reports,
  org/member management, settings, and the cross-tenant admin console — lives in one
  function/file. High cognitive load, hard to test in isolation, and easy to introduce a
  cross-cutting regression (the nav churn in recent commits is a symptom of large,
  tightly-coupled render files).
- **Impact**: No runtime defect; a maintainability/velocity risk.
- **Suggested fix**: Split `server.ts` into route modules by domain (auth already is
  separate; add `admin`, `onboarding`, `reports`, `org`, `marketing`) registered as
  Fastify plugins, and factor the large HTML string builders into per-page modules.

#### L-4 · Stale/contradictory dark-theme comment
> **Status: FIXED.** Corrected the `STYLES` doc comment in [html.ts](apps/web/src/html.ts) to
> state a single light theme, matching actual behavior and the other comments.
- **Category**: documentation / code quality
- **File / line**: `apps/web/src/html.ts:35` (the `STYLES` doc comment claims "a
  light/dark theme via `prefers-color-scheme`").
- **Description**: Lines 4-5 and 63 state the product is intentionally **light-theme
  only** with no auto dark-mode switch, and there is no `@media (prefers-color-scheme:
  dark)` rule anywhere in the stylesheet. The line-35 comment contradicts the actual
  behavior and the other comments.
- **Impact**: Trivial; misleads future maintainers.
- **Suggested fix**: Correct the line-35 comment to match reality (light-theme only).

---

## Areas reviewed and found sound (coverage notes)

These were actively checked and are **not** defects — recorded so the audit's coverage is
clear:

- **CSRF**: synchronizer-token pattern. `session.csrf` is minted at sign-in, stored inside
  the HMAC-signed httpOnly cookie, and every one of the 19 POST routes verifies it
  (`checkCsrf` at 18 sites plus the inline check in `/logout`). Cookies are `SameSite=Lax`
  (or `None`+`Secure` only for the cross-site IdP hop). Solid.
- **SQL injection**: all tenant queries in `store/pg.ts` use bound parameters; the admin
  console's dynamic `ORDER BY`/table/column fragments come exclusively from per-method
  whitelists (`sortMap`) and validated direction, never from user input
  (`store/pg.ts:698-721,751-805`). No injection found.
- **Multi-tenancy**: data queries are scoped by `tenant_id = $1`; unauthenticated hits on
  `/runs`, `/dashboard`, `/settings`, `/org`, `/admin`, `/reports/*` all 302 to `/login`
  (verified live).
- **Admin authz**: `requireAdmin` (`server.ts:728-741`) resolves the DB user and checks
  the email against `COSTFLOW_ADMIN_EMAILS`, returning **404** (not 403) to avoid
  disclosing the admin surface. Sort/filter params are bounded and clamped
  (`server.ts:743-765`).
- **Crypto**: AES-256-GCM for secrets, HMAC-SHA256 signed sessions, `timingSafeEqual` MAC
  comparison, 7-day server-enforced session TTL, 32-byte key validation at boot
  (`crypto.ts`, `auth.ts:89-114`). Sound.
- **SSRF guard** (`connectors/jira.ts:214-256`): rejects non-https, embedded credentials,
  loopback/private/CGNAT/link-local IPv4, non-global IPv6, and internal hostnames. I
  suspected numeric-shorthand bypasses (`https://127.1`, `https://192.168.1`,
  `https://0x7f.1`) but verified empirically that the WHATWG `URL` parser normalizes these
  to canonical dotted-quads **before** the guard reads `url.hostname`, so they are all
  correctly blocked. DNS-rebinding is explicitly documented as out of scope (network
  layer).
- **Security headers / CSP**: strict `default-src 'none'`, `script-src 'none'`,
  `form-action` allowlisted for the IdP logout hop, `frame-ancestors 'none'`, HSTS in
  production, `no-store, private` on authenticated responses (`security.ts:39-102`).
- **Error handling**: global error boundary logs only the error *class* and a redacted
  path, never messages/stacks/bodies/tokens/emails (`security.ts:108-154`); invite tokens
  and UUIDs are redacted from logs (`redactPath`).
- **Public demo `/try`**: seed input is validated to a bounded integer and only feeds a
  PRNG; company name/industry are `esc()`-escaped (`server.ts:547-586`). No injection.
- **Config/boot safety**: production refuses dev auth, memory store, missing DB, non-https
  post-logout URL, and missing/short keys (`config.ts`). Graceful SIGTERM drain and
  interrupted-job recovery on boot (`main.ts`).
- **Secrets & dependencies**: no hardcoded secrets found; dependency versions are current
  with no known-vulnerable pins.
- **Runtime smoke test**: server booted clean in dev/memory mode; `/healthz` 200;
  logged-out landing and logged-in onboarding rendered with **zero console errors** and no
  failed network requests.

---

## Subscription Entitlement Audit

> **Status: Deferred (backlog) — audit only, no fixes attempted.** E-1 through E-8 all
> share one root cause: there is no plan/subscription/entitlement layer in the product at
> all (no `plan` column, no Stripe/billing, tier names referenced by zero enforcement
> code). Building that layer — a schema migration, per-endpoint plan gates, seat metering,
> multi-workspace support, export routes, per-tenant SSO, and a customer-facing audit
> log — is a multi-week feature, not a fix-pass patch. Recorded here as-is for prioritization;
> nothing in this section was changed.

Date: 2026-07-27. Scope: every plan/tier advertised on the `/pricing` page vs. what the
code actually gates or grants.

**Headline: there is no billing, subscription, or entitlement layer in the product at
all.** The `/pricing` page (`apps/web/src/marketing.ts:54-99`) advertises three paid tiers
(Limited $0, Pro $20/user/mo, Enterprise $100/user/mo) with concrete caps and paid
features, but:

- The database schema (`apps/web/src/store/schema.sql`) has **no** `plan`, `tier`,
  `subscription`, `stripe_customer`, `seat`, `run_limit`, or `member_limit` column on any
  table (tenants, users, workspaces, jobs, runs, invitations, workspace_members,
  admin_audit). There is nowhere to store which plan a tenant is on.
- No Stripe / billing integration exists anywhere in `apps`/`packages` (no `stripe`
  dependency, no webhook handler, no checkout route).
- The plan names `Limited` / `Pro` / `Enterprise` appear **only** in the marketing copy
  (`marketing.ts`, `landing.ts`). They are referenced by **zero** enforcement code paths.
  (The single other hit, `demo-live.ts:176 key:'enterprise'`, is an unrelated demo
  work-item label.)

Net effect: every advertised cap is unenforced (all tiers get the "unlimited" behaviour
for free) and several advertised **paid** features are not implemented for anyone.

Mitigating context (does not remove the mismatch, but explains it): other marketing copy
repeatedly frames the product as a **free beta** — `landing.ts:113` ("Try the live demo
for free during beta"), `marketing.ts:575` ("Pricing: free during beta"),
`marketing.ts:636-637` / `landing.ts:229-230` ("The Limited plan is free, permanently…
Upgrade… only when the caps actually get in your way"). So the app may simply not have
built the paywall yet. But the `/pricing` page presents the caps and paid features as
**current, concrete plan limits** with dollar prices and "Start with Pro" CTAs, so the
promised-vs-enforced gap below is real and user-visible.

### Tier × feature × enforcement matrix

Legend — Enforced: gate exists and matches copy. None: advertised but no gate/impl found
(everyone gets it, or nobody does). Arch: enforced by architecture for *all* tiers, not by
plan. N/A: non-code (human/legal) — not gateable.

| Feature (advertised) | Tier | Advertised behaviour | Enforced in code? | Enforcement / gap location | Mismatch |
|---|---|---|---|---|---|
| 1 workspace, 1 tracker | Limited | Max 1 workspace | Arch (all tiers capped at 1) | `server.ts:442-445` `soleWorkspace` → `workspaces[0]` | Caps *every* tier, incl. Pro (see E-4) |
| Up to 3 team members | Limited | Hard cap 3 | **None** | invite handler `server.ts:2785-2811` — no count check | Not enforced (E-1) |
| Up to 3 analysis runs / month | Limited | Hard cap 3/mo | **None** | `POST /runs` `server.ts:2204-2217` — only double-submit guard | Not enforced (E-2) |
| 30-day report history | Limited | Runs pruned after 30d | **None** | no retention/prune; runs append-only `schema.sql:80-90` | Not enforced (E-3) |
| Formula drill-down | Limited | Included | Delivered (all) | `report-view.ts` | Match (base feature) |
| Email support | Limited | Included | N/A | — | Non-code |
| Unlimited runs | Pro | No cap | Trivially true (nobody capped) | — | Not a differentiator (E-2) |
| Unlimited report history | Pro | No cap | Trivially true | — | Not a differentiator (E-3) |
| Unlimited members, per-seat billed | Pro | No cap + per-seat billing | **None** | no member cap + no billing at all | Not implemented (E-1) |
| CSV & raw JSON export on every report | Pro | Export button per report | **None** | no export route exists (`server.ts` has only `/reports/:runId`, `/raw`, `/print`) | Under-delivering, paid (E-5) |
| Multiple workspaces per org | Pro | >1 workspace | **None** | `soleWorkspace` caps all tenants at 1 `server.ts:442-445` | Under-delivering, paid (E-4) |
| Priority email support | Pro | Included | N/A | — | Non-code |
| SSO / SAML for whole org | Enterprise | Per-org SAML | **None** (single global Auth0) | `auth.ts` one shared OIDC flow; no per-tenant SSO config | Under-delivering, paid (E-6) |
| Audit logs across workspaces & members | Enterprise | Customer-facing audit log | **None** | only `admin_audit` = internal ops console `schema.sql:125-136` | Under-delivering, paid (E-7) |
| Signed DPA | Enterprise | Legal doc | N/A | — | Non-code |
| Dedicated support + SLA | Enterprise | Included | N/A | — | Non-code |
| Org-wide role & workspace management | Enterprise | Roles + membership admin | Delivered to **all** tiers | `server.ts:2785,2824-2872,2873` (invites, role changes, membership) | Over-delivering (E-8) |

### Findings

#### E-1 · "Up to 3 team members" (Limited) is not enforced — no member cap on any tier
- **Advertised (exact)**: `'Up to 3 team members'` (Limited) — `marketing.ts:61`. Pro
  advertises `'Unlimited team members (billed per active seat)'` — `marketing.ts:77`.
- **Expected**: a Limited tenant cannot have more than 3 users/pending invites; Pro is
  billed $20 per active seat/month.
- **Actual**: `POST /org/invitations` (`server.ts:2785-2811`) validates email format, role,
  and duplicate membership only — there is **no** count of existing members/invites and no
  plan lookup. A Limited tenant can invite unlimited members for free. There is no seat
  metering anywhere, so Pro's "billed per active seat" is also not implemented.
- **Mismatch type**: not enforced (over-delivering to Limited) + paid feature unbuilt (Pro
  seat billing).
- **Severity**: High (core monetization: the seat count is the Pro revenue model).
- **Fix**: add a `plan` column to `tenants`; in the invite handler count
  `listUsers + pending invitations` and reject when a Limited tenant would exceed 3; meter
  active seats for Pro billing.

#### E-2 · "Up to 3 analysis runs per month" (Limited) is not enforced
- **Advertised (exact)**: `'Up to 3 analysis runs per month'` (Limited) — `marketing.ts:62`;
  Pro: `'Unlimited analysis runs'` — `marketing.ts:75`.
- **Expected**: a Limited tenant's 4th run in a calendar month is blocked/upsold.
- **Actual**: `POST /runs` (`server.ts:2204-2217`) has only the double-submit guard (an
  active job short-circuits to that job). There is no monthly count of `runs`, no plan
  check, no cap. Every tenant gets unlimited runs. "Unlimited runs" is therefore not a Pro
  differentiator — Limited already has it.
- **Mismatch type**: not enforced (over-delivering to Limited; Pro benefit is illusory).
- **Severity**: High (primary usage cap that's supposed to drive Limited→Pro upgrades).
- **Fix**: before `createJob`, count `runs` for the tenant in the current month; if the
  tenant is Limited and count ≥ 3, block with an upgrade prompt.

#### E-3 · "30-day report history" (Limited) is not enforced — history is unlimited for all
- **Advertised (exact)**: `'30-day report history'` (Limited) — `marketing.ts:63`; Pro:
  `'Unlimited report history'` — `marketing.ts:76`.
- **Expected**: Limited tenants can only view reports from the last 30 days.
- **Actual**: runs are append-only and never pruned (`schema.sql:3-4,80-90`); `listRuns`
  (`server.ts:1405`) returns all runs with no date window or plan filter. Every tenant
  keeps full history forever, so Pro's "unlimited history" is not a differentiator.
- **Mismatch type**: not enforced (over-delivering to Limited).
- **Severity**: Medium.
- **Fix**: filter `listRuns` / report fetch by `created_at >= now() - 30d` for Limited
  tenants (retain rows for upgrade, just hide/deny access beyond the window).

#### E-4 · "Multiple workspaces per organization" (Pro) is not implemented for anyone
- **Advertised (exact)**: `'Multiple workspaces per organization'` (Pro) — `marketing.ts:79`.
- **Expected**: a Pro org can create more than one workspace/tracker connection.
- **Actual**: the app is architecturally single-workspace. `soleWorkspace`
  (`server.ts:442-445`) returns `workspaces[0]`, and the connect flow
  (`server.ts:1601-1629`) **updates the existing sole workspace** (or platform-switches it)
  instead of creating a second one — `createWorkspace` is only reached when none exists.
  Dashboard, runs, reports, scope, and assumptions all resolve via `soleWorkspace`
  (`server.ts:462,503,1525`). A paying Pro customer gets exactly one workspace, same as
  Limited.
- **Mismatch type**: under-delivering (advertised paid feature not delivered).
- **Severity**: High (user pays $20/seat/mo for capability the code cannot provide).
- **Fix**: either build real multi-workspace support (workspace selector, per-workspace
  scoping already exists in the schema) gated to Pro+, or remove the bullet from the
  pricing copy until it ships.

#### E-5 · "CSV and raw JSON export on every report" (Pro) is not implemented for anyone
- **Advertised (exact)**: `'CSV and raw JSON export on every report'` (Pro) —
  `marketing.ts:78`.
- **Expected**: an export/download control on each report producing CSV and JSON.
- **Actual**: no export route or download exists. The only report routes are
  `GET /reports/:runId` (structured HTML, `server.ts:2367`), `/raw` (markdown→HTML,
  `server.ts:2394`), and `/print` (HTML, `server.ts:2408`). A codebase-wide search for
  `content-disposition` / `attachment` / `text/csv` / `.csv` / export returns nothing. The
  underlying `run_json` is stored (`schema.sql:85`) but never offered for download.
- **Mismatch type**: under-delivering (advertised paid feature not delivered).
- **Severity**: High (user pays for a feature that does not exist).
- **Fix**: add gated `GET /reports/:runId/export.json` and `.csv` routes (Pro+) with
  `Content-Disposition: attachment`; the JSON is already the stored `run_json`.

#### E-6 · "SSO / SAML sign-in for your whole org" (Enterprise) is not differentiated
- **Advertised (exact)**: `'SSO / SAML sign-in for your whole org'` (Enterprise) —
  `marketing.ts:91`.
- **Expected**: an Enterprise org configures its own IdP (SAML/OIDC connection) for its
  members.
- **Actual**: there is a single, global Auth0 OIDC flow shared by all tenants (`auth.ts`),
  plus a dev email-only mode. There is no per-tenant/per-org SSO configuration, no place to
  store an org's IdP, and no plan gate. Enterprise buyers get the same shared sign-in as
  everyone else.
- **Mismatch type**: under-delivering / not enforced (advertised paid feature not
  implemented as an org entitlement).
- **Severity**: Medium-High (common enterprise procurement blocker; sold but absent).
- **Fix**: implement per-tenant SSO connection config gated to Enterprise, or reword the
  bullet to reflect the single shared IdP.

#### E-7 · "Audit logs across workspaces and members" (Enterprise) is not implemented
- **Advertised (exact)**: `'Audit logs across workspaces and members'` (Enterprise) —
  `marketing.ts:92`.
- **Expected**: a customer-facing audit log of member/workspace actions inside their org.
- **Actual**: the only audit table is `admin_audit` (`schema.sql:119-136`), which by its
  own comment is the **internal cross-tenant operations console** trail written by
  allowlisted CostFlow admins (`admin-view.ts:28` "Audit log" is under `/admin`, gated by
  `requireAdmin`). There is no tenant-scoped audit log surfaced to customers of any tier.
- **Mismatch type**: under-delivering (advertised paid feature not delivered).
- **Severity**: Medium-High.
- **Fix**: add a tenant-scoped `org_audit` table + `/org/audit` view gated to Enterprise;
  do not repurpose the internal `admin_audit` (different trust boundary).

#### E-8 · "Org-wide role and workspace management" (Enterprise) is free to every tier
- **Advertised (exact)**: `'Org-wide role and workspace management'` (Enterprise) —
  `marketing.ts:95` (listed under "Everything in Pro, plus:").
- **Expected**: role/workspace administration is an Enterprise-only capability.
- **Actual**: full role and membership management is available to **all** tenants with no
  plan gate: invite members (`server.ts:2785`), change roles owner/admin/member
  (`server.ts:2824-2849`), remove members (`server.ts:2851`), and add/remove workspace
  members (`server.ts:2873-2895`). The role model (`schema.sql:31`, `workspace_members`
  table) applies to everyone. A free Limited tenant already gets what Enterprise lists as a
  differentiator.
- **Mismatch type**: over-delivering (advertised as Enterprise-only, granted to all tiers).
- **Severity**: Medium (dilutes Enterprise value; revenue leak in the opposite direction).
- **Fix**: if this is meant to be Enterprise-only, gate the org-management routes by plan;
  otherwise remove/soften the bullet since it is table-stakes for all tiers.

### Entitlement audit summary

- **Advertised paid features not implemented for anyone (under-delivering)**: 3 — E-4
  (multiple workspaces), E-5 (CSV/JSON export), E-7 (customer audit logs); plus E-6 (SSO)
  as not-differentiated. These are the highest-severity: users are invited to pay for
  capabilities the code cannot provide.
- **Advertised caps not enforced (over-delivering / no upgrade pressure)**: 3 — E-1 (3
  members), E-2 (3 runs/mo), E-3 (30-day history). Every "unlimited" Pro benefit is
  therefore illusory because Limited is already unlimited.
- **Advertised-as-higher-tier but free to all (over-delivering)**: 1 — E-8 (org role/
  workspace management).
- **Root cause (single, shared)**: no plan/subscription/entitlement layer exists — no plan
  column (`schema.sql`), no Stripe/billing, and the tier names are referenced by zero
  enforcement code. Client-side vs server-side is moot: there is no entitlement check on
  *either* side.
- **Not defects (non-code)**: email/priority/dedicated support, signed DPA, SLA — human/
  legal deliverables, correctly out of code scope.

No changes were made — audit only.

---

## Summary

**Total findings: 6** (0 critical, 1 high, 1 medium, 4 low) in the general QA pass, plus
**8 subscription-entitlement mismatches** documented separately in the Subscription
Entitlement Audit section above (root cause: no billing/entitlement layer exists).

By severity:
| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0     | —   |
| High     | 1     | H-1 |
| Medium   | 1     | M-1 |
| Low      | 4     | L-1, L-2, L-3, L-4 |

By category:
| Category                     | Count | IDs |
|------------------------------|-------|-----|
| Security                     | 2     | H-1, L-2 |
| Bug / concurrency            | 1     | L-1 |
| UX / visual regression       | 1     | M-1 |
| Architecture / maintainability | 1   | L-3 |
| Documentation / code quality | 1     | L-4 |

**Top 3 to address first:**
1. **H-1** — HTML-escape report content before it reaches `marked` so the `/reports/:runId/raw`
   path stops rendering work-item titles as raw HTML (currently only the CSP prevents this
   from being full stored XSS).
2. **M-1** — Fix the logged-in header alignment introduced by the uncommitted `html.ts`
   nav change: restore the auth cluster to the top-right for signed-in users while keeping
   the new symmetric marketing header.
3. **L-1** — Make the `/runs` job-claim atomic to close the double-submit race.

The application is otherwise well-architected and security-conscious; no critical issues
were found.
