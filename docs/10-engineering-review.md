# 10 — Engineering Review of M0 Slice 1 (Staff-Engineer Pass)

**Reviewer stance**: incoming staff engineer, no authorship attachment. Claims
were verified empirically where possible — four suspected defects were
reproduced before writing this document. No fixes have been applied; this is
findings only.

**Severity scale**
- **P0** — produces wrong or misleading output; must fix before any real data touches the tool
- **P1** — must fix before the first partner CSV / before slice 2 builds on the flaw
- **P2** — fix opportunistically or alongside the next slice
- **P3** — recorded; no action needed yet

**Verdict up front**: the pure core is genuinely solid — the layering,
versioning, determinism gates, and golden discipline are real, not theater.
The defects cluster in exactly one place: **the effectful edge and the display
layer got a fraction of the rigor the core got**, and the one place the
dependency diagram was "cleverly" preserved (D-7) produced the worst code in
the repo. The overall lesson for slice 2 is written at the end.

---

## 1. Verified defects (reproduced before writing)

### R-01 · P0 · Invalid `--now` produces a confident, silent, WRONG empty report

```
$ costflow analyze ... --now "20/07/2026"
→ exit 0, report says: "No frictions detected above thresholds in this import."
```

`"20/07/2026"` is exactly what a European partner will type. `parseIsoUtc`
returns null inside the detector, every item becomes "not evaluable," and the
product **asserts the absence of friction** instead of failing. For a product
whose entire thesis is honest numbers, a confidently wrong empty answer is the
single worst possible failure mode — worse than a crash. It violates doc 03 P5
directly, and it would have happened in the first partner session.

- **Why it matters**: one partner seeing "no frictions" on a board they know is
  a mess, then discovering the tool ate a malformed date silently, is R1 (trust
  death) delivered by our own hand.
- **Recommended change**: the CLI validates `--now` (and defaults) with
  `parseIsoUtc` and fails loudly on garbage. Deeper: `detectAging` should
  *throw* on unparseable `now` rather than skip — an invalid analysis time is
  a programming/input error, not a data-quality degradation. Degradation
  semantics belong to *item* data only.
- **When**: now. Nothing else ships first.

### R-02 · P0 · The money renderer is hand-rolled, wrong on negatives, and crashes on large values

Verified: `money("-0.5")` renders **"1"** (sign flipped!), `money("-5.7")`
renders "-4" (rounds toward +∞), `money("1e+22")` **throws**. The renderer
hand-parses decimal strings with `BigInt(intPart)` and a first-fraction-digit
check.

Root cause is architectural, not sloppiness: **D-7** (preserving the
doc 05 arrow "reporting → domain, analysis" via re-exports) meant reporting
couldn't use the configured `Money` class — so the flagship number formatter
of an exact-decimal-arithmetic product was reimplemented by hand, badly, in
the one package forbidden from importing the decimal library. The boundary
diagram won; correctness lost. Today all costs are non-negative so the bugs
are latent — but "latent until the first negative-adjustment cost model" is
not a defense. It also contradicts ADR-0001 (display rounding should be
half-even via the pinned class; this is half-up via `Number(frac[0]) >= 5`).

- **Recommended change**: revise doc 05 §3 — `reporting` may import
  `cost-engine` (it is pure; the arrow costs nothing). Delete the hand-rolled
  parser; format via the `Money` class with an explicit display-rounding mode.
  Replace `toLocaleString` with our own grouping while at it (removes the ICU
  dependency from determinism entirely). Kill D-7 in the log with a note.
- **When**: now. This is the number executives see.

### R-03 · P0 · `decToString` emits exponential notation at ≥1e21

Verified: `dec('1e21').toString()` → `"1e+21"`. The "canonical decimal string"
at rest is not canonical: artifacts, golden files, and every string-consuming
path (including R-02's renderer, which throws on it) break at large
magnitudes. Absurd magnitude for one org's aging cost — not absurd once a
cost model multiplies by an unvetted customer-supplied value-per-day.

- **Recommended change**: `decToString` uses `toFixed()` (never exponential);
  add a property test: serialization round-trips and never contains `e`.
  Document canonical serialization in ADR-0001.
- **When**: now — one line plus a test, and it hardens a P0 path.

### R-04 · P1 · Duplicate CSV headers are silently last-wins

Verified: `parse('ID,Status,Status\n1,Open,Closed', {columns: true})` →
`{ID:'1', Status:'Closed'}` — no error, first column silently discarded. Real
exports (especially Monday's, with duplicated column names across groups) will
hit this, and the misread is invisible in diagnostics.

- **Recommended change**: pre-scan the header row; duplicate mapped columns →
  hard import error naming the columns. Duplicates in unmapped columns →
  warning diagnostic.
- **When**: before the first partner CSV.

---

## 2. Edge (CLI + ingestion) findings

### R-05 · P1 · No validation that mapped columns exist in the CSV header

A typo'd mapping (`"Last Update"` vs `"Last Updated"`) silently nulls the
field for every row: titles become `""`, the aging detector reports itself
skipped with a legitimate-looking capability reason. The user is told "your
data lacks last-updated dates" when the truth is "your mapping has a typo."
Wrong diagnosis, honest tone — insidious.

- **Recommended change**: at import start, verify every mapped column exists
  in the header; missing → hard error listing header vs mapping. This is also
  the first brick of the M2 mapping wizard's validation logic — not throwaway.
- **When**: before the first partner CSV.

### R-06 · P1 · No uniqueness check on item ids

Two rows with the same `Item ID` produce two WorkItems with identical `id`.
Evidence lookups in the renderer (`find` by workItemId) become ambiguous,
trace `workItemIds` double-count, and nothing warns. Real exports contain
duplicates (sub-items, copy-paste rows).

- **Recommended change**: detect duplicate source ids during import → per-row
  `warning` diagnostic and deterministic disambiguation (`1001#2`), or drop
  with diagnostic. Never silent.
- **When**: before the first partner CSV.

### R-07 · P1 · Untrusted CSV content is embedded raw into report markdown

Titles/status names containing `|`, backticks, or `](...)` corrupt tables or
inject links into the report. Locally cosmetic; the moment a report is
forwarded (M1 sessions do exactly this), rendering integrity of the flagship
artifact depends on the politeness of customer data. This is the
current-milestone analog of the CSV-injection item doc 08 §11 already promises.

- **Recommended change**: escape `|`, backticks, and bracket sequences in all
  interpolated customer strings in the renderer; one helper, used everywhere.
- **When**: before any report leaves our machines — i.e., with this batch.

### R-08 · P1 · Zero negative-path tests for the CLI

The only layer a partner touches is the only layer with no failure-mode tests:
bad JSON (currently an unhandled stack trace — verified by reading the code:
`JSON.parse` outside any try/catch), missing files, schema violations, bad
`--now` (R-01). The golden test exercises exactly one happy path.

- **Recommended change**: a `cli-errors.test.ts` covering: malformed JSON,
  missing file, schema-invalid mapping/assumptions, bad `--now`, unknown flag.
  Each must exit non-zero with a one-line human message, no stack trace.
- **When**: with the R-01 fix (they're the same work).

### R-09 · P2 · Zod schemas are not `.strict()` and the stage-kind enum can drift

Unknown keys are silently stripped (typo'd optional key = silently ignored
config). Separately, the zod `stageKind` enum duplicates the six literals; the
`satisfies z.ZodType<...>` binding does **not** catch a future seventh kind
(subset assignability passes), so the edge would silently reject a valid new
kind. `STAGE_KINDS` is meanwhile exported from domain and now used by nothing.

- **Recommended change**: `.strict()` on both schemas; derive the zod enum
  from `STAGE_KINDS` (`z.enum(STAGE_KINDS)` with a type-level exhaustiveness
  assertion), deleting the duplication.
- **When**: next time schemas are touched; cheap enough to batch with R-08.

### R-10 · P2 · Assumption ranges accept negative values

`rangeFromSpec` checks ordering, not sign; the decimal regex allows `-`. A
negative attention-hours low produces a negative cost bound — nonsense that
would render (incorrectly — see R-02) rather than being rejected.

- **Recommended change**: non-negativity validation at the edge schema for
  rates and attention ranges (engine-level sign policy can wait until a model
  legitimately needs negative adjustments).
- **When**: with R-09.

---

## 3. Domain / type-model findings

### R-11 · P1 · `FrictionInstance` claims generality it does not have

`FrictionInstance.evidence: readonly AgingEvidence[]` — the "generic" instance
type is hardcoded to one signal's evidence shape, and `runAnalysis` prices
**every** friction through `priceAgingInstance`. With one signal this is
rule-4-compliant minimalism; with two it's a bug factory. The type currently
*lies about the architecture*, and slice 2 (F1) collides with it head-on.

- **Recommended change**: this is the *first task of slice 2, before F1 is
  written*: evidence becomes a discriminated union (or the instance becomes
  `FrictionInstance<E>` closed over a signal-keyed registry), and pricing
  routes through a model registry keyed by `signalId` — the F×→C× contract
  (doc 02 §5) as actual code. Do not bolt F1 onto the current shape.
- **When**: slice 2, as its opening move — flagged now so it's planned, not
  discovered.

### R-12 · P2 · `rateForRole` embeds pricing policy in the domain package

Rate fallback ("no role → default rate") is a cost-model decision living in
`domain`. Harmless with one model; when a second model wants different
fallback semantics (e.g., refuse to price rather than default), policy in the
shared layer becomes a fight. Note-level: move to cost-engine when a second
consumer appears; don't move it speculatively.

### R-13 · P3 · Trace values are pre-formatted display strings

`assumptionsUsed.value` holds strings like `"0.15–0.6 h/day (expected 0.3)"`.
Presentation leaked into the trace data layer; doc 03 E3 wants narrative
*rendered from* structured traces, and structured means machine-readable
values, not en-dashes. Small now, compounding later (the AI-explanation layer
will consume traces). Restructure to typed values when traces are next
touched — likely slice 2 anyway via R-11. Also: `trace.inputs` dropped the
`batchId` the design sketch specified; recoverable from the run, but restore
it for trace self-containment.

---

## 4. Boundary & purity enforcement — holes in the fence

### R-14 · P2 · Purity lint misses `performance.now()` and the global `crypto`

The ESLint purity rules ban `Date.now`, `Math.random`, zero-arg `new Date()`,
and `process` — but Node exposes **`performance.now()`** and **`crypto`**
(webcrypto, including `getRandomValues`) as globals. A pure package could read
a clock or randomness today and pass lint *and* depcruise (globals need no
import).

- **Recommended change**: add `performance` and `crypto` to
  `no-restricted-globals` for `packages/**`.
- **When**: now — it's two lines of config in the load-bearing fence.

### R-15 · P2 · Nothing stops a pure package from adding an I/O-doing npm dependency

depcruise bans node builtins; it does not ban `fs-extra` (a third-party
package wrapping fs). The fence checks imports, not what dependencies *do*.

- **Recommended change**: a small test asserting each pure package's
  `package.json` dependencies ⊆ an explicit allowlist (`decimal.js`,
  `csv-parse`, workspace siblings). Crude, effective, and it turns "adding a
  dep to a pure package" into a deliberate, reviewed act.
- **When**: with the next guardrail batch.

### R-16 · P2 · The boundary-proof test mutates the source tree and taxes every local run

`boundaries.test.ts` writes a violation file into `packages/cost-engine/src/`,
runs depcruise (twice per suite, ~2s of a 2.6s suite), and cleans up in
`finally` — which a SIGKILL skips, leaving a file that breaks subsequent
builds mysteriously. Clever test, wrong mechanics.

- **Recommended change**: point depcruise at a fixture violation in a temp
  directory outside the tree (config override), or gate the proof test to CI.
  Keep the concept — proving the fence fails closed is right.
- **When**: opportunistic.

---

## 5. Determinism, testing, tooling

### R-17 · P2 · Golden regeneration is undocumented folklore — IR2's defense doesn't exist

Doc 08 IR2 promised: regeneration is a separate, deliberate command whose
output is pasted into the PR. Reality: regeneration is "run the CLI with
`--out tools/golden/expected`" — undocumented, and identical to normal usage,
which is exactly the silent-recalibration path IR2 feared. Additionally,
**nothing is committed to git yet**, so "frozen" expected files are frozen in
name only — there is no history to diff against.

- **Recommended change**: add a `golden:update` script + a README in
  `tools/golden/` stating the rule (never hand-edit; regenerate + justify in
  PR). Make the initial commit — the golden discipline has no teeth without
  history (user's call to commit, but the review's position is: do it now).
- **When**: now — it's 20 minutes.

### R-18 · P3 · Minor tooling noise and portability

Vitest's CJS-deprecation warning on every run (root `package.json` lacks
`"type": "module"`); tests spawn `pnpm` (breaks on Windows — irrelevant for
the current team, noted); fast-check runs unseeded (correct default; failures
print reproducible seeds); `@types/node` 22 vs local Node 26 (harmless).
Batch these whenever config is next touched.

---

## 6. Security & enterprise readiness at this stage

- **R-19 · P3** — Run artifacts (`run.json`) embed the full assumption set,
  i.e., salary-proxy rate data, and full item titles. Fine for a local tool;
  the M0 "partner CSVs are confidential" rule in doc 08 §11 should be extended
  to *output artifacts* explicitly in the log. Do this when M1 sessions start.
- **R-20 · P1 (product-level)** — **The role-mapping reality gap.** Real
  partner exports have *person names* in the Owner column, not roles. The
  domain has only `roleRef`; there is no actor→role mapping mechanism and no
  pseudonymization (NFR-5: not started). Mapping a name column into `roleRef`
  would put PII straight into rate-matching keys and reports — brushing
  against N1's perimeter in the very first session. The two-week partner
  target hits this **before** it needs F1 queue-wait, because F1 needs event
  history most exports won't have, while every export has an owner-name column.
  - **Recommended change**: re-sequence slice 2. First: an edge-level
    role-mapping step (owner-value → role, defined in the mapping template)
    plus pseudonymization of unmapped actor values at ingestion. Then F1 with
    R-11's generalization. This review believes the roadmap's "next slice =
    F1" call was made from the architecture's perspective, not the partner
    data's perspective, and the M0/M1 overlap amendment makes partner data the
    boss.
- Everything else (tenancy, authn, audit log) is correctly absent — M2
  concerns; no premature machinery found. Good.

---

## 7. Review of the recorded decisions (D-1 … D-9)

| Decision | Verdict |
|---|---|
| D-1 no Turborepo | Correct. Nothing to add. |
| D-2 no build/emit | Correct; revisit at M2 container as logged. |
| D-3 zod at edge | Correct in shape; weakened in execution by R-09/R-10. |
| D-4 csv-parse | Correct library; config needs hardening (R-04). |
| D-5 decimal.js | Correct library; incomplete config (R-03) and the ADR's "rounding once at display" was violated by the display path itself (R-02). Amend ADR-0001 with canonical serialization + display rounding rules. |
| D-6 caller-supplied runId | Correct; keep. |
| D-7 reporting via analysis re-exports | **Wrong — reverse it.** Directly caused R-02. The doc 05 arrow should be amended (`reporting → cost-engine` allowed); a diagram's purity is not worth a hand-rolled money parser. |
| D-8 ISO-only dates | Acceptable for the fixture; R-01 shows the *same class* of gap at the `--now` edge, and partner CSVs (D/M/Y formats) will force date-format support in the mapping template sooner than "next slices, driven by actual files" implied. Pull forward. |
| D-9 no commits | Follow the rule, but note the consequence (R-17): golden files aren't meaningfully frozen until the first commit exists. |

**Doc-level revisions this review formally proposes**:
1. Doc 05 §3: add `reporting → cost-engine` to the allowed edges (kills D-7).
2. Doc 02 §2.4 implementation note: instance evidence is per-signal typed
   (discriminated union) with a signal-keyed cost-model registry (R-11) —
   the F×→C× table becomes code at slice 2.
3. ADR-0001 addendum: canonical serialization = non-exponential `toFixed`;
   display formatting lives in reporting via the pinned Money class.
4. Doc 08 §1 M0: the "both data modes on day one" DoD item (F1+F2) remains
   **open** — slice 1 shipped one detector by explicit instruction; the log
   should say so rather than let the checklist imply it.
5. Doc 08 §15 sequencing: role-mapping/pseudonymization micro-slice moves
   ahead of F1 (R-20).

---

## 8. Over- and under-engineering calls

**Over-engineered**: very little. The boundary-proof test's mechanics (R-16)
and the single-subcommand CLI ceremony are the only candidates, and both are
minor. The slice resisted speculative abstraction well — there is no registry
framework, no plugin system, no premature generality *except* the one place a
type pretends to generality it lacks (R-11), which is the inverse problem.

**Under-engineered — the actual theme of this review**: the effectful edge.
Input validation, error paths, header checks, hostile-data handling, negative
tests: all missing, all clustered in the ~150 lines of code that real humans
touch first. The pure core is a fortress; the drawbridge is a plank. Slice 1
optimized for the architecture diagram; the next day of work must optimize
for the first partner's malformed CSV.

## 9. What is genuinely good (kept short deliberately)

Golden bootstrap with pre-committed hand-computed numbers; double-run
determinism at library *and* process level; the fence actually failing closed
(proven, not assumed); capability-profile degradation working end-to-end;
version pinning on every output; zero-dep domain; sub-3-second full suite.
These are the bones of the company and they are straight.

## 10. Recommended action plan

**Slice 1.1 — Hardening (before any partner CSV, ~1 day):**
R-01, R-02 (+doc 05 amendment), R-03, R-04, R-05, R-06, R-07, R-08, R-14,
R-17 (+initial commit, user approving), and the cheap batch R-09/R-10/R-15/
R-18 where they fall out of the same files.

**Slice 2 — re-scoped (after 1.1):**
1. R-20: role mapping + pseudonymization at the edge.
2. R-11: evidence/type generalization + signal-keyed model registry.
3. Then F1 queue-wait on event history, as originally proposed.

No further feature work is recommended until Slice 1.1 is green.
