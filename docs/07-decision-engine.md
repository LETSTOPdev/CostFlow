# 07 — The Decision Layer: Root Cause, Recommendations, Simulation, Decisions

**Status: design only. Extends docs 00–06 without amending their principles.
Nothing here is authorized for implementation.**

## 0. Framing, and two honest challenges before the design

The vision upgrade is correct in shape: cost estimation alone is a *report*;
the five questions together are a *decision*. The layering also happens to map
cleanly onto the approved foundation — friction detection answers "what,"
and everything below builds on entities that already exist (FrictionInstance,
CostEstimate, AnalysisRun, AssumptionSet). No approved principle needs to change.
That is the good news, and it is not a coincidence: the fact/interpretation/
judgment layering of doc 02 was designed to be extended upward.

Two challenges to the vision as stated, before designing into it:

**Challenge 1 — "Root cause" is a claim our data cannot fully support, and we
must not pretend otherwise.** We observe work-item lifecycles. Observational
data supports *diagnosis* (evidence-backed identification of contributing
mechanisms) but not *proven causation* (counterfactual certainty). A
deterministic engine can absolutely rank candidate explanations with evidence —
that is what this document designs — but the product must speak the language of
"contributing factors, supported by this evidence" rather than "the root cause
is X." This is not timidity; it is the same trust posture as ranges-not-points
(doc 03 P2). An executive who catches us claiming causation we can't defend
discounts every diagnosis we ever make. **Design consequence: the engine is
named the Diagnostic Engine internally; "root cause" survives as UX vocabulary
only where a finding reaches the highest evidence tier.**

**Challenge 2 — "Operating system for executive decision making" is a
destination, not a build order.** The decision layer multiplies the value of the
cost layer only if the cost layer is trusted first (Risk R1, doc 06). Nothing
in this document may creep into the MVP definition of doc 00; the MVP bar
remains a trusted, explainable cost ranking from one CSV. The decision layer is
the post-PMF expansion — designed now so the domain model reserves its seats,
built later. The one exception worth pulling forward is noted in §7
(the Decision object's outcome loop, which has a data-compounding clock ticking
on it, like Q4).

The five questions, mapped to systems:

| Question | System | Foundation it builds on |
|---|---|---|
| 1. What is happening? | Friction detection (docs 02, exists) | ImportBatch → FrictionInstance |
| 2. Why is it happening? | **Diagnostic Engine** (§1) | FrictionInstance + canonical data |
| 3. What is the impact? | Cost Engine (doc 03, exists) | CostEstimate |
| 4. What should we do? | **Recommendation Engine** (§2) | DiagnosticFinding + Playbooks |
| 5. What if we fixed it? | **Simulation Engine** (§3) | Cost Engine replayed over transformed data |
| — All five, composed | **Decision Engine** (§4) | Everything above |

---

## 1. Diagnostic Engine ("Root Cause Engine")

### 1.1 What it is

A deterministic engine that, given a FrictionInstance and the canonical data
around it, produces ranked, evidence-backed **DiagnosticFindings**: candidate
explanations for why the friction exists, each with cited evidence and a
confidence grade. Pure function, versioned, no I/O, no LLM — the same contract
as the cost engine (doc 03 P1), for the same reason: a diagnosis that cannot
reproduce itself cannot be audited.

### 1.2 The causal factor taxonomy

The example causes in the brief mix three different kinds of thing (a mechanism
like "overloaded team," a stage label like "legal review," and an external
condition like "customer waiting"). The taxonomy below reorganizes them by
**mechanism**, because — exactly as with the friction taxonomy — the mechanism
determines both the detector and the recommendation family. Stage labels
("legal," "approval") are *where* a mechanism lives, not what it is.

| # | Causal factor | Mechanism | Primary evidence pattern (deterministic test) |
|---|---|---|---|
| D1 | **Capacity shortfall** | Demand into a stage/team persistently exceeds completion throughput | Arrival rate > completion rate over window; queue grows monotonically; utilization proxy high |
| D2 | **Load imbalance** | Aggregate capacity exists but is unevenly distributed across queues/teams | High variance of queue wait across parallel stages/teams handling same work type |
| D3 | **Serial gatekeeping** | A single stage/approver-role through which disproportionate volume must pass | One `review`-kind stage appears in the path of >X% of items; its wait dominates total lead time |
| D4 | **Missing ownership** | Items wait with no actor-role attached, or in stages with no owning team | High share of aging items with null assignee-role; wait time concentrated where ownership is unmapped |
| D5 | **Dependency drag** | Items blocked by other items; delay is imported, not produced | DependencyLinks present; blocked-time correlates with blocker item lead times |
| D6 | **Handoff structure** | Process design forces many actor/team transitions per item | Handoff count per item high vs. process median; wait clusters at transition boundaries |
| D7 | **Rework loops** | Items structurally return to earlier stages (quality/spec problems upstream) | Regression events concentrated on specific stage pairs; repeat offenders by work type |
| D8 | **External wait** | The delay is outside the org (customer, vendor, regulator) | Wait concentrated in stages mapped as external-wait during the mapping wizard |
| D9 | **Policy/batching artifacts** | Cadence-driven delay: weekly approval meetings, batch releases, SLA misalignment | Wait-time distribution is multimodal/periodic (spikes at fixed intervals) rather than load-driven |
| D10 | **Priority churn** | Expedites and reprioritization starve steady-state work | Priority-field volatility; aging concentrated in never-expedited items while expedited items flow |

Notes on the brief's examples: *approval bottlenecks* = D3 (usually with D1 or
D9 underneath — "the approval stage is slow" is a symptom; the diagnosis is
*why*: too few approvers (D1), one mandatory gate (D3), or Tuesday-only
approval meetings (D9) — these have completely different fixes, which is the
entire point of diagnosing). *Legal reviews* and *customer waiting* enter the
model as stage semantics (D3/D8 contexts) captured in the mapping wizard — a
new, small extension to it: optionally tagging stages as `external-wait` or
`gated-approval`. *Resource shortages* = D1. *Queue imbalance* = D2. *Process
design issues* = D6/D7/D9.

Taxonomy rules (mirroring doc 02 §4): every factor must be testable from data
we ingest, with a declared minimum data requirement (most diagnostic tests need
event history; D4 and parts of D2 work on snapshots — degradation is per-factor
and visible, per A7).

### 1.3 Domain model representation

Extending doc 02's signal/instance pattern one layer up:

- **DiagnosticSignal** — the versioned *definition* of one causal-factor test:
  the factor it tests for (D1–D10), its data requirements, its evidence
  computation, and its grading thresholds. Registered like FrictionSignals.
- **DiagnosticFinding** — one concrete result: `{friction_instance, factor,
  strength (effect-size measure, e.g., "this stage accounts for 61% of median
  lead time"), evidence_trace, confidence_grade, signal_version}`. Immutable,
  produced within an AnalysisRun. The `evidence_trace` is the diagnostic
  sibling of the cost engine's `formula_trace` — the machine-readable
  substrate for explainability (doc 03 E3 applies unchanged: any prose about a
  finding is rendered *from* its trace).
- A FrictionInstance may have **zero, one, or several** findings. Zero is a
  legal and honest outcome ("we detected the friction; the data does not
  support a diagnosis") and must be displayed as such, never padded.

### 1.4 Ranking multiple findings

Findings for the same friction are ranked by a deterministic score with three
declared components, in lexicographic-ish composition (confidence gates first,
then magnitude):

1. **Evidence grade** (below) — a finding never outranks one of a strictly
   higher grade regardless of magnitude. Rationale: showing a flashy
   low-evidence "cause" above a solid boring one is exactly how diagnostic
   credibility dies.
2. **Explanatory share** — how much of the friction's magnitude the factor's
   evidence accounts for (e.g., share of total wait attributable to the tested
   stage/pattern).
3. **Distinctiveness** — how anomalous the pattern is vs. the org's own
   baseline (same process, other stages/periods). We compare the customer to
   themselves, never to fabricated industry norms (N7 unchanged).

Multiple findings are presented as a ranked *set* ("62% of this friction's
wait is explained by the Contract Review gate [grade A]; load imbalance across
regional teams contributes [grade B]") — not forced into a single culprit.
Real frictions are usually multi-causal, and pretending otherwise would make
recommendations worse, not simpler.

### 1.5 Confidence

Diagnostic confidence is **graded by evidence class, mechanically** — never a
tunable "score" someone can inflate:

- **Grade A — Demonstrated pattern**: the evidence test passed on complete
  event history over a sufficient window, effect size above threshold, pattern
  stable across sub-windows (not driven by a handful of outlier items — the
  engine tests this explicitly).
- **Grade B — Supported hypothesis**: test passed but on partial data (short
  window, snapshot inference per Q3, or effect concentrated in few items).
- **Grade C — Consistent with**: weak/indirect evidence only. Grade C findings
  are shown collapsed under "possible contributing factors," never headline a
  diagnosis, and never feed the Recommendation Engine's savings math (§2).

Confidence composes downward only (doc 03 vocabulary reused): nothing built on
a Grade B finding may present higher than B (see §5, uncertainty propagation).

---

## 2. Recommendation Engine

### 2.1 The core design decision: a curated playbook library, deterministically matched

Recommendations are **not generated**; they are **selected and parameterized**.
The engine owns a versioned library of **Playbooks** — curated intervention
patterns authored by humans (initially us; eventually with customer-specific
additions) — and deterministically matches them to (friction type × causal
factor × context guards), then fills their parameters from the customer's
actual data.

Why this is the right architecture and not a limitation:

- **Determinism for free**: matching + parameterization is pure computation.
  Same finding, same library version → same recommendation, forever auditable.
- **The library is compounding IP** — exactly like MappingTemplates and cost
  models. Ten years of "what actually fixes D3-in-approval-stages" is a moat an
  LLM cannot replicate, because it will be calibrated by outcome data (§4.5).
- **LLMs stay in their lane** (doc 05 unchanged): they may *explain* a selected
  recommendation in context, drafting prose rendered from its trace; they never
  invent, select, or rank one.

### 2.2 Playbook model

A **Playbook** (versioned, registry-listed like cost models):

- `applies_to`: friction types × causal factors × guard predicates over the
  data ("only if stage is `review`-kind," "only if ≥2 parallel teams exist").
  Guards are what prevent nonsense like recommending load-rebalancing to an
  org with one team.
- `intervention`: the action pattern, in structured form — one of a small closed
  set of **intervention primitives** (add capacity to X; split/merge stage;
  introduce/raise/lower WIP limit; change batching cadence; add SLA to stage;
  reassign work type routing; remove gate for item class; escalate-on-age
  rule). The closed set matters enormously: it is what makes recommendations
  *simulatable* (§3) — every primitive has a defined transform on the data.
- `parameter_bindings`: how the primitive's parameters are computed from the
  finding's evidence (e.g., WIP limit suggestion derived from the org's own
  observed throughput, not a magic number).
- `effort_model`: a structured, honest effort estimate — `{effort_class:
  process-change | staffing | tooling | policy, indicative_range, drivers[]}`.
  We do not pretend to know the customer's org enough to price implementation
  precisely; effort is a **class + range + named drivers**, editable by the
  customer (assumption-ownership principle, doc 03 P4, applied to effort).
- `expected_savings_binding`: which simulation (§3) prices this playbook's
  benefit. **The Recommendation Engine never computes savings itself** — it
  delegates to the Simulation Engine so there is exactly one place in the
  product where counterfactual money is computed. One engine, one audit path.
- `evidence_requirements`: minimum diagnostic grade (≥B) to be offered at all.
- `risks_and_caveats`: structured, always displayed ("WIP limits can increase
  rejection friction at intake"), because a recommendation engine that only
  lists upsides is a slide deck, not a decision tool.

A **Recommendation** (instance) = `{playbook_version, diagnostic_findings[],
bound_parameters, effort_estimate, simulation_ref → savings_range,
confidence, trace}`. Immutable per run, like everything else.

### 2.3 Prioritization

Recommendations are ranked by **risk-adjusted return**, computed from ranges,
not points:

- Return: simulated savings range (§3), horizon-normalized (per quarter).
- Cost: effort class/range (customer-editable).
- Risk adjustment: confidence composition (§5) — the score uses the *low* bound
  of savings against the *high* bound of effort for ranking robustness. A
  recommendation that only looks good at its optimistic bound should not
  outrank one that clears the bar at its pessimistic bound. This conservative
  ranking rule is the recommendation-layer analog of doc 03 P3.
- Tie-breakers: implementation difficulty class (policy < process-change <
  staffing < tooling, i.e., prefer reversible/cheap-to-try), then time-to-
  impact.

The exact scoring formula is versioned and displayed (explainability applies to
rankings, not just numbers): "ranked #1 because worst-case savings still exceed
best-case effort within one quarter."

---

## 3. Simulation Engine

### 3.1 The honest scope: replay, not prophecy

The biggest design risk in this entire document is over-promising here. A full
discrete-event simulation of an organization, parameterized from partial CSV
exports, would be fiction wearing math. The deterministic, defensible core is:

> **Counterfactual replay**: re-run the *actual observed period* through the
> *existing cost engine*, with a declared transformation applied to the data,
> and diff the two runs.

"What if approval SLA were 24h instead of 72h?" becomes: cap every observed
wait in that stage at 24h in a transformed copy of the event history →
recompute frictions and costs with the *same* engine versions and assumption
set → the delta is the answer. Every property we need falls out:

- **Deterministic and reproducible** — it is literally two AnalysisRuns and a
  diff, machinery that already exists (FR-14).
- **Explainable by construction** — the result inherits full formula traces on
  both sides; "where does this savings number come from" has the same one-click
  answer as every other number (doc 03 E1 applies without modification).
- **Honestly framed** — the product says: "*Had* this been true last quarter,
  estimated cost would have been X–Y lower." Retrodiction on the customer's own
  data, not a forecast. The tense is a trust device and is mandatory in all UI
  and exports.

### 3.2 Intervention transforms

Each intervention primitive (§2.2) defines a **transform** on canonical data —
this is the contract that binds Recommendations to Simulations:

| Primitive | Transform (illustrative) |
|---|---|
| Stage SLA change | Cap per-item wait in stage at new SLA |
| Add capacity to stage | Scale stage completion throughput; re-drain the observed queue arrival sequence under new service rate (simple deterministic queue replay) |
| Remove/merge stage | Delete stage's wait contribution; re-route transitions |
| WIP limit change | Re-sequence stage entries under the limit against observed arrivals; recompute waits |
| Handoff reduction | Remove the k lowest-value transition pairs per the diagnostic evidence; subtract per-handoff overhead |
| Batching cadence change | Re-time batch-released transitions to the new cadence |

Transforms are versioned, pure, and composable (a Scenario may stack transforms;
composition order is explicit and displayed). The "hire one reviewer" example
uses the capacity transform — note it needs one more assumption (what fraction
of stage throughput one person adds), which the customer supplies or accepts
as a labeled default (P4 again).

### 3.3 Required assumptions, stated as a contract

Every simulation declares, and shows, exactly three kinds of input:

1. **Observed data** (the batches replayed) — with the capability profile
   caveats it already carries.
2. **Transform parameters** (the intervention itself) — chosen by the user or
   bound by a playbook.
3. **Behavioral assumptions** — the honest fine print, each a named, visible,
   toggleable assumption: *demand held constant* (fixing approvals doesn't
   change what arrives), *no downstream shift* by default (see limitations),
   *no behavioral adaptation* (people don't game the new rule). Defaults are
   conservative; each assumption's presence is displayed on the result, not
   buried in docs.

### 3.4 Confidence and limitations

- Simulation confidence = min(confidence of underlying data/diagnosis, transform
  fidelity class). Transform fidelity is graded per primitive: capping an SLA
  on observed waits is high-fidelity arithmetic; capacity re-draining involves
  a queue model and is graded lower — the grade travels with the result.
- **Declared limitations (displayed, not hidden):** (a) bottleneck migration —
  fixing stage A often reveals a queue at stage B; the replay *does* capture
  first-order migration for transforms that re-route flow, and says when it
  can't; (b) no second-order behavioral effects — Goodhart risk is real and
  named ("SLA caps can incentivize premature approvals"); playbook
  `risks_and_caveats` carry these; (c) demand exogeneity — we do not model
  demand response; (d) results degrade with the same data gaps as everything
  else (no event history → most transforms unavailable, said plainly per A7).
- **What we refuse to build (extends doc 06):** free-form "simulate my org"
  sandboxes decoupled from observed data, Monte Carlo forecasts presented as
  predictions, or any simulated number that does not carry its transform +
  assumptions on its face. If a customer wants prophecy, we sell them honest
  retrodiction and label the difference.

---

## 4. Decision Engine

### 4.1 What a Decision is

The Decision is the product's true unit of value — the object an executive
actually acts on, and (critically) the object whose outcome we can later
measure. It is a *composition with a lifecycle*, not a new kind of analysis:

**Decision** :=
- `subject`: the friction (or friction cluster) being decided about
- `evidence`: diagnostic findings (ranked, graded)
- `impact`: cost estimates (ranges, from the cost engine)
- `options[]`: recommendations, each with its simulation result and ROI range
  — **a Decision presents options, including always the implicit option
  "do nothing" priced at the friction's ongoing cost.** Executives decide
  between alternatives; a single prescriptive answer is a memo, not a decision.
- `resolution`: the human's choice + rationale (free text, theirs)
- `lifecycle`: `draft → presented → decided → in_progress → realized | abandoned`
- `outcome`: post-decision measurement (§4.5)
- Full version pins: every referenced run, model, playbook, assumption set.

Immutable per version; amendments create new versions (A3/N6 apply). The
composition pipeline (friction → cause → impact → recommendation → simulation
→ ROI) is exactly the dependency chain of the objects above — the Decision
adds no computation of its own, only assembly, choice, and memory. This
thinness is deliberate: every number in a Decision is computed by exactly one
engine elsewhere and merely *cited* here, so the audit path stays singular.

### 4.2 Ranking decisions

The executive-facing queue ("what should we decide this month?") ranks open
Decisions by **decision leverage**, deterministically:

1. Risk-adjusted ROI of the best option (worst-case savings vs. best-case
   effort, per §2.3) — the primary sort.
2. Decay urgency — frictions whose cost trend is worsening across runs
   outrank static ones of equal size (trend machinery exists, FR-14).
3. Confidence gate — a Decision whose best option rests on Grade C evidence is
   held in a separate "needs better data" tray with a concrete unlock ("attach
   value attribution / upload event history to promote this"), converting low
   confidence into a product loop instead of a lie.

### 4.3 Conflicting recommendations

Conflicts are **structural, declared, and resolved at portfolio level** — never
silently, never by the LLM:

- Every recommendation declares its **touched set**: stages, teams, and
  capacity pools its intervention modifies (derivable from its transform).
- Two options **conflict** if their touched sets overlap with incompatible
  transforms (raise and remove the same gate), and **interact** if overlapping
  but composable (both add capacity to the same team — savings don't add
  linearly).
- The Decision Engine surfaces a **portfolio view**: chosen options across open
  Decisions are checked for conflicts/interactions; interacting sets are
  re-simulated *composed* (transforms stack, §3.2) so the displayed combined
  savings is the simulated joint number, never the naive sum. Double-counting
  savings across recommendations is the decision-layer version of fabricated
  dollars — it goes on the never list (§6).
- True conflicts are presented as an explicit either/or with both branches
  simulated. The human chooses; the system remembers the rationale.

### 4.4 Uncertainty propagation

One system-wide rule set, stated once and enforced everywhere:

1. **Ranges propagate by interval composition** — arithmetic on ranges keeps
   worst/best bounds; ranges only widen through composition, never narrow.
2. **Grades compose by minimum** — a chain's confidence is its weakest link:
   Decision option confidence = min(data capability, diagnostic grade, cost
   confidence tier, transform fidelity). Displayed at every level with the
   *binding constraint named*: "confidence B — limited by: no event history in
   the March batch." Naming the binding constraint is what turns a grade from
   a badge into an action ("upload history → this becomes A").
3. **Rankings use conservative bounds** (§2.3), so ordering is robust to
   uncertainty rather than flattered by it.
4. **No downstream laundering**: nothing may display higher confidence than
   any of its inputs. Mechanically checkable, therefore CI-testable.

### 4.5 The outcome loop — the actual moat (and the one thing to pull forward)

When a Decision reaches `in_progress`, the system knows what was predicted
(simulation delta) and watches what happens (subsequent runs on new uploads):
**realized vs. projected savings, computed by the same engines, diffed the same
way.** This closes the loop the entire industry leaves open, and it compounds
three ways:

- **Customer trust**: "CostFlow said 90–140k; we realized ~110k" is the most
  powerful sales asset the product can ever generate.
- **Playbook calibration**: outcome data grades playbooks and transform
  fidelity empirically — the recommendation library stops being opinion and
  becomes evidence. This is the moat: competitors can copy playbook *text*;
  they cannot copy ten years of measured intervention outcomes.
- **Benchmark seed**: outcome data is exactly what the future benchmark layer
  (Q4) wants, with the same consent-language urgency.

**Recommendation to founders**: the full decision layer is post-PMF, but the
*Decision object with lifecycle and outcome tracking* — even in a manual,
thin form ("mark this friction as being-fixed; we'll track the delta") — is
worth pulling into the first post-MVP milestone. Its value compounds with
calendar time; every quarter without it is calibration data lost forever.

---

## 5. Future Vision — five years out, same architecture

The test applied to each expansion: does it require rewriting any approved
principle, or only adding engines/providers around the same immutable,
versioned, explainable core? All five pass, some with course corrections.

- **Continuous integrations.** Already designed (doc 05 §4): extractors on
  schedules feeding the same pipeline; "continuous" is a shortening batch
  interval, not an architecture change. The decision layer adds one new
  consequence: fresh data auto-refreshes *monitoring* of in-progress Decisions
  (outcome loop), which is the first genuinely valuable always-on behavior —
  a better argument for integrations than dashboards ever were.

- **Benchmarking.** The moat is sequenced: first *self*-benchmarks (your Q3 vs.
  Q1 — exists via run diffs), then *outcome* benchmarks ("orgs that applied
  this playbook to D3 frictions saw X" — from §4.5, properly consented per
  Q4), and only then cohort benchmarks ("vs. similar companies"), which need
  aggregation thresholds and legal review. Note the order inversion from the
  usual: playbook-outcome benchmarks are more defensible and more decision-
  relevant than cohort medians, and we get them earlier. N7 stands until the
  consented architecture exists.

- **Predictive friction.** "This queue will breach SLA in ~3 weeks at current
  trend." A doctrinal clarification is needed and is hereby made: the ban is on
  *non-reproducible* computation in the numeric path (N2's actual rationale),
  not on statistics. A versioned, deterministic-at-inference statistical model
  (trend extrapolation, survival curves on queue growth) is admissible if it
  meets the same bar as every engine: versioned, reproducible, explainable,
  uncertainty-carrying, and **labeled as projection, never observation** — a
  separate visual and verbal register in perpetuity. LLMs remain banned from
  the numeric path; regressions were never the problem.

- **AI copilots.** The conversational layer over Decision objects: "why is
  option B ranked first?" answered by an LLM that is *grounded read-only* in
  traces (formula, evidence, transform) and may only reference quantities
  present in them — doc 03 E3 generalizes from explanations to conversation
  without amendment. The copilot is a lens on the decision system, never a
  participant in it. This is where the deterministic-core bet pays out most
  visibly: competitors whose numbers come *from* the LLM cannot let users
  interrogate them; ours improve under interrogation.

- **Autonomous recommendations.** Here the vision needs its strongest pushback.
  The valuable autonomy ladder is: (1) auto-draft Decisions when thresholds
  trip (system prepares, human decides) → (2) standing policies with human-
  approved parameters ("alert and draft whenever any queue's cost run-rate
  exceeds 50k/quarter") → (3) delegated micro-actions *inside CostFlow only*
  (auto-promote a draft to the exec queue). What it must never become is
  autonomous *execution* in customer systems — auto-reassigning work,
  auto-changing WIP limits in Jira. That collides with N5 (write-back), with
  our read-only security posture, and with the product's actual thesis: the
  human owns the decision; we own everything up to it. "Autonomous
  recommendation" should mean *the preparation of decisions becomes free*,
  not that decisions stop being made by people. Five years out, the winning
  position is "the system that makes every executive decision defensible,"
  not "the system that makes decisions" — the former is a moat, the latter is
  a liability in every procurement review on earth.

**What would force a rewrite (named so we can watch for it):** none of the
above — but two things would: (a) true real-time streaming decisioning
(sub-minute), which would break the immutable-run model — no credible customer
need exists or is foreseen; (b) individual-level modeling, which is banned
anyway (N1). The architecture's five-year risk is not capability, it is
*discipline*: every future feature will be easier to build as a special case
outside the run/trace/version machinery. The never-list and CI-enforced
boundaries are the defense.

---

## 6. Additions to standing constraints (extends doc 06 §1)

- **N10 — No causal claims above evidence grade.** "Root cause" language is
  reserved for Grade A findings; below that, "contributing factor" /
  "hypothesis" vocabulary is mandatory in UI and exports.
- **N11 — No LLM-originated recommendations.** Playbook selection, ranking,
  and parameterization are deterministic; LLMs explain, never propose.
- **N12 — No unsimulated savings claims and no naive summation.** Every
  savings figure cites its simulation; interacting recommendations display
  jointly-simulated numbers only.
- **N13 — Simulations are retrodictions unless explicitly built and labeled as
  projections.** Tense discipline ("would have") is enforced in product copy
  and export templates.
- **N14 — No autonomous execution in external systems.** Autonomy stops at
  preparing and monitoring Decisions inside CostFlow. (Sharpens N5.)

## 7. New open questions (extends doc 06 §2)

- **Q9 — Diagnostic thresholds calibration.** Evidence-grade thresholds (§1.5)
  need empirical grounding from design-partner data before the diagnostic
  layer ships; shipping with guessed thresholds risks confident-wrong
  diagnoses, the worst failure mode this layer has.
- **Q10 — Playbook authorship model.** Curated-by-us only, or customer-authored
  playbooks (their own intervention patterns, privately)? Default: ours only
  until the outcome loop can grade playbooks; customer authoring without
  outcome grading would pollute the library.
- **Q11 — Decision-object minimal form in first post-MVP milestone.** Exactly
  how thin can the outcome loop ship (§4.5) while still capturing calibration
  data? Needs a dedicated design pass before that milestone.
- **Q12 — Queue-replay fidelity.** The capacity/WIP transforms (§3.2) embed a
  simple deterministic queue model; validate its retrodictive accuracy against
  design-partner histories (predict a past period from an earlier one) before
  any savings number rests on it. If fidelity is poor, those transforms ship
  later than SLA/gate transforms, which are arithmetic.

## 8. Package additions (extends doc 05 — for the approved future, not MVP)

```
packages/
├── diagnostics/      # DiagnosticSignals + engine. Pure. → domain, friction
├── playbooks/        # Playbook registry + recommendation engine. Pure.
│                     #   → domain, diagnostics, (simulation: types only)
├── simulation/       # Transforms + replay orchestration. Pure computation
│                     #   over cost-engine reruns. → domain, cost-engine, analysis
└── decisions/        # Decision assembly, lifecycle, portfolio checks,
                      #   outcome tracking. → all of the above; owns no math
```

Same rules as doc 05 §3: pure engines, versioned registries, `ai-assist` still
quarantined to the app layer, provider names still banned outside ingestion.
The dependency arrow always points down the five-questions stack; nothing in a
lower layer knows Decisions exist.
