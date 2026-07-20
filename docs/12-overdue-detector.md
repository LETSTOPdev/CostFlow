# 12 — The Overdue Detector: Design Before Implementation

**Status: design only. No implementation, no scaffolding, no roadmap change.
Grounded in M1 cycle-1 evidence (cu01, 2026-07-20); all cu01 figures below are
counts and aggregates from the values-free session record — no partner content.**

The question this document answers:

> How should an Overdue Detector be designed so it satisfies the same
> integrity, determinism, explainability, and auditability standards as F2?

---

## 0. The first design decision: "Overdue" is a family, not a detector

Challenging the premise before designing into it: "overdue" conflates two
different mechanisms with different data needs, different cost semantics, and
different gaming dynamics:

| | **F3a — Open overdue exposure** | **F3b — Realized late delivery** |
|---|---|---|
| What it detects | In-flight items whose due date has passed | Completed items delivered after their due date |
| Temporal nature | Ongoing — grows every day until resolved | Fixed historical fact |
| Data needed | `dueAt`, current stage, `now` — **all exist in today's model** | Requires `completedAt` — **not in the M0 WorkItem schema** (a documented migration) |
| Cost lens | L1 chasing/escalation attention + (future) L2 deferred value | L3-flavored: realized commitment breach; SLA/trust exposure |
| Exec question answered | "What's late *right now* and bleeding?" | "How reliably do we deliver on promises?" |
| Gaming pressure | Push due dates / delete them | Mark done prematurely |

These must be **separate signals** (`f3-overdue` and a future
`f5-late-delivery` or similar), not modes of one detector: a single "overdue"
instance mixing growing exposure with fixed history would produce a magnitude
that means nothing and a trace that must constantly explain which kind each
term is. The R-11 discriminated-union machinery exists precisely so signal
families stay clean.

**This document designs F3a** (hereafter simply F3). F3b is deferred until the
`completedAt` schema addition gets its own decision — noting that cu01's raw
data already carries the field, so the migration is data-supported when wanted.

## 1. Precise problem definition

An in-flight work item whose customer-stated due date has passed represents a
**commitment breach in progress**: the value the commitment represented is
being deferred, downstream plans built on it are degrading, and the item
consumes chasing/escalation attention until resolved. F3 detects these items,
aggregates them by the stage where the late work currently sits, and prices
the ongoing attention drag deterministically.

F3 is *not* aging (F2). An item can be overdue while actively worked
(commitment breach without neglect) and stale while not yet due (neglect
without breach). Different mechanisms, different fixes, both real.

## 2. Why M1 proved F3 should precede F2

Empirical, from cu01:

1. **F2 was arithmetically incapable of firing**: the workspace was 11 days
   old; the 14-day aging threshold could not be exceeded by any item. This is
   not a tuning accident — every young workspace, every trial, every new team
   has this property. F2's value ramps with workspace age.
2. **The friction that existed was overdue**: 27 of 65 in-flight items past
   due, 224 overdue item-days, on day 11 of the workspace's life. Overdue
   accrues from the *first missed commitment*, not from data maturity.
3. **The threshold provenance is structurally better.** F2's threshold is a
   number *we* ask the customer to invent ("how many days is stale?" — cu01
   answered 14 and it was unusable). F3's threshold is **the due date the
   customer already set, per item, inside their own tool**. The commitment is
   theirs; we never impose a temporal opinion. That is the strongest
   assumption-provenance any detector in the taxonomy can have.
4. **Universality**: every tracker exports due dates; cu01 could not export
   event history at all. Snapshot + due dates is the lowest common denominator
   of real customer data, and F3 lives entirely on it.

## 3. Required inputs & capability requirements

- **Batch**: `dueAt` mapped and present on at least one item — the existing
  `hasDueDates` capability key, already computed at ingestion. No new
  capability needed. Signal declaration: `requires: ['hasDueDates']`; absent →
  detector skipped visibly (existing FR-11 machinery).
- **Analysis time** `now`: explicit input, validated exactly as R-01 mandates
  (unparseable → throw, never silent).
- **Assumptions** (pricing only): rate card + default rate (existing); new
  **optional** parameter `overdueAttentionHoursPerDay: {range, provenance}` —
  the assumed daily chasing/escalation effort an overdue item consumes.
  Optional like the queue-wait parameter: absent → friction detected and
  reported **unpriced** with the missing input named (FR-13). It must NOT
  reuse `attentionHoursPerDay` (F2's) — chasing a breached commitment and
  glancing at a stale card are different behaviors; conflating them would make
  both assumptions un-editable independently.

## 4. Deterministic detection algorithm

For each item in the batch, in a single pass:

1. Exclude if `stage.kind ∈ {done, abandoned}` (F3a is open exposure only).
2. Exclude if `dueAt` is null (coverage is *reported*, see §12).
3. Compute `overdueDays = floor((now − dueAt) / 86_400_000 ms)` using the
   existing `wholeDaysBetween` (UTC, pure arithmetic).
4. Exclude if `overdueDays < 1` (day granularity, consistent with F2; an item
   overdue by hours appears tomorrow, never fractionally).
5. Group survivors by current stage name (structural attribution, N1).
   Instance id `f3-overdue:<stage-slug>`; magnitude
   `{unit: 'item-days-overdue', value: Σ overdueDays}`.
6. Order: evidence by `overdueDays` desc then item id; instances by magnitude
   desc then id — the exact tie-break discipline of F1/F2.

No randomness, no clock, no configuration beyond the inputs — same purity
contract as the existing detectors, enforced by the same lint/depcruise fence.

**Why group by current stage** (challenged): the commitment is about the item,
not the stage — but attribution to the stage where late work *currently sits*
is what makes the finding actionable ("your overdue work is pooled in
queue-kind Open" was literally cu01's situation) and keeps the N1 rule intact:
we name process locations, never people.

## 5. Evidence model

```
OverdueEvidence {
  workItemId, title, actor            // ActorRef — role | pseudonym | missing
  dueAt                               // the customer's own commitment
  overdueDays                         // floor days past due at `now`
  dueBeforeCreated: boolean           // true when dueAt < createdAt — bulk-import
                                      //   artifact flag, disclosed not hidden
  sharedDueDateCohortSize: number     // how many OTHER overdue items in the batch
                                      //   share this exact dueAt timestamp (§7)
}
OverdueInstance { frictionType: 'overdue', evidence: OverdueEvidence[], ... }
```

Extends the R-11 discriminated union; the wrong cost model cannot type-check
against it, same as today. The two disclosure fields exist because cu01 showed
both phenomena (gate-clustered due dates; items created around bulk deadlines)
and hiding them would make traces lie by omission.

## 6. Cost model — `cm-overdue-attention@1.0.0`

**Formula**: `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(actor-role)`
— interval arithmetic on the assumption range, exact decimals, rounding only
at display; identical algebra to the two existing models, sharing the same
range/decimal/rate machinery (no new arithmetic surface).

**Declared bias (doc 03 P3 discipline):** linear in overdue-days and therefore
almost certainly an **underestimate** — real chasing effort escalates with
lateness, and deferred business value (L2) is not priced at all until
ValueAttribution exists. An escalation curve was considered and **rejected**:
any super-linear exponent would be an invented parameter with no defensible
provenance. Conservative and explainable beats dramatic and assailable.

**Rejected alternative — pricing deferred value from thin air**: without
customer ValueAttribution there is no honest per-day value number. The L2
model arrives when ValueAttribution does (doc 02 already reserves it); until
then the trace says so.

## 7. Confidence model

Mechanical caps, min-composed, binding constraint named — the existing system,
with F3-specific inputs:

| Cap | Tier | Why |
|---|---|---|
| *(none for temporal basis)* | — | **Unlike F2, overdue-days are NOT inferred**: `dueAt` is an explicit customer commitment and `now` is the pinned cutoff. F3 is the first snapshot detector that can honestly reach **A**. |
| Due-date clustering | B | If > 50% of an instance's evidence shares one exact `dueAt` timestamp (`sharedDueDateCohortSize`), the dates likely encode a milestone gate, not per-item commitments (cu01 DQ-2: three gate dates). Reason names the cohort share. The 50% constant is part of the signal's versioned semantics, not a tunable. |
| `dueBeforeCreated` present | B | Items due before they existed indicate bulk-set dates; the commitment semantics are suspect for those terms. |
| Default rate used (missing/unmapped actor) | C | Existing `resolveActorRate` caps, unchanged. |
| `overdueAttentionHoursPerDay` provenance = default | C | Existing default-assumption discipline. |

The clustering cap is the design's answer to cu01's UA-2 (gates vs
commitments): we cannot resolve the semantics from data, so we *grade* the
finding and name why, instead of either refusing or pretending.

## 8. Formula trace requirements

Same four-questions contract (doc 03 E1), with F3-specific term type:

```
OverdueTraceTerm {
  kind: 'overdue-attention',
  workItemId, overdueDays, dueAt,
  attentionHoursPerDay: RangeSpec, hourlyRate, rateSource, subtotal: RangeSpec
}
```

`assumptionsUsed` carries `overdueAttentionHoursPerDay` + every rate source
with provenance. The claim reads: *"Estimated chasing cost of N item(s) past
their own due dates in stage X"* — deliberately anchoring that the threshold
is the customer's, not ours. `dueAt` appears in the trace because an auditor's
first question will be "overdue relative to what?"

## 9. Edge cases (all deterministic, none silently repaired)

| Case | Behavior |
|---|---|
| Due exactly at `now` / overdue < 24h | `overdueDays = 0` → excluded today, appears tomorrow. Documented day-granularity choice, consistent with F2. |
| `dueAt` in the future | Not overdue; ignored by F3 (no "at-risk" speculation — that would be prediction, doc 07's rules apply). |
| `dueAt` < `createdAt` | Included (the math is the math) with `dueBeforeCreated: true` disclosed + B cap (§7). |
| Overdue item in `blocked` stage | Included — a breach is a breach; the stage grouping shows it's blocked, which is the actionable part. |
| Absurdly old due dates (years) | Included as-is; magnitude stays honest. Preflight already surfaces date distributions for the operator conversation. |
| Unparseable due value | Already nulled with a row diagnostic at ingestion (existing behavior) → item simply lacks a due date. |
| Date-only `dueAt` (`YYYY-MM-DD` = midnight UTC) vs end-of-day intent | Known ±1-day semantic at day boundaries; floor granularity absorbs most of it; documented limitation, not patched with timezone guessing. |
| Recurring tasks (rolling due dates) | Snapshot sees the current instance only; documented limitation. |
| Done items past due | **Excluded** — that is F3b's job (§0), not F3a's. |

## 10. Interaction with existing F2 results

- **Invariance is a tested contract**: adding F3 must not change any byte of
  F2 (or F1) output — same test pattern as Slice 2's events-invariance.
- **Overlap is real and disclosed, not netted**: an item can be both overdue
  and aging (breached *and* neglected). The two instances price different
  attention behaviors and both stand. But the ranked table must not be
  mentally summed across signals — the doc 07 N12 rule (no naive summation)
  starts applying the moment two signals can hit the same item. Design
  requirement: the report's methodology note states that per-signal estimates
  are independent lenses and not additive; portfolio-level joint pricing is
  the decision layer's job, not v1's.

## 11. Ranking behavior

No new rules: instances enter the existing cross-signal ranking (expected
desc, low desc, id) — deterministic tie-breaks already proven multi-signal in
Slice 2. Expected consequence worth stating: on young workspaces F3 will
dominate rank 1; on mature ones F2/F1 catch up. That is the ordering being
*evidence-driven*, which is the whole product thesis.

## 12. Skip and exclusion reasons (all visible)

- **Detector skipped** (batch-level): `hasDueDates` false → existing skip
  mechanism with reason.
- **Pricing skipped**: `overdueAttentionHoursPerDay` absent → unpriced
  friction with the missing input named (existing FR-13 path).
- **Item exclusions** (not skips, definitionally out of scope): terminal
  stage, no due date, not yet due, overdue < 1 day.
- **Coverage disclosure** (new requirement, cheap): the report's Data section
  should state *"N of M in-flight items carry due dates"* — because F3's
  blind spot is exactly the items without commitments, and §17 depends on
  this number being visible.

## 13. Assumptions that must remain explicit

1. `overdueAttentionHoursPerDay` — range + provenance, customer-editable,
   independent from F2's parameter.
2. Rates + default rate — existing, provenance-tracked.
3. **Linearity** — declared in the model's documented bias.
4. **Due-date-as-commitment interpretation** — surfaced via the clustering
   cap and the coverage line; ultimately a partner conversation (UA-2), and
   the trace never hides which items carried suspect semantics.
5. Day granularity and the 50% clustering constant — versioned signal
   semantics, changing them bumps the signal version.

## 14. Worked example from cu01 (aggregates only; illustrative pricing)

Observed at cutoff: 27 of 65 in-flight items overdue; 224 overdue item-days;
max single-item lateness 11 days; due dates clustered on three shared gate
timestamps; 15 of 79 items unassigned overall.

Illustrative pricing with `overdueAttentionHoursPerDay = {0.15, 0.3, 0.6}`
(had the partner confirmed it) and the confirmed rates (Founder 50, default 30):

- If, say, 200 of those item-days sit on role-mapped items and 24 on
  unassigned ones: expected ≈ (200 × 0.3 × 50) + (24 × 0.3 × 30) =
  3,000 + 216 = **~3,216 USD**, range ≈ 1,608–6,432 USD for the period.
- Confidence: **B**, binding constraint = due-date clustering (three shared
  gate dates cover most evidence), with the C-cap on the unassigned subset's
  default rate surfacing in the affected instance.
- Contrast with the actual cu01 run: F2 produced zero findings on the same
  data. This example *is* the argument.

(Exact per-stage instances would come from the real run; these figures are
arithmetic on the recorded aggregates, labeled illustrative, and match how the
memo reported them — no partner values.)

## 15. Versioning strategy

`f3-overdue@1.0.0` + `cm-overdue-attention@1.0.0`, registered in the existing
signal list and cost-model registry (the R-11 mechanism needs no changes —
this is its second consumer, which is itself the test of that design).
Evidence union extension follows the Slice 2 pattern. Established policy
applies: versions bump only when valid-input outputs can change; the day
granularity and clustering constant are version-bound semantics. Run artifacts
pin all versions as today; goldens change only via `golden:update` with a
justification entry.

## 16. Tests that must exist before implementation

1. **Golden**: extend `demo-ops` expectations — the existing fixture already
   contains overdue items (hand-computation first: at the fixture's `now`,
   item 1001 is 35d past due, 1003 49d, 1004 20d; 1002/1005/1010 not yet due;
   1007 has no due date), so F3 will change demo-ops golden output in a
   hand-verified way. `demo-flow` gains F3 rows similarly or a due-date-free
   variant proves the skip path.
2. **Detector units**: each exclusion rule; the exactly-at-due boundary;
   `dueBeforeCreated` flagging; clustering cohort computation; stage grouping;
   deterministic ordering; double-run determinism; R-01 throw on bad `now`.
3. **Confidence**: A-tier achievable (customer assumptions, no clustering);
   each cap fires mechanically; min-composition with named binding constraint.
4. **Registry/types**: dispatch routes `f3-overdue` to its model only;
   runtime guard throws cross-signal; `@ts-expect-error` compile guards
   extended; unpriced path without the assumption.
5. **Invariance**: F2 and F1 outputs byte-identical with F3 present.
6. **Trace completeness**: every rendered number resolves to a term;
   `dueAt` present in every term.
7. **Privacy**: existing golden privacy sweep covers new artifacts unchanged.

## 17. Failure modes

- **Bulk-imported fake due dates** → large, confidently-wrong-looking
  magnitude. Defenses: clustering cap (B + named reason), `dueBeforeCreated`
  disclosure, preflight date-distribution conversation. Residual risk: real
  but graded, never hidden.
- **Due-date deletion after a bad report** → findings evaporate while reality
  worsens. Defense: the §12 coverage line makes deletion *visible* ("due-date
  coverage fell from 68% to 30% since the last run" is itself a trend
  insight); see §18.
- **Milestone-gate semantics** (cu01's actual situation) → priced "breach"
  that the team internally considers a soft gate. Defense: clustering cap +
  UA-2 as a mandatory intake question in the partner checklist.
- **Double-counting anxiety** with F2 → §10's non-additivity statement; the
  risk is a reader's mental sum, and the methodology note owns it.

## 18. Why this detector resists gaming (and where it honestly doesn't)

- **No individual scoring** (N1, enforced at the reporting layer): no person
  is ranked, so the personal incentive to falsify is structurally blunted —
  the report names stages and roles, not people.
- **The metric is the customer's own commitment**: gaming F3 means editing
  your own due dates, which is visible to the team in their own tool — unlike
  gaming an opaque vendor metric, it defaces an artifact they use daily.
- **Deletion and deferral are detectable as trends**: due-date *coverage* is
  printed per run (§12), and run-to-run diffs (the existing trend machinery)
  expose coverage drops and date pushes as first-class changes.
- **Honest residual**: a snapshot cannot see date edits between runs; only
  event history or run-cadence can. F3 v1 is gameable by a determined team —
  the design's position is that grading and disclosure beat surveillance, and
  the audience (executives buying prioritization) is not incentivized to game
  their own diagnostic.

## 19. Recommendation

**Implement F3 (`f3-overdue`, open-exposure family) as the first post-M0
detector.** The cu01 evidence supports it over every alternative considered:

- **vs F6 WIP overload** (the other snapshot candidate; 38-item queue pool in
  cu01): F6's cost model rests on a literature-derived context-switching drag
  factor — a C-confidence number by construction, and *our* assumption, not
  the customer's. F3's temporal facts are customer-authored and A-capable.
  First real dollar figures should ride on the most defensible provenance
  available. F6 second.
- **vs F1**: unavailable for this dataset class (event history API-gated) —
  settled by M1.
- **vs F3b late-delivery**: needs the `completedAt` schema migration; ship
  F3a value first, decide the migration deliberately.

Pairing note (not a roadmap change): MC-6 (the threshold-vs-dataset-age
warning) is a natural rider on the same slice, because F3's arrival is what
makes an F2-empty report acceptable rather than embarrassing.

One honest caveat: this recommendation generalizes from one partner (n=1, a
young sprint workspace). The design survives that caveat because F3 is
additive — it does not demote F2, whose value returns as datasets age; the
ordering claim ("F3 first") is about implementation sequence, not detector
worth. Re-running cu01 in a week, when F2 becomes arithmetically able to
fire, is the cheapest second data point available.
