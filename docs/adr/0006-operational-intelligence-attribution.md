# ADR-0006 — Operational Intelligence attributes to systems, not people

**Status**: accepted · **Binds**: FR-17, ADR-0002, doc 06 N1, doc 07 §1.5 /
§2.2 / §2.3 / §4.4 / N10–N12, doc 14 FS-4

## Context

The Operational Intelligence milestone (OI1) implements the first slice of the
doc 07 decision layer: the product stops reporting priced friction and starts
ranking the interventions that recover the most of it. Doc 07 designed this in
full but authorized none of it; this ADR authorizes a slice and fixes the one
question doc 07 did not answer directly.

That question came from the founder: *which employees need management
attention?* The stated intent was never blame — it was finding where management
attention has the highest operational return: one approver holding dozens of
blocked tasks, one specialist who has become a structural bottleneck, one
decision that many downstream items wait on. Those are doc 07 D1 (capacity
shortfall), D2 (load imbalance), and D3 (serial gatekeeping).

Three structural facts, verified against the implementation rather than assumed:

1. **Raw identity is unrepresentable in the analytical model.** `ActorRef`
   (`packages/domain/src/actor.ts`) is `role | unknown (pseudonym) | missing`.
   Pseudonymization happens at ingestion (NFR-5) and is one-way and org-scoped.
2. **Friction attribution is already structural.** `FrictionInstance.location`
   is `{ stage: StageRef }` and nothing else (`packages/friction/src/signal.ts`:
   "a stage, never a person").
3. **The reporting layer fails closed.** `findIndividualAttribution`
   (`apps/web/src/attribution.ts`) is exact-substring matching of the
   workspace's raw `observedActors` against the rendered bytes; `attributionOk`
   (`apps/web/src/server.ts`) withholds the entire response with HTTP 500 on any
   hit.

So a recommendation naming a person is not merely discouraged. It is
unrepresentable upstream and unservable downstream. The design question is
therefore not *whether* to allow it, but how to satisfy the founder's real
requirement entirely within that constraint.

## Decision

### 1. Load is a property of the system. Rate is a property of the person.

The governing rule for every Operational Intelligence metric, and the only part
of this ADR that is new law rather than applied law.

How much work sits in front of a role or a stage is the result of a routing
decision the organization made, so it is a system property: computable,
comparable, displayable. How fast someone processes what is in front of them is
a property of that person: never computed, never stored, never ranked, never
displayed.

**The test when a new metric is proposed:** if the number would change because a
person got faster, it is forbidden. If it would change because the organization
routed work differently, it is permitted.

Permitted: queue depth, wait hours, blocked counts, the age of the oldest
waiting item, dependency fan-in, and the distribution of assigned load across
roles including comparatively, because uneven distribution is a finding about
routing (D2). Forbidden: per-person throughput or cycle time, any ranking of
people by speed, quality, volume, or cost, and any per-person time series.

**Pseudonyms do not launder this rule.** An `unknown`-kind `ActorRef` carries a
stable org-scoped pseudonym, so per-pseudonym *load* is permitted under the rule
above while per-pseudonym *rate* remains forbidden exactly as for a named
person. The pseudonym is a privacy control, not a permission.

### 2. A recommendation's subject is a stage

Every recommendation is located at a `StageRef`, inheriting the structural
attribution that `FrictionInstance` already enforces. A role may appear in
supporting evidence (including its cardinality, for example "one actor-role
accounts for this stage's entire queue", which is what makes *redistribute*
actionable), never as the subject and never as the bearer of a cost.

### 3. Interventions come from doc 07's closed primitive set

The intervention vocabulary (doc 07 §2.2) stays closed and stays in a
registry: add capacity, split or merge a stage, introduce or change a WIP
limit, change batching cadence, add a stage SLA, reassign routing, remove a gate
for an item class, escalate on age. Adding a primitive is an amendment to this
ADR, not a call site.

**Amended during OI1 implementation, +2 primitives:**

- `review-queue` (Low, process-change). Doc 07's set is drawn from
  *simulatable* interventions, each bound to a data transform (§3.2). A
  concentration finding on snapshot-only evidence has no transform, and its
  honest action is triage rather than a process change. Without this primitive
  the diagnostic that works on every platform would have had no verb.
- `assign-ownership` (Low, process-change). D4's finding is that items have no
  owner. None of doc 07's eight primitives says "give these items an owner";
  `reassign-routing` is about where work goes, not whether anyone holds it.

Both are structural, both act on a stage, and neither is simulatable yet, which
is recorded here so that OI2's simulation work knows it inherits two primitives
without transforms rather than discovering it.

Deliberately closed, in explicit contrast to `EventType` (P4.5), which is
deliberately open so new analytics never require a migration. The opposite is
correct here: a closed set is what makes interventions simulatable (doc 07 §3.2
binds each primitive to a data transform), and it is what makes rule 1
structural rather than aspirational. No future call site can emit "coach" or
"review performance", because those verbs do not exist in the type.

### 4. Confidence reuses the existing tiers. It is never a probability.

Operational Intelligence confidence is the `Confidence` type already in
`packages/cost-engine/src/confidence.ts`: tiers A/B/C composed by minimum with
the binding constraint named, per doc 07 §4.4. Grades are assigned by evidence
class (doc 07 §1.5), never by a tunable score, and nothing may display higher
confidence than any of its inputs.

No percentage, no model output, no new scheme. A confidence number a reader
cannot trace to a rule is precisely the fabricated figure doc 03 P2/P3 exists to
prevent.

### 5. Impact and implementation complexity are separate axes, never one score

A recommendation presents two independent facts and does not fuse them:

- **Operational impact** — the friction currently priced at the subject stage.
  Measured by the cost engine, carrying its own range, confidence, and formula
  trace. Evidence.
- **Implementation complexity** — Low, Medium, or High: a documented
  characteristic of the *intervention primitive itself*, uniform across tenants,
  with its doc 07 §2.2 effort class named as the driver ("Medium — process
  change"). A declared property of the action, never an inference about the
  organization.

**Operational Intelligence does not compute a composite priority score.** Doc 07
§2.3 specifies ranking by risk-adjusted return: worst-case savings against
best-case effort. That formula presupposes two inputs this milestone
deliberately lacks — a simulated savings range (OI1 claims none, per N12) and a
customer-owned effort range (doc 03 P4 ownership, not yet collected). Composing
a measured money range with a declared complexity class would manufacture a
number with no evidentiary basis, which is precisely the failure doc 03 P2/P3
exists to prevent. A ranking is a claim, and it is held to the same evidentiary
bar as a cost.

Lists are therefore ordered by measured operational impact, descending, and the
ordering is labelled as what it is: where the organization is currently losing
the most, not a recommended sequence. Complexity is displayed beside each item
and never reorders it. Composing the two axes is the executive's judgment, and
the product's job is to make that judgment well-informed rather than to
pre-empt it.

Doc 07 §2.3's ranking becomes available when both of its inputs exist. Adopting
it is a later amendment, not a default.

### 6. No double-counting, which forecloses one of the requested targets

Doc 14 FS-4 and doc 07 N12 bind the recommendation layer without amendment: a
recommendation's claimed recovery may not include value already priced by
another friction.

This decides the "which teams are overloaded" requirement. Doc 14 files WIP
overload (F6) as a **Context Signal**, having failed FS-2, FS-3, and decisively
FS-4: overload's damage is *delivered through* longer queue waits and more
aging, which F1/F2/F3 already price. Overload may therefore appear as the
explanatory *why* beneath a priced recommendation, and may never carry its own
recovery figure. `ContextObservation` is structurally incapable of holding one,
and stays that way.

## Consequences

- **CostFlow cannot answer "who is my worst performer."** Accepted; it is the
  point, and it is now enforced at three layers (domain type, friction location,
  reporting guard) rather than by convention.
- **Two of the eight requested targets change shape.** "Which employees need
  management attention" becomes D1/D2/D3 findings located at stages. "Which
  teams are overloaded" becomes unpriced context under §6 rather than a ranked
  recommendation.
- **Some genuinely predictive signal is given up.** A role that is slower than
  its peers is invisible as such. The same situation still surfaces as queue
  depth and wait hours at that stage, which is the actionable form anyway.
- **A novel intervention requires an ADR amendment**, not a patch. Accepted as
  the cost of making rule 1 structural.
- **The product will not tell an executive what to do first.** It shows where
  the most is being lost and what each intervention costs to attempt, and stops
  there. This reads as less decisive than a ranked list with a single score, and
  is the honest position until §5's missing inputs exist.
- **New surfaces inherit the guard.** ADR-0002's scope clause is a standing
  requirement: any Operational Intelligence surface that renders evidence must
  call `attributionOk` before emitting bytes, exactly as `GET /reports/:runId`
  does. A recommendations page that bypassed it would be the first hole in a
  guarantee that is currently total.
