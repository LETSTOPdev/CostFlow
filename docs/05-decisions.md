# Architectural decisions

Decisions that remain true. Each states what was decided, why, what it costs,
and what follows.

Formal records live in `adr/` and several are cited from source code. This
document says what each means today; the ADRs carry the full reasoning.

---

## D1 — The engine is pure and frozen

**Decision.** Everything from ingestion through pricing is side-effect-free and
pinned by byte-identical golden artifacts. Changing it requires regenerating them
with a stated reason.

**Reason.** The product's claim is that every figure survives challenge. Only
reproducibility makes that enforceable rather than aspirational.

**Tradeoffs.** Engine changes are expensive and deliberate. Time must be threaded
as an explicit parameter everywhere, which is more verbose than reading a clock.

**Consequences.** New capability is usually built *around* the engine rather than
inside it. Diagnostics and comparison both read the stored artifact at render
time, which is why each shipped without regenerating a single golden.

---

## D2 — Money is decimal, and estimates are ranges

*(ADR-0001)*

**Decision.** Money is decimal strings at rest with exact decimal arithmetic;
never a float. Every estimate is a range carrying a confidence tier.

**Reason.** Floating-point money produces figures a CFO can dismiss on sight.
Point estimates imply a precision the inputs do not support.

**Tradeoffs.** More ceremony than arithmetic on numbers. Ranges are harder to
present than single figures.

**Consequences.** Range algebra and formatting live in the cost engine and are
imported everywhere, never reimplemented.

---

## D3 — Attribution is structural, never individual

*(ADR-0002, ADR-0006)*

**Decision.** Cost attaches to stages, queues and dependencies — never to a named
individual. **Load is a property of the system; rate is a property of the
person.**

**Reason.** Beyond principle: a tool that ranks employees is a
performance-management tool, with a different market, a different buyer, and
works-council and GDPR exposure. It is also weaker advice — naming a stage
invites a fix, naming a person invites an argument.

**Tradeoffs.** Some genuinely predictive signal is given up. A role slower than
its peers is invisible as such. Accepted: the same situation surfaces as queue
depth and wait time, which is the actionable form anyway.

**Consequences.** Enforced at three layers rather than by convention — the model
cannot represent a raw identity, friction instances are located at stages, and
the reporting layer fails closed on rendered bytes. Any new surface rendering
evidence must route through that guard.

---

## D4 — Signals are friction only if they pass all four tests

**Decision.** A signal is priced only if it measures loss occurring, has a
per-item observed magnitude, has a cost model whose only non-observed inputs are
customer-owned, and does not double-count loss another signal already prices.
Everything else is a **context signal**: displayed, never priced, never ranked.

**Reason.** The fourth test is the one that bites. Overload and expedite churn
destroy value *by making waits longer* — losses already priced. Pricing both
counts the same dollars twice.

**Tradeoffs.** Intuitively appealing signals stay unpriced. "Which teams are
overloaded" cannot carry a figure.

**Consequences.** `ContextObservation` has no cost field — the type makes the
rule structural. Context may explain a priced finding; it may never carry its own
recovery figure.

---

## D5 — The run artifact is self-contained

**Decision.** A completed run embeds its own batch, assumption set, evidence
notes, and every engine version.

**Reason.** A number must stay reconstructible from the artifact alone, years
later, after the connector that produced it has changed or been switched away
from.

**Tradeoffs.** Artifacts are large and partly redundant across runs.

**Consequences.** Run-over-run comparison needs no configuration-history schema.
It also means anything affecting interpretation must be *in* the artifact, not
looked up later — a workspace's provider can change while its runs remain.

---

## D6 — Capabilities gate execution; evidence quality caps confidence

**Decision.** Two separate models. Capability answers "can this be observed?"
and gates whether a diagnostic runs. Evidence quality answers "how good is what
was observed?" and caps confidence.

**Reason.** Conflating them forces a bad choice: refuse to run on imperfect
data, or run and claim full confidence.

**Tradeoffs.** Two vocabularies to learn and keep closed.

**Consequences.** A diagnostic that cannot run is a **product surface** — the
missing capability is named, and where the customer can fix it, the copy says
how. Evidence caps are scoped by subject, so a weakness in the event stream never
downgrades a finding computed purely from snapshots.

---

## D7 — Evidence weaknesses name problems, not mechanisms

*(`reference/21-evidence-quality.md`)*

**Decision.** `EvidenceWeakness` is keyed on what is epistemically weak, never
on how a connector produced it. A new member requires a genuinely different
problem, not a different mechanism producing one already named.

**Reason.** A provenance-shaped union accumulates one value per platform quirk,
which is a provider taxonomy living in the domain.

**Tradeoffs.** The mechanism lives in prose rather than in the type, so it cannot
be reasoned about mechanically. Accepted: nothing needs to.

**Consequences.** Two unrelated platforms with the same weakness produce the same
note. Four members, each mapping onto a confidence cap that already existed in
the codebase — nothing invented for a case not yet met.

---

## D8 — Diagnostics measure; playbooks recommend

*(ADR-0006)*

**Decision.** A finding is arithmetic over customer data. An intervention is a
curated recommendation matched to it deterministically. They render separately
with explicit provenance.

**Reason.** CostFlow knows the concentration exists; it does not know that an
escalation policy is objectively the right answer. Presented together, the second
borrows the first's authority.

**Tradeoffs.** More verbose UI. A new intervention requires an ADR amendment
rather than a patch.

**Consequences.** The intervention vocabulary is a closed union, so no call site
can emit "coach" or "review performance" — the verbs do not exist in the type.

---

## D9 — No composite priority score

*(ADR-0006 §5)*

**Decision.** Operational impact and implementation complexity are shown as
separate axes. Complexity never reorders the list. Ordering is by evidence
strength first, then concentration, and is labelled as such.

**Reason.** Fusing a measured money range with a declared complexity class
manufactures a number with no evidentiary basis — the exact fabrication the
product refuses everywhere else. The formula that would justify it presupposes a
simulated savings range and a customer-owned effort estimate, neither of which
exists yet.

**Tradeoffs.** Reads as less decisive than a single ranked score. The executive
does the composition.

**Consequences.** Thresholds are global constants and explicitly **not**
tenant-configurable: a threshold a customer can tune is one they can tune until
they get the answer they wanted.

---

## D10 — A trend is a claim, and is refused when unsupportable

*(`reference/19-monitoring-workspaces.md`)*

**Decision.** Run-over-run comparison computes a verdict before a chart. On
`not-comparable`, **no trend is rendered at all** — replaced by what differs and
what to do about it.

**Reason.** A number can move because the work changed, the configuration
changed, the engine changed, or a detector that used to skip now runs. A chart
mixing those converts a settings edit into a false claim of improvement. A
caveat above a table of arrows does not stop anyone reading the arrows.

**Tradeoffs.** Customers sometimes see a refusal where they expected a chart.

**Consequences.** A change in the set of detectors that *ran* is blocking — which
matters because the product now tells customers to enable a setting that makes a
detector run for the first time. Assumption changes are not uniform: a rate
change is a note, a threshold change is blocking because it changes which items
count at all.

---

## D11 — Zero client JavaScript

**Decision.** 100% server-rendered under `script-src 'none'`. Search, filter,
sort and pagination are GET params; actions are CSRF-protected POSTs.

**Reason.** Eliminates an entire vulnerability class, keeps pages fast and
printable, and forces the product surface to stay simple.

**Tradeoffs.** No rich interactivity. Charts are server-rendered SVG.

**Consequences.** Applies to the admin console too, which is why it is query-param
driven rather than a dashboard SPA.

---

## D12 — One Store interface, two implementations, one contract test

**Decision.** All persistence goes through a single `Store` interface with a
Postgres and an in-memory implementation, held to a shared contract test.

**Reason.** Tests run fast and hermetically against memory while production uses
Postgres, and behaviour cannot silently diverge.

**Tradeoffs.** Every new method must be implemented twice.

**Consequences.** A contract-shaped failure the shared test cannot express —
because it depends on how Postgres specifically claims a row — needs its own
focused suite. That gap once hid a real production race.

---

## D13 — Provider concepts die at the ingestion boundary

*(ADR-0005)*

**Decision.** Downstream code speaks only the canonical model. Adding a platform
means a new connector module plus one line in the composition root.

**Reason.** Otherwise every layer accumulates per-platform branches and the
engine stops being provider-agnostic.

**Tradeoffs.** A capability one platform exposes uniquely must be modelled
generically before it can be used.

**Consequences.** Enforced by `dependency-cruiser` plus a test that fails on a
provider name anywhere in `packages/diagnostics`, comments included.

---

## D14 — Deletion is transactional erasure

*(ADR-0003)*

**Decision.** Deleting a workspace removes it and everything derived from it in
one transaction. Runs are otherwise append-only.

**Reason.** GDPR erasure must be complete and verifiable. Partial deletion is
worse than none.

**Consequences.** The admin console performs no hard deletes; the audit log
carries no foreign keys so its rows survive tenant erasure.

---

## D15 — Defer with a trigger, not a date

**Decision.** Known-but-not-yet-worth-fixing debt is recorded with the condition
that makes it worth doing, not a deadline.

**Reason.** Speculative refactoring is the main way a small codebase becomes a
large one. A trigger keeps the analysis without forcing the work.

**Consequences.** `reference/20-oi1-retrospective.md` is a register, not a
backlog. Do not action an item because it is listed.
