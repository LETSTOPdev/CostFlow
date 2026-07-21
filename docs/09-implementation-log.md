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

---

## Slice 2 — Role mapping & pseudonymization → generalization → F1 (authorized 2026-07-20)

Strict order: Part A (actors) → Part B (R-11 generalization) → Part C (F1).

### Execution checklist

Part A — Actor→role mapping + pseudonymization (R-20, NFR-5)
- [x] Domain: `ActorRef` union — `{kind:'role', roleRef}` | `{kind:'unknown',
      pseudonym}` | `{kind:'missing'}`; replaces `WorkItem.roleRef` (documented
      schema migration). Capability key `hasRoles` → `hasActors`.
- [x] Domain: `PseudonymizationContext` type `{scopeId, pseudonymFor(raw)}` —
      pure packages receive the mapper as explicit input; salt/HMAC live only
      at the edge (`apps/cli/src/pseudonym.ts`, HMAC-SHA256(salt,
      scopeId+raw) → `anon-<12 hex>`; one-way, never encryption).
- [x] MappingTemplate: `columns.role` → `columns.actor`; new `actorRoleMap`
      (raw actor value → roleRef; explicit, versioned with the template).
- [x] Ingestion: actor resolution at import — mapped → role; unmapped →
      pseudonym via context (error if context absent); empty → missing. Raw
      values never stored. Batch records `pseudonymizationScope`.
- [x] CLI: `--org <scope>` + `--salt-file <path>` required whenever an actor
      column is mapped; salt never on argv; included in default run-id hash.
- [x] Rate resolution moves to cost-engine (`resolveActorRate`) — operates on
      ActorRef only, with distinct sources/confidence caps for
      role-with-rate / role-without-rate / unmapped / missing (closes R-12:
      two consumers now exist).
- [x] Tests: pseudonym determinism, org isolation (different salt/scope →
      unlinkable), raw-value absence from artifacts (automated privacy test
      over golden outputs), rate resolution per actor kind, missing/unknown
      actor safety.

Part B — Generalization (R-11)
- [x] `FrictionInstance` = discriminated union (`AgingInstance` |
      `QueueWaitInstance`) on `frictionType`; common base (id, signal id +
      version, location, magnitude); per-signal typed evidence.
- [x] Cost-model registry in cost-engine keyed by signal id: `{id, version,
      appliesToSignal, canPrice(assumptions), price(instance, assumptions)}`.
      Static object — no plugins, reflection, or DI.
- [x] Analysis dispatches through the registry; unpriceable instances produce
      explicit `pricing` outcomes (`priced` | `skipped` + reason) in the run
      artifact and an "Unpriced frictions" report section — never a crash or
      silent omission.
- [x] Trace terms get `kind` discriminants per model.
- [x] Tests: runtime guard (wrong model × wrong evidence throws), compile-time
      guard (`@ts-expect-error` type-safety file checked by tsc), registry-miss
      → skipped outcome.

Part C — F1 queue-wait over event history
- [x] Domain: `WorkItemEvent {workItemId, from: StageRef|null, to: StageRef,
      at}`; `ImportBatch.events`; `hasEventHistory` from actual events.
- [x] MappingTemplate: optional `events` section (columns: itemId, from?, to,
      at) sharing the template's `statusMap`.
- [x] Ingestion: optional events CSV. STRICT validation (hard errors, no
      silent repair): unknown item ids; unparseable timestamps; statuses
      missing from statusMap; `from`-chain mismatches; events before item
      creation; events present + duplicate item ids (ambiguous linkage).
- [x] Deterministic interval semantics (documented, not repaired):
      per-item order = (timestamp, file row) — file row breaks exact ties;
      repeated stage visits accumulate; reopened items are just more visits;
      pre-first-event time is never attributed; open last interval closes at
      analysis time iff stage is non-terminal (marked `open`, confidence cap);
      terminal transitions end attribution; zero-length intervals contribute 0.
- [x] F1 detector (`f1-queue-wait@1.0.0`): requires `hasEventHistory`;
      eligible stage kinds `queue` + `review` only; magnitude in integer
      item-hours; evidence per item (waitHours, visits, open, actor).
- [x] Cost model `cm-queue-wait-attention@1.0.0`: requires OPTIONAL assumption
      `queueWaitAttentionHoursPerDay` (skipped-with-reason if absent);
      waitDays = hours/24 exact decimal; Σ waitDays × attention × rate;
      confidence caps: open intervals → B; eligible items lacking events → B;
      default rate/assumptions → C; none → A.
- [x] Golden fixture 2 (`demo-flow`): items + events CSVs exercising both
      signals, an unmapped actor in a priced item, reopened item, open
      intervals, terminal transition. Two expected dirs:
      `expected/demo-ops/`, `expected/demo-flow/`.
- [x] Tests: multi-signal ranking determinism (double-run byte compare);
      events do not alter F2 results (same fixture ± events → identical F2
      estimates); invalid-history failures; F1 skip without history.

Cross-cutting
- [x] Fixture 1 updated to realistic actors (person names/emails/aliases →
      actorRoleMap); expected COST NUMBERS unchanged from Slice 1 table.
- [x] docs/11-partner-run-workflow.md — real-partner CLI workflow (files,
      configs, salt handling, validation, artifacts, non-retention, deletion).
- [x] Full check + all demos + privacy grep + completion entry + commit.

### Hand-computed expectations — fixture 2 `demo-flow` (frozen before code)

`now = 2026-07-20T00:00:00Z`. Rates (customer): Legal 120, Finance 95,
Procurement 80; default 75 (default provenance). Aging: threshold 14d,
attention {0.15, 0.3, 0.6} customer. Queue-wait attention {0.1, 0.2, 0.4}
customer. Actors: Sarah Cohen→Legal, john@company.com→Finance,
procurement-team→Procurement; `unknown.person` unmapped → pseudonym + default
rate.

Event-derived waits (integer hours ÷ 24 = exact days here):

| Item | Backlog (queue) | Contract Review (review) | Notes |
|---|---|---|---|
| 2001 (Legal) | 2d (closed) | 25d (OPEN 06-25 → now) | |
| 2002 (Finance) | 5d (closed) | 10d + 9d = 19d (2 visits, closed) | reopened; ends terminal (Done) |
| 2004 (Procurement) | 38d (closed) | 2d (OPEN 07-18 → now) | |
| 2003 (unmapped) | — | — | active only; no eligible wait |

Expected estimates (expected = Σ days × attention.expected × rate):

| Rank | Instance | Expected | Low | High | Confidence |
|---|---|---|---|---|---|
| 1 | F1 Contract Review (600+361+32) | 993 | 496.5 | 1986 | B — open intervals |
| 2 | F1 Backlog (48+95+608) | 751 | 375.5 | 1502 | **A** — closed intervals, customer assumptions |
| 3 | F2 Working on it (2003: 16 excess × 0.3 × 75) | 360 | 180 | 720 | C — default rate (unmapped actor) |
| 4 | F2 Contract Review (2001: 5 excess × 0.3 × 120) | 180 | 90 | 360 | B — snapshot durations |

Fixture 1 (`demo-ops`, actors updated to names): cost table IDENTICAL to the
Slice 1 hand-computed table (1842/1320/546 etc.); only actor representation
and rate-source labels change. 1007 (empty owner) prices at default rate
labeled missing-actor; 1002 → "Uri Levi" stays unmapped (below threshold —
pseudonym visible in run.json only).

### Schema migration note (Part B req 9 — documented, genuinely required)

`run.json` schema changes in this slice: `WorkItem.actor` union replaces
`roleRef`; capability `hasRoles` → `hasActors`; `ImportBatch.events` +
`pseudonymizationScope`; run gains `pricing` outcomes; assumption set gains
optional `queueWaitAttentionHoursPerDay`; trace terms gain `kind`. All golden
changes regenerate via `pnpm golden:update` with this entry as the required
justification. Underlying fixture-1 cost values are unchanged.

### Slice 2 completion record (2026-07-20)

**Decisions added:**
- **D-11 Pseudonymization as injected function.** Pure packages receive
  `PseudonymizationContext` (scope id + deterministic mapper) as an explicit
  input; HMAC-SHA256 and the salt live only in `apps/cli/src/pseudonym.ts`.
  Not a DI framework — one function parameter. Salt participates in the
  default run-id hash so different salts cannot silently share a run id.
- **D-12 Wait durations are integer hours.** F1 intervals are floor-hours
  (pure integer arithmetic); the cost model converts to days as exact decimal
  (`hours ÷ 24` at pinned precision). Magnitudes stay integers; money stays
  decimal; no floats anywhere.
- **D-13 Event validation severity is asymmetric by design.** Item rows with
  unmapped statuses degrade (drop + diagnostic) because each row is
  independent; event-history problems are hard errors because a broken chain
  poisons interval semantics for the whole item — repairing it silently would
  fabricate durations (doc 03 P5).
- **D-14 rate resolution moved domain → cost-engine** (`resolveActorRate`),
  closing R-12: rate fallback is pricing policy, and with two models it has
  two consumers. Domain now holds types + time/stage logic only.
- **D-15 Engine version bumps:** analysis 0.1.0 → 0.2.0 (run schema migration);
  reporting 0.2.0 → 0.3.0 (new sections/columns); `f2-aging` stays 1.0.0
  (evidence field renamed with the schema migration, detection semantics for
  valid inputs unchanged); new `f1-queue-wait@1.0.0`,
  `cm-queue-wait-attention@1.0.0`.

**Verification (all green, 2026-07-20):**
- Full `pnpm check`: typecheck · lint · format · depcruise (64 modules,
  184 deps, 0 violations) · **89/89 tests** (was 50; 39 added).
- Golden: both fixtures reproduce byte-exactly; demo-flow matched the
  hand-computed table above cell-for-cell on first generation (496/376
  display lows are the half-even renderings of 496.5/375.5 — trace keeps full
  precision). Double CLI runs byte-identical to each other and to frozen files.
- Privacy: automated test + manual grep — all 8 raw fixture actor values have
  **0 occurrences** across every generated artifact; pseudonyms are
  `anon-<12 hex>`; the three actor states (role/unknown/missing) verified in
  artifacts.
- Demos: F2-only run shows F1 **skipped** with reason; combined run ranks
  4 instances across both signals (B/A/C/B confidence spread — Backlog earns
  A on fully-closed observed intervals); invalid history (chain mismatch)
  exits 1 naming item, row, and stages; unknown actors pseudonymized; mapped
  actors price via `rates.<role>` sources.
- F2-invariance proven by test: adding events changes no aging estimate byte.

**M0 DoD status:** the "both data modes" item is now CLOSED — F2 (snapshot)
and F1 (event history) run through the same pipeline with capability-driven
degradation. Remaining M0 gaps: none against the doc 08 M0 deliverable list
as amended; review items R-13 (structured trace values), R-16 (boundary-test
mechanics), R-19 (artifact-confidentiality note — now partially addressed by
doc 11 §6) remain open at P2/P3.

**Recommendation for the first real partner run:** follow doc 11 verbatim.
Expect the partner's export to fail strict event validation on the first
attempt (real activity logs are messy) — that failure output is itself the
M1 learning artifact; capture it in the findings memo. If events prove
unusable, the F2-only path still delivers the session. Do NOT relax
validation ad hoc during a session; log what broke and decide deliberately.

---

## M1 Concierge Cycle 1 — preparation (2026-07-20)

M0 frozen; no engineering slice. Prep for the first real external dataset,
limited to operational material per the M1 authorization.

**Added (all data-free, committable):**
- `partner-runs/` git-ignored wholesale; guardrail test
  (`partner-guardrail.test.ts`) asserts the pattern exists, git agrees on all
  path shapes, and a real canary file never reaches `git status`.
- `tools/partner/`: `new-run.sh` (scaffold that REFUSES to run if the
  directory is not ignored; salt generated mode-600), `intake-checklist.md`
  (passes 1–5 procedure), `findings-memo-template.md` (8 categories ×
  severity/evidence/impact/response/now-later-never/generalizes),
  `run-commands.sh.template`, `verify-privacy.sh` (counts only, never
  values), `cleanup.sh` (confirm → delete → verify absence).
- `costflow preflight` subcommand (explicitly authorized): composes
  `importCsv`'s existing structural validation into a values-free structure
  summary — rows/drops/warnings, capability profile, actor coverage counts,
  rate-card coverage, unmapped columns, event validation status. No
  detectors, no money, no artifacts. CLI io helpers extracted to `io.ts`.
- Doc 11 amended: partner data location is `partner-runs/` (guardrail-backed)
  instead of a home directory; cleanup via the script.

**Dry-run verification:** scaffold created + git status clean with canary
present; salt file mode `-rw-------`; verify-privacy proved BOTH directions
(clean → exit 0, seeded leak → exit 1) — the clean path initially exposed a
pipefail bug in the script itself, fixed and re-verified; cleanup removed the
tree. Preflight smoke-tested against synthetic golden fixtures only.
`pnpm check` green: 95/95 tests (6 added).

**Status: waiting on the real partner dataset.** No partner data exists in
the repo or this log. Session execution (passes 1–5, findings memo, final
report) begins when files land in `partner-runs/<code>/raw/`.

**Cycle-1 execution note (2026-07-20, values-free):** executed against the
founder's own ClickUp workspace (cu01) via the official API. 79 items /
7 lists; preflight 79/79 imported; F2 valid with an honest zero (workspace
11 days old < 14d threshold); F1 skipped (event history plan-gated and
aggregate-only); privacy 6 values / 0 occurrences; byte-identical
reproducibility. Findings memo local to partner-runs/cu01/notes. Outcomes
drove docs 12 (F3 design), 13 (prioritization), 14 (signal taxonomy).

---

## Slice 3 — F3a overdue detector + F6 as Context Signal (authorized 2026-07-20)

Scope: doc 12 exactly (F3a only; F3b deferred pending the completedAt schema
decision); F6 per doc 14 — context only: no cost, no confidence, no rank, no
influence on other detectors' calculations.

### Hand-computed golden expectations (frozen before code runs)

**demo-ops** (`now = 2026-07-20T00:00:00Z`; adds
`overdueAttentionHoursPerDay {0.1, 0.2, 0.4}` provenance=customer):

F3 evidence (in-flight items past due; floor days):

| Item | Stage | Due | Overdue days | Rate |
|---|---|---|---|---|
| 1003 | Waiting for approval (review) | 2026-06-01 | 49 | Procurement 80 |
| 1001 | Waiting for approval (review) | 2026-06-15 | 35 | Legal 120 |
| 1004 | Stuck (blocked) | 2026-06-30 | 20 | Marketing 70 |
| 1009 | Working on it (active) | 2026-07-01 | 19 | IT 90 |
| 1002/1005/1010 | due in future | | — | |
| 1007 | no due date | | — | |
| 1006 | done → excluded | | — | |

Note 1009: F2 cannot evaluate it (bad lastUpdated) but F3 CAN (dueAt valid) —
the detector complementarity doc 12 predicted, visible in one fixture.

F3 estimates (expected = Σ days × 0.2 × rate; low ×0.1; high ×0.4):

| Instance | Expected | Low | High | Confidence |
|---|---|---|---|---|
| F3 Waiting for approval (784+840) | 1624 | 812 | 3248 | **A** (distinct dues, customer assumptions) |
| F3 Working on it (1009) | 342 | 171 | 684 | **A** |
| F3 Stuck (1004) | 280 | 140 | 560 | **A** |

Combined ranking: F2 WOI 1842 C > **F3 WFA 1624 A** > F2 WFA 1320 B >
F2 Stuck 546 B > **F3 WOI 342 A** > **F3 Stuck 280 A**.
Clustering cap must NOT fire (single-item cohorts and a 50% tie are not
clusters — cap requires cohort ≥ 2 AND cohort > half the evidence; decision
recorded here as version-bound semantics).

Context (c6-wip-load): 8 in-flight; review 3, active 4, blocked 1, queue 0 →
3/8 = 38% queue/review-kind; largest pool "Working on it" (4).
Due-date coverage line: 7 of 8 in-flight items carry due dates.

**demo-flow** (no overdue assumption added — exercises unpriced-by-missing-
assumption): F3 detects 2001 (due 2026-07-15 → 5d overdue, Contract Review)
→ appears under Unpriced frictions with the missing-assumption reason.
Context: 3 in-flight; 2/3 = 67% queue/review; largest pool Contract Review (2).
Coverage: 3 of 3. All existing F1/F2 rows byte-unchanged except run-schema
additions (invariance of estimates asserted by test).

### Version bumps
`f3-overdue@1.0.0` (new), `cm-overdue-attention@1.0.0` (new),
`c6-wip-load@1.0.0` (new, context), analysis 0.2.0→0.3.0 (run gains `context`
+ new signal), reporting 0.3.0→0.4.0 (Context section, coverage line, overdue
drill-down). F1/F2 signals and models unchanged.

### Completion record (2026-07-20)

**Golden change justification (per tools/golden/README.md):** regenerated via
`pnpm golden:update` once; outputs matched the hand-computed tables above on
first generation, cell for cell (demo-ops: 6-row multi-signal ranking with
three A-tier F3 instances; demo-flow: 4 rows byte-equivalent in content plus
the unpriced-F3 entry and context/coverage additions). Run-schema additions
(context, contextSignals, new signal version pins) are the documented reason
run.json changed; F1/F2 estimate CONTENT is unchanged (asserted by tests).

**Verification:** full `pnpm check` green — typecheck · lint · format ·
depcruise (74 modules, 233 deps, 0 violations) · **114/114 tests** (19 added:
8 detector, 6 model/registry incl. both new caps + A-tier + version-bound
cluster semantics, 5 analysis/context incl. F2-invariance and context
isolation; plus 2 golden/report assertions and 4 new @ts-expect-error
compile guards).

**cu01 re-run (values-free):** Run A (previously confirmed assumptions only):
F3 detected 4 instances totaling **224 item-days-overdue — exactly the
number predicted analytically during M1**; honestly unpriced (missing overdue
assumption named); context: 61 of 65 in-flight (94%) in queue/review kinds,
largest pool the queue-kind intake stage (38). Run B (labeled DEFAULT overdue
assumption 0.15/0.3/0.6): priced ranking led by the intake queue instance
(~2,700 USD expected, range 1,350–5,400), all C-tier with the binding
constraint correctly = unconfirmed default. Both doc 12 data-quality caps
fired on real data: dueBeforeCreated in all 4 instances (sprint-gate dates
set after task creation), milestone-gate clustering in 1. Reproducibility
byte-identical; privacy 6 values / 0 occurrences; partner-runs still
invisible to git.

**Doc 12/13/14 assumptions checked against reality:** none disproven. Two
sharpened: (1) M1's "58% pooled" understated the kind-level truth — the
context signal's by-kind computation shows 94%, strengthening the F6-as-
context value claim; (2) dueBeforeCreated was designed as an edge case and
turned out to be the NORM for gate-dated sprint tasks — the B cap does the
work doc 12 hoped, but its ubiquity on sprint-style boards is a finding for
the next partner conversation (UA-2 remains open).

---

## Slice 3b — Four-state provenance + report/simulation pricing policy (authorized 2026-07-20)

Implements the decision review outcome: doc 03 P4's cold-start clause was the
principle implementation proved insufficient (superseded by doc 14 FS-3).

### Scope
- `Provenance` becomes a four-state ladder: `vendor-suggested` →
  `customer-accepted` → `customer-customized` → `customer-measured`.
  Customer-owned = the latter three (`isCustomerOwned`).
- Pricing policy on the analysis run: **report mode (default)** prices only
  estimates whose load-bearing inputs are all customer-owned; an instance
  touching any vendor-suggested input (parameters OR resolved rates, incl.
  the default rate) is skipped with the offending refs named — NO partial
  pricing. **Simulation mode** (`--simulation`) prices any provenance with
  the vendor-suggested C-caps intact and a prominent report banner (doc 07
  N13 register). Developer tooling unaffected; the cost engine stays pure —
  policy lives in the analysis dispatch layer.
- Doc 03 P4 amended (dated); confidence-cap and renderer provenance wording
  updated to the four states.

### Hand-computed golden expectations (frozen before code)

Fixture provenance migration: `customer` → `customer-customized` (values were
authored by the fixture "customer"); `default` → `vendor-suggested`. The
fixtures' defaultRate is vendor-suggested → report mode now UNPRICES every
instance that touches it:

**demo-ops** (report mode): F2 "Working on it" (item 1007 missing actor →
vendor-suggested default rate) is now UNPRICED with refs named. Ranking
becomes 5 rows: F3 WFA 1624 A > F2 WFA 1320 B > F2 Stuck 546 B >
F3 WOI 342 A > F3 Stuck 280 A. Unpriced: F2 WOI (72 item-days-beyond-
threshold, vendor-suggested defaultRate:missing-actor).

**demo-flow** (report mode): F2 "Working on it" (2003 unmapped actor →
vendor-suggested default rate) UNPRICED. Ranking 3 rows: F1 CR 993 B >
F1 Backlog 751 A > F2 CR 180 B. Unpriced (magnitude desc): F2 WOI 16
item-days; F3 CR 5 item-days (missing overdue assumption).

These goldens now permanently exercise the report-mode suppression path —
the strictness is the point.

### Version bumps
analysis 0.3.0 → 0.4.0 (run gains `pricingPolicy`; report-mode dispatch);
reporting 0.4.0 → 0.5.0 (simulation banner, provenance labels).

### Completion record (2026-07-20)

- Four-state `Provenance` + `isCustomerOwned` in domain; registry entries gain
  `unconfirmedInputs(instance, assumptions)`; analysis dispatch gates pricing
  in report mode (default) and records `pricingPolicy` in the artifact; CLI
  `--simulation`; renderer provenance labels + simulation banner; doc 03 P4
  amended (dated, with the reasoning).
- Goldens regenerated once via `pnpm golden:update`; matched the frozen hand
  tables exactly — demo-ops now 5 priced rows + the suppressed F2 instance
  with refs named; demo-flow 3 rows + 2 unpriced. The goldens permanently
  exercise the suppression path.
- Full `pnpm check` green: **116/116 tests** (2 policy tests added: report-
  suppression/simulation-pricing equivalence of detection, and
  customer-accepted counting as customer-owned).
- cu01 policy proof (values-free): v2 assumptions (vendor-suggested overdue
  parameter) → report mode suppresses all 4 F3 instances with refs named;
  `--simulation` prices them behind the banner at C. Detection identical in
  both modes — policy gates pricing only.
- Fixture/test provenance migrated (`customer`→`customer-customized`,
  `default`→`vendor-suggested`); local cu01 configs migrated (not committed).

---

## Phase 2 / P1 — Provider SPI v2 + Jira connector (authorized 2026-07-20)

Doc 15 approved with the Telemetry milestone inserted as P3. P1 scope per
doc 15; detector families remain frozen.

### Execution checklist

- [x] `spi.ts`: ProviderDescriptor (id, auth requirements, deliverable
      capabilities), registry of descriptors (csv, jira). Types only — no
      plugins, no runtime loading.
- [x] `canonical.ts` (shared, pure): actor resolution + event ordering/strict
      validation + capability/batch assembly for API providers. **Deliberate
      P1 debt (D-16): the CSV provider keeps its own identical-semantics
      implementation untouched (zero golden risk); consolidation is scheduled
      for P2 when Monday forces the second consumer, with message-equality
      tests.**
- [x] `providers/jira/transform.ts` (pure): Jira search-page JSON (+
      supplementary changelog pages) + JiraMapping {statusMap, actorRoleMap}
      → ImportBatch with items AND events. Rules:
      J1 arrival derivation — Jira changelogs record transitions only; the
        initial status interval is derived from two facts: item created
        timestamp + the from-status of the first transition (or current
        status if no transitions). Deterministic, documented, NOT fabrication.
      J2 truncation is a hard error — if changelog.total exceeds supplied
        histories and no supplementary pages cover the gap, refuse (no silent
        truncation of history).
      J3 dropped issues (unmapped current status) take their events with them;
        any transition referencing an unmapped status is a hard error (same
        asymmetry as csv D-13).
- [x] Conformance suite (`spi-conformance.ts` helper): determinism, id
      uniqueness, capability honesty, count coherence, event ordering/refs,
      no raw actor values, scope recording — run against BOTH csv and jira.
- [x] Edge: `fetchers/jira.ts` (paginated search + changelog top-ups, token
      via file, raw pages to disk + manifest) + `costflow fetch --provider
      jira`; `costflow analyze --provider jira --raw <dir>`. Pure URL/page
      helpers unit-tested; HTTP not exercised in tests (no credentials).
- [x] Golden `demo-jira` (hand-computed below) + goldens for csv/flow
      byte-untouched.

### Hand-computed golden expectations — demo-jira (frozen before code)

Fixture: 3 issues, project OPS; statuses To Do(queue)/In Progress(active)/
Review(review)/Done(done); now = importedAt = 2026-07-20T00:00:00Z.
Assumptions all customer-owned: Legal 120, Ops 90 (customized); defaultRate
30 (customized); aging 14d + attention 0.15/0.3/0.6 (customized); queueWait
0.1/0.2/0.4 (customized); **overdue 0.1/0.2/0.4 customer-ACCEPTED** — first
golden exercise of the accepted state; everything prices in report mode.

Derived events (J1): OPS-1 arrival To Do @created 06-20, →In Progress 06-25,
→Review 07-08 (open to now: 12d). OPS-2 arrival To Do @06-22, →In Progress
07-02 (active, open). OPS-3 arrival To Do @06-01, no transitions (open queue
wait 49d). Actors: OPS-1 mapped Legal; OPS-2 UNMAPPED (pseudonym + default
rate 30); OPS-3 mapped Ops.

| Rank | Instance | Expected | Low | High | Conf |
|---|---|---|---|---|---|
| 1 | F1 queue-wait "To Do" (49d×90 + 10d×30 + 5d×120 @0.2) | 1062 | 531 | 2124 | C (default rate, unmapped actor; open intervals B) |
| 2 | F3 overdue "To Do" (OPS-3: 19d×0.2×90) | 342 | 171 | 684 | A |
| 3 | F2 aging "To Do" (OPS-3: 11 excess ×0.3×90) | 297 | 148.5 | 594 | B (snapshot) |
| 4 | F1 queue-wait "Review" (OPS-1: 12d×0.2×120) | 288 | 144 | 576 | B (open interval) |
| 5 | F3 overdue "Review" (OPS-1: 10d×0.2×120) | 240 | 120 | 480 | A |

Magnitudes: F1 To Do 1536 item-hours (1176+240+120); F1 Review 288h.
Unpriced: none. Context: 2 of 3 in-flight (67%) queue/review; largest pool
tie of three singleton stages → alphabetical first "In Progress" (1 items).
Due coverage: 2 of 3. F2's only finding: OPS-3 (25d aging, 11 excess).


### P1 completion record (2026-07-20)

- **All hand-computed demo-jira expectations matched on first generation** —
  every rank, magnitude (1536h/288h), cost, and confidence tier, including
  the J1-derived 49-day open queue wait on the never-transitioned issue and
  the customer-accepted overdue assumption pricing at A in report mode.
  **F1 queue-wait priced real-shape connector events for the first time.**
- Full `pnpm check` green: **142/142 tests** (26 added: 8 J1/J2/J3 transform
  units, 6×2 SPI conformance across csv+jira, 4 fetcher pure helpers, 2
  demo-jira goldens) · 81 modules, 0 boundary violations · demo-ops/demo-flow
  goldens byte-untouched (verified via git diff — empty).
- Debt recorded **D-16**: CSV provider keeps its own identical-semantics
  actor/event logic (untouched in P1 for golden stability); consolidation
  scheduled for P2 when Monday makes `canonical.ts` the required shared path.
  Also noted: the shared error class is still NAMED CsvImportError while now
  serving all providers — rename to ImportError in the P2 consolidation.
- Live validation deliberately pending: the fetcher's HTTP path is untested
  against a real Jira site (no credentials exist); pure helpers are unit-
  tested. First real Jira workspace = fetcher shakedown + Cycle-2 wake.
- Telemetry inserted as P3 in doc 15 per founder directive (derived-not-
  sprayed, versioned taxonomy, privacy-preserving, local-first/opt-in).

## Phase 2 / P2 — Monday + Asana connectors: the SPI promise test (authorized 2026-07-21)

Founder rule governing P2 (verbatim intent): the objective is NOT two more
connectors — it is to prove the Provider SPI is complete. Monday and Asana
are adversarial tests of the SPI. If either connector requires an SPI change,
stop immediately and explain; either the SPI is genuinely incomplete and
evolves for ALL providers, or the provider adapts to the SPI. No silent
extension of the abstraction to satisfy one provider. Every pressure point is
documented. P2 ends with a review answering one question: **"Did the Provider
SPI survive contact with multiple providers unchanged?"** Then stop before P3.

What "the SPI" is, precisely (so the verdict is checkable): (1) the two-half
provider shape — pure transform in `packages/ingestion`, effectful fetcher in
`apps/cli`, raw documents verbatim on disk between them; (2) the
`ProviderDescriptor` type; (3) the shared canonical assembly contract —
`resolveActorValue`, `orderAndValidateEvents(CanonicalEventInput[])`,
`buildCapability`, `stageForStatus`; (4) the canonical `ImportBatch` domain
model itself; (5) the conformance suite every provider must pass. Mapping
TYPES are per-provider by design (JiraMapping ≠ MappingTemplate already in
P1) — a new provider-specific mapping field is NOT an SPI change; a new field
on ImportBatch/descriptor/canonical helpers IS.

### Execution checklist

- [x] **D-16 consolidation first** (so Monday/Asana join an already-shared
      path): CSV provider imports `resolveActorValue`, `orderAndValidateEvents`,
      `buildCapability` from canonical.ts; rename `CsvImportError` →
      `ImportError` (all providers, all references, all tests); demo-ops and
      demo-flow goldens must stay byte-identical; error-message equality
      verified by the existing error-path tests continuing to pass unchanged
      (any deliberate message change is listed here, not slipped through).
- [x] `providers/monday/transform.ts` (pure) + `MONDAY_DESCRIPTOR`, rules
      M1–M6 below; unit tests per rule.
- [x] `providers/asana/transform.ts` (pure) + `ASANA_DESCRIPTOR`, rules
      A1–A5 below; unit tests per rule.
- [x] Fetchers: `fetchers/monday.ts` (GraphQL, POST-for-query — see pressure
      point M5), `fetchers/asana.ts` (REST GET, offset pagination, stories +
      sections to exhaustion); `costflow fetch`/`analyze --provider monday|asana`;
      strict zod mapping schemas.
- [x] Conformance suite green ×4 (csv, jira, monday, asana).
- [x] Goldens `demo-monday` + `demo-asana` matching the hand tables below;
      demo-ops/demo-flow/demo-jira byte-untouched.
- [x] SPI survival review written below; stop before P3.

### Derivation rules — Monday (M1–M6, frozen before code)

- **M1 — status is a column, not a field.** Monday has no first-class status;
  `MondayMapping.statusColumnId` designates which column is the status;
  `statusMap` keys are that column's labels. Provider adapts to the SPI
  (statusMap semantics unchanged).
- **M2 — 17-digit activity timestamps.** `activity_logs[].created_at` is UNIX
  time in 100-nanosecond units (17 digits). Deterministic conversion:
  `ms = floor(n / 10^4)` → ISO-8601. Conversion happens inside the provider
  transform; canonical validation still sees only ISO strings.
- **M3 — multi-person people column.** The canonical domain model holds ONE
  ActorRef per item; Monday people columns hold many. Rule: the first person
  listed (source order) is the item's actor — deterministic, documented.
  This is recorded as pressure on the DOMAIN MODEL's single-actor assumption,
  surfaced honestly rather than silently widened (see pressure points).
- **M4 — completeness is not attestable.** Jira's `changelog.total` lets J2
  prove completeness; Monday's activity_logs API makes no per-item
  completeness claim and plan-dependent retention truncates silently. J2 has
  NO Monday analog. Resolution follows the provenance philosophy: the
  customer attests. `MondayMapping.activityLogsComplete: boolean` — `true`
  derives events (J1-style arrival: created_at + previous label of the first
  status transition, else current status); `false` imports items only, adds a
  file-level diagnostic, and F1 is honestly skipped (`hasEventHistory` false)
  — the cu01 honest-zero pattern, not a fabricated history.
- **M5 — GraphQL requires POST (fetcher edge, N5).** P1 wrote "read-only by
  construction: GET requests only." Monday's API is POST-only even for
  queries, so the HTTP verb was never the real invariant. Restated: read-only
  = the query document contains no mutation. Enforced by static query-string
  constants + a test asserting no mutation appears. Pressure point on the
  FETCHER EDGE convention, not on the SPI.
- **M6 — board-scoped history vs item-scoped history.** Jira embeds history
  per issue; Monday's activity log is per-board, so entries can reference
  items absent from the items snapshot (deleted/archived). Rule: entries for
  item ids not present in the snapshot are excluded with a counted file-level
  diagnostic (facts about out-of-snapshot items, same family as J3
  dropped-take-events); entries for IMPORTED items still hard-error on
  unmapped statuses via canonical validation.

### Derivation rules — Asana (A1–A5, frozen before code)

- **A1 — multi-homed tasks.** Asana tasks live in many projects/sections.
  `AsanaMapping.projectGid` scopes the import; the membership whose
  `project.gid` matches supplies the current section; tasks without such a
  membership are dropped rows. The sections document
  (`GET /projects/{gid}/sections`, fetched raw) is the authoritative set of
  in-scope section gids.
- **A2 — completion is orthogonal to section.** `completed` is a boolean and
  completed tasks keep their section. `AsanaMapping.completedStatus` (must
  be a `statusMap` key, hard error otherwise) is the stage completed tasks
  land in; a completion event {from: current section, to: completedStatus,
  at: completed_at} is derived. `completed: true` with null `completed_at`
  is a hard error (malformed document, never guessed).
- **A3 — story scoping.** `section_changed` stories whose sections are BOTH
  outside the scoped set are foreign-project moves: excluded with a counted
  per-row diagnostic. A story mixing one in-scope and one out-of-scope
  section is a hard error (breaks the scoping model; never repaired).
- **A4 — arrival derivation (J1 analog).** Arrival at task `created_at` into
  the `old_section` of the first in-scope story, else the current section.
  Known limitation, documented: a task added to the scoped project long after
  creation overstates its first-section wait; detecting add-time reliably
  needs story shapes we will only trust after live validation.
- **A5 — pagination completeness IS attestable (J2 analog).** Asana responses
  carry `next_page`; a document whose `next_page` is non-null and whose
  continuation was not provided is a hard error in the transform. The fetcher
  follows pagination to exhaustion. (Adversarial contrast with M4: Asana can
  prove completeness, Monday cannot — the SPI accommodates both without
  changing.)

### Hand-computed golden expectations — demo-monday (frozen before code)

Fixture: board 4412, 3 items; status column `status` labels Backlog(queue)/
Working on it(active)/Waiting for review(review)/Done(done); people column
`person`; date column `date4`; `activityLogsComplete: true`; now = importedAt
= 2026-07-20T00:00:00Z. Assumptions: Founder 100 (customized); defaultRate 40
(customized); aging 14d + 0.15/0.3/0.6 (customized); queueWait 0.1/0.2/0.4
(customized); overdue 0.1/0.2/0.4 customer-accepted. Everything prices in
report mode.

Items: 101 "Website redesign brief" Backlog, Maya Founder→Founder, created
06-05, updated 06-30, due 07-08, NO activity (arrival from current status).
102 "Vendor contract renewal" Waiting for review, unmapped person→pseudonym
(default 40), created 06-10, updated 07-16, due 07-14; activity Backlog→
Working on it 06-18, →Waiting for review 07-06. 103 "Spring campaign wrap-up"
Done, empty people→missing (default 40), created 06-01, updated 06-20, no
due; activity Backlog→Working on it 06-08, →Done 06-20.

Derived events (7): 101 arrival Backlog @06-05 (open queue wait 45d=1080h);
102 arrival @06-10 (Backlog 8d=192h) + 2 transitions (review wait open
14d=336h); 103 arrival @06-01 (Backlog 7d=168h) + 2 transitions (Done
terminal — attribution ends).

| Rank | Instance | Expected | Low | High | Conf |
|---|---|---|---|---|---|
| 1 | F1 queue-wait "Backlog" 1440h (45d×100 + 8d×40 + 7d×40 @0.2) | 1020 | 510 | 2040 | C (open B; unmapped C; missing C) |
| 2 | F3 overdue "Backlog" (101: 12d×0.2×100) | 240 | 120 | 480 | A |
| 3 | F2 aging "Backlog" (101: 20d−14=6 excess ×0.3×100) | 180 | 90 | 360 | B (snapshot) |
| 4 | F1 queue-wait "Waiting for review" 336h (14d×0.2×40) | 112 | 56 | 224 | C (open B; unmapped C) |
| 5 | F3 overdue "Waiting for review" (102: 6d×0.2×40) | 48 | 24 | 96 | C (unmapped) |

Unpriced: none. Diagnostics: none. Context: 2 of 2 in-flight (100%)
queue/review; largest pool tie of singletons → alphabetical "Backlog"
(1 items). Due coverage 2 of 2. Counts 3/3/0.

### Hand-computed golden expectations — demo-asana (frozen before code)

Fixture: project 555, sections Intake(s1,queue)/Doing(s2,active)/Legal
review(s3,review); completedStatus "Done"(done); now = importedAt =
2026-07-20T00:00:00Z. Assumptions: Legal 110 (customized); defaultRate 35
(customized); same parameter shape as monday (overdue customer-accepted).

Tasks: 9001 "Draft NDA for new vendor" Legal review, Rina Legal→Legal,
created 06-15, modified 07-14, due 07-12, stories s1→s2 06-22, s2→s3 07-04.
9002 "Update onboarding checklist" Intake, unmapped assignee→pseudonym,
created 06-08, modified 06-28, no due, no stories. 9003 "Ship pricing page
update" memberships [project 555 section Doing; project 999 section x9],
assignee null→missing, created 06-01, due 06-25, completed 07-02; stories
s1→s2 06-05 (in-scope) + one foreign x8→x9 move 06-10 (A3: excluded, row-3
diagnostic "1 section move(s) in other projects ignored").

Derived events (7): 9001 arrival Intake @06-15 (7d=168h) + 2 transitions
(Legal review open 16d=384h); 9002 arrival Intake @06-08 (open 42d=1008h);
9003 arrival Intake @06-01 (4d=96h) + s1→s2 + completion Doing→Done @07-02
(A2; stage Done excludes it from overdue despite due 06-25 — terminal).

| Rank | Instance | Expected | Low | High | Conf |
|---|---|---|---|---|---|
| 1 | F1 queue-wait "Intake" 1272h (42d×35 + 7d×110 + 4d×35 @0.2) | 476 | 238 | 952 | C (open B; unmapped C; missing C) |
| 2 | F1 queue-wait "Legal review" 384h (16d×0.2×110) | 352 | 176 | 704 | B (open) |
| 3 | F3 overdue "Legal review" (9001: 8d×0.2×110) | 176 | 88 | 352 | A |
| 4 | F2 aging "Intake" (9002: 22d−14=8 excess ×0.3×35) | 84 | 42 | 168 | C (snapshot B; unmapped C) |

Unpriced: none. Context: 2 of 2 in-flight (100%) queue/review; pool tie →
alphabetical "Intake" (1 items). Due coverage 1 of 2 (9003 done, excluded
from in-flight). Counts 3/3/0. Report shows the Row 3 A3 diagnostic.

### SPI pressure-point log (updated as encountered)

- **PP-1 (M5)**: N5 "read-only = GET-only" was a provider-specific encoding of
  the real invariant (no mutations). Fetcher-edge convention restated; SPI
  untouched.
- **PP-2 (M3)**: canonical WorkItem holds a single ActorRef; Monday people
  columns hold many. Resolved provider-side by deterministic first-person
  rule; the single-actor assumption is now a KNOWN simplification of the
  domain model, to be revisited only if a real workspace shows material
  cost attribution error — not silently widened in P2.
- **PP-3 (M4 vs A5/J2)**: history-completeness attestation differs by
  provider (Jira: payload-provable; Asana: payload-provable via next_page;
  Monday: unprovable → customer attestation field). Resolved in
  provider mappings; canonical model untouched.
- **PP-4 (M6)**: board-scoped vs item-scoped history sources. Resolved
  provider-side (excluded-with-diagnostic rule); canonical event validation
  untouched.
- **PP-5 (A1/A2)**: multi-homing and orthogonal completion are Asana-shape
  facts absorbed entirely by AsanaMapping fields + derivation rules;
  canonical StageRef/ImportBatch untouched.
- (further entries added during implementation if encountered)

### P2 completion record (2026-07-21)

- **All hand-computed expectations for BOTH goldens matched on first
  generation** — every rank, magnitude, cost range, and confidence tier, plus
  the predicted Asana Row-3 foreign-move diagnostic and the monday 100%
  waiting-share context line. demo-monday exercises M1 (status column), M2
  (17-digit timestamps → exact ISO), M3 (first-person rule), J1-on-monday
  (item 101's 45-day open Backlog wait from two facts), and a Done item's
  closed queue interval still counting (103, 168h). demo-asana exercises A1
  (multi-homed task scoped to project 555), A2 (completed task in Done via
  completedStatus, completion event closing its Intake/Doing intervals, and
  its stale due date correctly NOT surfacing as overdue), A3 (foreign move
  excluded with a visible diagnostic), A4 (arrival from first in-scope
  story), and A5 (next_page completeness law).
- **D-16 closed**: the CSV provider now consumes `resolveActorValue`,
  `orderAndValidateEvents`, and `buildCapability` from canonical.ts — one
  implementation of actor/event/capability semantics for all four providers.
  demo-ops and demo-flow stayed byte-identical through the consolidation
  (verified via git diff — empty), and every pre-existing error-path test
  passed unchanged. `CsvImportError` renamed to `ImportError` (neutral
  `errors.ts`), all references and tests updated. ONE deliberate user-visible
  message change, recorded here: the missing-pseudonymization-context error
  now says "The data contains actor values…" (canonical wording) instead of
  the CSV-specific "The file contains actor values…". No test asserted the
  old wording; no other message changed.
- Full `pnpm check` green: **183/183 tests** (41 added: 8 monday transform
  units, 10 asana transform units, 6×2 conformance for the two new
  providers, 7 fetcher pure helpers, 2×2 goldens) · 89 modules, 0 boundary
  violations · demo-ops/demo-flow/demo-jira goldens byte-untouched.
- CLI edge improvements while wiring: raw-page filename ordering is now
  numeric (page-10 after page-9 — latent lexicographic bug that would have
  bitten the first ≥10-page real workspace, jira included); the deterministic
  run-id hash for API providers now feeds pages through JSON.stringify
  (unambiguous page boundaries) via one shared `apiRunId` helper. Goldens
  pin `--run-id`, so artifacts were unaffected.
- Live validation deliberately pending (same posture as P1): monday/asana
  HTTP paths and the exact GraphQL pagination shapes are built from the
  documented APIs with synthetic API-shape fixtures; first real
  board/project = fetcher shakedown. A3's treatment of NULL sections
  (excluded as out-of-scope; mixed null/in-scope currently hard-errors) is
  flagged as the most likely rule to need a documented amendment after
  contact with a real Asana workspace.

### SPI survival review — "Did the Provider SPI survive contact with multiple providers unchanged?"

**Yes — with one honest asterisk, and it is not in the SPI.**

Component-by-component verdict against the definition frozen at the top of
this P2 entry:

1. **Two-half provider shape (pure transform / effectful fetcher, raw
   verbatim between them)** — survived unchanged. Both connectors fit it
   exactly; neither needed the boundary moved.
2. **ProviderDescriptor type** — survived unchanged. Zero edits to the type;
   monday and asana are two new literals.
3. **Canonical assembly contract** (`resolveActorValue`,
   `orderAndValidateEvents(CanonicalEventInput[])`, `buildCapability`,
   `stageForStatus`) — survived unchanged: no signature, semantic, or
   message change was needed to accommodate either provider. The only edits
   to canonical.ts were the planned ImportError rename and a comment. The
   `ref`-labelled event-input design (P1) absorbed provider-specific error
   labels ("item 102 activity 1", "task 9003 story 2") exactly as intended.
4. **Canonical ImportBatch / domain model** — survived unchanged, but this
   is where the real pressure landed, absorbed provider-side and documented
   rather than silently widened:
   - PP-2: monday people columns hold MANY persons; WorkItem holds one
     ActorRef. Resolved by the deterministic first-person rule (M3). The
     single-actor assumption is now a KNOWN simplification with a named
     revisit trigger (material attribution error in a real workspace).
   - PP-3: history-completeness attestation differs per provider (Jira
     payload-provable via changelog.total; Asana payload-provable via
     next_page; monday UNPROVABLE → customer attestation field M4). The
     domain model never had a "history is complete" field — and still does
     not need one, because the rule is enforceable at each transform.
   - PP-5: Asana's multi-homing and orthogonal completion were absorbed
     entirely by AsanaMapping fields (projectGid, completedStatus) and
     derivation rules A1–A4.
   - PP-4: monday's board-scoped activity log (entries for items outside
     the snapshot) resolved by the M6 exclude-with-diagnostic rule.
5. **Conformance suite** — survived unchanged and did its job: the same six
   invariants now run against four providers with zero provider-specific
   carve-outs.

**The asterisk (PP-1):** the P1 completion record stated the fetcher edge is
"read-only by construction: GET requests only." monday's GraphQL API is
POST-only even for pure reads, so that formulation did not survive — it was
a provider-specific encoding of the real invariant. Restated as a platform
rule: **read-only = the request can express no mutation** (static query
constants containing none, asserted by test, for GraphQL; GET for REST).
This is a change to a documented edge CONVENTION, not to any SPI type,
contract, or the canonical model — but under this review's own standard it
is reported as the one thing contact with a second provider genuinely
falsified.

Also for the record: per-provider mapping TYPES gained fields
(statusColumnId, activityLogsComplete, projectGid, completedStatus). Mapping
types are per-provider by design (frozen definition above), so these are
provider adaptations to the SPI — the direction the founder rule demands —
not SPI evolution. No canonical field, no shared helper, and no descriptor
changed to satisfy any single provider.

**Doc 05 promise verdict** (P2 DoD): the "permanent integration contract"
promise holds after four providers of three genuinely different shapes
(files, item-scoped-history REST, board-scoped-history GraphQL,
story-derived multi-homed REST). Capability profiles honestly differ per
batch, not per marketing claim; every honest gap (monday completeness,
asana late-add arrival overstatement) is a documented rule with a named
revisit trigger, not a silent repair.

## Phase 2 / P3 — Telemetry (authorized 2026-07-21)

Founder scope (verbatim intent): telemetry derived from immutable run
artifacts wherever possible; interaction telemetry only at effectful product
edges; versioned event taxonomy; no titles, raw actor values, emails,
assumption values, or customer business data; local by default; explicit
opt-in before anything leaves the machine; telemetry must never affect
analysis, pricing, confidence, ranking, or reports; telemetry failure must
never fail an analysis run; all existing goldens byte-identical unless a
separate telemetry artifact is intentionally generated. Taxonomy and privacy
constraints frozen HERE before implementation; five proofs required after;
stop before P4.

### Event taxonomy v1 (frozen before code)

Envelope, one JSON object per JSONL line, fixed key order:
`{event, version, kind, at, runId?, fields}`.

**Derived events** (`kind: "derived"`) — computed by the pure function
`deriveRunTelemetry(run: AnalysisRun)` in the new `@costflow/telemetry`
package. Deterministic by construction: `at` = the run's pinned analysis
time (never a clock), `runId` = the run's id, fields are pure functions of
the immutable artifact. Written by the CLI to `<out>/telemetry.jsonl`
alongside run.json/report.md — an intentionally generated new golden
artifact.

- `tm-run@1.0.0` — exactly one per analysis run. Fields:
  `pricingPolicy` ('report'|'simulation'), `provider` (provider id),
  `engineAnalysisVersion`,
  `items {total, imported, dropped}`, `events` (count),
  `diagnostics {warnings, dropped}`,
  `capability {hasEventHistory, hasDueDates, hasLastUpdated, hasActors}`,
  `dueDates {inFlight, withDue}`, `contextObservations` (count),
  `estimates {count, tiers {A, B, C}}`,
  `pricing {priced, skipped, skipReasons {vendorSuggestedGate,
  missingAssumption, noCostModel, other}}`,
  `provenanceMix {vendorSuggested, customerAccepted, customerCustomized,
  customerMeasured}` (counts over rate-card entries + defaultRate + present
  parameters — states only, never values).
- `tm-detector@1.0.0` — one per detector outcome, in engine order. Fields:
  `signalId`, `signalVersion`, `status` ('ran'|'skipped'), `instanceCount`,
  `skipReasonClass` ('missing-capability'|null).

**Interaction events** (`kind: "interaction"`) — constructed ONLY in
`apps/cli` (the effectful edge), appended to the local file
`${COSTFLOW_TELEMETRY_DIR:-.costflow}/interactions.jsonl`. `at` = wall
clock (edge measurement, explicitly non-deterministic, never golden). No
`runId` in v1 (funnel linkage is a P4 decision, not a default).

- `tm-cli-analyze@1.0.0` — `{provider, mode, ok, errorClass, durationMs}`
- `tm-cli-fetch@1.0.0` — `{provider, ok, errorClass, durationMs}`
- `tm-cli-preflight@1.0.0` — `{ok, durationMs}`

`errorClass` enum: 'cli-error' (input/usage), 'import-error' (structural
data refusal), 'unexpected', or null on success. Never a message string.

Versioning law: any field addition/removal/semantic change bumps the event
version; the registry (`TELEMETRY_TAXONOMY`) records every event id,
version, kind, and description; emitters may only emit registered events
(asserted by test).

Skip-reason classing (deterministic prefix map over engine-owned strings):
'Rests on vendor-suggested' → vendorSuggestedGate; 'Missing assumption' →
missingAssumption; 'No cost model' → noCostModel; anything else → other.

### Privacy constraints (frozen before code)

NEVER in any telemetry event, derived or interaction: work-item titles or
ids; stage names or stage-name slugs (therefore NO friction-instance ids —
they embed stage slugs); actor values INCLUDING pseudonyms; role names;
emails; money amounts, rates, or magnitudes (item-hours/-days are customer
operational data); assumption values or ranges; mapping-template ids/
versions and assumption-set ids/versions (customer-authored strings); org
scope ids; salts; tokens; file paths; site URLs, project keys/gids, board
ids. ALLOWED: counts, booleans, durations, engine-owned identifiers (signal
ids, cost-model ids, provider ids, versions, tiers, provenance states,
policies, error classes), the opaque content-hash runId, and the pinned
analysis time. Mechanical guard, tested: every string value in `fields`
must match `^[a-z0-9@.:-]+$` (engine vocabulary is lowercase-mechanical;
customer vocabulary virtually never is), PLUS explicit known-string absence
scans against all five golden fixtures' titles/stages/actors/roles/rates.

Transport: none exists in P3. Both destinations are local files; the
interaction log can be disabled entirely with `COSTFLOW_TELEMETRY=off`.
Any future outward transport requires explicit opt-in machinery that does
not exist yet — nothing leaves the machine by construction.

Failure containment: every telemetry write (derived and interaction) is
wrapped at the edge; failure prints one stderr warning and never alters the
exit code or artifacts.

### The five proofs (test plan, frozen before code)

1. **Cannot modify analysis output**: dependency-cruiser rules — no package
   may import telemetry (only apps/cli may); telemetry imports domain +
   analysis only. Plus: `deriveRunTelemetry` leaves its input JSON-identical
   (before/after compare). Plus: run.json/report.md goldens byte-identical
   while telemetry is emitted in the same invocation.
2. **Failure is non-blocking**: spawned CLI with the interaction dir forced
   unwritable (env points under a regular file) exits 0 with artifacts
   intact and a stderr warning; derived-write helper unit-tested to swallow
   an impossible path.
3. **Prohibited data never appears**: known-string absence scan over the
   derived telemetry of ALL five golden runs + the machine-shape regex over
   every string field of every event both kinds.
4. **Derived events are deterministic**: derive twice → byte-identical;
   telemetry.jsonl frozen as a golden for all five demo runs; the CLI
   double-run gate extends to telemetry.jsonl bytes.
5. **Derived/interaction separation**: the registry types every event's
   kind; `deriveRunTelemetry` may emit only kind-derived events (asserted);
   interaction constructors exist only in apps/cli; the two kinds land in
   different files with different lifecycle (per-run artifact vs local
   append log).

### Hand-computed derived-telemetry expectations (frozen before code)

demo-monday tm-run fields: pricingPolicy report, provider monday, items
{3,3,0}, events 7, diagnostics {0,0}, capability all true, dueDates {2,2},
contextObservations 1, estimates {5, {A:1,B:1,C:3}}, pricing {5,0,{0,0,0,0}},
provenanceMix {0,1,5,0} (rates: Founder customized; defaultRate customized;
aging+attention+queueWait customized; overdue ACCEPTED). tm-detector:
f2-aging ran 1; f1-queue-wait ran 2; f3-overdue ran 2 (engine order).

demo-flow tm-run fields: pricingPolicy report, provider csv, items {4,4,0},
events 11, diagnostics {0,0}, capability all true, dueDates {3,3},
contextObservations 1, estimates {3, {A:1,B:2,C:0}}, pricing {3,2,
{vendorSuggestedGate:1, missingAssumption:1, noCostModel:0, other:0}},
provenanceMix {1,0,6,0} (3 rates customized + defaultRate VENDOR-SUGGESTED +
aging/attention/queueWait customized; overdue param absent → not counted).
tm-detector: f2-aging ran 2; f1-queue-wait ran 2; f3-overdue ran 1.

(demo-ops, demo-jira, demo-asana telemetry goldens are generated and frozen
under the same law; the two tables above are the pre-committed checks.)

### P3 completion record (2026-07-21)

Built exactly to the frozen taxonomy: new pure package `@costflow/telemetry`
(taxonomy registry + `deriveRunTelemetry` + byte-deterministic JSONL
serializer), CLI edge module `telemetry-edge.ts` (the ONLY place interaction
events are constructed), derived artifact `<out>/telemetry.jsonl` beside
run.json/report.md, local interaction log
`${COSTFLOW_TELEMETRY_DIR:-.costflow}/interactions.jsonl` (gitignored;
`COSTFLOW_TELEMETRY=off` disables). No transport exists — nothing can leave
the machine. **Both frozen hand tables (demo-monday, demo-flow) matched the
generated telemetry exactly on first generation**, including demo-flow's
skip-reason split {vendorSuggestedGate:1, missingAssumption:1} and
provenance mix {1,0,6,0}.

The five proofs, delivered as tests (all green):

1. **Telemetry cannot modify analysis output.** dependency-cruiser rules
   `nothing-imports-telemetry-except-apps` (no pure package may import
   telemetry) and `telemetry-only-domain-and-analysis` (telemetry src reads
   the artifact types and nothing else) — 0 violations across 94 modules.
   `deriveRunTelemetry` leaves its input JSON-identical (asserted per golden
   run and at unit level). All five goldens' run.json/report.md byte-
   identical while telemetry is emitted in the same invocation (git diff
   empty; CLI double-run gate).
2. **Telemetry failure is non-blocking.** Spawned CLI with the interaction
   destination forced unwritable (dir path under a regular file): exit 0,
   all three artifacts written, single stderr warning "interaction telemetry
   not recorded (…) — analysis unaffected." Derived-write helper equally
   contained. `COSTFLOW_TELEMETRY=off` produces no interaction file at all.
3. **Prohibited data never appears.** Known-string absence scan over the
   derived telemetry of ALL five golden runs (titles, stage names, actor
   values, pseudonym prefix, role names, quoted rate values, currency, org
   scope, customer-authored mapping/assumption ids) + recursive
   machine-shape regex `^[a-z0-9@.:-]+$` over every string field of every
   event, both kinds. Friction-instance ids (which embed stage slugs) are
   structurally absent from the taxonomy.
4. **Derived events are deterministic.** `at` = pinned analysis time, never
   a clock; double-derivation byte-identical; telemetry.jsonl frozen as a
   golden for all five demo runs; the CLI spawn-twice gate now byte-compares
   telemetry.jsonl too.
5. **Interaction events are clearly separated.** The registry types every
   event's kind; `deriveRunTelemetry` emits only kind-derived registered
   events (asserted); interaction constructors exist only in apps/cli;
   different files, different lifecycle, different `at` semantics; the
   derived artifact is asserted to contain ONLY kind-derived lines.

Verification: full `pnpm check` green — **210/210 tests** (27 added: 7
telemetry unit, 18 corpus/edge proofs incl. 3 CLI spawns, plus the extended
double-run gate and R-15 allowlist row) · 94 modules, 0 boundary violations
· all pre-P3 golden files byte-untouched; the only expected/ additions are
the five intentional telemetry.jsonl artifacts (authorized by the P3
directive). R-15 allowlist gained `telemetry: []` — the package carries
zero external dependencies.

Deliberate limits, named: no transport/opt-in machinery exists yet (P3 is
local-only by design; outward opt-in is future work with its own
authorization); interaction taxonomy is minimal (3 CLI events) because the
funnel the founder directive names (onboarding, mapping completion,
assumption confirmation, export) belongs to P4 surfaces that do not exist
yet — P4 ships pre-instrumented on this registry; `runId` is deliberately
absent from interaction events until a P4 decision links funnels.

## Phase 2 / P4.1 — Self-serve spine: first-report journey (authorized 2026-07-21)

Authorized scope: ONE authenticated customer connects ONE Jira workspace,
completes configuration, runs analysis, views the first report in the web
app, and can return to the persisted run. Exclusions per directive (no
billing/invites/org-admin/Monday-Asana-UI/dashboards/PDF/trends/simulation-
UI/scheduling/marketplace/branding). All CLI behavior, goldens, privacy
guarantees, and deterministic analysis unchanged.

### P4.1 execution plan (concise, per directive — not an architecture doc)

**Stack for this slice**: `apps/web` — Fastify, server-rendered HTML (no
SPA build; fewest moving parts, end-to-end testable via inject), `marked`
to render the EXISTING report.md artifact (numbers never re-derived),
node-postgres for persistence. Environment fact: this machine has no
Postgres/Docker, so the Pg adapter ships schema + SQL behind a store
contract; the contract test suite runs against the in-memory adapter always
and against real Postgres when COSTFLOW_TEST_DATABASE_URL is set (same
honesty pattern as the live-untested provider HTTP paths).

1. **Tenancy & authorization boundaries.** Rows: tenants → users →
   workspaces → jobs → runs; every row carries tenant_id; runs are
   append-only. Session cookie (HMAC-signed, httpOnly, SameSite=Lax)
   resolves {userId, tenantId}; EVERY store read/write takes tenantId as
   its first argument and scopes by it — cross-tenant ids resolve to
   not-found, asserted by test. CSRF: per-session token in every POST form.
   Per-tenant pseudonymization salt generated at tenant creation, encrypted
   at rest; scope id = tenant id. Auth is an adapter seam: OIDC
   authorization-code adapter (any managed IdP: issuer/clientId/secret from
   env, fetch injected so tests drive it with a stub issuer) + an
   explicitly-gated dev adapter (COSTFLOW_AUTH=dev) for local/test. No
   passwords are ever stored by CostFlow.
2. **Credential encryption & redaction.** Jira token encrypted at rest with
   AES-256-GCM (key: COSTFLOW_CREDENTIAL_KEY, 32-byte base64; payload =
   iv‖tag‖ciphertext). Decryption happens ONLY inside connection validation
   and job execution; the token never appears in any HTML response, form
   echo, log line, error message, or telemetry event (gateway errors are
   sanitized to status + class). Acceptance test greps every response body
   of the full journey for the token. Same treatment for the tenant salt.
3. **Job lifecycle & retry.** jobs: queued → running → succeeded | failed
   {errorClass: auth-error | fetch-error | import-error | unexpected}.
   In-process async execution (no background scheduler in scope); UI polls
   the run page. Retry is explicit: a failed job page offers "Run again" =
   NEW job row (append-only history; no in-place mutation). Recovery: jobs
   found 'running' at server start are marked failed/interrupted (crash
   evidence, never silent). now is captured once at job start (test-
   injectable for determinism).
4. **Onboarding state machine** (persisted per workspace):
   connected → scope-selected → statuses-mapped → actors-mapped →
   assumptions-set → ready (first successful run). Furthest-completed-step
   semantics: earlier steps stay editable; each route guards on its
   prerequisite; run creation requires ≥ assumptions-set. Observed statuses
   and actor values are extracted from the fetched raw pages (customer's
   own data shown only to the customer's authenticated session).
5. **Provenance transitions** (four-state model, doc 03 P4): every
   assumption is seeded from the vendor catalog as vendor-suggested;
   "Accept" (explicit button, value untouched) → customer-accepted; any
   value edit → customer-customized; customer-measured is NOT settable in
   P4.1 (reserved for measured flows). A customer-owned state never
   silently reverts to vendor-suggested. Role rates entered during
   onboarding are customer-customized; a role left without a rate falls
   back to defaultRate with the existing confidence cap. Report mode only —
   the engine's unpriced-until-owned gate is the UI's teacher.
6. **Telemetry events** (additive registry entries, same envelope/privacy
   law; constructors live only at the web edge): tm-web-signin,
   tm-web-workspace-connected {provider, ok, errorClass},
   tm-web-scope-selected {provider}, tm-web-statuses-mapped {mapped,
   droppedCandidates}, tm-web-actors-mapped {mappedToRoles, unmapped},
   tm-web-assumptions-confirmed {accepted, customized, vendorRemaining},
   tm-web-run {provider, ok, errorClass, durationMs}, tm-web-report-viewed
   {firstView} — all @1.0.0, kind interaction, counts/enums only. Derived
   tm-run/tm-detector are persisted with each run's artifacts unchanged.
7. **Failure & recovery states.** Connection validation failure (bad
   site/credentials) → inline form error, nothing persisted; fetch/import
   failure during a job → failed job with class + sanitized message +
   retry; interrupted jobs surfaced (see 3); unconfigured crypto/auth env →
   refuse to boot with a named message (never limp); telemetry failure
   never fails a request (P3 law, same wrapper pattern).
8. **Acceptance tests** (fixture-backed stub gateway = golden Jira raw
   pages; dev auth; memory store; pinned now): the full 8-step journey in
   one test — sign in, connect, choose project, map statuses, map actors,
   accept+customize assumptions (provenance states asserted in store), run
   (job succeeds), report view (demo-jira's known figures asserted), then a
   FRESH session views the persisted run. Plus: tenant-isolation (foreign
   ids 404), token-redaction sweep across all journey responses, job
   failure + retry, step gating (no run before assumptions), provenance
   transition rules, funnel telemetry order + privacy scan, store contract
   suite (memory now, pg when a database URL exists). Full pnpm check;
   existing goldens byte-identical.

### P4.1 completion record (2026-07-21)

Delivered exactly the authorized scope, nothing from the exclusion list.
New effectful edge `apps/web` (Fastify, server-rendered HTML, marked
rendering the EXISTING report.md artifact — no number is ever re-derived);
new pure module `providers/jira/urls.ts` in ingestion (URL builders +
observed-vocabulary extraction shared by CLI and web edges; CLI fetcher
re-exports them, its tests unchanged).

The eight completion criteria, each proven by the acceptance suite:

1. **Sign in** — dev adapter (email-only, explicitly gated) and a real OIDC
   authorization-code adapter (discovery → code exchange → userinfo) tested
   against a stubbed managed IdP, state round-trip included. No passwords
   ever stored.
2. **Connect a Jira workspace** — credentials validated against the
   gateway before anything persists; token AES-256-GCM-encrypted at rest;
   a rejected connection stores nothing and reports its class.
3. **Choose the imported scope** — project list from the live gateway;
   selection fetches raw pages and extracts the observed status/actor
   vocabulary for the mapping forms.
4. **Map statuses and roles** — every observed status (current + historical,
   the D-13/J3 rule made visible) must be mapped; people left roleless are
   pseudonymized, never stored by name.
5. **Accept or customize assumptions** — four-state provenance with the
   frozen transition table (`nextProvenance` unit-tested): vendor → accepted
   only by explicit accept; any edit → customized; owned states never
   silently downgrade; customer-measured not settable in P4.1. The
   all-vendor path is also tested: the engine's report-mode gate leaves
   EVERYTHING unpriced and the report says so.
6. **Run CostFlow** — jobs queued→running→succeeded/failed with sanitized
   error classes; retry is a new append-only job; interrupted jobs are
   marked failed at startup; pinned-clock jobs in tests.
7. **View a report** — the fixture-backed journey renders the P1
   hand-computed demo-jira figures (1,062 / 342 / 297) through the web; the
   persisted run.json carries pseudonyms, never raw identities.
8. **Return later** — a fresh session lists and renders the persisted run;
   first-view vs repeat-view distinguished in telemetry.

Cross-cutting proofs: tenant isolation (foreign workspace/job/run ids →
404 at routes AND null at the store, asserted for both layers); CSRF
required on every POST; the provider token appears in NO response body
across the entire journey (swept), in no error message, and in no telemetry
event; onboarding funnel telemetry fires in order (signin → connected →
scope → statuses → actors → assumptions{accepted/customized/vendorRemaining
counts} → run{ok/errorClass/duration} → report-viewed{firstView}) with
counts/enums only — scanned against customer vocabulary; store contract
suite runs against MemoryStore (and against Postgres when
COSTFLOW_TEST_DATABASE_URL exists).

Verification: full `pnpm check` green — **228 tests + 1 skipped** (46
added for P4.1) · 119 modules, 0 boundary violations · every pre-P4 golden
file and engine package byte-untouched (git diff empty) · CLI behavior,
privacy guarantees, and deterministic analysis unchanged (their suites run
unmodified).

Honest limits, named: the Postgres adapter ships schema + SQL behind the
contract suite but has never touched a live database (none exists on this
machine) — first deployment runs the same suite against real Postgres
before go-live; the OIDC adapter is stub-tested, live IdP shakedown pending;
jobs execute in-process (background scheduling is excluded from P4.1 by
directive); the web edge duplicates two small effectful helpers from the
CLI edge (HMAC pseudonymization, telemetry file sink) because pure packages
may not hold crypto/fs and apps may not import apps — noted as D-17,
revisit only if a third edge appears.
