# Roadmap

Future work only. **When a milestone completes, delete it from this file** and
update `02-current-state.md` instead.

## The current phase: Design Partner Validation

**Founder directive, 2026-07-29. The build phase is complete. Do not start
implementing new capabilities.** The core product is feature-complete. The
priority is learning from real companies using their own data, and the remaining
product work is to be driven by evidence from design partners rather than by
internal intuition.

**Everything below this section is on hold** until that evidence exists. The
items are kept because they are still the right shape, not because any of them
is next. Read them as candidates to be confirmed or discarded by what real usage
shows, and expect some to be discarded.

What to do instead, when picking this project up:

1. Read what real usage says. The event spine and the `/admin` funnel already
   record every step of every signup, and U1–U7 in `06-known-risks.md` name what
   to look for. Nothing needs new telemetry.
2. Fix what a real customer actually hit. A defect a design partner ran into is
   evidence; a defect nobody has met is a candidate.
3. Bring a proposal only when evidence supports it, and say which observation it
   came from.

A milestone that begins by proposing a feature is starting in the wrong place.
The cold-start ritual in `09-ai-context.md` §3 still applies to anything that
does get built.

### Development is paused, and these are the three things that resume it

**Do not proactively continue development.** The current state is the baseline.
Wait for one of:

1. **Real design partner feedback.**
2. **Production data that validates or contradicts one of U1–U7**
   (`06-known-risks.md`).
3. **A deliberate product decision that has to be made on that evidence.**

Absent one of those, there is no next milestone to find, and looking for one is
the mistake this section exists to prevent. When work does resume it optimises
for evidence rather than intuition, which means every proposal names the
observation behind it.

**Two things gate the learning and neither is a code change:** `/admin` is
unreachable in production (R1), and no real Jira or ClickUp account has ever been
connected to this product (R11) — every walkthrough to date has used stub
gateways.

---

**The roadmap is a guide, not a contract. The North Star is the contract.**
Founder directive, 2026-07-28. Do not stop to re-rank this file: when a
milestone finishes, pick the next item that most improves an executive's ability
to know what to do next, and start. If no item here meaningfully improves that
outcome, say so, name the gap, and propose replacing the item rather than
following the list mechanically.

## The North Star

> An executive opens a report, reads it in under two minutes, and leaves with
> complete confidence about the single highest-impact action to take next.

Stated in full in `00-project-brief.md`. Between several good implementations,
prefer the one that makes the executive's next decision clearer.

## The priority order

Founder directive, 2026-07-28: the centre of gravity moves from infrastructure,
correctness and engine capability to **customer value**. Prefer work a customer
can immediately see, understand and benefit from, in this order:

1. User experience
2. Report clarity
3. Operational decision intelligence
4. Onboarding
5. Customer adoption
6. New engine capabilities

**Look at the product before proposing anything** — the rendered UI, the
exported report, onboarding, the dashboard, and only then the implementation.
The method is in `09-ai-context.md` §3, including how to actually render those
surfaces locally.

**The test to apply before proposing anything: "will a customer notice this
within the next report?"** If the answer is no, challenge whether it belongs at
the front of the queue. This does not stop engine work — it requires that engine
work be justified by the product outcome it unlocks, not by the capability
itself.

## The four adoption outcomes

Founder directive, 2026-07-29: optimise for **first real customers**, not for
ourselves. Every remaining improvement must do at least one of these, and the
proposal has to say which:

1. **Increase a customer's confidence.**
2. **Reduce onboarding friction.**
3. **Improve the quality of the first report.**
4. **Increase the likelihood of a second analysis.**

An improvement that does none of them is not necessarily wrong, but it is not
now — question whether it should be built at all yet. The goal stopped being a
better product in isolation and became a product real customers adopt.

Assumptions this product rests on that no customer has yet tested are listed in
`06-known-risks.md` under *Unvalidated assumptions*. **Mark them, do not build
around them.** Optimising for a guess about customer behaviour is how a roadmap
fills up with work that turns out to have been aimed at nobody.

The items below predate the North Star and are ordered by their old logic.
Rank them against it as you go, not in a separate pass.

No milestone is active. P0 is blocked on the operator and blocks nothing else;
P1 is waiting on real customer usage, which the founder made a precondition for
building anything further on the intelligence layer.

---

## P0 — Unblock the operator

### `/admin` access in production

**Goal.** The founder can open the admin console.

**Reason.** It is built, live, and inaccessible. Nothing else about running the
business can be observed until this works.

**Dependencies.** None. This is a Railway environment variable, not code.

**Status.** Blocked on operator action. `COSTFLOW_ADMIN_EMAILS` must contain the
signed-in email, then redeploy. The console now logs a sanitised `admin-denied`
line that distinguishes "variable not set" from "set but not matching".
Procedure in `08-admin.md`.

---

## P1 — Learn before building

### Validate OI1 against real customer workspaces

**Goal.** Find out whether the recommendations are useful to a real reader, and
whether the thresholds, copy and diagnostic set survive contact.

**Reason.** OI1 is live and unexercised. The founder made this an explicit
precondition for building the layer above it. The same approach previously
reshaped OI1's scope before implementation and was worth more than any amount of
design discussion.

**Dependencies.** Real workspaces running analyses. Possibly P0, to observe them.

**Status.** Waiting on customer usage.

---

## P2 — Admin console extensions

The console and customer database already exist, so these are extensions rather
than builds. Candidates, roughly by business value:

### Real billing integration

**Goal.** Replace the beta placeholder with true subscription state from Lemon
Squeezy: webhook endpoint, signature verification, lifecycle sync, and admin
views reading real plan, status and renewal dates.

**Reason.** The first thing that makes the console reflect money. Nothing in the
product knows whether anyone is paying.

**Dependencies.** A Lemon Squeezy account and store. The schema already maps
one-to-one onto their customer, subscription and variant records, so this fills
fields rather than reshaping.

**Status.** Not started. Scaffold in place.

### Per-person usage and engagement

**Goal.** Surface who inside a customer organisation actually uses CostFlow, who
has gone quiet, and which accounts depend on a single user.

**Reason.** The strongest available churn signal. The event spine already stores
an actor on every event; only the aggregation is missing.

**Dependencies.** None.

**Status.** Not started. Note this is the internal ops console — the
never-name-a-person rule governs customer-facing attribution, not your own view
of your own customers.

### Audit what the console cannot answer

**Goal.** Before adding features, establish which questions about running the
business it cannot answer today, and which of its three known limits bites
first.

**Reason.** Same reasoning as P1: evidence before construction.

**Dependencies.** P0.

**Status.** Not started.

---

## P3 — Monitoring Workspaces continued

Design in `reference/19-monitoring-workspaces.md`. MW1 shipped; MW2 onward
remain.

### MW2 — compare any two runs

**Goal.** Pick two runs from a workspace's history and see the verdict and diff,
not just the immediately previous one.

**Reason.** The natural completion of MW1, which currently only compares against
the previous run.

**Dependencies.** None — the entire computation layer shipped with MW1. This is
a route and a UI.

**Status.** Not started. Smallest remaining item with real user value.

### MW3 — historical KPIs and trend series

**Goal.** A small set of KPIs tracked across runs, drawn against real timestamps.

**Reason.** Turns a folder of runs into a trend an executive can act on.

**Dependencies.** MW2. Needs a decision on which KPIs; the proposal deliberately
includes three "honesty" measures (priced coverage, detector participation,
scope size) whose job is to stop the headline number lying.

**Status.** Not started. No schema change required.

### MW4 — recurring analyses

**Goal.** A workspace runs on a cadence.

**Reason.** Turns a Monitoring Workspace from a folder into a monitor.

**Dependencies.** A scheduler safe across two replicas — a database advisory
lock or claim row, never an in-process timer — plus idempotency and a per-tenant
rate ceiling.

**Status.** Not started. The milestone with real infrastructure risk.

### MW5 — long-term operational insight

**Goal.** Organisation-level rollups, regression detection against declared
thresholds, and change attribution.

**Dependencies.** MW3 and MW4 having accumulated real series.

**Status.** Not started.

---

## P4 — Operational Intelligence continued

### OI2 — simulation

**Goal.** Convert "here is where you are losing" into "had this been true last
quarter, estimated cost would have been X lower". Counterfactual replay of the
observed period through the same engine with a declared transform applied.

**Reason.** Lifts the constraint OI1 ships under: it presents friction at stake
rather than savings, because a savings figure must cite a simulation.

**Dependencies.** **P1 — the founder will not start this until OI1 has been used
by real customers.** Start with the SLA-cap transform, which is high-fidelity
arithmetic over observed waits rather than a queue model.

**Status.** Deliberately deferred. This is a decision, not an oversight.

### Dependency-aware analysis

**Goal.** Detect that ten blocked tasks share one blocker, and report the
bottleneck rather than ten slow tasks.

**Reason.** The single largest gap between what CostFlow reports and what a
manager needs. "Legal approval is blocking 14 downstream tasks" is a dependency
claim, and today the engine cannot count the 14.

**Dependencies.** `WorkItem` carries no dependency link of any kind. The raw
ClickUp payload already contains `dependencies`, `linked_tasks`, `parent` and
`top_level_parent` — fetched, retained, and deliberately not canonicalised
because no consumer existed. So the path is a domain field, then ingestion, then
a diagnostic. Touches the frozen engine, so golden regeneration with a stated
reason.

**Status.** **Design only, by explicit instruction.** The canonical model is to
be designed and every affected site identified, but the engine change waits.

### MC-5 continued — connector capability expansion

**Goal.** Widen the evidence available to the diagnostics layer: assignment
history, dependency graph, approval chain, capacity signals. All four are
declared in the capability vocabulary and currently false for every platform.

**Reason.** Each unlocks named diagnostics. Dependency graph in particular
enables the cascading-delay analysis that could not be built in OI1 because the
canonical model has no dependency link.

**Dependencies.** Domain model additions plus ingestion work per platform.
Touches the frozen engine, so golden regeneration with a stated reason.

**Status.** Not started.

---

## Deferred, with triggers rather than dates

`reference/20-oi1-retrospective.md` is a register of latent debt in the
diagnostics layer. Every item states its cost today and **the trigger that makes
it worth doing** — the diagnostic registry waits for the fourth diagnostic, the
generalised magnitude model waits for the first diagnostic whose magnitude is not
a share, and so on.

It is a reference document, not a backlog. Do not action an item because it is
listed; action it when its trigger fires.
