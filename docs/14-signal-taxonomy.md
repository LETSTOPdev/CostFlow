# 14 — Friction Signals vs Context Signals

**Status: design note only. No implementation, no roadmap edits, no code.**

One question: *what qualifies a signal as a Friction Signal (priced, graded,
traced, ranked) versus a Context Signal (explains or amplifies, never
independently priced)?*

## 1. The distinction is real — and the architecture already reserved its seat

Before challenging the proposal, one observation that strengthens it: the
Context Signal concept is not new to the design — it is the M0-era face of
what doc 07 formalized as **DiagnosticSignals** (D1–D10). "WIP overload
explains why frictions grow" is literally doc 07's D1/D2 (capacity shortfall,
load imbalance) wearing an F-number. The proposal therefore does not add a
second taxonomy; it recognizes that some F-families were mis-filed into the
friction taxonomy when they belong to the diagnostic one. That is a
correction, not an invention.

## 2. The qualification test

A signal is a **Friction Signal** only if it passes ALL four:

- **FS-1 — Direct loss mechanism.** It measures loss *occurring* (time,
  effort, or value being consumed or deferred), not a condition, propensity,
  or explanation.
- **FS-2 — Item-attributable magnitude.** There is a per-item, observed,
  time-or-effort-denominated quantity (days overdue, hours waiting, hours
  re-spent). A state ("too many items in flight") is not a magnitude.
- **FS-3 — Honest cost path.** A cost model exists whose only non-observed
  inputs are customer-owned assumptions (rates, attention shares, value
  attributions). If the load-bearing coefficient is literature-derived — a
  number *we* bring — the price is our opinion, not their cost.
- **FS-4 — Counterfactual coherence, without double-counting.** Removing this
  instance removes that loss — and the loss is not already delivered through
  another priced friction. This is the decisive test for amplifiers: overload
  and expedite churn destroy value *by making waits longer and rework more
  frequent* — losses that F1/F2/F3/F4 already price. Pricing the cause AND
  its priced effects counts the same dollars twice, which is the
  decision-layer sin (doc 07 N12) committed at the detector layer.

Everything that fails the test but genuinely explains or amplifies friction
is a **Context Signal**: it may appear in reports as an unpriced observation,
feed the future diagnostic layer as evidence, and shape narrative — but it
never carries a cost range, never enters the ranking, and **never mutates a
friction estimate** (a number that changed "because context fired" is a number
that can no longer be audited; doc 03 E1 dies).

The categories are properties of the **defensible claim**, not of the
phenomenon. WIP overload is real value destruction — the phenomenon is
friction; the *signal* is context because FS-2/3/4 fail. Families can migrate
when the failing criterion changes (see §4).

## 3. Verdicts, family by family

| Family | Verdict | Test result |
|---|---|---|
| **F1 queue-wait** (+F10) | **Friction** | Passes all four: observed per-item wait, customer-owned attention/value assumptions, removing the wait removes the loss. |
| **F2 aging** | **Friction** (weakest pass) | FS-1..4 pass via the carrying/attention claim, but FS-1 is the borderline: staleness is partly a *proxy* for abandonment risk. Stays friction; its permanent B ceiling is the honest price of that borderline. |
| **F3a overdue-open** | **Friction** | The cleanest pass in the taxonomy; the threshold itself is customer-authored. |
| **F3b late-delivery** | **Friction** (retrospective) | Realized loss with two explicit facts per item. Being backward-looking does not demote it — a loss that already landed is still a loss; no third "outcome signal" category is needed, and taxonomy proliferation is refused. |
| **F4 rework** | **Friction** | Strongest L1 claim in the taxonomy (hours actually re-spent), once event data exists. |
| **F5 handoff churn** | **Context by default; promotable** | The handoff *count* explains coordination structure (doc 07 D6). Pricing count × per-handoff overhead fails FS-3 (the overhead coefficient is ours). The *wait at handoff boundaries* is already F1's friction. Promotion path: a customer who owns their per-handoff overhead number satisfies FS-3. |
| **F6 WIP overload** | **Context** — the user's intuition survives the challenge, on harder grounds | Fails three of four: no per-item magnitude (FS-2), literature drag factor (FS-3), and decisively FS-4 — overload's damage is *delivered through* longer queue waits and more aging, which F1/F2/F3 already price. Even a customer-confirmed drag factor (fixing FS-3) cannot fix FS-4. F6 is structurally an amplifier; its home is diagnostic evidence (D1/D2). |
| **F7 blocker chains** | **Split** | The priceable part — time items sit blocked — is wait-friction (an eligible-kind question for F1's family, already `blocked`-kind adjacent). The chain *topology* (what blocks what, propagation) is context feeding doc 07 D5. The family as usually imagined — dependency-graph analysis — is context. |
| **F8 abandonment** | **Data-dependent** | With observed invested effort (time tracking), sunk cost passes FS-1–3 → friction. Without it, "effort estimated by us" fails FS-3 → context (an outcome pattern explaining waste). The criterion that decides is observability, not modeling ambition. |
| **F9 expedite disruption** | **Context** | Same amplifier logic as F6: preemption's cost lands in other items' waits, already priced. Priority-churn patterns are doc 07 D10 evidence. Narrow promotion path: explicit overtime/premium spend data (rare) would price the *premium* without double-counting the *waits*. |

Tally: five Friction families (F1/F10, F2, F3a, F3b, F4), two firm Context
families (F6, F9), three whose category is determined by criteria (F5, F7,
F8) — which is the answer to "can families exist in either category":
yes, and the *criterion that flips* must be named per family (FS-3 for F5,
scope-restriction for F7, FS-2 observability for F8). A family never
migrates by wanting to; it migrates when a named test changes truth value.

## 4. Consequences this note must own

1. **Doc 13's launch trio is amended in composition, not membership.**
   F3a + F2 + F6 stands, but F6 participates as *context* — displayed,
   unpriced, unranked ("58% of your in-flight work is pooled in queue stages"
   as the *why* beneath the priced *what*). This is strictly better product:
   the launch report previews the doc 07 why-layer without fabricating a
   third dollar figure — and cu01 showed the context sentence is compelling
   on its own.
2. **No new machinery is implied.** A Context Signal is architecturally a
   signal with no cost model *by design*. The only conceptual delta for a
   future slice: distinguishing "unpriced: missing assumption" (a gap) from
   "unpriced: context by design" (a decision) in run artifacts and reports —
   noted here, not designed here.
3. **Context never touches estimates.** Stated twice deliberately: context
   signals inform diagnosis and narrative; if one ever adjusts a cost number,
   confidence grade, or rank, auditability is broken. Interaction between
   context and cost happens only in the doc 07 decision layer, where joint
   effects are simulated, versioned, and traced.
4. **The doc 02 taxonomy needs a one-line errata eventually** (F6/F9 re-homed
   toward the diagnostic table) — deferred until more than one real workspace
   supports it, per the standing n=1 rule. This note records the position;
   it does not edit the foundation.

## 5. The challenge, honestly resolved

The strongest argument *against* the distinction: "everything destroys value;
splitting hairs about mechanism is theology." The rebuttal is doc 03 P2/P3 —
the product's survival depends on every displayed dollar being defensible in
front of a CFO, and the four tests above are exactly the questions a CFO
asks (what loss? on which items? whose assumption? counted once?). The
distinction is not theology; it is the pricing bar the company already
committed to, applied at the taxonomy level. F6 priced would have been the
first number in a CostFlow report that a skeptic could kill — and doc 06 R1
says one killed number poisons all of them.
