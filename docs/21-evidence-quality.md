# 21 — Evidence quality in the canonical model (MC-5 Part B)

**Status: proposal awaiting approval.** Nothing here is authorized for
implementation. It introduces a concept into `packages/domain`, which means it
enters the artifact and therefore the permanent language of the platform, so it
is reviewed before it is written.

Part A of MC-5 shipped separately (`1021e30`): a connector-layer correction,
no engine change. This document covers only Part B.

## 1. What forced the question

The ClickUp transform reconstructs an ordered event chain from time-in-status
entries (CU1). Every emitted timestamp is a real observed instant, so the
reconstruction is honest — but it carries a documented limitation: a status
revisited N times keeps only its latest entry instant, so bounce sequences
collapse. Total wait is conserved and never overstated, while **hours can shift
between adjacent stages**.

D3 serial gatekeeping is a claim about per-stage wait attribution. So a
D3 finding computed from reconstructed events is genuinely less reliable than
one computed from a changelog, and presenting both at the same confidence grade
would overclaim.

The engine can already express "less reliable": `ConfidenceCap` composed by
minimum, with the binding constraint named. What is missing is a way for the
fact to *reach* the diagnostic without the diagnostic learning what ClickUp is.

## 2. Why not `eventProvenance`

The obvious move is a field on `ImportBatch`:

```ts
eventProvenance: 'observed-transitions' | 'reconstructed-from-residency' | 'arrival-only'
```

Rejected. Consider what that union accumulates. Monday derives events one way,
Asana another, ClickUp a third; each new connector wants a value describing *how
it derives events*. Within a year it is a catalogue of per-provider derivation
styles living in `packages/domain` — a **provider taxonomy wearing a domain
name**, which doc 06 N4 exists to prevent.

The failure is not that the union gets long. It is that each new value is a
connector implementation detail promoted into the core language.

A quality framing does not have that failure mode, because it is keyed on **what
is weak about the evidence, not on who produced it**. Two unrelated platforms
with the same weakness get the same note, and a connector that changes its
derivation strategy without changing what is weak changes nothing here.

## 3. The concept already exists, six times, as prose

This is not a speculative abstraction. Every confidence cap in the codebase was
surveyed; they are not sixteen heuristics but a handful of recurring kinds,
currently expressed as free text inside individual cost models where nothing
downstream can reason about them:

| Recurring kind | Existing instance |
|---|---|
| derived, not observed | "Durations inferred from snapshot dates, not event history" (aging) |
| partial coverage | "N items in queue/review stages have no event history" (queue-wait) |
| open interval | "Includes open stage intervals measured to the analysis time" (queue-wait) |
| ambiguous semantics | "M of N items share a single due date — dates may encode a milestone gate" (overdue) |
| assumption ownership | "…is vendor-suggested (unconfirmed)" (×5, plus rate resolution) |

Doc 07 §4.4 already states the aspiration this serves: display the binding
constraint *by name* so a grade becomes an action — "upload history → this
becomes A." OI1 delivered exactly that for **unavailability**, via the
four-reason absence taxonomy. It remains undelivered for **degradation**,
because the reason is prose. This is the same idea one level down.

### 3.1 What is deliberately NOT evidence quality

**Assumption ownership.** Already a first-class four-state concept attached to
the assumption set (doc 03 P4: `vendor-suggested` / `customer-accepted` /
`customer-customized` / `customer-measured`). It describes who owns an input,
not what was observed. It stays exactly where it is.

**Representativeness.** The outlier and sample-size caps in the diagnostics
layer ("a single item accounts for 90% of this stage's total"; "the comparison
rests on 6 items") say nothing about evidence quality. The observations are
perfectly good; the *distribution* is skewed or the *sample* is small. Those are
properties of the inference being drawn, not of the data.

This distinction is load-bearing and is the reason the register lives on the
batch: **`ImportBatch` describes the data, never what anyone concludes from
it.** A diagnostic's own caps are computed at inference time and stay in the
diagnostic. The moment a conclusion-shaped fact is allowed onto the batch, the
batch stops being a record of an import.

## 4. The proposal

```ts
// packages/domain/src/evidence.ts

export const EVIDENCE_WEAKNESSES = [
  'derived-not-observed',   // the value was inferred, not read
  'partial-coverage',       // some subjects were not observed at all
  'open-interval',          // the observation window is truncated at analysis time
  'collapsed-repetition',   // repeated states merged; order or duration is approximate
  'ambiguous-semantics',    // the field may not mean what it is treated as
] as const;

export type EvidenceWeakness = (typeof EVIDENCE_WEAKNESSES)[number];

export const EVIDENCE_SUBJECTS = ['events', 'items', 'actors', 'commitments'] as const;

export type EvidenceSubject = (typeof EVIDENCE_SUBJECTS)[number];

export interface EvidenceNote {
  readonly weakness: EvidenceWeakness;
  readonly subject: EvidenceSubject;
  /** Values-safe, human-readable; rendered as a confidence reason. */
  readonly detail: string;
}
```

on `ImportBatch.evidence: readonly EvidenceNote[]`.

**Both unions are CLOSED.** A new weakness is a domain decision requiring an ADR
amendment, at the same level of deliberation as a new `FrictionSignal` or a new
`StageKind` — deliberately unlike `EventType`, which is open precisely so
analytics never needs a migration. The asymmetry is the point: analytics
vocabulary should be cheap to extend, and the language the engine reasons in
should not be.

### 4.1 `subject`, and why it is not a field list

The first draft of this proposal used `scope: 'events' | 'stages' | 'due-dates'
| 'actors' | 'items'`. That was a list of the canonical model's fields wearing
the name of a concept, and it was corrected under review. Two changes:

**The governing rule.** `subject` names the canonical concept whose
**observations** are weak — never the inference that suffers from it. CU1's
bounce collapse is `subject: 'events'` (the sequence is what is approximate),
not `'stages'` (which is merely what gets misattributed downstream). A
diagnostic already knows that per-stage wait derives from events; connecting the
two is the consumer's job, correctly placed.

**Only members with a real instance.** Applying that rule:

| Subject | Real instance today |
|---|---|
| `events` | CU1 collapse; missing history; open intervals |
| `items` | rows dropped at ingestion |
| `actors` | CU3 — multi-assignee tasks keep only the primary assignee |
| `commitments` | shared due dates that encode a milestone gate |

`stages` was dropped: no stage-scoped observational weakness exists, and it was
invented for symmetry. `due-dates` became `commitments`, which names the concept
(the customer's own delivery commitment) rather than the field, and generalizes
to SLAs and targets without renaming.

**The growth test**, which is what the review was for: a future weakness about
dependencies, estimates or capacity adds a subject *only when the canonical
model gains that concept* — and gaining a canonical concept is already a domain
decision. The union grows with the domain's vocabulary, never with a connector's
capabilities. That is the property that distinguishes this from a field list.

## 5. Layering: why each piece sits where it does

**`EvidenceWeakness` / `EvidenceNote` in `domain`.** They are part of
`ImportBatch`, and `ImportBatch` is domain's. Nothing else is possible without
the type escaping its own structure.

**The value set in `ingestion`.** The fact exists only at the moment of
derivation. A downstream layer would have to infer "these events were
reconstructed" from the events themselves, which is re-deriving engine law at
the edges — the exact mistake corrected in `63aafa6`.

*Why not one layer higher (friction/analysis)?* Detectors consume `batch.events`
and structurally cannot recover how those events came to be. By the time
friction sees them, the information is gone.

*Why not the connector or app layer, avoiding the engine entirely?* Because runs
outlive their provider. Switching a workspace's provider resets setup but keeps
the append-only runs, so a run's current workspace provider is not evidence about
what produced that run. And NFR-2 requires the artifact to be self-contained: a
number must stay reconstructible from the artifact alone, forever. A quality
caveat that lives outside the artifact is lost the moment the run is stored.
This is the same argument doc 19 §3 makes for the comparability verdict.

**`friction` does not change.** Stated as a finding rather than an omission: the
weakness is batch-level, and diagnostics read the batch, so no detector and no
cost model is touched. The frozen engine's *behaviour* is unchanged; only the
artifact gains a field.

**`diagnostics` stays quality-blind.** Detectors do not read `batch.evidence`,
for the same reason the portability test forbids them from reading
`batch.capability`: translation is the app edge's job. They accept inherited
`ConfidenceCap[]` and compose them with their own, which the engine already does
by minimum. A diagnostic therefore never learns what a weakness *is* — only that
its confidence is capped.

**`apps/web` translates.** `evidence.ts` already turns connector plus config
plus import into an `EvidenceProfile`; it gains a second output, turning
`EvidenceNote[]` into `ConfidenceCap[]` and authoring the customer-facing
sentence.

## 6. Compatibility, and the one hard constraint

**Old artifacts.** `parseRun` is an unchecked `JSON.parse(...) as AnalysisRun`
with no validation, so a stored run written before this change parses cleanly
with `batch.evidence === undefined`. Every consumer must treat that as
**unknown, never as empty**: `undefined` means "this run predates the concept",
while `[]` means "we looked and found nothing weak". Defaulting the former to
the latter would retroactively claim a clean bill of health for every historical
run.

**The hard constraint.** Evidence-derived caps apply to **diagnostics only,
never to cost estimates**. Letting one reach the cost path would change the
displayed confidence of every historical priced number, which is the one thing a
frozen engine must never do. This is an acceptance criterion, not a guideline.

**Existing reports.** Unaffected. The section is additive; a run with no notes
renders exactly as it does today.

**Migration.** None. `run_json` is `text`, so no schema change and no backfill.
Old runs render as they always have and gain an unknown-provenance cap on
diagnostics if they carry events.

**Goldens.** All six regenerate, because `ImportBatch` is embedded in every
`run.json`. Five gain `"evidence": []`; `demo-clickup` gains one note. **Every
`report.md` must be byte-identical** — reporting does not render the field — and
that should be an explicit acceptance criterion rather than an expectation, so
the diff is provably additive.

## 7. Scope discipline

Per docs/20's rule, this introduces the concept and uses it for the one case
that demands it. It does **not** retrofit the five existing prose caps. They
migrate when they are next touched for another reason. Retrofitting now would
regenerate cost-model goldens for no behavioural gain and would put the hard
constraint in §6 at risk for no return.

## 8. Open questions

1. **Does `collapsed-repetition` deserve its own member**, or is it
   `derived-not-observed` with a detail string? It is the only member introduced
   without a pre-existing prose instance, which by this document's own standard
   is the weakest of the five.
2. **Should `EvidenceNote` carry a magnitude** (how many items were affected)?
   The existing prose caps do — "N item(s) have no event history". Adding it
   makes the note self-describing; leaving it out keeps `detail` as the only
   place a number lives, which is the current inconsistency.
3. **Does the app layer author the cap text, or does `detail` become it
   directly?** The latter is simpler and keeps one sentence; the former allows
   customer-facing copy to differ from the engine's internal record.
