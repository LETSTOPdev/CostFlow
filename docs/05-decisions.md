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

---

## D16 — A workspace selects containers; a run records what it covered

**Decision.** A Monitoring Workspace's scope **selection** may name a container
(a ClickUp Space or Folder) as well as a leaf. What that selection covers is
resolved fresh on every run, and the set of origins actually fetched is recorded
on the immutable artifact as `ImportBatch.scopes`. Comparison treats a change in
that set as blocking.

**Reason.** Managers reason in Spaces, not in the twenty Lists that happen to
sit inside one today. But a container is a moving target: adding a List widens
what is measured without changing anything the customer did. Freezing the
expansion at selection time would quietly stop analysing new work; expanding it
without recording the result would let a total grow and read as a trend. Storing
the selection and recording the coverage is the only combination that is both
current and honest.

**Tradeoffs.** Two concepts where there was one, and a run that fetches N
origins takes N times as long. A selection cap (`COSTFLOW_MAX_SCOPES`, default
25) bounds the fan-out; the item ceiling is now a total across the selection
rather than per origin, because the analysis holds every item in one heap.

**Consequences.** `BatchScope` carries no provider *kind* — that vocabulary
lives in the connector layer (D13). The comparison verdict gained a seventh
aspect. An artifact written before this field has coverage *absent*, which means
unknown rather than empty, and comparing a known set against an unknown one
blocks: an old run cannot vouch for its own scope.

---

## D17 — Merged capability is the intersection

**Decision.** When several origins merge into one analysis, the capability
profile is the AND across all of them, and the loss is explained by a
`partial-coverage` evidence note naming the origins responsible.

**Reason.** If one List has status history and another does not, a union would
let the queue-wait detector run across the whole workspace while only ever
seeing half of it — a confident number for a population it did not observe. The
intersection makes the detector skip, and a skip with a reason is something the
report already knows how to render.

**Tradeoffs.** One badly configured List can switch off a detector for an entire
department. That is the intended behaviour and the note says which List to fix,
which is more actionable than a silently understated figure.

**Consequences.** Turning on the Total Time in Status ClickApp for a single
missing List can restore wait analysis for the whole workspace. Refusing beats
half-measuring, the same posture as report mode declining to price
vendor-suggested assumptions.

---

## D18 — The recommendations come second, and everything below them is detail

**Decision.** The report is ordered for a reader with two minutes: total, then
recommendations, then a labelled boundary, then all supporting detail. Every
surface that renders a report renders the same body, including the printable
export and the public samples.

**Reason.** The five questions an executive actually has — what is the biggest
problem, why, what to do first, what it is worth, what backs it — are all
answered by the recommendations. Putting them after the methodology meant a
reader who stopped at the total never reached them, and the export omitted them
outright. Sophistication that never reaches a report is not progress.

**Tradeoffs.** The decision now sits above the working that justifies it, which
inverts how the artifact is built. The labelled boundary is what keeps that
honest: it says where the claim ends and the evidence begins rather than hiding
the evidence.

**Consequences.** `/demo` and `/try/report` show recommendations, marked as
computed from demonstration data (founder decision, 2026-07-28). Where the
sample is too small to support one, the refusal is stated as what it is — the
product declining to recommend on thin evidence — and links to a full-size
demonstration.

---

## D19 — Friction is located at (origin, stage), never stage alone

**Decision.** Every `WorkItem` records its origin, and every `FrictionInstance`
and `DiagnosticFinding` is located at the pair. Two origins sharing a status
name produce two findings.

**Reason.** A workspace spanning Engineering and Legal that reports one blended
"review queue" finding has answered a question nobody asked. The manager needs
to know whose queue is expensive, and multi-scope monitoring is worth little
without it — cross-team aggregation is not cross-team visibility.

**Tradeoffs.** This changed the frozen engine: three detector versions and the
analysis version moved, and runs from before are not comparable with runs after.
It is a no-op for a single-origin import — grouping by (null, stage) is grouping
by stage — so no golden number moved, only version strings and the new fields.
That is what made the cost worth paying (see `04-engineering-principles.md`
§ Proportion).

**Consequences.** Instance ids gain an origin segment only when the origin is
non-null, so imports without scope structure keep exactly the ids they had. The
origin id travels through the engine; the customer-facing LABEL is resolved at
the render edge from the batch, which keeps customer content out of the pure
layers. Attribution is still structural, so ADR-0002 is untouched.

---

## D20 — The top of the report always answers, even when nothing can be recommended

**Decision.** When no diagnostic clears its evidence gate but the run priced
real friction, "Where to act first" names the largest **measured** cost and says
explicitly that it is arithmetic rather than a fitted recommendation. It is only
silent when nothing was priced at all.

**Reason.** A small workspace routinely produces real priced friction and no
pattern strong enough to recommend against. That is a correct result, but
rendering it as "no operational findings" at the very top of the report — above
thousands of dollars of ranked cost — is the worst available reading of it, and
undoes the point of promoting that section (D18). Found by walking the product
as a first-time customer, not by reading the code.

**Tradeoffs.** The section now carries two kinds of statement. The wording does
the separating: a fitted intervention is offered only when a diagnostic earned
it, and the fallback says which of the two the reader is looking at.

**Consequences.** No threshold moved and no diagnostic was relaxed — ADR-0006 §7
suppression is untouched, and the fallback shows figures the report already
renders further down. The public sample surfaces keep their own empty state,
which explains the evidence threshold and links to a full-size demonstration.

---

## D21 — "Where to act first" names one place to start

**Decision.** When any diagnostic clears its evidence gate, the section opens by
naming the single strongest-evidenced finding as the starting point, states that
this is the basis, and reports its implementation complexity. The caveat about
ordering stays, scoped to the remainder of the list.

**Reason.** The section was titled "Where to act first" and opened with "this is
not a recommended sequence" — a heading and a disclaimer that cancel each other,
in the one section the North Star depends on. An executive reading both leaves
less confident than they arrived.

The disclaimer was defending something real (D9 / ADR-0006 §5: no composite
priority score, and a ranked list does not become a work order because it is
ordered). But "there is no optimal sequence" and "here is where to start" are
different claims, and only the first was ever in question.

**Tradeoffs.** Naming a starting point is a stronger statement than the product
made before. It is bounded by saying what it is chosen ON — strongest evidence,
explicitly not largest figure — so a reader who disagrees with that basis can
see the basis and choose differently.

**Consequences.** Nothing is fused: complexity is reported and still never
reorders anything. The ranked-friction list, which is ordered by cost, now says
why its order differs from the section above it — two orders on one page is a
credibility problem unless the page says why.

---

## D22 — The report leads with the action; the money is its evidence

**Decision.** Every surface leads with the single highest-leverage action. The
estimated financial impact sits beneath it as the reason to act, and the total
across the analysis moves into the supporting detail. The report is an executive
briefing, not a financial statement.

The sentence every surface is written to answer: *"Start here. This is the
single highest-leverage operational improvement we found, and here is the
evidence supporting that recommendation."*

**Reason.** Founder decision, 2026-07-28, following the North Star. An executive
opens CostFlow to learn what to do next; the report answered "how much" first
and made them hunt for the rest. The money did not get smaller — it stopped
being the message, and attached itself to a specific action instead of floating
above a dozen of them.

**Tradeoffs.** The headline figure was the credibility hook, and losing its
primacy risks the report reading as advice rather than measurement. Three things
hold that line: the cost at stake is stated on the action itself, the total is
one section below with its full range, and every figure still opens into its
formula. A recommendation with a priced consequence attached is more persuasive
than a number with no owner, not less.

**Consequences.** The hero has three states — a fitted recommendation, the
largest measured cost when no diagnostic cleared its gate, or an explicit
nothing-priced result. `ADR-0006 §5` is intact: impact and complexity appear as
separate chips on the hero and are never fused. The dashboard, the printable
export, `/demo`, `/try/report` and the landing page all carry the same order, so
a customer meets one product rather than two.

---

## D23 — "Nothing priced" is not "nothing wrong"

**Decision.** A run that found frictions but priced none of them is presented as
a BLOCKED analysis with confirming the assumptions as the recommended action,
never as a healthy result. The healthy message is reserved for a run that found
nothing and left nothing unpriced.

**Reason.** Report mode refuses to price a vendor suggestion (D4), so a customer
who supplies values without confirming them gets zero priced findings. The
report rendered that as *"No priced friction crossed your thresholds. That is a
genuinely healthy sign."* — with eight measured frictions listed below it. It
told a first-time executive their process was fine at the moment the analysis
found eight problems and declined to cost them.

Found by walking the realistic first-run path: type your own rate, ignore the
six accept checkboxes for parameters you have no opinion about. No test caught
it because every test either accepted everything or accepted nothing while
asserting on the unpriced list rather than the headline.

**Tradeoffs.** The blocked state now occupies the hero, which is more prominent
than a caveat. That is correct: it is the highest-leverage action available to
that reader, and a briefing they cannot act on is worth less than a clear
instruction for making it actionable.

**Consequences.** The unconfirmed assumptions are listed by the names the
customer saw on the assumptions step, read from the artifact's own provenance
rather than parsed out of the engine's skip-reason prose. The dashboard carries
the same split. `isCustomerOwned` is the single test for both.

---

## D24 — A recommendation carries its basis where it is made

**Decision.** Wherever CostFlow recommends an action, the same screen states the
confidence tier **and what that tier means**, that the finding is measured while
the intervention is selected, and where the figures open into their formulas.
Not in a drill-down, not in an appendix: beside the claim.

**Reason.** The second ritual question (`09-ai-context.md` §3): *why should the
CEO trust this recommendation?* If the answer is not obvious from the screen,
the screen is improved before the engine. A correct recommendation nobody
believes is worth nothing, and belief is a property of the screen rather than of
the arithmetic behind it.

Both anchors existed on the recommendation card and were lost when the hero took
over the headline in D22. The second loss is the serious one: presenting a
curated playbook match with no provenance line lets it borrow the authority of
the measurement above it, which is the exact boundary doc 07 §2.1 holds.

**Consequences.** `CONFIDENCE_NOTE` and `INTERVENTION_PROVENANCE` are exported
from the diagnostics view and used by both the hero and the cards, so the two
can never drift apart again. Applies equally to the printable export.

**Noted while fixing it.** Em-dash density in product copy had roughly tripled
in `report-view.ts` during this session, against the standing copywriting bar.
The hero copy was corrected; the rest is pre-existing and not worth a churn pass
on its own. Watch it when touching copy.
