# Architecture

Stable structure only. Anything that might change next month belongs in
`02-current-state.md`.

---

## 1. The shape

A pnpm workspace monorepo. Nine pure packages, two applications.

```
packages/                    pure: no I/O, no clock, no env, no network
  domain          canonical model — the vocabulary everything else speaks
  ingestion       provider payloads → canonical model
  friction        detectors: what is going wrong
  cost-engine     decimal money, ranges, confidence, cost models
  analysis        composes detectors + pricing into one immutable artifact
  reporting       the artifact → markdown, plus the shared report model
  diagnostics     the artifact → where attention pays off
  comparison      two artifacts → is a trend meaningful, and what moved
  telemetry       the artifact → product analytics

apps/
  cli             analyse and preflight from files; generates golden artifacts
  web             Fastify server: routes, stores, connectors, all rendering
```

The dependency arrow points one way and is enforced by `dependency-cruiser` in
CI, not by convention:

```
domain ◄── friction ◄── analysis ◄── reporting
   ▲           ▲            ▲    ◄── diagnostics
   │           │            │    ◄── comparison
   └── ingestion            │
   └── cost-engine ─────────┘
```

Rules a build will fail on: no pure package may import an app; no pure package
may import a Node builtin; provider names may not appear outside `ingestion`;
`analysis` may never import `comparison` or `diagnostics` (consumers must not
leak back into the producer).

## 2. Data flow

```
  ┌─ tracker API or CSV
  │
  ▼
ingestion ───► ImportBatch ───► friction ───► FrictionInstance[]
  pseudonymises   canonical      detectors     located at a STAGE
  identities      model                              │
  maps statuses                                      ▼
  declares                                     cost-engine
  capability                                   prices what it can,
  declares                                     skips the rest with a reason
  evidence quality                                   │
                                                     ▼
                                              AnalysisRun  ◄── the artifact
                                                     │
                        ┌────────────────────────────┼───────────────┐
                        ▼                            ▼               ▼
                   reporting                   diagnostics      comparison
                   priced report            where to act      vs another run
```

Everything after the artifact is a **reader**. No downstream layer derives a new
number; it aggregates, formats, or compares numbers the engine already produced.

## 3. The canonical model

Provider vocabulary dies at the ingestion boundary. Downstream code never sees a
Jira status or a ClickUp list.

- **`WorkItem`** — id, title, stage, actor, created/due/updated dates.
  Deliberately minimal: a field exists only because a consumer reads it.
- **`StageRef`** — the customer's own status name plus one of six canonical
  kinds: `queue`, `active`, `review`, `blocked`, `done`, `abandoned`.
- **`ActorRef`** — `role` (mapped to a business role), `unknown` (a one-way
  org-scoped pseudonym), or `missing`. **Raw identity is structurally
  unrepresentable.**
- **`WorkItemEvent`** — an ordered, timestamped stage transition.
- **`ImportBatch`** — the items and events, plus what the import can support
  (capability), what is weak about it (evidence), which origins it covered
  (`BatchScope[]`), and provenance counts.
- **`AssumptionSet`** — rates, thresholds and attention-hour ranges, each
  carrying provenance.

### Selection and coverage

A Monitoring Workspace spans a **set** of scopes, so two different questions
have to be answered separately, and conflating them is how a settings change
becomes a false trend.

**Selection** is what the customer asked to monitor. It lives in workspace
configuration and can name a *container* — a ClickUp Space, a Folder — rather
than a leaf. It changes only when the customer changes it.

**Coverage** is what a particular run actually fetched, resolved from the
selection at run time and recorded on the artifact as `BatchScope[]`. Selecting
a Space and later adding a List to it leaves the selection identical and the
coverage wider.

Coverage is the one that belongs on the immutable artifact, because it is the
only one that states what the numbers were computed from. Comparison compares
coverage, and blocks a trend when it moves (§8).

`BatchScope` deliberately carries no scope *kind*. "List", "Folder", "Space" and
"project" are provider vocabulary, and the domain does not learn provider
vocabulary — kind lives in the connector layer, where it renders a hierarchy the
customer recognises. See D16.

### Merging several origins into one analysis

Fetch and transform are per origin; `mergeBatches` is the single seam where a
set becomes one analysis. It is pure and order-independent — inputs are sorted
by scope id before anything is concatenated, so fetch order never reaches a
total. Three rules carry weight:

- **Items de-duplicate.** A ClickUp task can belong to several Lists. Counting
  it twice would inflate every total silently.
- **Capability is the intersection, never the union.** If one List has status
  history and another does not, a union would let a detector report a confident
  figure for a population half of which it never observed. The intersection
  makes the detector skip, which the report already knows how to explain.
- **Evidence is the union**, with each note attributed to its origin, and a
  `partial-coverage` note added when capability is not uniform. A customer
  seeing a detector skip needs to know *which* two of their nine Lists caused
  it.

## 4. The pure engine

**Pure** means: no I/O, no clock, no environment, no randomness. Time is always
an explicit input. The same inputs produce the same bytes, forever.

**Frozen** means: pinned by golden artifacts checked into `tools/golden/`.
Changing engine behaviour requires regenerating them deliberately with a stated
reason. This is what makes every other guarantee enforceable rather than
aspirational.

### Detectors (`friction`)

Three friction signals and one context signal. Each declares its data
requirements; one whose requirements the batch cannot meet is **skipped visibly
with the reason**, never silently.

| Signal | Measures | Needs |
|---|---|---|
| `f1-queue-wait` | time in queue/review stages | event history |
| `f2-aging` | time since last touch beyond a threshold | last-updated dates |
| `f3-overdue` | time past the customer's own due date | due dates |
| `c6-wip-load` | where in-flight work is pooled | nothing |

Every `FrictionInstance` is located at a **stage**, never at a person, and
carries a time-denominated magnitude plus typed evidence rows.

`c6-wip-load` is a **context signal**: it explains, it is never priced, and it
cannot carry a cost — the type has no field for one. This is deliberate and
argued in `reference/14-signal-taxonomy.md`.

### Cost engine

Money is decimal at rest and exact in arithmetic. It never exists as a float.
Every estimate is a **range**, never a point, and carries:

- a **formula trace** — per-item terms, the assumptions used, and their
  provenance;
- a **confidence tier** — A, B or C, composed by taking the weakest input and
  naming the binding constraint.

A friction it cannot price is recorded as skipped with a reason. In report mode
it refuses to price anything resting on a vendor-suggested assumption the
customer has not confirmed.

### The run artifact

`AnalysisRun` embeds its own batch, assumption set, detector outcomes, friction
instances, pricing outcomes, estimates, context observations, and **every engine
version**.

Self-containment is not tidiness — it is what allows a run from a year ago to be
re-interpreted correctly today, and what makes run-over-run comparison possible
without a schema for configuration history.

## 5. The capability model

**Capabilities describe what can be observed.** A closed vocabulary of eight:
`stage-snapshots`, `status-history`, `transition-history`, `assignment-history`,
`due-dates`, `dependency-graph`, `approval-chain`, `capacity-signals`.

Diagnostics declare which they require and are gated on them. A diagnostic that
cannot run is **reported as unavailable with the missing capability named**,
which is a product surface rather than a gap.

The translation from a platform's limits, a workspace's plan, and an import's
contents into a capability profile happens **at the app edge, never in the
diagnostics layer**. A diagnostic asks "do I have transition history?", never
"which platform is this?". A test fails the build if a provider name appears
anywhere in `packages/diagnostics` — including in a comment.

When a capability is absent, the app distinguishes four reasons, because only
some are actionable:

| Reason | Meaning |
|---|---|
| `platform-cannot` | the platform has no way to expose it |
| `plan-gated` | it can; this workspace's plan or settings do not — **actionable** |
| `import-lacked` | it does; this import did not carry it — **actionable** |
| `not-built` | CostFlow does not read it from any platform yet |

## 6. The evidence model

**Capabilities describe observability. Evidence quality describes trust.**

An import declares what is *weak* about its observations, using a closed
vocabulary of four weaknesses across four subjects:

| Weakness | The question it answers |
|---|---|
| `derived-not-observed` | Is the value real, or did we compute it? |
| `partial-coverage` | Is the population complete? |
| `open-interval` | Is the measurement finished? |
| `ambiguous-semantics` | Does it mean what we think it means? |

Subjects: `events`, `items`, `actors`, `commitments`.

Keyed on **what is weak, never on who produced it** — so two unrelated platforms
with the same weakness produce the same note, and a connector changing its
technique changes nothing here.

These notes travel **inside the artifact**, so a run stays interpretable after
the connector that produced it has changed or been switched away from. They cap
diagnostic confidence and are scoped by subject: a weakness in the event stream
never downgrades a finding computed purely from snapshots.

## 7. Diagnostics

Reads a stored artifact and produces findings about **where attention pays off**.

Three diagnostics today: friction concentration, missing ownership, serial
gatekeeping. Each declares required capabilities, its minimum evidence, and
whether falling short suppresses the finding or lowers its grade.

Two separations are structural, not stylistic:

**Diagnostics measure; playbooks recommend.** A finding is arithmetic over the
customer's data. An intervention is a curated recommendation matched to it.
The UI renders them as separate blocks with explicit provenance, because
presenting them together would let the recommendation borrow the measurement's
authority.

**Impact and complexity are separate axes.** There is no composite priority
score. Implementation complexity is a declared property of the intervention,
uniform across tenants, and it never reorders the list.

Findings carry numbers only — never titles, never identities. That is what makes
a finding structurally incapable of leaking an identity into rendered output.

## 8. Comparison

Two artifacts in, a **verdict** plus a structured diff out.

A trend is a claim: that a number moved because the work changed. It can also
move because configuration changed, the engine changed, or a detector that used
to skip now runs. The verdict separates those:

- `comparable` — nothing else moved.
- `comparable-with-note` — something moved that must be shown alongside.
- `not-comparable` — the two runs are not measuring the same thing.

Seven aspects: engine, detectors, assumptions, scope, **coverage**, evidence,
policy. Coverage is blocking, and it is the aspect multi-scope made necessary: a
workspace monitoring a Space silently covers more work the day someone adds a
List to it, with no configuration change to point at.

**On `not-comparable`, no trend is rendered at all** — replaced by what differs
and what to do about it. A wrong trend is worse than no trend.

## 9. The web application

Fastify, **100% server-rendered, zero client JavaScript, strict CSP
(`script-src 'none'`)**. Search, filter, sort and pagination are GET query
params; actions are CSRF-protected POSTs. This is a hard constraint, not a
preference.

- **Auth** — OIDC via Auth0, stateless signed-cookie sessions, per-session CSRF.
- **Storage** — one `Store` interface, two implementations (Postgres, in-memory
  for tests), held to a shared contract test.
- **Tenancy** — every query is tenant-scoped. The single sanctioned exception is
  the admin console's `admin*` methods, which are cross-tenant, allowlist-gated
  and audited.
- **Connectors** — a provider contract in the app layer pairing an effectful
  gateway with the pure ingestion transform. Adding a platform is a new
  connector module plus one line in the composition root.

### The attribution guard

The single structural choke point for the never-name-a-person rule. Immediately
before responding, the report handler checks the rendered bytes for any raw
observed-actor identity. If one appears it **fails closed**: withholds the entire
response, logs a count only, and does not record the view.

Deterministic exact-substring matching. No heuristics. Any new surface that
renders evidence must route through it.
