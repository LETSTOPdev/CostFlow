# 05 — Architecture: Repository Structure, Module Boundaries, Integrations, AI, Principles

## 1. Architecture Principles

- **A1 — The domain model is the center of gravity.** Providers map in; UIs read
  out; nothing reaches around it. (The mandated decision, made structural.)
- **A2 — Pure core, effectful edges.** Domain logic, detectors, and the cost
  engine are pure functions over in-memory canonical data. I/O (parsing, storage,
  HTTP) lives at the edges. This is what makes NFR-1 (determinism) testable and
  E4 (sensitivity) cheap.
- **A3 — Immutability of facts and runs.** Batches, events, runs, estimates are
  append-only. Corrections are new versions. Doubt about "which numbers did the
  board see" must be impossible.
- **A4 — Everything that produces a number is versioned.** Detectors, cost
  models, mappings, assumptions. Version identifiers travel with every output.
- **A5 — Modular monolith now; services never until forced.** One deployable,
  strict internal module boundaries (enforced by the package graph below).
  Microservices for a pre-PMF analytics product is self-harm. The boundary
  discipline keeps extraction possible if ever genuinely needed.
- **A6 — Boring technology, exciting model.** Innovation budget is spent on the
  friction/cost model, nowhere else. Standard relational storage, standard web
  stack, no exotic infrastructure.
- **A7 — Degradation is a designed state, not an error state.** Partial data is
  the *normal* case (CSV-first guarantees it). Every layer must have defined
  behavior for missing capabilities.

## 2. Repository Structure Proposal

Monorepo. Language choice is deliberately **not** fixed in this document (it's an
implementation decision for the approved team; the structure below is
language-agnostic). The strong recommendation is a single language across core
and app to keep the pure core importable by every edge.

```
costflow/
├── docs/                      # These documents; ADRs live in docs/adr/
├── packages/
│   ├── domain/                # THE CENTER. Canonical entities, invariants,
│   │                          #  stage-kind logic, capability profiles.
│   │                          #  Pure. Depends on NOTHING internal.
│   ├── friction/              # Friction signal definitions + detectors.
│   │                          #  Pure functions: canonical data → instances.
│   │                          #  Depends on: domain.
│   ├── cost-engine/           # Cost models, F×→C× registry, range arithmetic,
│   │                          #  formula-trace builder, assumption resolution.
│   │                          #  Pure. Depends on: domain, friction (types only).
│   ├── ingestion/             # Provider SPI: Extractor + Mapper contracts,
│   │                          #  MappingTemplate engine, batch diagnostics.
│   │                          #  Depends on: domain.
│   │   └── providers/
│   │       └── csv/           # Provider #1. Proves the SPI is real.
│   ├── analysis/              # Run orchestration: batches × detectors ×
│   │                          #  models × assumptions → immutable runs; diffs.
│   │                          #  Depends on: domain, friction, cost-engine.
│   ├── reporting/             # Ranking, aggregation, drill-down shaping,
│   │                          #  export composition, attribution guard (FR-17).
│   │                          #  Depends on: domain, analysis.
│   └── ai-assist/             # Mapping suggestions, narrative drafting.
│                              #  Quarantined: nothing may depend on it except app.
├── apps/
│   ├── api/                   # HTTP layer, authn/z, tenancy enforcement.
│   └── web/                   # The product UI.
├── infra/                     # IaC, deployment. Thin.
└── tools/                     # Dev scripts, golden-dataset fixtures.
```

### Why this shape

- **`domain` depends on nothing** — the mandate as a build rule. A Monday import
  concept appearing in `domain` fails review by construction.
- **Pure packages (`domain`, `friction`, `cost-engine`) contain no I/O**, so the
  determinism invariant (NFR-1) is enforced by golden-dataset tests: fixture CSVs
  → expected estimates, byte-exact, run in CI forever.
- **`ai-assist` is quarantined** so the "no LLM in the numeric path" rule (doc 03
  P1) is a dependency-graph fact, not a code-review hope: `cost-engine` cannot
  even import it.
- **`providers/csv` sits under the same SPI future integrations will use** —
  CSV as first-class citizen means CSV is provider #1 through the front door,
  not a special case beside the real pipeline.

## 3. Module Boundaries (the dependency contract)

> **Amended 2026-07-20 (Slice 1.1, review R-02/D-10):** `reporting` may import
> `cost-engine`. The original diagram routed reporting's decimal needs through
> `analysis` re-exports (D-7), which pushed the money *formatter* out of the
> engine and led directly to a hand-rolled, defective renderer. Rule: the
> package that owns monetary arithmetic also owns monetary formatting; no
> consumer may reimplement either. `cost-engine` remains pure, so the added
> edge costs nothing architecturally.

```
ai-assist ──▶ (app layer only)
apps/web ──▶ apps/api ──▶ reporting ──▶ analysis ──▶ friction ──▶ domain
                     │            └───▶ cost-engine ──▶ domain
                     └──▶ ingestion ──▶ domain
```

Hard rules (CI-enforced, violations fail the build):

1. `domain` imports nothing internal.
2. `friction`, `cost-engine` import only `domain` (+ each other's types via the
   F×→C× contract). No I/O, no clock, no randomness — time is always an input.
   `reporting` may additionally import `cost-engine` for estimate types,
   decimal ordering, and display formatting (never to compute new figures).
3. Providers implement the ingestion SPI; **nothing outside `ingestion` may
   reference a provider by name.** The word "monday" appearing under `analysis/`
   is a build failure.
4. `ai-assist` may be imported only by `apps/*`. Its outputs are always
   *suggestions* requiring human confirmation before entering the domain.
5. The attribution guard (no individual-level output, FR-17) lives in
   `reporting` as the single choke point every read path passes through.

## 4. Future Integrations Strategy

### The provider contract (designed now, exercised by CSV)

Every provider — CSV included — implements the same three-step contract:

1. **Extract**: produce rows/records from the source (file parse today; API
   pagination tomorrow).
2. **Map**: apply a MappingTemplate → canonical entities + capability profile.
3. **Land**: create an immutable ImportBatch with diagnostics.

Because CSV exercises the full contract from day one, adding Monday's API later
changes *only* the Extract step plus a pre-built MappingTemplate ("Monday board
export, standard shape"). The wizard, capability profiles, analysis, and
reporting are untouched. **That is the payoff of CSV-first: the integration
roadmap becomes an extractor roadmap.**

### Sequencing (post-PMF, in order of evidence)

1. **Whichever tool our paying design partners actually use** — not a strategy
   document's guess. Measured by: which saved MappingTemplates exist, and which
   re-upload cadences are highest (the customers doing weekly re-uploads are the
   ones begging for automation).
2. Live sync starts as **scheduled pull** (hourly/daily), not webhooks/streaming.
   A pull is a self-running CSV upload; it reuses everything. Streaming is
   post-post-PMF, if ever — friction analysis has no real-time requirement.
3. **Marketplace embeds (Monday app, etc.) are distribution, not architecture.**
   A thin embedded view over the same API. Never let a marketplace's data model
   or review process dictate core design — and price in that platforms may clone
   us (Risk R5, doc 06).
4. **Write-back** (e.g., creating "fix this friction" tasks in the source tool)
   is deliberately deferred and possibly permanent-never: it changes our
   security posture from read-only-analytical to write-capable, which changes
   every enterprise security review. Requires its own decision document if ever
   proposed.

## 5. AI Responsibilities (the FBX1 boundary)

AI in CostFlow is a **clerk and a translator, never an accountant**.

### AI does (all quarantined in `ai-assist`, all human-confirmed)

- **Mapping suggestions** (MVP): propose column→field and status→stage-kind
  mappings from headers and sample values. High leverage — this is the biggest
  UX cliff in J1 — and safe, because the human confirms and the mapping is then
  deterministic data.
- **Narrative drafting** (post-MVP): turn a formula trace + friction instance
  into readable insight prose. Constrained: every quantity in the prose must
  come from the trace (doc 03 E3); output is a draft until a human approves it.
- **Anomaly flagging** (post-MVP): "this batch looks structurally different from
  last week's" — advisory only.

### AI never

- Produces, adjusts, or validates any number in the cost path.
- Auto-applies a mapping without confirmation.
- Sees cross-tenant data; customer data never trains shared models.
- Ships prose to an executive without human approval.

### On "Powered by FBX1"

Recommendation: keep FBX1 as an internal codename for the *cost engine + model
registry* (the actual IP), not the AI layer. Branding the deterministic engine
is honest and durable; branding a thin AI-assist layer as a proprietary engine
invites "so it's a GPT wrapper?" diligence questions and sets an AI-magic
expectation that our explainability positioning must then fight. Flagged as
Open Question Q6 (doc 06) for a human decision.
