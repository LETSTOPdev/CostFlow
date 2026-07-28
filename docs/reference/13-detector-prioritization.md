# 13 — Detector Prioritization: Evidence, Not Enthusiasm

**Status: analysis only. No design, no implementation, no roadmap change.**

Purpose: rank the known detector families by evidence. Evidence base is thin
and this document says so per row: **one real workspace (cu01, ClickUp, young
sprint, snapshot-only)**, two synthetic golden fixtures, and the doc 02
taxonomy reasoning. Rows are tagged **[O]** observed, **[A]** assumption,
**[M]** mixed. This document is allowed to *reprioritize implementation*; it
is explicitly **not** allowed to rewrite product strategy on n=1 — the doc 02
taxonomy stands.

## 1. The families

F10 (approval latency) is F1 restricted to review-kind stages — it ships free
with F1 and is listed for completeness, not ranked separately. F3 is split per
doc 12 (F3a open overdue / F3b realized late delivery).

| | F1 queue-wait | F2 aging | F3a overdue-open | F3b late-delivery | F4 rework | F5 handoff churn | F6 WIP overload | F7 blocker chains | F8 abandonment | F9 expedite |
|---|---|---|---|---|---|---|---|---|---|---|
| **Business question** | "What does waiting in queues/approvals cost?" | "What is forgotten and rotting?" | "What is late *right now* and bleeding?" | "How reliably do we deliver on promises?" | "What does redoing work cost?" | "What does pass-the-parcel cost?" | "What does overload cost us in slowdown?" | "What do dependency jams cost?" | "What did we sink into dead work?" | "What does firefighting cost everything else?" |
| **Required data** | Ordered status transitions | lastUpdated snapshot | dueAt snapshot | dueAt + completedAt | Transitions (regressions) | Transitions **with actors** (schema gap: events carry no actor today) | Snapshot counts per stage/team | DependencyLinks (schema gap) | Terminal-abandoned mapping + invested-effort proxy | Transitions + priority churn |
| **Availability: ClickUp** | **[O] NO** — plan-gated, aggregate-only even then | [O] YES (REST) | [O] YES | [O] YES (date_closed seen in cu01 raw) | [O] NO (same as F1) | [O] NO | [O] YES | [A] API has deps; rarely in CSV | [M] 'rejected' status existed in cu01, unused | [O] NO |
| **Availability: Monday** | [A] partial (activity log, plan/retention-gated; absent from CSV) | [A] YES | [A] YES | [A] YES | [A] partial | [A] partial | [A] YES | [A] rare | [A] partial | [A] rare |
| **Availability: Jira** | [A] GOOD (changelog API) | [A] YES | [A] YES (patchy usage in sw teams) | [A] YES | [A] GOOD | [A] GOOD | [A] YES | [A] GOOD (issue links) | [A] partial | [A] partial |
| **Availability: Asana** | [A] partial (stories API; not CSV) | [A] YES | [A] YES | [A] YES | [A] partial | [A] partial | [A] YES | [A] partial | [A] partial | [A] rare |
| **Impl. complexity** | built | built | **Low** (doc 12; existing machinery) | Low + `completedAt` migration | Medium | Medium + event-actor schema | Low-Medium (2 new assumptions) | Medium + DependencyLink schema | Medium; cost model weak without effort data | High |
| **Confidence ceiling** | **A** (closed observed intervals — proven on synthetic golden) | **B** (snapshot inference cap, permanent) | **A** (explicit customer commitments; B typical under date-clustering) | **A** (two explicit facts) | A (observed transitions) | A mechanically; attribution sits closest to the N1 line — needs care | **C typical** (literature drag factor); B if customer owns the factor | B (propagation logic adds modeling assumptions) | C (sunk cost needs invested-effort estimates we don't have) | B-C |
| **Explainability** | High ("sat in Review 19 days") | High | **Highest** ("past its own due date" — zero vocabulary to teach) | High | High | Medium (churn needs explaining) | Medium-Low (drag factor invites the exact CFO fight doc 03 avoids) | Medium | Medium | Low |
| **Auditability** | Full trace (built) | Full trace (built) | Full (dueAt in every term) | Full | Full (event-backed) | Full but actor-adjacent | Full mechanics; weakest link is the factor's provenance | Depends on link data quality | Weak (effort proxy) | Weak |
| **Expected customer value (today)** | High *where data exists* | Low young / Medium mature | **High — the only family that priced cu01** (27 items, 224 item-days) | Medium (retrospective; sales-credibility asset) | High in mature/quality-sensitive orgs | Medium | Medium (38-item pool observed; number less defensible) | Medium-High in dependency-heavy orgs | Low-Medium | Medium |
| **Evidence FOR ranking** | Synthetic A-tier demo; doc 02 F10-as-wedge logic | Held M0 integrity; will fire on cu01 in ~1 week | [O] cu01: dominant friction; universal data; best assumption provenance | [O] data exists in cu01 raw | [A] taxonomy + industry priors | [A] taxonomy | [O] cu01 queue pool visible; snapshot-universal | [A] taxonomy | [M] status vocab existed, unused | [A] taxonomy |
| **Evidence AGAINST** | [O] unavailable from the one real source tested | [O] zero findings on the one real dataset | n=1; young-workspace bias; gate-date semantics muddy it | No partner has asked yet | Zero real observations | Zero real observations + schema gap | Drag factor is *our* invented number | Zero observations + schema gap | cu01 usage: zero abandoned items | Zero observations |
| **Basis** | [M] | [O] | [O] | [M] | [A] | [A] | [M] | [A] | [M] | [A] |

## 2. Ranking 1 — current evidence-based implementation priority

(What to build next, given today's data reality. F1/F2 are already built;
listed where their *continued investment* belongs.)

1. **F3a** — the only family that would have priced the one real dataset; A-capable; lowest complexity; universal data. `[O]`
2. **F6** — second friction actually observed (58% queue pool); snapshot-universal; ranked below F3a solely on assumption provenance (the drag factor is ours, not the customer's). `[M]`
3. **F3b** — cheap after F3a, data observed present; turns one run into a delivery-reliability story. Requires the `completedAt` migration decision. `[M]`
4. **F2 (keep, ride)** — no work needed; value returns as datasets age; the MC-6 age-warning rider protects it from looking broken meanwhile. `[O]`
5. **F4** — first event-dependent family worth building, but *only after* a partner with real event history exists (likely a Jira workspace). Building it now would be code with no runnable data. `[A]`
6. **F1 (keep, wait)** — built; strategically parked until the live-provider/webhook era or a changelog-rich partner arrives. `[O]`
7. **F7** — next schema extension candidate (DependencyLink) when a dependency-heavy partner shows up. `[A]`
8. **F5** — needs event-actor schema + closest N1 proximity; deliberately late. `[A]`
9. **F8** — weak cost model without effort data; wait for time-tracking-rich partners. `[M]`
10. **F9** — hardest data, weakest auditability. Last. `[A]`

## 3. Ranking 2 — predicted long-term product importance

(Where the money is once the live-provider era solves event availability.
This ranking is mostly `[A]` and says so.)

1. **F1/F10** — approval/queue latency is the exec-legible heart of cost-of-delay; doc 02 called F10 the wedge insight and nothing observed contradicts the *value* claim, only today's data access.
2. **F3a + F3b** — commitment reliability is a permanent executive concern and the family with the best trust properties; it compounds into the benchmark/outcome story.
3. **F4** — rework is where mature organizations bleed the most money; strongest L1 claim in the taxonomy (C1: hours actually re-spent).
4. **F7** — dependency drag is the diagnosis layer's favorite input (doc 07 D5) and grows with org size.
5. **F2** — permanent, honest, B-ceiling utility player; never the headline.
6. **F6** — likely evolves from a priced detector into *diagnostic context* (doc 07 D1/D2 evidence) — its long-term home may be the diagnostic engine, not the cost ranking.
7. **F5**, 8. **F9**, 9. **F8** — real but niche or data-hungry.

## 4. Why the two rankings differ

One sentence: **Ranking 1 is constrained by what data exists today; Ranking 2
assumes the event-availability constraint dissolves.** They differ on F1
(long-term #1, currently unbuildable-upon for the observed customer class),
F4 (big future money, zero runnable data now), and F6 (useful now, probably
demoted to diagnostic evidence later). They agree on F3's family: high in
both, which is exactly what "reprioritize implementation without rewriting
strategy" should look like. The disagreement is a *sequencing* fact about the
world, not a *valuation* disagreement — and Ranking 2 is the one that must
not be treated as settled until more than one real workspace has been
analyzed.

## 5. If CostFlow could launch with only three detector families

**F3a (overdue exposure) + F2 (aging) + F6 (WIP overload).**

Why this trio and not others:

1. **They run on every export from every tool** — snapshot-only, the lowest
   common denominator M1 proved is the real world. A launch detector that
   needs event history (F1, F4) fails the first demo on the median customer,
   which cu01 demonstrated concretely.
2. **They cover three distinct failure mechanisms with no overlap in
   explanation**: *breach* (F3a: "you promised, it's late"), *neglect* (F2:
   "nobody has touched it"), and *systemic overload* (F6: "too much is in
   flight for your throughput"). Together they tell a complete first story:
   what is late, what is forgotten, and the structural reason why — every
   workspace lifecycle stage gets at least one detector that can fire (young →
   F3a/F6, mature → F2 joins).
3. **They ladder in confidence honestly**: F3a can reach A (customer's own
   commitments), F2 sits at B (honest snapshot cap), F6 at B/C (declared
   assumption-heavy). A launch that shows all three tiers *teaches the
   confidence system* — which is the trust mechanism the entire company rests
   on — instead of showing a wall of identical badges.

F1 is excluded from the launch trio with regret: it is Ranking 2's #1, but a
launch detector must fire on first contact with real data, and the one real
contact we have proved it cannot. It graduates into the trio's successor the
moment live integrations or changelog-rich sources make event history a
normal input rather than a lucky one.

**Falsifiers to watch** (what would change these rankings): a Jira design
partner with a rich changelog (promotes F4, vindicates F1 earlier);
a partner whose due-date coverage is near zero (weakens F3a's universality
claim); a second young workspace where F6's pool doesn't appear (demotes F6);
F2 firing usefully on the cu01 re-run (restores F2's standing sooner).
Each future M1 cycle should update this document's `[O]`/`[A]` tags — the
tags, not the prose, are the point of the exercise.
