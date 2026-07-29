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
paying, so the console cannot answer any revenue question. Nothing can be
charged, so every plan cap on the pricing page is unenforced and every design
partner is on the full feature set for free.

**Mitigation.** The schema maps one-to-one onto Lemon Squeezy customer,
subscription and variant records, so integrating fills fields rather than
reshaping. No invented trial dates or payment history were ever written, so
there is nothing false to unwind. The pricing page now states plainly that
billing does not exist yet and that no cap is enforced, so a design partner
reading it is not misled about what they are getting.

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

---

# Unvalidated assumptions

Founder directive, 2026-07-29. These are beliefs about **customer behaviour**
that the product is already built on and that no real customer has yet tested.
They are recorded so nobody mistakes them for findings.

**Do not optimise around them until there is evidence.** An assumption is not a
bug and not a backlog item; building for a guess about how customers behave is
how effort gets spent on nobody. Each one names what would settle it.

The instrument already exists: the event spine and the onboarding funnel in
`/admin` record every step of every real signup. Nothing here needs new
telemetry — it needs traffic, and then someone to read it.

## R13 — The marketing site does not deploy on push

**Description.** The Vercel project `costflow-marketing` is connected to no
repository, so `fbx1.com` only updates when someone runs the manual deploy.

The cause is not what it looks like. The Vercel GitHub App **is** installed —
on the GitHub account `ddoorr1185-ctrl` (installation `144726709`). The
repository is owned by `LETSTOPdev`, which is a GitHub **User** account, not an
organization. A GitHub App installation is scoped to one account and cannot
reach another's repositories, and because `LETSTOPdev` is a user there is no
organization-level access grant to widen. Vercel therefore sees exactly one
namespace, `ddoorr1185-ctrl`, containing seven repositories, none of which is
this one.

**Impact.** Medium, and it grows quietly. A push updates the application and
leaves the marketing site on whatever was last deployed by hand, so the two
drift — and they share `packages/ui`, so a shell or report change lands on one
host and not the other. Nothing breaks; the site simply becomes stale without
saying so.

**There is a trap next to it.** `ddoorr1185-ctrl` owns a *different*, private
repository also called `costflow`, whose `main` is frozen at 2026-07-23 —
before the host split. Asking Vercel to link "CostFlow" within the namespace it
can see succeeds and silently binds the project to that one. A single push
there would replace `fbx1.com` with a six-day-old marketing site that has no
host split. **Link by full name (`LETSTOPdev/CostFlow`) and verify the `link`
field afterwards; never by bare repository name.**

**Mitigation.** Until it is connected, every push touching `apps/marketing`,
`packages/ui` or the brand assets must be followed by the manual deploy in
`08-admin.md`. The fix is to install the Vercel GitHub App on the `LETSTOPdev`
account — `https://github.com/apps/vercel`, granting it `LETSTOPdev/CostFlow` —
and then link the project. That requires signing in to GitHub as `LETSTOPdev`,
which no automation can do on the owner's behalf.

The alternative is a GitHub Actions workflow deploying with `vercel deploy
--prebuilt`, which needs no GitHub App. It is not in place because it needs a
Vercel token in repository secrets, and the only token obtainable here is the
operator's personal account-wide credential — too much authority to place in a
public repository's CI for a project-scoped job. A **project-only** token
created from the Vercel dashboard would be safe; the API refuses to mint one
from a CLI-issued credential.

**Status.** Open. Blocked on operator action; not a code change.

---

## U1 — That an executive wants one action, not a ranked list

The report, the dashboard, the export and the landing page were all rebuilt
around a single "start here" (D22). It is a strong belief and an untested one:
an operations lead may want the whole ranked list and resent being told where to
begin.

*Settled by:* which surface real customers open and return to, and whether they
act on the lead or scroll past it.

## U2 — That the six-step onboarding is completable unassisted

Nobody outside this project has completed connect → scope → statuses → roles →
assumptions → run without help. Every step has been walked here by someone who
knows what each one is for.

*Settled by:* the funnel in `/admin`, which already records step completion and
drop-off per signup.

## U3 — That customers accept suggested assumptions rather than abandon

The provenance gate (D4) makes the assumptions step the point where a first run
either becomes priced or does not. The product now states the consequence before
the button, but whether a customer accepts, customises, or leaves is unknown.

*Settled by:* the ratio of accepted to unconfirmed assumption sets among real
first runs, and how many sessions end on that step.

## U4 — That confidence grades build trust rather than undermine it

A/B/C grading is on every figure and in the hero. It is designed to read as
rigour. It may instead read as a vendor who is not sure, particularly at grade C
— which is what every figure is graded when a customer skips the optional roles
step.

*Settled by:* whether customers ask about grades, ignore them, or cite them as a
reason to doubt the numbers.

## U5 — That customers want a second analysis at all

The whole Monitoring Workspaces direction (MW2–MW5) presupposes recurring use.
There is no scheduled run, no notification, and no evidence anyone wants either.
Building a scheduler would be optimising around this assumption, not testing it.

*Settled by:* how many tenants run a second analysis unprompted, and how long
after the first.

## U6 — That ClickUp's Total Time in Status ClickApp is usually on

Queue wait is the largest priced category in every sample analysed so far, and
on ClickUp it exists only when a workspace admin has enabled that ClickApp. If
it is usually off, the flagship number is usually absent, and the first report
most ClickUp customers see is materially weaker than the one demonstrated.

*Settled by:* the capability profile recorded on real ClickUp imports. This one
is cheap to check as soon as there are any.

## U7 — That money is the right unit for this reader

Everything is denominated in recoverable cost. Days of delay, or throughput,
might be the unit an operations executive actually reasons in, with money the
translation they perform for their own CFO rather than the one we should lead
with.

*Settled by:* what customers repeat back and what they forward internally.

---

## R11 — No real provider account has ever been connected

**Description.** Every walkthrough, test and golden in this project runs against
stub gateways or recorded fixtures. The Jira and ClickUp connectors have never
been pointed at a live account by anyone. The one real customer dataset that has
been analysed (R3) arrived as an export, not through the connector.

**Impact.** High for a first design-partner experience, and the failure would
land at the worst possible moment: step 1, before any value has been shown.
Live APIs differ from fixtures in pagination edges, rate limiting, permission
scoping, custom fields, and error shapes. None of that is visible from here.

**Mitigation.** None applied, and none is available from inside the codebase.
The fix is one real connection, made by the operator, before any partner is
invited. Connecting a personal Jira or ClickUp and running one analysis end to
end would either confirm the path or surface the problem while there is nobody
watching.

**Status.** Open. The highest-value pre-launch action, and it is not a code
change.

---

## R12 — The product cannot send email

**Description.** There is no transactional email of any kind. Inviting a member
creates a link the inviter must copy and send themselves, which the product says
plainly. Nothing notifies anyone that a run finished, that a run failed, or that
anything changed.

**Impact.** Medium, and specific to the second analysis. A design partner who
runs once and closes the tab has nothing bringing them back, which is also why
U5 stays unvalidated — an absent channel is not evidence that nobody wants one.

**Mitigation.** None. Deliberately not built: adding a scheduler or a digest
would be optimising around U5 rather than testing it. Revisit once real usage
says whether anyone returns unprompted.

**Status.** Open, accepted for the design-partner phase.
