# 08 — Implementation Roadmap (Phase 1 Plan)

> **Superseded in part (2026-07-20):** Phase 1 (M0 + M1 cycle 1) is complete
> through commit 4bc828f. Phase-2 sequencing now lives in
> [15-productization-roadmap.md](15-productization-roadmap.md) (founder
> directive: productization before further detector families). The stack
> decisions (§4), standards (§6–§13), and deferral tripwires (§15) of this
> document remain in force.

**Status: plan only. No code, scaffolding, APIs, database, or UI exist yet.
Every decision here is subordinate to the principles in docs 00–07; where this
document is silent, those documents govern.**

**Team assumption**: 2–3 engineers plus a product-founder. Every estimate below
assumes that. If the team differs, re-derive the calendar, not the sequence.

---

## 0. The shape of the roadmap, and the one big sequencing decision

The roadmap's spine is a single decision that everything else hangs off:

> **The pure engine is built first, as an internally-operated pipeline — before
> the product, before the database, before the UI.**

Milestone 0–1 produce a runnable engine (CSV in → explainable cost report out)
that *we* operate for design partners by hand. The product around it (M2+) is
built only after real customer CSVs have collided with the domain model.

Why this ordering wins on all five optimization axes:

- **Fast learning**: the riskiest assumptions (R1 trust, R2 data quality) are
  tested with real partner data in weeks, not after a quarter of UI work.
  A concierge report meeting is a cheaper, richer experiment than any beta.
- **Architectural integrity**: the pure core (doc 05 A2) is forced to actually
  be pure, because for two milestones there is nothing else — no DB to lean on,
  no framework to leak into it. Purity enforced by absence.
- **Small increments**: every milestone ships something usable — first to us,
  then to partners, then to customers.
- **Minimal debt**: the most expensive debt in this product would be a wrong
  domain model hardened under a UI. Model-first, UI-later minimizes exactly that.
- **Enterprise readiness**: immutability, versioning, determinism, and the audit
  trail are M0 concerns here — retrofitting them is the classic enterprise-
  readiness failure, and this ordering makes retrofit unnecessary.

---

## 1. Development Phases & Milestones

```
M0  Walking Skeleton        (~3 wks)   engine spine, CLI, golden tests, CI
M1  Concierge Engine        (~4 wks)   real partner CSVs, hand-run reports   ← first learning
M2  Self-Serve Spine        (~6 wks)   web app, DB, auth, upload→report      ← first users
M3  The Executive Artifact  (~4 wks)   PDF export, trends, scenarios, J3 loop
M4  First Revenue           (~4 wks)   billing, onboarding, security hardening ← first payment
─────────────────────────────────────────────────────────────────────────────
                             ~5 months first commit → first paying customer
```

Calendar honesty: 5 months is the *plan*; M1 learning may legitimately reorder
M2/M3 scope. The sequence M0→M1 is fixed; everything after is evidence-steerable.

### M0 — Walking Skeleton (~3 weeks)

The full pipeline at minimum width, as a CLI. No DB, no UI, no server.

**Deliverables**
- Monorepo initialized per §5 with dependency-boundary enforcement *in CI from
  the first week* (the doc 05 §3 rules as lint failures, not review comments).
- `domain`: canonical entities, `stage_kind` logic, capability profiles.
- `ingestion` + `providers/csv`: parse → MappingTemplate (as a checked-in JSON
  file for now) → canonical entities + ImportBatch with diagnostics.
- `friction`: two detectors only — F2 aging (snapshot) and F1 queue-wait
  (events) — chosen to force both data modes through the model on day one.
- `cost-engine`: one cost model (C1-style labor pricing of wait/age), range
  arithmetic, confidence tiers, full `formula_trace`.
- `analysis`: run orchestration producing an immutable run artifact (JSON on
  disk — runs-as-files is the M0/M1 persistence model).
- A CLI: `costflow analyze --csv … --mapping … --assumptions …` → run artifact
  + human-readable report (markdown).
- **Golden dataset v1**: 3 synthetic fixture CSVs (rich-history, snapshot-only,
  pathological) with byte-exact expected outputs, in CI. Plus the determinism
  test: every engine run executed twice, outputs diffed (NFR-1 as a CI gate).

**Definition of Done**
- [ ] `costflow analyze` on all three fixtures reproduces expected outputs byte-exact, twice, in CI.
- [ ] A deliberately-introduced import of `ingestion` from `cost-engine` fails the build (boundary test proven, not assumed).
- [ ] Every displayed number in the markdown report can answer the four questions of doc 03 E1 from its trace.
- [ ] A snapshot-only fixture produces a report that *states* which detectors were skipped and why (A7 visible).
- [ ] README-for-engineers: run it locally in <10 minutes from clone.

**Risks**
- *Over-modeling before data contact* — the domain doc is rich; the temptation
  is to implement all of it. Mitigation: M0 implements only what its two
  detectors need; entities without a consumer are not written.
- *Golden fixtures encode our fantasies* — synthetic data confirms the design
  instead of testing it. Accepted for 3 weeks; M1 exists to fix it.

### M1 — Concierge Engine (~4 weeks) — the learning milestone

We run real design-partner CSVs through the CLI ourselves and deliver
hand-polished reports in live sessions. **This milestone's output is knowledge,
not features.** The tripwires of doc 06 (R1, R2, R3) get their first real data.

**Deliverables**
- 5+ design-partner engagements: their real export → our engine → an exec
  report delivered in a session we attend and take notes in.
- Detector set grown to the full MVP six (F1–F6), *in the order partner data
  demands, not doc order*.
- MappingTemplate format hardened against real export variance (Monday + Jira
  at minimum); mapping authored by us in files — the wizard UX is *specified*
  from this experience, not guessed.
- Assumption-set format hardened (real rate-card conversations with partners).
- Golden dataset v2: anonymized/synthesized derivatives of real partner shapes
  replace pure fantasy fixtures.
- **A written M1 findings memo**: what data capability profiles actually look
  like in the wild (R2 verdict), which frictions' rankings landed (R1/R3
  verdict), and the resulting scope adjustments to M2/M3. This memo is a
  formal deliverable reviewed with the founder before M2 starts.

**Definition of Done**
- [ ] ≥5 partner sessions run on ≥5 genuinely different real exports.
- [ ] ≥1 executive reacted to the *ranking* (agreement or productive disagreement) — R1's first signal.
- [ ] Every partner file's capability profile recorded; % supporting event-history detectors known (R2 tripwire measured).
- [ ] Findings memo written, reviewed, and M2 scope amended in writing.
- [ ] All six MVP detectors pass golden tests on the v2 dataset.

**Risks**
- *Concierge comfort* — hand-running reports works so well we drift into
  consulting and defer the product. Mitigation: hard cap — M1 is 4 weeks and
  new concierge engagements stop when M2 starts (existing partners continue as
  M2 beta users).
- *Partner recruitment stalls* — the schedule slips silently while "waiting for
  CSVs." Mitigation: recruitment starts during M0; M1 doesn't begin until 3
  partners are committed.
- *We hear what we want to hear* — sessions run by the people who built the
  engine. Mitigation: the findings memo must record verbatim skeptical quotes;
  a session with no pushback is a failed session for learning purposes.

### M2 — Self-Serve Spine (~6 weeks) — first users

The product exists: J1 (upload → mapping → assumptions → report) unassisted,
in a browser, with persistence and tenancy. Partners from M1 become the beta
cohort; the bar is Maya self-serving without us on the call.

**Deliverables**
- Postgres persistence for the domain (append-only for batches/runs/estimates;
  the runs-as-files artifacts from M0/M1 migrate in as the first rows).
- AuthN via managed provider; org tenancy with the two-layer isolation model
  (§11); admin/member roles only.
- Upload + **mapping wizard v1 (heuristic only — no AI)**: column-name/value
  heuristics propose, human confirms; status→stage_kind mapping UI; template
  save/reuse (FR-2/3). AI suggestions deliberately deferred — see §15.
- Assumption UI: rate cards with labeled defaults, versioning, provenance.
- Report UI: ranked friction list, drill-down implementing the four questions
  (FR-15/16), skipped-detector honesty (FR-11), attribution guard in the
  reporting layer (FR-17) with its own tests.
- Data deletion (FR-22) working end-to-end — built now because it shapes the
  schema (cascade design), and retrofitting deletion is enterprise-readiness
  debt of the worst kind.
- Staging + production environments; deploy pipeline (§8).

**Definition of Done**
- [ ] A new M1 partner completes J1 unassisted in <30 min on their own export (the MVP bar of doc 00, measured with a stopwatch, ≥3 times).
- [ ] Determinism gate now includes DB round-trip: persist → reload → re-run → byte-identical estimates.
- [ ] Attribution-guard tests prove no individual-level data in any API response (N1/FR-17).
- [ ] Org deletion verifiably cascades (test creates org, imports, analyzes, deletes, proves absence).
- [ ] Cross-tenant access attempts fail in an automated test suite that runs as a second tenant.
- [ ] Funnel analytics live on the J1 steps (R7 tripwire instrumented from day one of having users).

**Risks**
- *The mapping wizard is the product's UX cliff* (R7). Mitigation: it is built
  from M1's observed mapping sessions; its funnel is instrumented; heuristics
  target the shapes M1 actually saw.
- *Scope creep from beta feedback* — partners now ask for features weekly.
  Mitigation: M3 scope is already committed; new asks go to a parking lot
  reviewed at M3 end.
- *Persistence subtly breaks purity* — ORMs and lazy loading leak I/O into
  engines. Mitigation: engines keep operating on in-memory canonical data
  loaded up-front by the `analysis` orchestrator; the boundary linter forbids
  DB imports in pure packages; the M0 CLI still runs DB-free forever.

### M3 — The Executive Artifact (~4 weeks)

The Daniel/Rivka surfaces: what gets *shown upward*, and the trust interaction.

**Deliverables**
- Executive export (FR-18): server-rendered HTML→PDF, methodology appendix
  auto-included, uncertainty framing structurally hard to strip.
- Trend view (FR-14/J4): run-vs-run diff on re-upload, template auto-apply.
- Scenario calculator v1 (FR-19): percentage-reduction only.
- The J3 interaction: edit assumption → new run → visible recompute diff
  (NFR-8's <30s target).
- Report sharing (link with org-scoped access) — Daniel may never "log in."

**Definition of Done**
- [ ] An M1 partner forwards a CostFlow-generated PDF to a real executive without editing it (the artifact survives contact — measured, not assumed).
- [ ] Assumption-edit→recompute on beta orgs completes <30s; the diff view shows what moved and why.
- [ ] Second-upload trend works on ≥3 beta orgs' real re-exports (R4 tripwire instrumented: second-upload-within-3-weeks now measurable).
- [ ] Export templates pass a "strip test": removing range/confidence framing requires editing the PDF, not clicking an option.

**Risks**
- *PDF rendering is a tarpit* — pixel-perfection consumes weeks. Mitigation:
  one opinionated template, no customization options in M3; beauty budget is
  capped at one designer-week.
- *Trend comparability* — partners' second exports differ structurally from
  their first (renamed columns/statuses). Mitigation: template versioning + a
  comparability check that says "these runs aren't comparable because X"
  rather than diffing garbage (A7 again).

### M4 — First Revenue (~4 weeks)

Everything between "partners love it" and "a company pays and passes procurement."

**Deliverables**
- Billing (Stripe): subscription, one price point to start; pricing experiment
  design is a founder deliverable, not an engineering one.
- Onboarding polish on the J1 funnel (driven by M2/M3 analytics, not taste).
- Security hardening pass (§11 items marked M4), a completed security
  self-assessment document (the artifact buyers' IT asks for), DPA template,
  data-processing records (NFR-6).
- Backup/restore drill executed and documented.
- Benchmark-consent language in the standard contract (Q4 — legal deliverable,
  time-sensitive per doc 06; flagged to founder at M4 start, not M4 end).
- Support/incident basics: status page, support inbox, on-call-lite rota.

**Definition of Done**
- [ ] A customer outside the design-partner cohort completes signup→payment→J1 with zero human assistance.
- [ ] First real invoice paid.
- [ ] Security self-assessment answered a real prospect's questionnaire at least once.
- [ ] Restore-from-backup drill performed on production data within target time, documented.
- [ ] Consent language shipped in the contract template (Q4 unblocked for the future benchmark layer).

**Risks**
- *Pricing paralysis* — endless deliberation. Mitigation: one price, annual
  and monthly, decided in week 1 of M4; the milestone tests willingness-to-pay,
  not price optimality.
- *Procurement surprises* — an enterprise prospect demands SSO/SOC2 now.
  Mitigation: §11's posture (SSO-capable auth provider, SOC2-lite controls
  documented) makes the honest answer "on the roadmap, here are our current
  controls" — and we accept losing deals that can't take that answer yet.
- *Premature enterprise pull* — one big logo's demands hijack the roadmap.
  Mitigation: founder-level rule — no roadmap reordering for any single
  unsigned customer.

---

## 2–3. (Milestones and deliverables are integrated above.)

## 4. Recommended Technology Stack

Chosen by A6 (boring technology, exciting model) and one binding constraint
from doc 05: a single language so the pure core is importable by every edge.

| Layer | Choice | Justification / rejected alternatives |
|---|---|---|
| Language | **TypeScript (strict) everywhere; Node LTS** | One language across core/api/web keeps pure packages importable by CLI, server, and tests alike. Discriminated unions model `stage_kind`, confidence tiers, and trace types exceptionally well. Hiring pool is the largest that exists. *Rejected*: Python core (better stats libs, but splits the codebase in two languages and the engines are arithmetic + set logic, not ML — the stats argument buys little before the predictive layer, years away); Rust/Go core (performance we don't need at NFR-7 scale, at real velocity cost). |
| Money/decimals | **A vetted decimal library; `numeric` in Postgres; no binary floats in currency paths** | NFR-3 verbatim. Library choice is an M0 ADR (decimal.js-class); the *rule* is what matters here. |
| Monorepo tooling | **pnpm workspaces + Turborepo** | Standard, boring, fast, enforces the package graph we already designed. *Rejected*: Nx (heavier than needed), Bazel (absurd at this size). |
| Boundary enforcement | **dependency-cruiser (or eslint-boundaries) with doc 05 §3 rules as config** | The mandate "violations fail the build" needs a tool, not a norm. Config file is reviewed as part of M0 DoD. |
| API | **Fastify + Zod schemas; OpenAPI generated from schemas** | Thin, boring HTTP edge (A2 — effectful edges stay thin). Zod gives runtime validation + static types from one definition. OpenAPI early because enterprise buyers ask for it. *Rejected*: NestJS (framework gravity pulls logic into the edge — exactly what A2 forbids); tRPC (couples API to TS clients; a public API is on the horizon); GraphQL (no consumer needs graph flexibility; complicates the attribution guard, which wants one choke point with enumerable responses). |
| Database | **PostgreSQL (managed)** | The boring default for relational, append-only, audited data. `numeric` for money, JSONB for traces/attribute bags, RLS for the second isolation layer (§11). *Rejected*: anything eventful/streaming (no requirement), MongoDB (our data is relational and versioned), SQLite-in-prod (multi-tenant + concurrent analysis makes it wrong here, though engines stay DB-free anyway). |
| DB access | **Thin query layer (e.g., Kysely-class typed SQL builder); no heavyweight ORM** | ORMs with lazy loading are the classic purity leak (M2 risk). Typed SQL keeps the effectful edge explicit and reviewable. Final library is an M2 ADR. |
| File/object storage | **S3-compatible object store** for raw uploads (Q7: retained) | Raw batch retention with deletion cascade; MinIO locally for parity. |
| Frontend | **React + Vite SPA; TanStack Query/Router; no Next.js** | The API is the single choke point (attribution guard, tenancy); a fullstack framework blurs where server logic lives and invites a second effectful edge. SPA + API keeps the doc 05 diagram literally true. *Rejected*: Next.js (SSR/edge complexity buys nothing for a logged-in analytical tool). |
| PDF export | **Server-side headless-Chromium HTML→PDF (Playwright-class)** | One templating system (HTML/CSS) for screen and export; the strip-test (M3 DoD) is easiest to enforce in our own renderer. *Rejected*: client-side PDF libs (typography quality too low for the flagship artifact). |
| AuthN | **Managed auth provider with SSO/SAML upgrade path (WorkOS/Auth0-class)** | We never store passwords (aligns with the platform's own safety posture and shrinks the attack surface NFR-4/5 cares about); SSO becomes a config change, not a milestone — that's bought enterprise-readiness. Specific vendor is an M2 ADR. *Rejected*: hand-rolled auth (all downside). |
| Hosting | **Managed container PaaS (Render/Fly-class) + managed Postgres, single deployable** | A5: modular monolith, one artifact. PaaS until enterprise compliance demands a cloud-account story; the monolith makes that migration boring by design. *Rejected*: Kubernetes (self-harm at this stage), serverless-function architectures (long-running analysis runs fit containers, and cold-start complexity buys nothing). |
| CI/CD | **GitHub Actions** | Where the code lives; boring; sufficient. |
| Errors/analytics | **Sentry-class error tracking; PostHog-class product analytics** | §12; funnel instrumentation is a named MVP need (R7 tripwire). |

Stack-level rule: each choice above marked "ADR" gets a one-page Architecture
Decision Record in `docs/adr/` at the milestone where it binds. The table fixes
*classes* of tools now and defers vendor-picking to the moment of use — the
reverse (vendor now, rationale never) is how stacks rot.

## 5. Repository Structure

Doc 05 §2 stands as written. Phase-1 deltas only:

- `apps/cli/` is added — the M0/M1 entry point, and *permanently retained*
  thereafter: it is the determinism harness, the support tool, and the living
  proof that engines run without the app. It ships in CI forever.
- `packages/diagnostics|playbooks|simulation|decisions` (doc 07 §8) are **not
  created** — not even as empty directories. Empty scaffolds invite premature
  content; the design docs reserve the seats.
- `tools/golden/` holds the golden datasets + expected outputs, versioned in
  the repo (they are the constitution of the engines; they travel with the code).
- `docs/adr/` for decision records, numbered, immutable once accepted.

## 6. Coding Standards

- **TypeScript strict; `any` is a lint error** in `packages/*` (allowed, with
  comment, only at untyped third-party edges in `apps/*`).
- **The ubiquitous language is law**: code names match doc 02 exactly
  (WorkItem, ImportBatch, FrictionInstance, AssumptionSet, formula_trace…).
  A concept needing a name not in docs 02/07 triggers a doc update in the same
  PR — the model and the code may never drift.
- **Purity is structural**: pure packages import no I/O modules, receive time
  as an argument, contain no randomness (doc 05 §3 rule 2), enforced by the
  boundary linter. `Date.now()` in `cost-engine` is a build failure, not a nit.
- **Money discipline**: currency values flow as decimal types with explicit
  currency; a bare `number` holding money is a review-blocking defect (NFR-3).
- **Immutability discipline**: no UPDATE paths on batches/runs/estimates at the
  query layer; corrections are inserts of new versions (A3). The query layer
  simply does not export an update function for those tables.
- Lint/format: ESLint + Prettier, zero-warning CI. Conventional commits.
  PRs small and single-purpose; anything touching `domain` or an engine's
  output requires a golden-dataset diff in the PR description (even if empty —
  "no golden changes" is an explicit claim).
- Comments follow the standing rule: explain constraints code can't show;
  never narrate.

## 7. Testing Strategy

The pyramid is deliberately bottom-heavy in the pure core — that is where the
company's correctness lives.

1. **Golden-dataset tests (the constitution)**: fixture CSVs → byte-exact
   expected run artifacts, for every detector × capability-profile combination.
   Any diff is a reviewed, deliberate act with a version bump on the engine
   that caused it (A4). Grown at every milestone; M1 replaces fantasy fixtures
   with reality-derived ones.
2. **Determinism gates (NFR-1 as CI)**: every engine run in CI executes twice
   and diffs; from M2, also persist→reload→re-run→diff.
3. **Property-based tests** for the algebra: range arithmetic (ranges never
   narrow under composition), confidence composition (min rule; no downstream
   laundering — doc 07 §4.4 rule 4 is mechanically checkable and is checked),
   mapping round-trips.
4. **Unit tests** for detectors against synthetic event streams (each friction's
   evidence pattern and its negative cases).
5. **Contract tests on the provider SPI**: a provider conformance suite that
   `providers/csv` passes — the same suite every future provider must pass
   (the doc 05 §4 promise, executable).
6. **Guard tests as first-class citizens**: attribution guard (no individual
   data egress), tenancy isolation (automated second-tenant attack suite),
   deletion cascade. These test the never-list, and they never get deleted.
7. **E2E (Playwright)**: the J1 spine only — upload→map→assume→report→drill.
   Kept deliberately thin; E2E breadth is where test suites go to die.
8. **Trace completeness test**: every number in a rendered report must resolve
   to a `formula_trace` that answers doc 03 E1's four questions — automated by
   walking the report model, not by human spot-checks.

Coverage philosophy: no numeric coverage target (they distort); instead, the
gates above are mandatory and the pure packages aim for exhaustive behavioral
coverage because their inputs are enumerable.

## 8. CI/CD Strategy

- **Trunk-based**: short-lived branches → PR → main. No release branches.
- **Every PR**: typecheck, lint (zero warnings), boundary check, unit +
  property + golden + guard tests, determinism gate. Target <10 min wall clock
  (pure-core tests are fast by construction; this is a benefit of A2 worth
  defending — a slow suite erodes the golden-test culture).
- **main → staging**: auto-deploy on merge (from M2, when staging exists).
- **staging → production**: manual one-click promotion of the same immutable
  artifact (build once, promote twice). Tagged releases; changelog generated
  from conventional commits.
- **Migrations**: forward-only, reviewed like engine changes, applied on
  promotion with automatic backup snapshot before each production migration.
- **No feature-flag platform yet**: at this team size, flags are env vars;
  a flag service is M5+ debt-avoidance theater. (Challenge recorded: revisit
  when two teams exist.)

## 9. Local Development Workflow

- Clone → `pnpm install` → `pnpm test` runs the entire pure-core suite with
  **no services at all** (no DB, no docker) — the A2 dividend; this must stay
  true forever and is checked by running that job on a service-less CI runner.
- `docker compose up` brings Postgres + MinIO for app work; `pnpm dev` runs
  api + web with hot reload; seeded demo org from golden fixtures.
- `costflow analyze` (the CLI) runs any fixture or real CSV locally — the
  primary loop for engine work stays sub-second and offline.
- Onboarding bar: new engineer to green tests <10 min, to running app <30 min,
  measured on the next hire and fixed if missed.

## 10. Deployment Strategy

- **Two environments** (staging, production) — a third buys nothing yet.
- Single container image runs API + serves the SPA; the same image runs
  migrations and the CLI (one artifact, every role — trivial rollbacks).
- Managed Postgres with PITR backups; object storage with lifecycle rules
  honoring retention/deletion (FR-22, Q7).
- Analysis runs execute in-process with a job table for status (no queue
  infrastructure until NFR-7 scale actually strains it — see §15).
- Rollback = redeploy previous image; migrations forward-only means rollback
  windows are considered in migration review (expand-migrate-contract pattern
  when touching live tables).

## 11. Security Baseline

Layered per milestone; items are cumulative.

**From M0 (culture-level)**
- Secrets never in the repo (platform secret store; local `.env` gitignored,
  `.env.example` maintained). Dependency scanning (Dependabot/audit) in CI.
- Partner CSVs are confidential data from day one: stored only in the
  designated bucket, never in tickets/chat, deleted on request — the concierge
  phase handles real customer data *before* the product does; the security
  posture starts there, not at M2.

**From M2 (product-level)**
- AuthN delegated to the managed provider (no password handling, ever).
- **Two-layer tenant isolation**: every query path carries org scope by
  construction (typed query layer requires an org-scoped context to compile),
  *and* Postgres RLS as the second, independent layer — NFR-4's "structural,
  not policy-suppressed," implemented as two structures that would both have
  to fail.
- Pseudonymization at ingestion (NFR-5): actor identities hashed org-locally;
  display labels are roles/teams. PII inventory maintained as a doc.
- Upload hygiene: size caps, content-type verification, CSV parsed never
  executed, **CSV-injection escaping on every export** (the classic analytics-
  product vulnerability — formulas in exported cells), rate limits on upload
  and auth endpoints.
- TLS everywhere; security headers; audit log (append-only) for authz-relevant
  events: logins, exports, deletions, assumption edits (the last one matters —
  assumption provenance is a *product* feature (doc 03 P4) and a security
  feature in the same table).

**From M4 (enterprise-facing)**
- Security self-assessment document (answers the standard questionnaire),
  access-review cadence, least-privilege on cloud accounts, incident-response
  one-pager, restore drill (DoD item), DPA + processing records (NFR-6).
- SOC 2: *controls operated informally and documented* from M4; the audit
  itself is scheduled when the first deal requires it, not before. Buying the
  audit pre-revenue is enterprise cosplay; operating the controls early is
  enterprise readiness.

## 12. Logging & Observability

- **Structured logs** (JSON) with request ID + org ID on every line; **no PII
  and no customer work-item content in logs** — log entity IDs, never titles.
  This rule is lint-assisted (logger API takes typed fields, not free strings).
- **Error tracking** (Sentry-class) from M2, release-tagged.
- **The run audit trail is not logging**: AnalysisRun records (versions,
  inputs, timings, diagnostics) are domain data in the DB — the explainability
  machinery *is* the deep observability for everything that matters most, by
  design. App logs are for the boring edges.
- **Product analytics** (PostHog-class) on the J1 funnel and the R4/R7
  tripwires from the first day real users exist — the doc 06 tripwires are
  dashboards, not aspirations.
- Uptime checks + platform metrics; a single ops dashboard (error rate, p95,
  queue-of-runs depth, import failure rate). OpenTelemetry tracing is
  deliberately deferred — one service, boring edges; traces earn their keep
  when there are hops to trace (§15).

## 13. Definition of Done — global, plus per-milestone

Per-milestone DoD checklists are embedded in §1. The **global DoD**, applying
to every PR in every milestone:

- [ ] Boundary linter, tests, determinism gate green; zero lint warnings.
- [ ] Golden-dataset diff stated in the PR (or "no golden changes").
- [ ] New concepts named per docs 02/07, or the doc updated in the same PR.
- [ ] No number rendered anywhere without a trace behind it.
- [ ] Never-list (doc 06 §1 N1–N9, doc 07 §6 N10–N14) not violated — reviewer
      explicitly confirms for PRs touching reporting, exports, or engines.
- [ ] Security-relevant changes (auth, queries, uploads, exports) get a second
      reviewer.

## 14. Risks (implementation-phase; product risks live in doc 06)

Per-milestone risks are embedded in §1. Cross-cutting implementation risks:

- **IR1 — The pure core erodes gradually.** Each individual leak (a date here,
  a DB call there) looks harmless. Defense: the linter config is the contract;
  weakening it requires an ADR, and the DB-free CI job + immortal CLI keep the
  claim testable forever.
- **IR2 — Golden tests become a ritual.** People regenerate expected outputs
  on every diff without reading them. Defense: regeneration is a separate,
  deliberate command whose output must be pasted into the PR; engine version
  bumps are required alongside (A4), making "silent recalibration" loud.
- **IR3 — The 5-month plan meets reality.** Something slips; the temptation is
  to compress M1 (the learning milestone) because it "produces no features."
  Standing rule: **M1 is the last milestone to cut, not the first** — it is
  the cheapest de-risking of R1/R2 the company will ever buy.
- **IR4 — Single-language regret at the predictive layer (years out).** If
  statistical models eventually want Python, the engine boundary (pure
  packages, versioned registries) is exactly where a second-language service
  could dock without violating A5's spirit. Not a today-problem; recorded so
  today's choice isn't misread as forever-dogma.
- **IR5 — Team size fantasy.** This plan assumes 2–3 engineers. With fewer,
  extend the calendar, never thin the DoD — the DoD *is* the architectural
  integrity the roadmap exists to protect.

## 15. Intentionally NOT Built Yet (and the tripwire that un-defers each)

| Deferred item | Built when |
|---|---|
| Live integrations (any provider beyond CSV) | Post-PMF, per doc 05 §4 — specifically: weekly re-upload cadence sustained by paying customers (R4 evidence) |
| `ai-assist` package (AI mapping suggestions, narrative drafts) | Funnel data shows mapping-step drop-off that heuristics can't fix (R7 evidence). Heuristics-first is a deliberate M2 simplification of FR-2 — ship the deterministic 80% before the assisted 20% |
| Decision layer (diagnostics, playbooks, simulation, decisions) | First post-MVP milestone *after* M4, starting with the thin outcome-loop Decision object (doc 07 Q11) — the one deferred item with a calendar cost, so it leads the post-M4 queue |
| Benchmarks of any kind | Consented data exists (Q4 language ships in M4) + volume |
| SSO/SAML | First enterprise deal that requires it (auth provider makes it config, not construction) |
| RBAC beyond admin/member; audit-grade permission system | First customer whose org structure demands it |
| Multi-currency (Q1) | First multinational design partner |
| Job queue / worker infrastructure | An analysis run actually exceeds the in-process budget (NFR-7 measured, not imagined) |
| Public API | Second genuine external consumer request (OpenAPI spec exists from M2 anyway) |
| Feature-flag service, OpenTelemetry tracing, k8s, microservices | Two teams / multiple services / measured need — respectively; none before |
| SOC 2 audit engagement | First deal that names it as a closing condition |

The table's discipline: every deferral names its un-deferral evidence. "Later"
without a tripwire is how deferred work becomes forgotten work — or worse,
premature work done out of anxiety.

---

## 16. Self-challenge record (what this roadmap almost was, and why it isn't)

- **Almost: DB and web app from week 1.** Rejected — it front-loads the least
  risky work (CRUD) and starves the riskiest assumptions of contact with
  reality. The CLI-first plan felt slower on paper and is faster in truth.
- **Almost: M1 and M2 merged ("build the app, learn in beta").** Rejected —
  beta users teach you about your UI; concierge sessions teach you about your
  *model*. The model is the company; the UI is replaceable.
- **Almost: AI mapping suggestions in M2** (docs list them in FR-2). Simplified
  out — heuristics on real M1 shapes likely cover most cases, and shipping the
  `ai-assist` quarantine machinery for a marginal gain violates "optimize for
  fast learning." The FR stands; its AI clause is sequenced behind evidence.
- **Almost: 6 milestones with a separate "hardening" phase.** Rejected —
  hardening-as-a-phase means debt-as-a-policy. Security and enterprise
  readiness are layered into every milestone (§11) precisely so no milestone
  ships what a later phase must redo.
- **Almost: Next.js fullstack for velocity.** Rejected on an architectural
  ground, not taste: the attribution guard and tenancy enforcement want *one*
  choke point; a framework that blurs client/server boundaries blurs exactly
  the line docs 05/06 made load-bearing.
- **Remaining doubt, stated honestly**: M2 at 6 weeks is the most likely
  estimate to be wrong (mapping wizard UX is genuinely hard). If it slips, the
  correct response is cutting M2 *polish*, never M2's DoD — and the M1 findings
  memo exists precisely to narrow the wizard to the shapes that matter.
