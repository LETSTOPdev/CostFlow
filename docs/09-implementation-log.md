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
