# 02 — Internal Domain Model, Friction Taxonomy, Delay-Cost Taxonomy

This is the most important document in the repository. The mandated architectural
decision — *no external tool's schema may shape the core* — is realized here.
Every provider (CSV today; Monday, Jira, ClickUp, HubSpot later) maps INTO this
model and knows nothing about what happens after.

## 1. Design rules for the domain model

1. **Provider-agnostic by construction.** No field in the canonical model may be
   named after, or exist because of, a specific tool. The test: a Jira engineer
   and a HubSpot admin must both read the model and say "yes, my data fits."
2. **Events over snapshots, but snapshots are legal.** The richest analysis needs
   status-change history; most CSV exports only carry current state. The model
   therefore represents both, and every consumer must declare which it needs.
   This single decision is what makes "CSV-first, degrade gracefully" possible.
3. **Facts, interpretations, and judgments are separate layers.** What happened
   (WorkItem, events) is immutable fact. What it means operationally
   (FrictionInstance) is a versioned interpretation. What it costs (CostEstimate)
   is a versioned judgment built on stated assumptions. Keeping these layers
   separate is what makes recomputation, explainability, and model evolution
   possible without touching source data.
4. **Attribution targets are structural, never personal.** Friction attaches to
   process stages, queues, teams, and work types — never to an individual (doc 06).
5. **Money is always a range with provenance.** There is no scalar `cost` field
   anywhere in the model. Cost is `{low, expected, high, currency, confidence,
   model_version, assumption_refs[]}` or it does not exist.

## 2. The canonical model

### 2.1 Identity & tenancy

- **Organization** — the tenant. Hard isolation boundary for everything below.
- **Workspace** — a logical grouping within an org (e.g., "R&D", "Sales Ops").
  Lets one org analyze departments separately without separate tenants.
- **Member** — a CostFlow user (Maya, Daniel). Not to be confused with…

### 2.2 The world being analyzed (facts)

- **Actor** — a person or team *referenced by imported data* (an assignee column).
  Actors are analysis subjects, not users. Actors carry a `role_ref` for rate-card
  matching. Individual actors exist in the model (data fidelity requires it) but
  the reporting layer only ever aggregates them to Team/Role level (doc 06).
- **Team** — a structural grouping of actors; a legal attribution target.
- **Process** — a named flow that work items move through (a board, a pipeline, a
  queue — canonically). Contains ordered **Stages**.
- **Stage** — a canonical state within a process, tagged with a `stage_kind`:
  `queue | active | review | blocked | done | abandoned`. The `stage_kind` tag is
  what lets friction detectors work generically: "time in `queue`-kind stages" is
  wait time regardless of whether the customer calls it "Waiting for approval" or
  "On hold". **Mapping a customer's statuses to stage kinds is a core step of the
  mapping wizard** — it is where provider vocabulary dies and canonical vocabulary
  begins.
- **WorkItem** — the atom. A unit of work with identity, title, type, process,
  current stage, actors (by role), timestamps (created / due / completed), and
  optional **ValueAttribution** (see 2.5). Deliberately minimal; everything
  tool-specific that we can't canonicalize goes into a typed `attributes` bag that
  detectors may read but the core schema doesn't depend on.
- **WorkItemEvent** — an immutable state transition: `(work_item, from_stage,
  to_stage, at, actor?)`. The event stream, when present, is the high-fidelity
  substrate for wait time, rework, and handoff detection.
- **DependencyLink** — `WorkItem → WorkItem` blocking relations, when the source
  data has them. Enables blocker-chain analysis; entirely optional.

### 2.3 Ingestion (provenance)

- **DataSource** — a configured origin: `{provider: csv | monday | jira | …,
  config}`. CSV is provider #1 and structurally identical to future live providers.
- **MappingTemplate** — the reusable recipe that turns a provider's shape into
  canonical entities: column→field mappings, status→stage-kind mappings, role
  mappings. **This is durable product IP**: a library of "how Monday sales boards
  usually map" is both a UX accelerator and the seed of every future integration.
- **ImportBatch** — one ingestion run: source, timestamp, mapping template version,
  row counts, diagnostics (rows dropped and why), and a `capability profile` —
  a machine-readable statement of what this data supports (has history? has due
  dates? has roles?). Every downstream analysis cites the batches it ran on.
  Batches are immutable; re-uploads create new batches, which is what makes
  trend analysis (J4) and full reproducibility possible.

### 2.4 Interpretation (friction)

- **FrictionSignal** — the *definition* of a detectable pattern (e.g.,
  "stage wait time exceeds threshold"). Versioned. Has declared data requirements
  (events vs. snapshot) so the system knows which signals a given ImportBatch can
  support — this is the mechanism behind graceful degradation.
- **FrictionInstance** — a concrete detection: signal X, on work items Y, at
  process/stage/team Z, with magnitude (e.g., 340 item-days of queue wait) and
  the evidence set. Immutable per analysis run.

### 2.5 Judgment (money)

- **RateCard** — customer-owned cost rates per role/team, versioned, with edit
  history. Ships with clearly-labeled regional defaults the customer must be able
  to see and override.
- **ValueAttribution** — optional business value attached to a work item or
  process: deal size, SLA penalty terms, revenue-per-day of a launch. The bridge
  from "labor cost" to "business impact" (doc 03's cost lens L2/L3). Always
  customer-supplied.
- **AssumptionSet** — the frozen bundle of rate cards, value attributions, and
  engine parameters used by an analysis run. Referenced by every estimate;
  editing assumptions creates a new version, never mutates history.
- **CostModel** — a versioned, deterministic formula that prices one friction
  signal type (doc 03). Code, but registered as data so estimates can cite it.
- **CostEstimate** — the output atom: `{friction_instance, cost_range, currency,
  confidence_tier, cost_model_version, assumption_set_version, formula_trace}`.
  The `formula_trace` is the machine-readable derivation that powers the
  explainability UI (doc 03).
- **AnalysisRun** — one full pass: (import batches × signal versions × cost model
  versions × assumption set) → friction instances + cost estimates. Immutable,
  reproducible, comparable. Trend = diff of two runs. "What changed when I edited
  the rate?" = diff of two runs. This entity is what makes the audit journey (J3)
  cheap instead of magical.

### 2.6 Decision support (thin in MVP)

- **Insight** — a curated, human-readable finding assembled from friction
  instances + estimates (AI-drafted, grounded, human-approved — doc 05).
- **Scenario** — a what-if: "friction F reduced by N%" → projected savings range.
  MVP: percentage reduction only.
- **Report** — a versioned, exportable snapshot of selected insights for an
  audience (the Daniel artifact).

## 3. Model decisions worth defending (and the alternatives rejected)

- **Why `stage_kind` tagging instead of free-form status?** Without it, every
  friction detector needs per-customer configuration and the product doesn't
  scale past consulting. With it, detectors are written once against six kinds.
  Cost: the mapping wizard must get this right — worth it, and AI-assisted
  mapping helps (doc 05).
- **Why keep individual Actors at all if we only report on teams?** Data fidelity
  and future flexibility (e.g., handoff *count* needs to know two events had
  different actors, even though we report the count at stage level). The
  restriction is enforced at the reporting/API layer, not by data amputation —
  amputation would silently break detectors.
- **Why immutable runs instead of live-updating numbers?** Executives will make
  decisions on these numbers. A number that silently changes under someone's
  board deck is a trust catastrophe. Immutable runs cost storage and force an
  explicit "recompute" action — both acceptable.
- **Rejected: modeling a universal "work graph" of everything.** A generic
  everything-graph (items, docs, messages, meetings…) is the billion-dollar-
  sounding trap: enormous modeling surface, no additional MVP value. The model
  above covers work items and their lifecycle; expansion happens by adding
  entities later, not by abstracting prematurely.
- **Rejected: storing provider payloads as the primary record with views on top.**
  Keeping raw exports for audit is fine (and we do, per ImportBatch), but if
  analyses read provider shapes, provider assumptions metastasize into the core —
  precisely what the mandate forbids.

## 4. Business Friction Taxonomy

Friction := any pattern in the work lifecycle that destroys economic value.
Organized by *mechanism*, because the mechanism determines both the detector and
the cost model. Each entry states its minimum data requirement — the practical
meaning of "CSV-first."

| # | Friction | Mechanism | Minimum data | MVP |
|---|---|---|---|---|
| F1 | **Queue wait** | Item sits in a `queue`/`review`-kind stage; value delivery deferred | Events (or stage-entry timestamps) | ✅ |
| F2 | **Aging / stagnation** | Item untouched beyond threshold; likely forgotten or silently blocked | Snapshot (last-updated date) | ✅ |
| F3 | **Overdue delivery** | Item past stated due date; downstream commitments at risk | Snapshot (due date) | ✅ |
| F4 | **Rework** | Item regresses to an earlier stage; work is being redone | Events | ✅ |
| F5 | **Handoff churn** | Item changes hands many times; coordination overhead + wait per handoff | Events with actors | ✅ |
| F6 | **WIP overload** | Team/stage holds far more concurrent items than it completes; context-switching + universal slowdown | Snapshot | ✅ |
| F7 | **Blocker chains** | Item blocked by dependency; delay propagates | DependencyLinks | ◻ post-MVP |
| F8 | **Abandonment** | Item dies after significant investment; sunk cost | Events or status | ◻ post-MVP |
| F9 | **Expedite disruption** | "Urgent" items preempt flow; everything else slows | Events + priority field | ◻ post-MVP |
| F10 | **Approval latency** | Specialization of F1 for `review`-kind stages; called out because it's the single most common exec-legible friction and often the wedge insight | Events | ✅ (as F1 reported by stage kind) |

Taxonomy rules: (a) every friction must be *detectable from data we ingest* —
no survey-based frictions (morale, meeting overload) in the core taxonomy;
(b) every friction must have at least one honest cost model or it ships as an
unpriced "operational flag," clearly separated from priced frictions.

## 5. Delay-Cost Taxonomy

The cost side, organized as **three lenses of escalating claim strength**. The
lens structure is itself a trust device: the product always states which lens a
number comes from, because they carry very different evidentiary weight.

### Lens L1 — Direct resource cost (strongest claim)

Money spent on labor consumed or occupied by the friction.
- **C1 Rework labor**: hours re-spent × rate. (F4)
- **C2 Coordination overhead**: per-handoff overhead estimate × handoffs × rate. (F5)
- **C3 Context-switching drag**: WIP above healthy threshold × drag factor × rate.
  Weakest of L1 — the drag factor is a literature-derived assumption; labeled
  low-confidence by default. (F6)

### Lens L2 — Delayed value (the core "cost of delay" claim)

Value that exists but arrives later than it should; cost = value rate × delay.
- **C4 Deferred revenue/value**: (value per day from ValueAttribution) × days
  delayed. Only computable when the customer attributes value; otherwise the
  friction is reported in time units with a "attach value to price this" prompt. (F1, F3, F7)
- **C5 Carrying cost of open work**: invested-but-undelivered effort aging on the
  books. (F2, F8)

### Lens L3 — Risk-weighted exposure (weakest claim; always labeled as such)

Probabilistic downside made legible.
- **C6 SLA/penalty exposure**: breach probability × penalty terms. (F3)
- **C7 Churn/relationship risk**: delay on customer-facing items × customer value
  × churn-risk factor. Post-MVP; easy to abuse, needs careful design.
- **C8 Expedite tax**: overtime/disruption premium on preempted work. (F9, post-MVP)

### Deliberately excluded from pricing

Morale, attrition, reputation, "employee frustration": real, but any dollar figure
we attach would be theater and would contaminate trust in the numbers that *are*
defensible. They may appear as qualitative context in insights, never as currency.

### The mapping that makes the product coherent

Every MVP friction ships with: **one primary cost model, its lens label, its
required assumptions, and its degradation story** (what it reports when value
attribution is missing — always time-denominated magnitude, never a fabricated
dollar). This table (F× → C×, requirements, fallbacks) is the contract between
the friction layer and the cost engine, and it is versioned like everything else.
