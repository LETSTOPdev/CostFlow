# 09 — Implementation Log

Running log of implementation work, decisions, and any deviations from the
approved foundation (docs 00–08). Newest entries at the bottom of each section.

---

## M0 — Vertical Slice 1: CSV → canonical → F2 aging → cost → trace → ranked CLI → golden test

**Authorized**: 2026-07-20, M0 only, with the sequencing amendment (M0/M1
overlap; first real external dataset targeted within two weeks — this slice is
built to be pointed at a real partner CSV the day it lands).

### Execution checklist

Scaffolding & guardrails
- [x] `git init`; `.gitignore`
- [x] pnpm workspace: root `package.json`, `pnpm-workspace.yaml`
- [x] Root `tsconfig.json` (strict, noEmit) with `@costflow/*` path aliases
- [x] ESLint flat config: strict TS, `no-explicit-any` error in `packages/**`,
      purity rules (`Date.now`, `Math.random`, zero-arg `new Date()`, `process`
      banned in `packages/**`)
- [x] Prettier config + `format:check` script
- [x] dependency-cruiser config encoding doc 05 §3 boundaries + node-builtin ban
      in `packages/**`
- [x] Vitest config (aliases to package sources; no build step)
- [x] GitHub Actions CI workflow (typecheck, lint, format, depcruise, tests)

Pure packages (in dependency order)
- [x] `@costflow/domain`: StageKind, StageRef, WorkItem, CapabilityProfile,
      ImportBatch (+diagnostics), AssumptionSet (rate cards, parameters,
      provenance), DecimalString/RangeSpec types. Zero deps.
- [x] `@costflow/ingestion` + `providers/csv`: MappingTemplate type, pure CSV
      text → ImportBatch (extract/map/land), row diagnostics, capability profile
- [x] `@costflow/friction`: FrictionSignal registry shape, F2 aging detector
      (`f2-aging@1.0.0`) with declared data requirements + skip reasons,
      FrictionInstance grouped by stage
- [x] `@costflow/cost-engine`: Decimal setup (exact arithmetic, explicit
      precision/rounding), Range interval algebra, confidence tiers (min-compose
      + reasons), `cm-aging-attention@1.0.0` cost model, FormulaTrace builder
- [x] `@costflow/analysis`: pure `runAnalysis` orchestration → immutable
      AnalysisRun artifact (all versions pinned, detector outcomes incl. skips)
- [x] `@costflow/reporting`: ranking (expected desc, deterministic tie-breaks),
      report model, markdown renderer answering doc 03 E1's four questions

Effectful edge
- [x] `apps/cli`: `costflow analyze --csv --mapping --assumptions --now
      [--run-id] --out` — file I/O, zod validation of mapping/assumption JSON,
      writes `run.json` + `report.md`. The ONLY package allowed I/O.

Fixtures & tests
- [x] Golden fixture `tools/golden/fixtures/`: demo CSV (Monday-shaped) covering
      stale/fresh/done items, missing role → default rate, unmapped status →
      dropped diagnostic, bad date → warning; mapping.json; assumptions.json
- [x] Hand-computed expected numbers documented below; pipeline output verified
      against them before freezing expected files (golden bootstrap honesty)
- [x] Golden test: pipeline output byte-identical to frozen `expected/` files
- [x] Determinism gate: everything run twice, byte-compared (library level and
      CLI spawn level)
- [x] Unit tests: aging detector edge cases; range algebra properties
      (fast-check): bounds ordered, composition never narrows
- [x] Boundary proof test: verify depcruise *fails* on a forbidden import
      (temporarily injected in the test, not committed)

Verification
- [x] `pnpm check` green: typecheck + lint + format + depcruise + tests
- [x] CLI run on fixture produces correct report; output captured for the
      completion report

### Golden fixture — hand-computed expectations (frozen before running code)

`now = 2026-07-20T00:00:00Z`, threshold 14 days (customer), attention
h/day range {0.15, 0.3, 0.6} (customer), currency USD. Rates (customer):
Legal 120, Finance 95, Procurement 80, Marketing 70, IT 90; default rate 75
(provenance: default).

Aging days (floor((now − lastUpdated)/1d)), excess = aging − 14:

| Item | Stage | Aging | Excess | Rate |
|---|---|---|---|---|
| 1001 | Waiting for approval (review) | 30 | 16 | Legal 120 |
| 1003 | Waiting for approval (review) | 45 | 31 | Procurement 80 |
| 1005 | Working on it (active) | 51 | 37 | Finance 95 |
| 1007 | Working on it (active) | 49 | 35 | default 75 |
| 1004 | Stuck (blocked) | 40 | 26 | Marketing 70 |
| 1002, 1010 | below threshold | 2, 5 | — | — |
| 1006 | Done → excluded | | | |
| 1008 | unmapped status → dropped (diagnostic) | | | |
| 1009 | bad date → lastUpdated null, warning, not evaluable | | | |

Expected instance costs (expected = Σ excess × 0.3 × rate; low ×0.15; high ×0.6):

| Rank | Instance (stage) | Expected | Low | High | Confidence |
|---|---|---|---|---|---|
| 1 | Working on it | 1842.00 | 921.00 | 3684.00 | C (default rate used) |
| 2 | Waiting for approval | 1320.00 | 660.00 | 2640.00 | B (snapshot cap) |
| 3 | Stuck | 546.00 | 273.00 | 1092.00 | B (snapshot cap) |

Confidence rules (slice): snapshot-derived durations cap at B; any term using a
default-provenance assumption caps at C; tier = min(caps); reasons recorded in
trace.

### Decisions & deviations (rule 11)

- **D-1 Turborepo deferred.** Roadmap stack names pnpm + Turborepo; with 7 tiny
  packages and a <10s test suite, turbo adds config without benefit (rule 4:
  no machinery the slice doesn't exercise). `pnpm -r` + a root `check` script
  suffice. Adopt turbo when task-graph caching earns its keep. Deviation is
  tooling-timing only; no architectural effect.
- **D-2 No build/emit step.** Packages expose `src/index.ts` directly; the CLI
  runs via `tsx`; typecheck is `tsc --noEmit`. Nothing is published in M0, so
  emitting JS buys nothing. Revisited when the first artifact consumer outside
  the monorepo exists (the M2 container build).
- **D-3 Zod at the edge only.** Domain stays zero-dependency; zod schemas for
  the mapping/assumption file formats live in `apps/cli`, bound to the domain
  types via `satisfies z.ZodType<T>` so schema/type drift is a compile error.
  Matches A2 (validation at edges) and keeps the core dependency-free.
- **D-4 `csv-parse` (sync API) for CSV parsing.** Battle-tested quoting/escaping
  beats a hand-rolled parser (boring technology, A6). Its sync string→records
  API is pure, so `ingestion` remains I/O-free.
- **D-5 decimal.js for money** (ADR-0001): explicit precision 34,
  ROUND_HALF_EVEN, all money as decimal strings at rest, rounding only at
  display (NFR-3).
- **D-6 Run IDs are caller-supplied.** `runAnalysis` takes `runId` as input
  (purity: no randomness/hashing inside engines). The CLI derives a
  deterministic default (sha256 of input file bytes + `--now`) and `--run-id`
  overrides. Golden tests pass fixed IDs.
- **D-7 Reporting imports cost-engine types/comparators via `analysis`
  re-exports**, preserving the doc 05 §3 diagram (`reporting → domain,
  analysis`) without float-parsing decimal strings for ranking (NFR-3 spirit).
- **D-8 Date parsing (M0 limitation).** Mapping templates support ISO dates
  (`YYYY-MM-DD` or full ISO) only; non-ISO values produce a row warning and a
  null field. Real-partner formats extend this in the next slices, driven by
  actual files (M0/M1 overlap plan).
- **D-9 `git init` performed; committing left to the user** (standing rule:
  commit only when asked). The tree is left clean and commit-ready.

### Verification results (2026-07-20)

`pnpm check` fully green: typecheck (tsc strict, noEmit) · eslint (zero
warnings, purity rules active) · prettier · dependency-cruiser (43 modules,
95 dependencies, 0 violations) · vitest **21/21 tests passed** across 6 files:

- `packages/friction/test/aging.test.ts` — detector edge cases (terminal/fresh/
  undated exclusion, grouping, threshold boundary, determinism, skip reasons)
- `packages/ingestion/test/csv-provider.test.ts` — diagnostics, capability
  profile, determinism
- `packages/cost-engine/test/range.test.ts` — fast-check properties: bounds
  ordered, composition never narrows, exact decimal (0.1×3 === 0.3)
- `packages/cost-engine/test/confidence.test.ts` — min-composition, binding
  constraint first, no downstream laundering
- `apps/cli/test/golden.test.ts` — run.json + report.md byte-exact vs frozen
  expected; hand-computed numbers verified; double-run determinism at library
  level AND via two spawned CLI processes
- `apps/cli/test/boundaries.test.ts` — clean tree passes depcruise; an injected
  cost-engine → ingestion import FAILS the check (boundary enforcement proven)

Golden bootstrap honesty: the expectations table above was written before any
code ran; the first pipeline output matched it exactly (ranking Working on it
1842 C > Waiting for approval 1320 B > Stuck 546 B; low/high bounds 921/3684
etc.) and was then frozen as `tools/golden/expected/`.

Example invocation:

```
pnpm costflow analyze \
  --csv tools/golden/fixtures/demo-ops.csv \
  --mapping tools/golden/fixtures/mapping.json \
  --assumptions tools/golden/fixtures/assumptions.json \
  --now 2026-07-20T00:00:00Z --run-id golden-demo-ops --out out
```

Known limitations (deliberate, per slice scope): single detector (F2) and cost
model; ISO-only dates (D-8); no persistence (runs-as-files per roadmap M0);
no stable-stringify helper — artifact key order is deterministic by
construction, revisit if artifacts are ever built non-literally.

### Next smallest vertical slice (superseded by the review — see Slice 1.1 below)

Original proposal was F1 queue-wait. The engineering review (doc 10) re-scoped
the sequence; see the Slice 1.1 entry and the revised Slice 2 recommendation.

---

## Slice 1.1 — Hardening (2026-07-20, completed)

Scope: doc 10 findings, per the approved priority order. No features added.

### Findings fixed

- **R-01** (P0): CLI validates `--now`; `detectAging` throws on an unparseable
  analysis time instead of silently finding nothing. "No frictions detected"
  can now only follow a valid completed analysis.
- **R-02** (P0): hand-rolled money renderer deleted. `formatWholeMoney` lives
  in `cost-engine` (ROUND_HALF_EVEN via the pinned Money class, locale-free
  grouping); reporting performs no monetary arithmetic or formatting.
- **R-03** (P0): `decToString` uses `toFixed()` — canonical decimal strings
  are never exponential; property-tested.
- **R-04** (P1): duplicate *mapped* CSV headers → hard `CsvImportError`;
  duplicate unmapped headers → file-level diagnostic (row 0).
- **R-05** (P1): mapped columns missing from the header → hard error listing
  missing vs. actual header.
- **R-06** (P1): duplicate item ids disambiguated deterministically
  (`id#2`, `id#3`) with warnings; `sourceId` preserved.
- **R-07** (P1): all customer-controlled strings escaped at markdown render
  (`|`, backticks, brackets, backslashes, newlines); artifacts keep raw truth.
- **R-08** (P1): 8 negative-path CLI tests; all input errors exit non-zero
  with one-line messages and no stack traces.
- **R-09/R-10** (P2): schemas `.strict()`; stage-kind enum derived from
  `STAGE_KINDS` (single source of truth); money/effort decimals must be
  non-negative.
- **R-14** (P2): `performance` and `crypto` globals banned in `packages/**`.
- **R-15** (P2): pure-package dependency allowlist test (deps ⊆ workspace
  siblings + {csv-parse, decimal.js}; no local devDependencies).
- **R-16** (P2, partial): boundary-test debris file added to `.gitignore`;
  mechanics otherwise unchanged (accepted).
- **R-17** (P2): `pnpm golden:update` is the only sanctioned regeneration
  path; `tools/golden/README.md` states the rules; initial commit makes
  "frozen" real.
- **R-18** (P3): root `"type": "module"` (vitest CJS warning gone).

### Architectural amendments

- **D-10 (reverses D-7)**: doc 05 §3 amended — `reporting` may import
  `cost-engine`; analysis re-exports types only, never behavior. Rule adopted:
  whoever owns monetary arithmetic owns monetary formatting.
- **ADR-0001 addendum**: canonical serialization is `toFixed()` (never
  exponential); `formatWholeMoney` is the only path from decimal string to
  human-readable money.
- **Versioning policy clarified**: signal/model versions bump only when
  outputs for *valid* inputs can change. R-01 hardened the input contract of
  `f2-aging` without changing valid-input output → stays 1.0.0. The renderer's
  output DID change → `@costflow/reporting` bumped to 0.2.0.

### Golden change record (per tools/golden/README.md rules)

`pnpm golden:update` run once, deliberately. `run.json`: **byte-identical**
(engine semantics untouched). `report.md`: two changes, both intended —
diagnostic lines now escape brackets (R-07), and one subtotal displays 1,054
instead of 1,055 (R-02: display rounding is now half-even per ADR-0001, was
hand-rolled half-up; underlying value 1054.5 unchanged in the artifact).

### Verification

- Full `pnpm check` green: typecheck · lint (zero warnings, new purity rules) ·
  format · depcruise (47 modules, 118 deps, 0 violations) · **50/50 tests**
  (was 21; 29 added, incl. regression tests for every reproduced defect).
- Every review reproduction re-run and demonstrated fixed: bad `--now` → exit 1
  with a clear message; `formatWholeMoney('-0.5')` → `0 USD`, `('-5.7')` →
  `-6 USD`, 1e22 formats with grouping; `decToString(1e21)` plain notation;
  duplicate mapped headers → `CsvImportError`.

### Remaining unresolved review findings

- **R-11** (P1) — FrictionInstance evidence generalization + signal-keyed cost
  model registry: deliberately deferred to be Slice 2's opening move.
- **R-20** (P1, product) — role mapping + pseudonymization: deferred by
  explicit instruction; recommended as Slice 2 step 1.
- **R-12, R-13, R-19** (P2/P3) — rate-policy placement, structured trace
  values, artifact-confidentiality note: unchanged, tracked.
- **R-16** — boundary-test mechanics accepted as-is beyond the gitignore guard.

### M0 DoD honesty note

The M0 DoD item "two detectors forcing both data modes (F1 + F2)" remains
**open** — slice 1 shipped F2 only, per the explicit single-detector
instruction. It closes in Slice 2 with F1.

### Revised Slice 2 recommendation (unchanged from doc 10 §10)

1. R-20: actor→role mapping in the MappingTemplate + pseudonymization of
   unmapped actor values at ingestion (NFR-5), because real partner exports
   carry person names, not roles, and the two-week partner target hits this
   first.
2. R-11: evidence type generalization + cost-model registry keyed by signal.
3. F1 queue-wait on event history (closes the M0 "both data modes" DoD item).
