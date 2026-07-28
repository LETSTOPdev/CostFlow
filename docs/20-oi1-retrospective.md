# 20 — OI1 engineering retrospective, and the deferred-refactor register

**Status: reference document.** Written immediately after OI1 shipped
(`63aafa6`, 2026-07-28), while the reasoning was still recoverable. Its job is
to be the thing a future contributor reads *before* refactoring the diagnostics
layer, so that work happens once, deliberately, and for a reason that has
actually arrived.

## 0. The governing rule

> **Refactor because reality demands it, not because we can already imagine it.**

Founder directive, 2026-07-28. Everything in §4 is real debt with a real cost,
and none of it is worth paying down on speculation. The register exists so that
when the cost does arrive, nobody has to rediscover the analysis — not so that
someone can work through it as a checklist.

Two categories, and the distinction is the point:

- **Blocking debt** — wrong behaviour, or a trap that fires without anyone
  looking. Fixed immediately (§3).
- **Latent debt** — duplication and missing abstraction that costs nothing today
  and compounds only when another diagnostic arrives. Deferred, with the trigger
  named (§4).

## 1. What proved successful, and should be copied

- **Capability gating as a declared requirement.** `requires: EvidenceCapability[]`
  plus `checkCapabilities` mirrors `FrictionSignalMeta.requires` one layer up.
  That inheritance is why an unavailable diagnostic became a product surface
  ("here is the evidence you are missing") rather than an empty panel, and why
  adding a platform is a `provides` declaration instead of a branch.
- **Computing from the stored artifact at render time.** No pure package
  changed, so no golden regenerated, so the frozen-engine rule never came up.
  This is why three diagnostics shipped in a day, and it should be the default
  posture for any read-only layer until something genuinely needs to live in
  the artifact.
- **Mechanical enforcement over stated intent.** The connector-blindness test
  caught provider names in the author's own doc comments. Intent would have
  shipped them, and the first special-case branch would have been written next
  to them.
- **Validating against real customer data before implementing.** The highest
  leverage decision in the milestone. It removed D2 (undeliverable without event
  history *and* two actors), produced DC (which works on every platform), and
  promoted MC-5 from a footnote to a sequenced milestone. Without it, two of the
  three flagship diagnostics could not have run for most of the install base.
- **Looking at rendered output before shipping.** Caught a ranking bug that no
  unit test would have: cards sorted by share alone put a 76%-of-one-item
  outlier above a solid finding, which is the exact failure doc 07 §1.4 names.

Both process wins reduce to the same lesson: **look at the real thing early.**

## 2. Abstractions that are thinner than they look

Not defects, but a joiner should not mistake them for load-bearing design.

- **`DiagnosticOutcome` is exported and unused.** Every detector returns a
  bespoke `{ findings, unavailable: X | null }`. It is a shape waiting for the
  registry in §4 to make it real.
- **Four of the eight evidence capabilities are placeholders.**
  `assignment-history`, `dependency-graph`, `approval-chain` and
  `capacity-signals` are hardcoded `false`, have no consumer, and — for the last
  two — no definition of what would ever set them true. The vocabulary earns its
  place by making the roadmap legible, which was deliberate, but half of it is
  currently a signpost rather than a model.

## 3. Fixed, because they were blocking

- **Confidence tier ordering was re-derived from the letters.** The render layer
  ranked by `localeCompare` on `'A' | 'B' | 'C'`, correct only by the
  coincidence that the letters run strongest-to-weakest. `cost-engine` owned the
  canonical `ORDER` map but kept it private. Latent silent failure in the exact
  ranking doc 07 §1.4 makes load-bearing. Fixed by exporting
  `byStrongestConfidence` and typing `bestTier` as `ConfidenceTier` (`63aafa6`).
- **`NOT_BUILT` and `realized()` were two lists that had to agree.** Teaching
  the derivation a new capability without updating the list would tell a
  customer "CostFlow does not read this yet" about something it now reads.
  Pinned by a test asserting the two cannot drift.
- **`INTERVENTION_BY_UNIT` defaulted silently.** An unmapped magnitude unit fell
  back to `review-queue`, turning a renamed or newly added unit into confident
  but wrong advice. Now `interventionForUnit` returns `null` and the finding is
  dropped: a recommendation the evidence does not support is worse than no
  recommendation. Skipping rather than throwing is deliberate — with two
  replicas, a rolling deploy guarantees the older one reads artifacts from the
  newer engine, so an unknown unit is an expected transient. Exhaustiveness is
  enforced at build time instead, by a test that walks the goldens and asserts
  every unit the engine actually emits is mapped.

## 4. The deferred-refactor register

Each item states the debt, its real cost today, and **the trigger that makes it
worth doing**. Do not action one because it is listed. Action it when its
trigger fires.

### 4.1 Diagnostic registry

**Debt.** `server.ts` hand-lists the three detectors and flat-maps their
results. A fourth diagnostic that nobody adds there silently never runs, and no
test fails. Composition logic lives in the app layer rather than the package.

**Cost today.** Zero. Three entries, all present, all tested end to end.

**Trigger.** The fourth diagnostic. At that point add `{ meta, detect }` records
and a single `runDiagnostics(run, profile)`, plus a test asserting every
exported diagnostic is registered. This single change also resolves 4.2, 4.3 and
4.4, so do them together rather than piecemeal.

### 4.2 `DiagnosticOutcome` adopted or deleted

**Debt.** Exported, unused (§2).

**Trigger.** The registry in 4.1, which makes it the natural return type. If the
registry is still not needed a year from now, delete the type instead.

### 4.3 Shared capability-gate helper

**Debt.** The check-then-build-`DiagnosticUnavailable` preamble is repeated
verbatim in all three detectors, roughly twelve lines each.

**Cost today.** Thirty-six lines and three chances to forget the gate — all
three currently correct, and pinned by the portability test.

**Trigger.** 4.1. The registry can gate centrally, so the preamble disappears
rather than being extracted.

### 4.4 Shared percentage helper

**Debt.** `pct` is defined identically in three files.

**Trigger.** 4.1, or the fourth definition — whichever comes first.

### 4.5 Generalized magnitude model

**Debt.** `sharePercent` + `shareOf` was designed from three diagnostics that
all happen to express themselves as a share of a total.

**This is the one most likely to bend, and the one worth watching.** Doc 07 D1
(capacity shortfall) is a *rate comparison* — arrival versus completion — not a
share of anything. D9 (batching artifacts) is a distribution shape. Forcing
either into a percentage will distort it or grow a second parallel field.

**Trigger.** The first diagnostic whose magnitude is not a share. Generalize
`magnitude` into a small discriminated union at that point, while there are
three or four call sites rather than ten. Do NOT wait until several non-share
diagnostics have each invented their own workaround.

### 4.6 `MinimumEvidence` as declared metadata

**Debt.** ADR-0006 §7 requires every diagnostic to declare its minimum evidence,
whether shortfall suppresses or downgrades, and why. Today that is a documented
promise; this codebase's idiom is to turn such promises into types (`requires[]`
did exactly that for capabilities).

**Trigger.** Either the fourth diagnostic, or the moment §7's open item is
resolved — DC and D4 suppress below five contributing items while D3 lowers its
grade, and that divergence is currently accidental rather than argued. A
`minimumEvidence: { threshold, onShortfall, rationale }` field on
`DiagnosticSignalMeta` would make §7 unforgettable and give the UI something
honest to render when a diagnostic is silent.

### 4.7 Render-layer styling

**Debt.** `oi-view.ts` uses per-element inline styles; the admin console uses a
single scoped `<style>` block. Two conventions for the same problem.

**Cost today.** Cosmetic and contained.

**Trigger.** The card layout changing, or the diagnostic count reaching roughly
six. Whichever comes first, move to the admin console's pattern rather than
inventing a third.

## 5. Contracts to leave alone

Stable, load-bearing, and not to be "tidied":

- The finding shape's `subject` / `facts` / `statement` / `confidence` /
  `intervention` spine (its `magnitude` half is 4.5's business).
- **`facts` is numbers only.** This is what makes a finding structurally
  incapable of carrying an identity into the rendered bytes, and therefore
  incapable of tripping the attribution guard. It is a privacy control wearing
  a type, not a convenience.
- The four-reason absence taxonomy (`platform-cannot` / `plan-gated` /
  `import-lacked` / `not-built`) and its residence in the app layer. The
  diagnostics package must never learn why a capability is missing.
- Suppress-versus-downgrade as a stated rule (ADR-0006 §7) rather than
  per-diagnostic taste.

## 6. Carried forward, unrelated to OI1

`createJobIfNoneActive` is live on `POST /runs` with no parity test in either
store adapter. Of everything in this document it is the only item that is a
correctness risk in production rather than a maintainability one.
