# CostFlow — The Engineering Bible

> **Read this first. If you read nothing else, read §0, §3 (Invariants), and §16 (Dangerous to change).**
>
> This is the single authoritative onboarding document for CostFlow. It is written so a
> world-class engineer can take over with zero verbal handoff. It summarizes the whole system
> and points to the deep docs (`docs/00`–`docs/17`, `docs/adr/*`) for detail. When this file and
> a deep doc disagree, **the code is the source of truth**; fix whichever doc is stale.

---

## 0. What CostFlow is, in one screen

CostFlow is a **Business Friction Intelligence** product. It connects to a work-tracking system
(Jira and ClickUp today), reads the work items and their history, detects **friction** (delays, queues,
overdue work), and prices that friction into an **itemized, ranked dollar estimate** — where every
figure is traceable to its formula, inputs, and assumptions.

- **Deployed at:** `https://app.fbx1.com` (Railway). "Powered by FBX1."
- **Stage:** free public beta. No billing. No email sending yet.
- **Shape:** server-rendered (SSR) Fastify app, **no client JavaScript** (strict CSP
  `script-src 'none'`), pure-CSS UI, a deterministic analysis engine, PostgreSQL persistence,
  Auth0 (OIDC) authentication.
- **Non-negotiable product promises** (these drive the architecture):
  1. **Every number is traceable** — claim → formula → exact work items → assumptions + provenance.
  2. **Honest by construction** — an unconfirmed (vendor-suggested) assumption is left *unpriced*,
     never guessed.
  3. **People are never scored** — cost is attributed to processes/stages/roles, never to a named
     individual. Identities are pseudonymized before analysis, and a response-layer guard blocks any
     leak (ADR-0002).
  4. **Your data, your control** — credentials encrypted at rest; permanent, cascading deletion any
     time (ADR-0003).
  5. **Determinism** — same inputs ⇒ byte-identical outputs, forever (golden tests).

---

## 1. Repository map (monorepo, pnpm workspaces, TypeScript strict, no build step)

```
packages/                 PURE domain logic. No I/O, no node builtins, deterministic.
  domain/                 Types + primitives: WorkItem, Stage, StageKind, IsoDateString,
                          Money decimal, pseudonymization context. Depends on NOTHING internal.
  friction/               Friction detectors operate on canonical work items/events. domain only.
  cost-engine/            Money math (decimal), rates, ranges, confidence, cost estimates + traces.
                          domain + friction types only. (ADR-0001: decimal arithmetic.)
  ingestion/              Provider SPI + transforms: raw provider JSON → canonical ImportBatch.
                          Jira/ClickUp/Monday/Asana/CSV live under providers/. domain only.
  analysis/              Orchestrates ingestion→friction→cost-engine into the immutable AnalysisRun
                          (run.json). domain + friction + cost-engine + ingestion.
  reporting/             Deterministic report model + markdown. domain + analysis + cost-engine.
  telemetry/             DERIVES privacy-safe events from the immutable run artifact ONLY.
                          domain + analysis. Nothing (except apps) may import telemetry.
apps/
  cli/                    `costflow` CLI: preflight, analyze, golden generation.
  web/                    The Fastify SSR app (all customer-facing product). Impure edge.
                          src/connectors/ = the platform layer (ADR-0005): one module per
                          provider (gateway + descriptor + adapters) behind a static registry;
                          provider names may not appear anywhere else in the app (depcruise).
tools/
  golden/                 Frozen fixtures + expected/ outputs. The determinism contract.
  partner/                Partner-run tooling (gitignored outputs under partner-runs/).
docs/                     00–17 numbered design docs + adr/ (see §17). THIS file = BIBLE.md.
```

**The dependency rule (enforced by `pnpm depcruise`, `error` severity):** dependencies point only
*inward* toward `domain`. A package may import only the packages named in its dependency-cruiser
rule (see `.dependency-cruiser.cjs`). `packages/` may **never** import `apps/`. Pure packages may
**never** import a node builtin (that's how we prove they do no I/O). Provider names must not leak
outside `ingestion/`. **If you add a package, add its boundary rule.**

---

## 2. Architecture & data flow (end to end)

```
Browser ──HTTPS──> Railway edge (TLS) ──> Fastify (apps/web, SSR, no client JS)
                                              │
   Auth0 (OIDC) ◄── /login,/signup,/auth/callback ──► session cookie (HMAC-signed)
                                              │
   Provider APIs  ◄── connector gateways ────┤ (Jira, ClickUp; read-only tokens, AES-256-GCM at rest)
                                              │
                                       ┌──────┴───────┐
                                       │  Job runner  │  (apps/web/jobs.ts) — async analysis
                                       └──────┬───────┘
                                              │ calls the PURE engine:
        ingestion (raw JSON → ImportBatch) → friction (detect) → cost-engine (price)
                                              │ = analysis.AnalysisRun  (the run.json artifact)
                                              ▼
                                   PostgreSQL (runs, jobs, workspaces, users, …)
                                              │
   report-view / reporting  ◄── render run.json (never re-derived) ──► SSR HTML
   telemetry (derive events from run.json)  ─────────────────────────► funnel stats
```

**Golden rule of the data flow:** the **pure engine is a pure function** `inputs → AnalysisRun`.
The web app is the only impure layer (HTTP, DB, Jira, Auth0, clock, crypto). Rendering **never
recomputes a number** — it displays the immutable `run.json` through the engine's single sanctioned
money formatter. This is why the report can never disagree with the golden tests.

### The customer journey (onboarding state machine)

`OnboardingState` (in `store/contract.ts`) is a strict linear ladder; `onboardingRank()` orders it:

```
connected → scope-selected → statuses-mapped → actors-mapped → assumptions-set → ready
```

Route → step mapping (all in `apps/web/src/server.ts`):
`/connect` (provider picker → creds; fields/copy come from the connector descriptor) →
`/scope` (a Jira project / a ClickUp List) → `/mapping/statuses` → `/mapping/actors` (roles, optional)
→ `/assumptions` → `/dashboard` → POST `/runs` (kick job) → `/jobs/:id` (loading, meta-refresh) →
`/reports/:id`. `requireStep(minimum)` gates each route; a user below the minimum is redirected to
the right next step. `/` routes a returning manager to `nextStepPath(workspace)`.

---

## 3. Invariants — the load-bearing truths (violating these breaks the product)

1. **Determinism / frozen engine.** The pure packages + CLI + golden pipeline produce
   **byte-identical** `run.json`, `report.md`, and `telemetry.jsonl` to `tools/golden/expected/`.
   `pnpm test` fails on any drift. **Never** "fix" a number by editing the engine without
   regenerating goldens *deliberately* (`pnpm golden:update`) and understanding why every byte moved.
2. **All money is decimal, never float** (ADR-0001). Arithmetic goes through `cost-engine`'s decimal
   (`dec()`, `addRanges`, `rangeFromSpec`, `compareDecimalStrings`, `formatWholeMoney`). A raw JS
   number in a money path is a bug. Note: relative-magnitude *bar widths* in the report are the one
   sanctioned float — they are CSS percentages, never rendered as a figure.
3. **Attribution guard is a hard choke point** (ADR-0002). `findIndividualAttribution` scans the
   fully-rendered report bytes against the workspace's observed actor names; if any raw identity
   survived, the **entire response is withheld** (500 + "report withheld"), and only a sanitized
   log line is emitted. Pseudonymization happens at ingestion; this is defense-in-depth at the edge.
4. **Nothing prices a vendor-suggested assumption.** Provenance has four states:
   `vendor-suggested` (unconfirmed) | `customer-accepted` | `customer-customized` | `customer-measured`.
   In report mode, a friction whose binding assumption is still `vendor-suggested` is listed as
   **unpriced** with the missing input named. Simulation mode (CLI/analysis only) may price them, but
   the report banners it as conditional and never suitable for executive use.
5. **Tenant isolation is by construction.** Every store read is tenant-scoped
   (`getRun(tenantId, runId)`, etc.). There is no unscoped "get by id." A foreign id returns
   `null` → 404. Do not add an unscoped store method.
6. **Every mapping is user-approved.** Status→stage suggestions are *form defaults only*; nothing is
   stored until the user submits. History through an **unmapped** status makes the analysis **refuse**
   (hard error), never silently drop (J3). Import truncation is a hard error, never silent (J2).
7. **Migrations run in a separate pre-deploy phase, never chained with start.** See §9. Chaining
   `migrate && start` froze production once (the migrate process blocks; healthcheck times out).
8. **CSP is `script-src 'none'`.** There is no client JS and there must not be. All interactivity is
   HTML/CSS/SSR. Adding a script tag breaks the CSP and the security posture; don't.
9. **Provider names never leak past the connector boundary** (ADR-0005). In the engine, provider
   code lives only under `ingestion/providers/<id>/`; in the web app, only under
   `apps/web/src/connectors/` (+ the composition root and the Jira-shaped demo generator). Both are
   dependency-cruiser `error` rules. The job runner dispatches on `workspace.provider` through the
   registry exactly once; everything downstream sees only the canonical model.

---

## 4. The engine (pure packages) — how a dollar figure is produced

Deep docs: `docs/02` (domain), `docs/03` (cost engine), `docs/07` (decision engine),
`docs/12`–`docs/14` (detectors, prioritization, signal taxonomy).

1. **Ingest** (`ingestion`): raw provider JSON → canonical `ImportBatch` = work items + a strictly
   **ordered, validated event stream** + a `capability` descriptor (does the source have event
   history? due dates? last-updated? actors?) + import diagnostics. Jira specifics (`providers/jira/
   transform.ts`): J1 initial-status interval derived from `created` + first transition; J2 history
   truncation = hard error; J3 transition through an unmapped status = hard error.
2. **Stages** (`domain`): every status maps to a `StageKind` ∈
   `queue | active | review | blocked | done | abandoned`. `TERMINAL_STAGE_KINDS` = done/abandoned.
3. **Detect friction** (`friction`): pure detectors over items/events. Current signals:
   - **aging** — items sitting untouched beyond `agingThresholdDays`.
   - **queue-wait** — time spent in queue stages (visits, wait days, open-now).
   - **overdue** — exposure past `duedate`.
   Each detector *skips* cleanly (with a stated reason) when the source capability can't support it —
   nothing is invented from missing data.
4. **Price** (`cost-engine`): each friction instance → a `CostEstimate` with a **trace**:
   `claim`, `formula` (string), per-item `terms` (the itemized breakdown), `assumptionsUsed`
   (+ provenance), and a **confidence tier** A/B/C with reasons. Cost is a **range**
   `{low, expected, high}` in the workspace currency. Rates come from the role rate card or the
   default rate; unmapped people are pseudonymized and priced at the default with reduced confidence.
5. **Assemble** (`analysis`): the `AnalysisRun` (`run.json`) — the immutable artifact. Contains the
   batch, detectors' status, priced + unpriced frictions, context signals, assumptions, currency,
   `pricingPolicy` (report|simulation), and the analysis timestamp (`now`).
6. **Report** (`reporting` + `apps/web/report-view.ts`): `buildReportModel(run)` ranks priced
   frictions by expected cost and partitions unpriced; the web renders that model. **Never re-derives.**

**Confidence tiers:** A = fully observed data + customer-confirmed assumptions; B/C = progressively
more inference or missing inputs. Each drill-down states the binding reason.

---

## 5. Frontend (SSR, pure CSS) — `apps/web/src/html.ts`, `landing.ts`, `report-view.ts`

- **One design system** lives in `layout()`'s inline `<style>` in `html.ts`: CSS custom properties,
  fluid type scale (system font stack — no external fonts, CSP-blocked), buttons/forms/cards/tables/
  badges, a stepper, light/dark via `prefers-color-scheme`. Every authenticated + public page routes
  through `layout(title, body, csrf?, {bleed?})`.
- **Landing** (`landing.ts`) is product-led: a faux CostFlow app-window mockup built from the real
  report UI, glass/glow/gradients, CSS-only motion (`prefers-reduced-motion` respected). Its heavy
  CSS is scoped to a `<style>` in the landing body so app pages stay lean.
- **Report view** (`report-view.ts`): executive hero (expected total big, range demoted), ranked
  friction cards with relative-magnitude bars, drill-downs, coverage chips, run-over-run trend.
  **Drill-down tables are capped at 50 rows** (top by subtotal) with a "+N more" note — this bounds
  report HTML to ~126KB regardless of project size (see §12). Full breakdown stays in the raw export.
- **States are all styled and consistent:** empty (`.empty`), loading (`loadingPage()` — branded,
  `<meta refresh>` since no JS), error/alert (`.error role=alert`), success (`.info role=status`),
  404 (`setNotFoundHandler`), 500 (global error boundary). Onboarding uses `stepsNav()` with
  `aria-current="step"`. Skip-link + single `<main id="main">` for keyboard/AT.
- **Accessibility posture:** labels on every field, visible focus rings, AA contrast on body/
  secondary/links/badges. Known AA-Large-only: `--faint` fine print and the gradient button's
  fuchsia end — **frozen brand tokens, documented not overridden** (§13).

---

## 6. Backend (`apps/web/src/server.ts` and friends)

- **Framework:** Fastify. `buildServer(deps: ServerDeps)` assembles routes; `main.ts` wires real
  deps (the connector registry over `HttpJiraGateway`/`HttpClickUpGateway`, Postgres store, file
  telemetry sink) from `loadConfig(env)`.
- **`ServerDeps`** (injectable seam — this is why tests drive the *real* server in-process):
  `store, connectors, auth, telemetry, jobNowFn?, awaitJobs?, production?, trustProxy?, logSink?,
  adminEmails?, maxIssues?`. `connectors` is the ADR-0005 registry; tests wire stub gateways into
  real connectors (`helpers.ts stubConnectors`).
- **Job runner** (`jobs.ts`): POST `/runs` creates a job, runs `executeJob` (fetch → engine →
  persist run) **asynchronously** (production) so the request returns immediately to a loading page;
  tests pass `awaitJobs:true`. On boot, `markInterruptedJobs` fails any job left `running` by a crash.
- **Reliability ceiling:** `maxIssues` (default **50,000**, env `COSTFLOW_MAX_ISSUES`) is enforced at
  `/scope` *before* the memory-heavy analysis — a project above it gets a clear 400. This prevents a
  single large tenant from OOM-ing the shared process (§12).
- **Security choke points:** `checkCsrf` (per-session token on every mutating POST), `requireSession`,
  `requireStep`, `managerPath`/`isManager` (role gating), the attribution guard, sanitized structured
  logging (`logLine` + `redactPath` collapses invite tokens/UUIDs; never logs tokens/emails/titles).

---

## 7. Database (PostgreSQL) — the store contract

The **`Store` interface** (`apps/web/src/store/contract.ts`) is the whole persistence API. Two
implementations, **contract-tested identically**: `MemoryStore` (tests/dev) and `PgStore` (prod).
Every method is tenant-scoped. Record types: `TenantRecord`, `UserRecord` (role owner/admin/member),
`InvitationRecord`, `WorkspaceRecord` (provider id + `connectionParams` jsonb + one encrypted
secret, scopeId/scopeName on the legacy project_key/project_name columns, observed
statuses/actors, statusHints, statusMap, actorRoleMap, assumptions, onboarding), `JobRecord` (status queued/running/succeeded/failed +
errorClass), `RunRecord` (**`runJson`, `reportMd`, `telemetryJsonl`** blobs + viewed marker).

Notable methods: `deleteWorkspace` / `deleteTenantData` return a `DeletionSummary` and **cascade**
transactionally (ADR-0003); `markRunViewed` (first-view telemetry); `funnelStats` (aggregate
distinct-tenant counts for `/admin`); `markInterruptedJobs` (crash recovery); `ping` (readiness).

**Migrations:** `apps/web/src/migrate.ts`, run via `pnpm --filter @costflow/web migrate`. It calls
`main().then(()=>process.exit(0)).catch(()=>process.exit(1))` — the explicit exit is what lets the
Railway pre-deploy phase terminate (see §9, invariant 7). Schema is created/evolved here.

**Blob caveat:** `run.json` scales with issue count (~33MB @ 20k, ~80MB @ 50k issues). This is the
main DB-size pressure. The `maxIssues` ceiling bounds it. See §12/§14.

---

## 8. Authentication (Auth0 / OIDC) — `apps/web/src/auth.ts`

- **Modes:** `COSTFLOW_AUTH=oidc` (production, managed Auth0) or `dev` (email-only, **refused in
  production**). `registerAuthRoutes(app, config, store, onSignIn, log, onInviteAccepted?)`.
- **Flow (authorization code):** `/login` and `/signup` both call `beginAuth` → set a signed
  `cf_oidc_state` cookie → redirect to Auth0 `/authorize` (scope `openid email`). **`/signup` adds
  `screen_hint=signup`** so first-time visitors land on the registration screen. `/auth/callback`
  validates state, exchanges the code, fetches userinfo, provisions/loads the tenant, sets the
  session. RP-initiated logout via `/oidc/logout`.
- **Cookie SameSite is load-bearing:** `cf_oidc_state` and `cf_invite` must be **`SameSite=None;
  Secure`** in production — a `Lax` cookie is dropped on the cross-site IdP callback and yields the
  "Invalid sign-in state" bug. In dev (no TLS) they fall back to `Lax`.
- **Sessions:** HMAC-signed cookie (`crypto.ts` `signValue`/`verifyValue`), carries `{tenantId,
  userId, csrf, …}`. Tampering breaks the signature → treated as no session → redirect to `/login`.
- **The Auth0 tenant is configured in the Auth0 dashboard, not in code.** A leftover post-login
  "allowlist" Action once denied all public signups (`access_denied`); public signup requires **no**
  denying Action in Auth0 → Actions → Triggers → Login/Pre-User-Registration. Branding (logo, page
  title) is in the Auth0 dashboard; the logo is served by us at `/brand/logo.svg`.

---

## 9. Deployment (Railway) — `railway.json`, `Dockerfile`

- **Build:** Dockerfile (`node:22-slim`, `pnpm install --frozen-lockfile --prod=false`, no build step
  — `tsx` runs TS directly). `EXPOSE 3000`. `CMD ["pnpm","--filter","@costflow/web","start"]`
  (**start only**).
- **Deploy (`railway.json`):**
  - `preDeployCommand: "pnpm --filter @costflow/web migrate"` — migrations run **here**, in their own
    phase, and exit.
  - `startCommand: "pnpm --filter @costflow/web start"`.
  - `healthcheckPath: /healthz`, `healthcheckTimeout: 60`, `restartPolicyType: ON_FAILURE`,
    `restartPolicyMaxRetries: 3`.
- **⚠️ NEVER put `migrate && start` in the start command.** The migrate process blocks, `start` never
  runs, the healthcheck times out, and *every* deploy fails while the old build keeps serving (this
  exact incident froze prod for hours). Migrate is pre-deploy; start is start.
- **Domain/TLS:** `app.fbx1.com` → CNAME to Railway; Let's Encrypt at the edge; TLS terminates at the
  edge, so `trustProxy` + production HSTS are on.
- **Deploy = push to `main`.** GitHub → Railway auto-build. Typical live in ~45–90s; a GitHub incident
  can queue it (production keeps serving the old build meanwhile — this is safe).

---

## 10. Environment variables (complete)

| Variable | Required | Purpose / notes |
|---|---|---|
| `COSTFLOW_ENV` | prod | `production` enables strict posture (OIDC-only, HSTS, trustProxy). |
| `COSTFLOW_AUTH` | yes | `oidc` (prod) or `dev` (dev only; refused in prod). |
| `COSTFLOW_SESSION_KEY` | yes | 32-byte key (hex) for HMAC session signing. Rotating logs everyone out. |
| `COSTFLOW_CREDENTIAL_KEY` | yes | 32-byte key (hex) for AES-256-GCM of Jira tokens. **Rotating orphans stored creds** — see §11. |
| `COSTFLOW_OIDC_ISSUER` | oidc | Auth0 issuer URL. |
| `COSTFLOW_OIDC_CLIENT_ID` | oidc | Auth0 app client id. |
| `COSTFLOW_OIDC_CLIENT_SECRET` | oidc | Auth0 app client secret. |
| `COSTFLOW_OIDC_REDIRECT_URI` | oidc | Must exactly match Auth0's Allowed Callback URL. |
| `COSTFLOW_PUBLIC_URL` | recommended | Base URL for post-logout / invite links; else derived from redirect URI. |
| `COSTFLOW_STORE` / `DATABASE_URL` | prod | Postgres connection. `useMemoryStore` when unset (dev/test). |
| `COSTFLOW_ADMIN_EMAILS` | optional | Comma list; who may view `/admin` activation funnel. |
| `COSTFLOW_MAX_ISSUES` | optional | Per-project import ceiling; default 50,000. Guards OOM. |
| `PORT` | optional | Default 3000. |

**Startup validation:** `loadConfig` throws on missing/invalid required config (e.g., non-32-byte
keys, `dev` auth in production) — the process fails fast rather than booting insecure.

---

## 11. Security — posture and threat model

Deep: `docs/16-operations.md`, ADR-0002/0003/0004.

- **Headers (`security.ts`):** CSP `default-src 'none'; script-src 'none'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; connect-src
  'self'; base-uri 'none'`. Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy`
  (geo/cam/mic off), and **HSTS in production**.
- **Secrets:** Jira tokens AES-256-GCM at rest; keys from env, never in code/logs. Sessions
  HMAC-signed. Auth passwords never touch CostFlow (Auth0 hosts login).
- **CSRF:** per-session token required on every mutating POST (`checkCsrf` → 403).
- **AuthZ:** role gating (`owner`/`admin`/`member`, ADR-0004); owner-only org deletion; member cannot
  reach manager surfaces or another workspace's runs.
- **Tenant isolation:** structural (tenant-scoped store reads) — verified by red-team IDOR probes.
- **Attribution guard:** the report-layer PII choke point (ADR-0002).
- **Sanitized logging:** request shape only; `redactPath` masks invite tokens + UUIDs; never logs
  tokens, emails, titles, or the OAuth code/state.
- **Verified against** (red-team, all blocked): CSRF, IDOR/tenant, cookie tampering, privilege
  escalation, host-header injection, open-redirect, method confusion, XSS/SQL-injection/unicode/RTL
  (all escaped). Auth0 provides attack protection (brute force, breached passwords) on signup.

---

## 12. Performance — measured limits and the numbers behind them

Full-funnel + report, in-process, single core (measured; regenerate with the red-team harness):

| Issues | Analyze | run.json | Report GET (server) | Analysis heap |
|---|---|---|---|---|
| 2,000 | 57 ms | 3.3 MB | 23 ms | 30 MB |
| 20,000 | 942 ms | 33 MB | 130 ms | 133 MB |
| 100,000 | 10.6 s | 165 MB | 468 ms | ~1 GB |

- **Report HTML is bounded ~126KB at any scale** (50-row drill-down cap). Cold start ~94 ms.
- **Concurrency (SSR):** 500 concurrent report renders @ **8.3 ms/req, 0 errors**; 200 concurrent
  signups in 22 ms. SSR is cheap and stable; the bottleneck is never rendering.
- **The one hard limit:** a single **100k-issue** analysis uses ~1 GB heap and writes a ~165 MB
  `run.json`. On a shared multi-tenant process that risks an OOM that takes down **all** tenants.
  **Mitigation shipped:** `COSTFLOW_MAX_ISSUES` (default 50k) refuses above the ceiling at import time.
  Analysis is async (behind the loading page), so latency never blocks a request.

**No response compression or CDN yet** — ~40KB inline CSS per page ships uncompressed. First
optimization for scale (see §14).

---

## 13. Accessibility — measured

WCAG contrast (AA normal ≥4.5): body 19.3:1, secondary 6.3:1, links 5.5:1, dark-mode text 18:1,
tier badges ≥4.7:1 — **pass**. **AA-Large-only (documented tradeoff):** `--faint` fine print
(3.30:1) and the primary button white-on-fuchsia-gradient end (3.96:1) — these are **frozen brand
tokens**; changing them alters the locked visual identity, so they are disclosed rather than
overridden. Structure: `lang`, one `<h1>`, one `<main id="main">`, skip-link, semantic header/footer,
`aria-current`/`role=alert`/`role=status`, labelled forms, visible focus, reduced-motion respected.

---

## 14. Scaling strategy (in priority order)

1. **Upgrade Railway off the trial + provision a bigger instance** (see §10/§15). The single-process
   heap is the constraint; more RAM + the 50k ceiling covers essentially all real projects.
2. **Response compression** (`@fastify/compress`) — ~70% transfer cut, trivial.
3. **Put Cloudflare in front** — edge cache for static/landing, DDoS + bot protection, and
   server-side-free analytics in one move.
4. **Move analysis to a worker/queue** if large imports become common — isolates the 1 GB heap spike
   from the request process so one whale can't affect availability even below the ceiling.
5. **Slim the `run.json` artifact** (engine-level, deliberate + golden-regenerated) — the per-run blob
   is the DB-growth driver. Consider storing traces separately / on demand.
6. **Cache `runSummary`** on the `RunRecord` at creation so the runs list doesn't re-parse each blob.
7. **Horizontal scale** is possible (stateless SSR + Postgres); jobs need a shared queue first (item 4).

---

## 15. Operational runbooks

Deep: `docs/16-operations.md`, `docs/17-launch-operations.md`.

- **Health:** `GET /healthz` (liveness, no deps) and `GET /readyz` (503 if Postgres `ping` fails —
  sheds traffic without killing the pod). Railway healthcheck uses `/healthz`.
- **Deploy:** push to `main`. Verify: `curl -s -o /dev/null -w '%{http_code}' https://app.fbx1.com/healthz`
  == 200, then confirm a distinctive marker from the new build is live. A queued deploy during a
  GitHub incident is safe — old build keeps serving.
- **"Every deploy is failing / prod frozen":** check the Railway start command is **start-only** and
  migrations are in `preDeployCommand` (invariant 7). Check the pre-deploy (migrate) logs for a
  schema error.
- **"Invalid sign-in state" on signup:** `cf_oidc_state` must be `SameSite=None; Secure` in prod (§8).
- **"access_denied" on signup:** an Auth0 **Login Action** is denying (email-verification enforcement
  or a leftover tester allowlist). Fix in Auth0 → Actions → Triggers → Login; remove/disable the
  `api.access.deny(...)` Action. Not a code change.
- **A run is stuck `running`:** the boot-time `markInterruptedJobs` fails orphaned jobs; the user sees
  a failed-run page with retry. If a job fails repeatedly, check the Jira gateway error class in the
  job record / logs (auth/fetch/import/unexpected).
- **"Report withheld":** the attribution guard fired — a raw identity reached the rendered bytes.
  Investigate pseudonymization for that workspace; **do not** disable the guard. Sanitized log line:
  `attribution-guard-blocked`.
- **Rotate a leaked `COSTFLOW_CREDENTIAL_KEY`:** rotating orphans all stored Jira tokens (they can't
  be decrypted). Users must reconnect Jira. Communicate before rotating. `COSTFLOW_SESSION_KEY`
  rotation logs everyone out (safe, lower blast radius).

---

## 16. **Dangerous to change** — read before touching these

- **The pure packages / engine math.** Any change must regenerate goldens deliberately and be
  understood byte-for-byte. Silent changes here corrupt every historical comparison and violate
  invariant 1.
- **The attribution guard** (`attribution.ts` + the report-layer call). Weakening it can leak PII.
- **Cookie `SameSite`/`Secure` for `cf_oidc_state`/`cf_invite`** — a wrong value breaks all signups.
- **The Railway start/preDeploy split** — chaining migrate+start freezes prod.
- **`CSP script-src 'none'`** — adding client JS breaks the security model and the whole no-JS design.
- **Adding an unscoped store method** — breaks tenant isolation (invariant 5).
- **Telemetry taxonomy** (`telemetry-web.ts` + `packages/telemetry`) — event names/fields are frozen
  and privacy-reviewed (`docs/14`). New fields risk leaking identifiers; telemetry may read only the
  immutable run artifact.
- **The money-formatting seam** — all figures must flow through `formatWholeMoney`; a stray `toFixed`
  or float breaks determinism/precision (ADR-0001).
- **Status-mapping "hard refuse" on unmapped history (J3) / truncation (J2)** — relaxing these makes
  the analysis silently wrong.

---

## 17. Testing philosophy & coding standards

- **The gate (`pnpm check`):** `typecheck` → `lint` → `format:check` → `depcruise` → `test`. All must
  be green before commit. CI mirrors it (`.github/workflows`).
- **Determinism tests are the crown jewels:** golden byte-identical fixtures (`tools/golden`). The
  Postgres contract suite runs the **real engine** with **zero skips** (`test:pg`, needs
  `COSTFLOW_TEST_DATABASE_URL`).
- **Tests drive the real server in-process** via `ServerDeps` injection (`apps/web/test/helpers.ts`) —
  no mocking of our own logic; only the Jira gateway and clock are stubbed. This is why a passing test
  suite is strong evidence of production correctness.
- **Style:** TypeScript strict, `exactOptionalPropertyTypes`. Prettier + ESLint enforced. Match the
  surrounding code's idiom and comment density. Comments explain *why* (invariants, tradeoffs), not
  *what*. No `any` in product code. Errors never leak internals to the user (global boundary logs the
  error *name* only).
- **Adding a provider:** (1) pure transform under `ingestion/providers/<name>/` with documented
  derivation rules (J1/CU1-style), run `describeProviderConformance`; (2) golden fixtures + a
  `golden:update:demo-<name>` script + a golden test; (3) CLI fetcher + mapping schema + dispatch;
  (4) a web connector module in `apps/web/src/connectors/<name>.ts` (gateway + descriptor +
  adapters) and one registry line in `main.ts`; (5) journey test. Provider names stay inside those
  directories (boundary rules on both sides).

---

## 18. Known limitations & deferred decisions (honest ledger)

- **No billing.** Free beta. Paying customers require a checkout/subscription flow (not built).
- **No email sending.** Welcome/nudge/report-ready emails and email-based invites are deferred; invites
  are shareable links only. Auth0 sends verification email but does not gate login.
- **Jira + ClickUp in-product.** Monday/Asana/CSV transforms exist in the engine (goldens + conformance)
  but aren't wired into the onboarding UI — each needs only a connector module + registry line (ADR-0005).
- **`run.json` blob size** grows with issues (the DB-growth driver); slimming is deferred (§14.5).
- **No response compression / CDN** (§14.2–3).
- **Analysis is in-process** (not a worker queue) — the `maxIssues` ceiling is the interim guard (§14.4).
- **Legal is beta-grade** — Terms/Privacy are plain-language; a DPA + subprocessor list + counsel
  review are required before enterprise/GA.
- **No A/B testing / session replay** — `/admin` aggregate funnel is the only optimization signal.
- **AA-Large-only contrast** on two frozen brand tokens (§13).
- **Operational gaps for scale-day:** uptime/error alerting (Sentry or log-drain), verified Postgres
  backups, and the Railway upgrade are ops tasks, not code (§15, `docs/17`).

---

## 19. Future roadmap (suggested, not committed)

Near: response compression; Cloudflare (analytics + bot + edge cache); Auth0 custom email domain;
uptime/error alerting; data-export endpoint (Terms already promises "export anytime"); durable
telemetry sink (events → Postgres for week-over-week funnels); a "Powered by CostFlow" line on the
exported report (the organic referral loop). Mid: email flows + email invites; per-tenant run
caps/concurrency; worker-queue for analysis; run.json slimming; formal axe a11y pass; DPA/SOC-2 path.
Later: retention features (weekly digest, scheduled re-runs, trend alerts); Monday/Asana/CSV in-product;
proper referral program; billing + paid plans.

---

## 20. Disaster recovery & backups

- **What must survive:** PostgreSQL (all customer data + immutable run artifacts) and the two crypto
  keys (`COSTFLOW_SESSION_KEY`, `COSTFLOW_CREDENTIAL_KEY`). **Without `COSTFLOW_CREDENTIAL_KEY`, stored
  Jira tokens are unrecoverable** — back up the keys in a secrets manager, separately from the DB.
- **Backups:** enable and **verify** managed Postgres backups (point-in-time if available). A backup
  you have never restored is not a backup — do a test restore. This is currently an **unclosed ops
  action** and the top DR gap.
- **Recovery drills:**
  - *DB loss:* restore from the latest verified backup; run `migrate` (idempotent); redeploy. Runs are
    immutable, so a restore loses only data written after the snapshot.
  - *Process crash:* Railway `ON_FAILURE` restart (max 3); boot runs `markInterruptedJobs`; `/readyz`
    sheds traffic until Postgres is reachable.
  - *Bad deploy:* Railway keeps prior builds — roll back to the last green deployment in the dashboard;
    or `git revert` + push. There is no destructive forward-only migration assumption, but **review
    any migration for reversibility** before shipping.
  - *Key compromise:* rotate `SESSION_KEY` (logs everyone out) immediately; rotate `CREDENTIAL_KEY`
    only with user comms (forces Jira reconnect). Revoke the Auth0 client secret in the dashboard.
- **RPO/RTO:** bounded by the managed-Postgres backup cadence and Railway redeploy time (~minutes),
  once backups are enabled and drilled. Until then, treat DR as **not yet proven**.

---

## 21. Where to look next (deep docs index)

`00` vision/scope · `01` personas/journeys · `02` domain model · `03` cost engine · `04` requirements ·
`05` architecture · `06` constraints/open-questions/risks · `07` decision engine · `08` roadmap ·
`09` **implementation log** (the running build diary + phase records) · `10` engineering review ·
`11` partner-run workflow · `12` overdue detector · `13` detector prioritization · `14` signal
taxonomy (telemetry privacy) · `15` productization roadmap · `16` operations · `17` launch operations.
ADRs: `0001` decimal arithmetic · `0002` attribution-guard boundary · `0003` transactional erasure ·
`0004` org roles & permissions · `0005` multi-platform connector architecture.

*Keep this file current. When you change an invariant, a runbook, or a dangerous zone, update §3/§15/
§16 in the same PR. The best documentation is the kind you can trust without asking.*
