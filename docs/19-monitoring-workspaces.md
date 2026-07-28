# 19 — Monitoring Workspaces: comparison, trends, and operational insight

**Status: plan awaiting approval.** Founder directive 2026-07-28: Monitoring
Workspaces become one of the core product capabilities, not a reporting
side-feature. All architectural principles (docs 00–07, 12–14), the provenance
policy (doc 03 P4 as amended), the attribution guard (ADR-0002/ADR-0006), and
the frozen engine rule remain binding. Nothing in this plan changes a pure
package.

## 1. What a Monitoring Workspace is

A persistent operational view of one part of an organization: Engineering,
Marketing, Customer Success. It remembers a connected integration, a selected
scope, a status map, an actor role map, salary assumptions, its members, and
every analysis ever run against it.

That last clause is the product. A single friction report tells you what a team
costs today. A Monitoring Workspace tells you whether that is getting better or
worse, which is the only version of the question an executive can act on. The
current product answers the first and gestures at the second.

## 2. What already exists

Worth stating precisely, because the gap is smaller than it looks and the
temptation to rebuild is real.

- **Runs are append-only and workspace-scoped.** `runs` carries
  `(tenant_id, id)` with `workspace_id` and `created_at`. Explicit erasure
  (FR-22) is the only delete path.
- **`run.json` is self-contained (NFR-2).** Each artifact embeds its own
  `batch`, `assumptions`, `detectors`, `frictions`, `pricing`, `estimates`,
  `context`, and a pinned `engineVersions` map (`packages/analysis/src/run.ts`).
  This is the single most important fact in this document, and section 3
  explains why.
- **A one-step delta already ships.** The report view renders a trend section
  against the immediately previous run of the same workspace: `previousRunFor`
  (`apps/web/src/server.ts:2817`) feeds `renderTrend(current, previous)`
  (`apps/web/src/report-view.ts:271`).
- **The access path is indexed as of P4.5.** `runs_workspace_at
  (tenant_id, workspace_id, created_at desc)` (`schema.sql:105`) plus
  `Store.listWorkspaceRunHeaders` (`contract.ts:756`), an ordered artifact-free
  history. This is the primitive every milestone below reads from.
- **Workspaces have names**, so a series can be labelled with something a human
  recognizes.
- **The activity spine records analysis events** (`analysis.started`,
  `analysis.completed`, `report.viewed`) with actor attribution, so
  "who looked at this and when" is already answerable.

What does not exist: comparing two arbitrary runs, any series longer than two
points, any named KPI, any notion of whether two runs are even comparable, and
any cadence that would make a series regular.

## 3. The hazard that decides whether any of this is trustworthy

A trend line is a claim that a number moved. Between two runs of the same
workspace, a number can move for four different reasons:

1. **The work changed.** Friction genuinely rose or fell. This is the only
   reason anyone wants to see.
2. **The configuration changed.** Someone edited salary assumptions, remapped
   statuses, changed the actor role map, or widened the scope.
3. **The engine changed.** A detector or cost model version moved, so the same
   input prices differently.
4. **The input window changed.** A different date range or a partial import.

A chart that silently mixes these is worse than no chart, because it converts a
configuration edit into a confident false claim that the team improved. This is
the same failure mode the provenance policy exists to prevent, one level up.

**CostFlow can detect all four**, because `run.json` pins the assumption set and
every engine version inside the artifact. The configuration a number was
computed under travels with the number. So the first thing to build is not a
chart. It is a verdict.

**Comparability verdict**, computed pure from two run artifacts:

- `comparable` — same engine versions, same assumption set, same scope.
- `comparable-with-note` — something changed that does not invalidate the
  comparison but must be shown next to it (for example a salary rate changed,
  so cost moved even where hours did not).
- `not-comparable` — the scope or the detector set differs enough that the
  delta is meaningless. The UI must refuse the comparison and say why.

This belongs in a pure package alongside the engine, is trivially testable
against goldens, and makes every later milestone honest by construction.

## 4. Milestones

```
MW1  Comparability verdict + run diff (pure, no UI)          ~1 wk
MW2  Compare any two runs (UI over MW1)                      ~1.5 wks
MW3  Historical KPIs + trend series                          ~2 wks
MW4  Recurring analyses (cadence)                            ~2 wks
MW5  Long-term operational insight (rollups, regressions)    ~2 wks
```

Sequenced so that each milestone ships something usable on its own, and so that
nothing renders a number before the machinery exists to say whether that number
means anything.

### MW1 — Comparability verdict and run diff

Pure functions over two `AnalysisRun` artifacts. No storage, no UI, no route.

- `compareRuns(a, b)` returns the verdict above plus a structured diff:
  per-signal instance counts, per-signal priced cost, totals, and the set of
  configuration fields that differ.
- Golden-tested the way the engine is. Determinism is the whole point: the same
  two artifacts always produce the same verdict and the same diff.
- Boundary: lives in a pure package, so `dependency-cruiser` forbids it from
  reaching the store, the web app, or a connector.

Deliverable: `renderTrend` is refactored onto it, which means MW1 ships with a
real consumer rather than as speculative infrastructure.

### MW2 — Compare any two runs

- Pick two runs from a workspace's history and see the diff, with the verdict
  displayed first rather than buried.
- A `not-comparable` pair renders an explanation of what differs, not a chart.
- Reachable from the report view ("compare to…") and from the workspace's run
  history.
- Server-rendered, no client JavaScript, consistent with the strict CSP.

### MW3 — Historical KPIs and trend series

The first milestone that needs a decision rather than only construction: which
numbers are the KPIs. Proposal, all derived from what the engine already emits
so nothing is invented:

| KPI | Source | Why it earns a slot |
|---|---|---|
| Total priced friction cost | sum of `estimates` | The headline number the product exists to produce |
| Priced coverage | `pricing` priced vs skipped | A cost that moved because coverage moved is not an improvement, and this is what exposes that |
| Friction instances by signal | `frictions` grouped by `signalId` | Where the cost is concentrated |
| Detector participation | `detectors` ran vs skipped | Guards against a series that moved because a detector stopped running |
| Scope size | `batch` item count | Normalizes for a team that simply got bigger |

Note the shape of that list. Three of the five exist to keep the other two
honest. A KPI page that shows only total cost invites exactly the false
conclusions section 3 warns about.

**Storage.** A twelve-point series means twelve `run.json` parses. That is
acceptable at current volume and will not be at scale. The upgrade path is a
`run_metrics` projection keyed by `(tenant_id, run_id)`, and the rule for it is
non-negotiable: it is a **cache derived from `run.json`, never a source of
truth**, so it can be dropped and rebuilt at any time and can never drift from
the artifact. Build it when a real workspace crosses roughly 50 runs, not
before. Adding it is one table and a backfill, which is why P4.5 deliberately
did not add per-run metric columns.

**Irregular sampling.** Until MW4, runs are ad hoc, so the x-axis is uneven. The
series must be drawn against real timestamps rather than run ordinals, and must
not interpolate. Do not draw a smooth line through three runs eleven weeks
apart.

### MW4 — Recurring analyses

This is what turns a Monitoring Workspace from a folder into a monitor, and it
is the milestone with real infrastructure risk.

- A workspace can run on a cadence (weekly, monthly).
- Needs: a scheduler safe across two Railway replicas (a database advisory lock
  or a claim row, not an in-process timer), idempotency so a retry cannot
  double-run, failure handling that surfaces in the product rather than only in
  logs, and a per-tenant rate ceiling so a scheduled fleet cannot exhaust a
  connector's API budget.
- The existing `jobs` table and job runner are the foundation; this adds
  triggering and claiming, not a second execution path.
- Depends on nothing in MW1–MW3, so it can move earlier if cadence matters more
  than comparison. It is placed here because a trend of irregular manual runs is
  still useful, while a scheduler that produces uncomparable runs is not.

### MW5 — Long-term operational insight

Only meaningful once MW3 and MW4 have accumulated real series.

- **Organization rollup**: every Monitoring Workspace side by side, so
  Engineering and Support are comparable at a glance.
- **Regression detection**: flag a workspace whose cost rose beyond a declared
  threshold across comparable runs. Deterministic and explainable, using the
  same posture as the customer health score: declared rules, shown to the user,
  never a model.
- **Change attribution**: when a total moves, name which signals moved it. The
  diff from MW1 already contains this; MW5 surfaces it at the org level.
- **Digest**: a periodic summary of what changed. Requires an email path, which
  the product does not currently have (invitations aside), so scope this
  honestly or defer it.

## 5. Data model: what changes, and what deliberately does not

**No schema change is required for MW1, MW2, or MW3.** That is the point of the
P4.5 groundwork and it should survive contact with implementation.

Additive, when the milestone that needs it arrives:

- `run_metrics` (MW3, only past roughly 50 runs per workspace): derived cache,
  rebuildable, never authoritative.
- `workspace_schedules` (MW4): cadence, next run, last claim, owner.

Deliberately **not** added, and reviewers should push back if they appear:

- Per-run metric columns on `runs`. The artifact already holds them.
- A configuration snapshot table. `run.json` embeds its assumption set.
- Any table or column per signal or per KPI. New signals must not require
  migrations, for the same reason new event types must not (see the events
  table contract in P4.5).

## 6. Relationship to Operational Intelligence

MW1's comparability verdict is a prerequisite for one specific Operational
Intelligence capability and not for the rest. Doc 07 §4.2 ranks decisions partly
by **decay urgency** — frictions whose cost is worsening across runs outrank
static ones of equal size — and that comparison is only honest on a `comparable`
pair. OI1 therefore ships without decay urgency, and gains it when MW1 lands.

Nothing else in Operational Intelligence depends on this document.

## 7. Non-goals

- **No forecasting, no ML, no anomaly detection by model.** The product's
  credibility rests on every number being reconstructible. A predicted number is
  not. Regression detection in MW5 is a declared threshold, not a learned one.
  (Doc 07 §5 admits versioned deterministic statistical projection as a distinct,
  separately labelled register; that is a later question, not MW5's.)
- **No cross-tenant benchmarking** ("you are worse than similar teams") without
  explicit opt-in. It leaks customer data by construction, and N7 stands.
- **No individual-level trends.** ADR-0002 and ADR-0006 apply with more force
  over time, not less: a per-person cost or rate series is a performance
  management tool, and CostFlow is deliberately not one.
- **No new client JavaScript.** Charts are server-rendered SVG under the
  existing CSP. This constrains interactivity and that is an accepted trade.

## 8. Open questions for the founder

1. **Cadence priority.** Does MW4 move ahead of MW3? Scheduled runs make every
   later series better, at the cost of shipping infrastructure before the
   feature that motivates it.
2. **KPI list.** Section 4's MW3 table is a proposal. The three "honesty" KPIs
   are the ones most likely to be cut for looking less impressive, and are the
   ones most worth keeping.
3. **Digest delivery.** MW5's digest needs outbound email. Is that in scope, or
   does the insight stay in-product?
4. **Retention.** Runs are append-only forever. At some volume that becomes a
   cost and a GDPR surface. A retention policy is a product decision, not an
   engineering one.
