# Known risks

Active risks only. **When a risk is resolved, delete it from this file.**

---

## R1 — The operator cannot reach the admin console

**Description.** `/admin` is gated by the `COSTFLOW_ADMIN_EMAILS` environment
variable. It does not currently contain the operator's email, so the console
returns 404 in production.

**Impact.** High and immediate. No customer, funnel, usage or health data is
observable. Nothing about running the business can be checked.

**Mitigation.** Set the variable in Railway and redeploy. The console now emits a
sanitised `admin-denied` log line distinguishing "variable not reaching the app"
from "set but not matching the signed-in email". Procedure in `08-admin.md`.

**Status.** Open. Blocked on operator action; not a code change.

---

## R2 — OI1 has never been used by a real customer

**Description.** The recommendations layer is live and unexercised. Its
thresholds, copy and diagnostic set were validated against one real dataset and
otherwise reasoned about.

**Impact.** Medium. Building anything on top of an unvalidated layer risks
compounding a wrong assumption. Simulation in particular would inherit whatever
is wrong.

**Mitigation.** The founder has made real-customer validation an explicit
precondition for OI2. Validating against one real workspace previously changed
the milestone's entire scope, which is precedent for doing it again.

**Status.** Open by design. Waiting on customer usage.

---

## R3 — Only one real customer dataset has ever been analysed

**Description.** Product decisions rest on a single partner workspace, which is
small, single-person, and lacks event history. A second workspace exists as a
scaffold with no data.

**Impact.** Medium. Thresholds tuned against one dataset may not generalise. The
minimum-evidence floors are educated guesses.

**Mitigation.** Thresholds are declared global constants, displayed with their
findings, and changeable in one place. They are deliberately not
tenant-configurable, so tuning is a reviewed decision rather than a customer
knob.

**Status.** Open. Resolves as real workspaces arrive.

---

## R4 — Concurrent sessions push to `main`

**Description.** Another agent session has pushed directly to `main` during
active work, at least twice. One of those pushes bypassed the gate and left the
format check failing; another shipped a store method with no tests, which
contained a real production race.

**Impact.** Medium. Deploy is push-to-`main` with no staging, so an unreviewed
push goes straight to production.

**Mitigation.** Always `git fetch` before pushing and expect to rebase. Run the
full gate on the combined tree, not just your own commits. Treat anything you did
not write as unverified until you have read it.

**Status.** Open. Process risk, not fixable in code.

---

## R5 — Internal notes can be wrong, and one still is

**Description.** A partner-run findings note states that ClickUp's time-in-status
returns aggregate durations rather than ordered transitions. **This is false.**
Entries carry the instant a task entered a status, and the ingestion transform
has reconstructed an ordered event chain from them since the connector shipped.
The note was written after a plan probe that never returned a payload.

**Impact.** Medium. Believing it cost a milestone's entire premise: the
connector was declared incapable, customers were told their platform could not
supply the data, and a wrong test was written to enforce it.

**Mitigation.** The connector declaration is corrected and a test now asserts the
golden artifact directly, so it cannot claim a capability the transform does not
deliver. `partner-runs/` is git-ignored, so its notes are reviewed by nothing.
**Trust the transform and the goldens over any note.**

**Status.** Open — the note itself is still wrong and still on the machine. It is
customer data and is not edited casually.

---

## R6 — Stored artifacts are parsed with an unchecked cast

**Description.** `parseRun` is `JSON.parse(json) as AnalysisRun` with no
validation. A stored run predating a newly added field has `undefined` at runtime
while TypeScript believes the field is present.

**Impact.** Medium. Every field added to the artifact creates a silent divergence
between the type and old rows. Handled correctly so far, but by discipline rather
than by the compiler.

**Mitigation.** Treat absent as *unknown*, never as empty, and handle it
explicitly at the read boundary with a comment saying why. Both fields added so
far do this and have tests.

**Status.** Open. A validating parser would close it but would need a migration
story for every historical artifact.

---

## R7 — The customer table truncates silently past 2,000 organisations

**Description.** The admin customer list scans a bounded 2,000 rows because the
health score is computed on read rather than stored.

**Impact.** Low today, high the moment it is crossed — the list would simply stop
showing customers, with no error.

**Mitigation.** The cap is a named constant and the limit is documented in the
console's own UI. Fixing it means persisting the health score, which is a
projection rather than a source of truth.

**Status.** Open. Not urgent at current scale.

---

## R8 — Billing state is a placeholder

**Description.** Every organisation carries plan `beta`, status `free_beta`,
provider `none`, all dates null. No webhook, no sync, no real subscription
state.

**Impact.** Medium and growing. Nothing in the product knows whether anyone is
paying, so the console cannot answer any revenue question.

**Mitigation.** The schema maps one-to-one onto Lemon Squeezy customer,
subscription and variant records, so integrating fills fields rather than
reshaping. No invented trial dates or payment history were ever written, so
there is nothing false to unwind.

**Status.** Open. Candidate for the next milestone.

---

## R9 — Founder-gated operations are unverified

**Description.** Postgres backups have never been restore-tested. There is no
uptime or error alerting. The Railway plan has not been reviewed against
production load.

**Impact.** High if any of them is needed. An untested backup is a hope, not a
backup.

**Mitigation.** All three need the account owner and cannot be done from the
codebase. Documented in `reference/16-operations.md` and
`reference/17-launch-operations.md`.

**Status.** Open. Requires operator action.

---

## R10 — A scope named exactly after a person withholds the report

**Description.** Scope labels are now rendered inside the report body: in the
executive summary, on every ranked friction, and on every recommendation card.
The ADR-0002 attribution guard matches observed actor values as exact substrings
of the rendered bytes and fails closed with HTTP 500. A customer whose ClickUp
List is named exactly as one of their observed actor values — a List called
"Dan Ops" in a workspace where "Dan Ops" is an assignee — would trip it.

**Impact.** Low likelihood, high blast radius when it happens: the whole report
is withheld and the customer sees an error with no obvious cause. The surface
widened with per-origin attribution; before that, scope names appeared only in
the page foot and settings.

**Mitigation.** None applied. The guard is deliberately strict and fail-closed,
and loosening it to accommodate a naming coincidence would weaken the one
mechanism that guarantees no individual is ever named in a report. Renaming the
List resolves it.

**Status.** Open, accepted. Revisit if a real customer hits it — the fix would
be a clearer error on this specific collision, never a weaker guard.
