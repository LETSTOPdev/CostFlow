# Roadmap

Future work only. **When a milestone completes, delete it from this file** and
update `02-current-state.md` instead.

Multi-scope monitoring (P2) is the active milestone. P0 is blocked on the
operator and blocks nothing else.

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

## P2 — Multi-scope monitoring (next milestone)

### A monitoring workspace spans several scopes

**Goal.** A workspace analyses several spaces, folders, lists or projects as one
connected body of work, instead of a single isolated scope.

**Reason.** Managers reason across an organisation. Engineering, Legal, Design
and QA in one analysis is what makes a cross-team bottleneck visible at all; a
single list can only ever show friction inside itself. This is foundational for
organisational intelligence rather than a convenience.

**Dependencies.** A schema change (`scopeId` is one nullable column today),
fetching several scopes per run, and merging them into one `ImportBatch` while
keeping item ids unique. Bulk selection in the UI (Select All, Deselect All)
lands here too — it is meaningless against a single-scope model, which is why
the search half shipped first and the bulk half did not.

**Status.** Design starting. Treat as foundational.

---

## P3 — Admin console extensions

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

## P4 — Monitoring Workspaces continued

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

## P5 — Operational Intelligence continued

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
