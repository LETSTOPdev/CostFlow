# 18 — Connector Architecture: Multi-Platform Audit & Design

> **Status:** Phase 1 (audit) and Phase 2 (design) of the multi-platform connector
> initiative. Mission: make Jira the *first supported connector* rather than the
> product's identity, and ship ClickUp as the second production connector.
> Companion log entries live in `docs/09`; the how-to-add-a-connector guide is §5.

---

## 1. Audit method

Every package, app, doc, schema, and test was swept for provider assumptions
(case-insensitive `jira|monday|asana|atlassian`), and every hit was classified:
**sanctioned** (inside the ingestion SPI or an effectful edge that must know
providers) or **leak** (platform assumption in platform-agnostic territory —
code, schema, copy, or terminology).

## 2. What is already platform-agnostic (verified, not assumed)

The 2026-07-20/21 P1–P2 work (doc 09) built the Provider SPI v2, and it held:

- **`domain`, `friction`, `cost-engine`, `analysis`, `reporting`, `telemetry`
  contain zero provider references.** The dependency-cruiser rule
  `no-provider-names-outside-ingestion` enforces this at `error` severity, and
  `ImportBatch.provider` is a free string the engine never branches on. The
  deterministic engine cannot know where data came from — this invariant is
  structural, and this initiative does not touch it.
- **`ingestion` has four pure transforms** (csv, jira, monday, asana) over one
  shared canonical assembly (`canonical.ts`: actor resolution, strict event
  validation, capability profile), one error type, and static descriptors
  (`spi.ts`). The SPI conformance suite (6 invariants) runs against all of them.
- **The CLI** fetches and analyzes all four providers. Its per-provider
  dispatch is hand-rolled (`if provider === …` in `main.ts`), which is
  acceptable at an effectful edge, but adding a provider touches five places
  (USAGE, KNOWN_PROVIDERS, fetch dispatch, analyze dispatch, schemas).

**Conclusion:** the engine never needed rescuing. The platform coupling is
concentrated in the *product* — `apps/web` — which was deliberately built
Jira-only ("Jira-only wedge", doc 09 v1 founder decision, now lifted).

## 3. Audit findings — where Jira leaks (Phase 1 deliverable)

### 3.1 Backend structure (the load-bearing leaks)

| # | Location | Leak |
|---|---|---|
| L1 | `apps/web/src/store/contract.ts` | `WorkspaceRecord.provider: 'jira'` — the *type* forbids any other provider. |
| L2 | `store/contract.ts`, `schema.sql` | Credentials are Jira-shaped columns: `site`, `email` (`NOT NULL`), `token_ciphertext`. ClickUp (and monday/asana) authenticate with a token only — they have no site/email. |
| L3 | `store/contract.ts` | Scope is Jira-named: `projectKey`/`projectName`. ClickUp's unit is a Space; monday's a board; Asana's a project. |
| L4 | `apps/web/src/jira-gateway.ts` | The only gateway. `ServerDeps.gateway: JiraGateway` hard-wires the whole server to it. Failure stages (`list-projects`/`search`/`changelog`) are Jira fetch anatomy. |
| L5 | `apps/web/src/jobs.ts` | `executeJob` imports `transformJira`/`JiraMapping` directly and builds a `{site,email,token}` connection. The job runner — pure orchestration — knows Jira. |
| L6 | `apps/web/src/server.ts` POST `/connect` | Hardcodes `provider: 'jira'` on create and in `tm-web-workspace-connected`/`tm-web-scope-selected`/`tm-web-run` telemetry. |
| L7 | `server.ts` POST `/scope` | The `maxIssues` guard parses the Jira search-page shape (`total`, `issues[]`) inline; observed vocabulary comes from `observeJiraSearchPages` unconditionally. |
| L8 | `apps/web/src/main.ts` | Wires `new HttpJiraGateway()` as *the* gateway. |
| L9 | `server.ts` logs | `jira-list-projects-failed`, `jira-import-failed`, `jira-import-too-large` event names. |

### 3.2 Onboarding, reports, terminology, UI copy

| # | Location | Leak |
|---|---|---|
| L10 | `/connect` page | Jira-only form (site URL, account email, Atlassian token walkthrough). No provider choice exists. |
| L11 | `/scope` page | "Pick the Jira project…" |
| L12 | Dashboard + `/settings` | "Jira site *X* · connected as *Y*" connection summaries. |
| L13 | `html.ts` | `<meta>`/OG/Twitter descriptions: "Connect Jira and get…"; loading page says "Connecting to Jira". |
| L14 | `landing.ts` | Hero ("delays in your Jira"), how-it-works, faux-app mockup ("Jira site acme.atlassian.net"), FAQ ("Will you change anything in my Jira?", "Jira today. Monday, Asana, and CSV … coming soon"), JSON-LD descriptions. |
| L15 | `/demo`, `/try` CTAs (`server.ts`, `demo-live.ts`) | "run one on your own Jira", "Connect your Jira". |
| L16 | Reports | `report-view.ts` and `reporting` are **clean** — no provider references. No change needed. |

### 3.3 Database, tests, docs, telemetry

| # | Location | Leak |
|---|---|---|
| L17 | `schema.sql` | `site`/`email` `NOT NULL` (blocks token-only providers). `provider` is free text with no CHECK — good, no migration needed for new values. |
| L18 | `apps/web/test/helpers.ts` | `StubJiraGateway` is the only injectable connector; ~8 web suites depend on its shape. |
| L19 | `docs/BIBLE.md`, `docs/16`, `docs/17`, `README.md` | "Jira today", "Jira only in-product", runbooks that say "Jira tokens", "reconnect Jira". |
| L20 | `apps/cli/src/main.ts` | `KNOWN_PROVIDERS` and dispatch lack any new provider (expected; the edge must enumerate). |
| L21 | `demo-live.ts` internals | Synthesizes Jira-shaped raw and calls `transformJira`. **Sanctioned:** synthetic data must take *some* provider's shape and this exercises a real transform; only its user-facing copy is a leak (L15). |

### 3.4 Non-findings (checked, clean)

Attribution guard, pseudonymization, assumptions/provenance flow, status/actor
mapping steps, roles/permissions, deletion, funnel stats, report rendering, and
the entire pure-package tree operate on canonical or workspace-local data with
no provider knowledge.

---

## 4. Target architecture (Phase 2 design)

### 4.1 The one new concept: the **web connector** (edge SPI)

The pure SPI (doc 15 P1) already splits every provider into FETCH (effectful,
apps) and TRANSFORM (pure, `packages/ingestion`). What the web app lacked is a
*uniform effectful half*. That is now `apps/web/src/connectors/`:

```
apps/web/src/connectors/
  contract.ts     WebConnector interface + ConnectorRegistry + GatewayError
  jira.ts         Jira connector (wraps the existing HttpJiraGateway logic)
  clickup.ts      ClickUp connector (new)
  index.ts        buildConnectors(fetchFn) → ConnectorRegistry
```

```ts
interface WebConnector {
  descriptor: ProviderDescriptor;         // from @costflow/ingestion (id, name)
  scopeNoun: { singular; plural };        // "project" / "Space" — UI vocabulary
  credentialFields: CredentialField[];    // renders the /connect/<id> form
  connectionHelpHtml: string;             // provider token walkthrough
  parseCredentials(body) → Connection | {error};   // validation, never stores raw
  splitCredentials(connection) → {display, secret};// display → connection_json,
                                                   // secret → AES-256-GCM ciphertext
  connectionFrom(workspace, secret) → Connection;  // rehydrate at use time
  summaryText(workspace) → string;        // "Jira site X as Y" / "ClickUp workspace"
  listScopes(connection) → ScopeRef[];    // Jira: projects; ClickUp: team/Spaces
  fetchAll(connection, scopeKey) → RawFetchPayload; // provider-shaped raw docs
  countItems(payload) → number;           // maxIssues guard, provider-aware
  observe(payload) → {statuses, actors};  // mapping vocabulary
  transform(payload, args) → ImportBatch; // DELEGATES to the pure package transform
}
```

Laws (all carried over, none new):

1. **Raw documents verbatim; transforms pure.** `fetchAll` returns raw response
   strings; `transform` only forwards them to `packages/ingestion`. No number,
   date, or identity is derived at the edge.
2. **Sanitized failures.** Every connector throws the shared `GatewayError`
   (class `auth-error`/`fetch-error`, a provider-local *stage* string, optional
   HTTP status) — never URLs, credentials, or customer data.
3. **Read-only by construction.** Jira/ClickUp use GET only; the monday
   precedent (P2 PP-1) keeps the invariant as "no mutation in any request".
4. **The registry is static data.** No plugins, no reflection — the R-11
   discipline, same as cost models and descriptors.

`ServerDeps.gateway: JiraGateway` is replaced by
`ServerDeps.connectors: ConnectorRegistry`. `jobs.ts` and every onboarding
route dispatch on `workspace.provider` through the registry and are now
provider-blind. `jira-gateway.ts` is deleted; its HTTP logic lives unchanged
inside `connectors/jira.ts`.

### 4.2 Store generalization (D-21)

`WorkspaceRecord` becomes provider-neutral:

- `provider: string` (was `'jira'`).
- `connection: Record<string, string>` — the connector's **non-secret display
  fields** (Jira: `{site, email}`; ClickUp: `{}`). Persisted as a new
  `connection_json` column. The secret stays exactly where it was:
  `token_ciphertext` (AES-256-GCM).
- `scopeKey`/`scopeName` (was `projectKey`/`projectName`). **TS rename only** —
  the Postgres columns stay `project_key`/`project_name` (the adapter maps), so
  the deployed DB needs no risky column rename.
- Migration (idempotent, reversible): `site`/`email` add `DROP NOT NULL`;
  `connection_json` added. **Jira rows keep `site`/`email` mirrored** so a
  rollback to the previous build still reads them; existing rows without
  `connection_json` are backfilled at read time from `site`/`email`.

### 4.3 Onboarding becomes provider-aware (the only UI the architecture requires)

- `GET /connect` — provider picker (Jira, ClickUp) when nothing is connected;
  the connected provider's form otherwise.
- `GET/POST /connect/:provider` — the connector's `credentialFields` form +
  validation probe (`listScopes`). The manager-path gate covers the new routes.
- `/scope`, `/mapping/*`, `/assumptions`, job → report: **unchanged flow**,
  provider-blind via the registry (`scopeNoun` supplies vocabulary). The
  onboarding state machine is untouched.
- Telemetry call sites pass `workspace.provider` instead of the `'jira'`
  literal — event names and shapes are unchanged (taxonomy already declares the
  `provider` field as machine-shape).

### 4.4 What deliberately does NOT change

- **The canonical model.** ClickUp priorities, time estimates, custom fields,
  and task relationships are fetched into the raw documents (so history is
  never lost) but not mapped: no detector consumes them today, and canonical
  extensions ride with a consuming detector, never with a connector (doc 15 P2
  law). This is recorded as future work, not silently dropped — see §6.
- **The engine, goldens, and existing transforms** — byte-identical.
- **CSV/monday/asana in-product** — the architecture now makes each a
  bounded add (§7); wiring them is a separate authorization.

---

## 5. The ClickUp connector (Phase 3 design)

Grounded in the real cu01 partner run (doc 09 M1): 79 tasks / 7 lists fetched
from a production ClickUp workspace via the official REST v2 API established
the platform's actual capabilities and shaped rules CU1–CU7.

- **Auth:** personal API token (header `Authorization: <token>`), the same
  posture as Jira's API token. OAuth is a future item.
- **Scope:** one ClickUp **Space** (labelled "Team / Space" when the token sees
  several teams). Fetch = spaces' folders + folderless lists → every list's
  tasks (paginated, `subtasks=true`, `include_closed=true`).
- **Capability truth:** ClickUp's standard API exposes **no ordered status
  transitions** (Time-in-Status is plan-gated *and* aggregate-only — M1
  finding, generalized). The descriptor says `eventHistory: false`; the batch
  carries zero events; queue-wait *skips visibly*. Nothing is invented.

Transform rules (documented and tested like J1–J3/M1–M6/A1–A5):

| Rule | Behavior |
|---|---|
| CU1 | Millisecond-epoch string timestamps → ISO-8601 UTC, deterministically; unparseable values → warning diagnostic, field ignored. |
| CU2 | Pagination completeness is verified: each list's page sequence must end `last_page: true`, else the transform hard-errors (J2 analog — no silent truncation). |
| CU3 | Multi-assignee tasks (14% in cu01): the primary actor is the assignee with the **lowest numeric user id** (deterministic), with a per-task diagnostic counting the others. Single-actor is the known PP-2 domain simplification. |
| CU4 | No events are emitted, structurally (`eventHistory: false`); detector skips are visible in the report's coverage. |
| CU5 | A task whose current status is unmapped is dropped with a diagnostic (same semantics as Jira J3's current-status side). |
| CU6 | Subtasks are first-class work items (own id, status, dates); the parent link is fetched raw but unmapped (no canonical field). |
| CU7 | Closed/done tasks are imported (terminal stages) so counts and future completed-at work (F3b) stay honest. |

Deliverables: `packages/ingestion/src/providers/clickup/{transform,urls}.ts`,
descriptor, conformance run, CLI fetcher + `fetch/analyze` wiring + zod
mapping schema, web connector with 429-aware fetch (ClickUp rate limit:
100 req/min — bounded retry honoring `Retry-After`), golden `demo-clickup`
with a hand-computed expected table, and stress tests.

### The demo-clickup golden — hand-computed BEFORE generation (project law)

Fixture: 2 lists (901 Sprint, 902 Backlog), 4 tasks, `--now 2026-07-20T00:00:00Z`,
demo-jira's assumption set (Legal 120, Ops 90, default 30, aging ≥14d,
attention 0.15/0.3/0.6, overdue attention 0.1/0.2/0.4 customer-accepted).
CU-1 "to do" Legal, updated Jun 28, due Jul 10 · CU-2 "in progress"
2 assignees (primary = lowest id → Legal), fresh · CU-3 "to do" no assignee,
updated May 10 · CU-4 "complete" unmapped assignee, due Jun 25 (terminal).

- Counts: 4/4/0. Events 0; capability event-history **no**. Due-date
  coverage 2 of 3 in-flight. One CU3 diagnostic (CU-2). Queue-wait **skipped**.
- **Aging, stage "to do"**: CU-1 → 22 untouched − 14 = 8 d; CU-3 → 71 − 14 =
  57 d; magnitude **65 item-days-beyond-threshold**. Cost: CU-1 8×{0.15,0.3,0.6}×120
  = 144/288/576; CU-3 57×{…}×30 = 256.5/513/1026. Stage total
  **400.5 / 801 / 1602** → displayed 400 – 1,602 (expected ~801). Tier **C**
  (default rate on the actor-less CU-3, min-composition).
- **Overdue, stage "to do"**: CU-1 only (CU-4 terminal) → **10
  item-days-overdue**; 10×{0.1,0.2,0.4}×120 = **120/240/480**, tier **A**
  (customer-owned due date + accepted attention; no clustering, no
  due-before-created).
- Rank: aging 801 → #1, overdue 240 → #2. Context: 3 in-flight, 2 (67%) in
  queue/review, largest pool "to do" (2 items).

---

## 6. How to add the next connector (the permanent recipe)

1. **Pure half** (`packages/ingestion/src/providers/<id>/`): a `transform<Id>`
   with numbered derivation rules (X1…Xn) documented in the header; reuse
   `canonical.ts` helpers; add the descriptor to `spi.ts`; export from
   `index.ts`. Run `describeProviderConformance` on a representative fixture.
2. **Golden**: build a small synthetic API-shaped fixture under
   `tools/golden/fixtures/<id>/`, hand-compute the expected figures FIRST, add
   a `golden:update:demo-<id>` script, generate, verify against your table,
   freeze. Add the fixture to the CLI golden test.
3. **CLI edge**: fetcher in `apps/cli/src/fetchers/<id>.ts` (pure URL/query
   builders exported for tests; raw pages verbatim to disk + manifest), zod
   mapping schema, `fetch`/`analyze` dispatch arms, `KNOWN_PROVIDERS`.
4. **Web edge**: implement `WebConnector` in `apps/web/src/connectors/<id>.ts`
   and register it in `buildConnectors`. Everything else — onboarding, mapping,
   assumptions, jobs, reports, deletion — works untouched.
5. **Tests**: transform suite (happy path + every rule + adversarial payloads),
   fetcher URL/pagination tests, web journey test with a stub connector.
6. **Docs**: rules table here, log entry in doc 09, BIBLE §"repository map"
   provider list.

The engine, detectors, cost models, analysis, reporting, and telemetry are
**never** touched by a connector. If a connector seems to need an engine
change, stop — that is a canonical-model decision requiring its own review.

---

## 7. Effort map for the connector roadmap (estimates)

With this architecture in place (registry + generic onboarding + store):

| Platform | Pure transform | Edge work | Notes | Estimate |
|---|---|---|---|---|
| monday.com | **exists** (P2) | web connector only | GraphQL POST-for-query; board = scope | ~1 day |
| Asana | **exists** (P2) | web connector only | stories give real event history | ~1 day |
| CSV upload | **exists** (M0) | file-upload UI + mapping-template UX (no gateway) | different UX shape (upload, not connect) | ~2–3 days |
| Linear | new | full recipe (§6) | GraphQL; issue history available | ~2–3 days |
| Azure DevOps | new | full recipe | REST + revisions for history | ~3 days |
| GitHub Projects | new | full recipe | GraphQL ProjectsV2; status via field values | ~2–3 days |

