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

## R13 — The marketing site deploys from CI, not from Vercel's own link

**Description.** The Vercel project `costflow-marketing` is connected to no
repository. `fbx1.com` now deploys on every push to `main`, but through
`.github/workflows/deploy-marketing.yml` rather than through Vercel's own git
integration — the workflow builds the Build Output directory and uploads it with
`--prebuilt`.

The cause is an identity mismatch, not a missing install. The Vercel GitHub App
**is** installed — on the GitHub account `ddoorr1185-ctrl` (installation
`144726709`). This repository is owned by `LETSTOPdev`, a GitHub **User**
account rather than an organization, so there is no organization-level grant to
widen and an installation on one account cannot reach the other's repositories.
Vercel's connected GitHub identity is `ddoorr1185-ctrl`, and the only namespace
it can offer is that same account.

**Impact.** Medium, and it grows quietly. A push updates the application and
leaves the marketing site on whatever was last deployed deliberately, so the two
drift — and they share `packages/ui`, so a shell or report change lands on one
host and not the other. Nothing breaks; the site becomes stale without saying so.

**The trap beside it, now defused.** `ddoorr1185-ctrl` owns a *different*,
private repository also called `costflow`, frozen at 2026-07-23 — before the
host split. Asking Vercel to link "CostFlow" from the namespace it can see
succeeds silently and binds the project to that one; a single push there would
replace `fbx1.com` with a pre-split site. An attempt to widen the installation
narrowed it instead, so that stale repository is currently the *only* one Vercel
can reach, which makes the wrong link the easy one to make.

Two things now stand in the way. The project's ignored-build-step command
refuses any git-triggered build whose `VERCEL_GIT_REPO_OWNER` is not
`LETSTOPdev`, so a wrong link produces no deployment rather than a wrong one.
And the rule for linking is: **use the full name and verify `link.org`
afterwards** — never a bare repository name.

**Mitigation.** `.github/workflows/deploy-marketing.yml` deploys the site
without the GitHub App at all, building the same output the manual deploy
produces and uploading it with `--prebuilt`. **The `VERCEL_TOKEN` secret now
exists and the workflow deploys**, verified 2026-07-29: a real production upload
under `dors-projects-ceb7e8c1/costflow-marketing`, after which all 17
prerendered pages were byte-identical to the artifact built from `origin/main`.

Adding it was the whole fix, and it also settled two things the repository could
not answer on its own: the token is valid and correctly scoped, and the
hardcoded `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` resolve to the real project.

A project-only token is the point. The account-wide token this machine holds
would also work and is the wrong instrument: it carries authority over every
project in the team, in a public repository's CI, for a job that deploys one
site.

The alternative is to make Vercel able to see `LETSTOPdev` — either by
installing the App on that account *and* connecting it to the Vercel team's git
identity, or by connecting `LETSTOPdev` as the team's GitHub account. If that is
done, **delete the workflow**, or every push deploys twice.

**The permanent fix** is to move the repository into a business-owned GitHub
organization, where installing an app is a role several people can hold rather
than one person's personal account. That also removes the larger risk hiding
behind this one: today, if that account is lost, the business cannot regain
administrative control of its own production repository. The sequenced
procedure, with verification and rollback at every step, is
[`runbooks/github-org-migration.md`](runbooks/github-org-migration.md).

**Status.** Deployment half **closed**. What remains open is the ownership
split underneath it: the Vercel team belongs to one person and the GitHub
repository to another, so Vercel's own git integration still cannot reach this
repository and CI holds a token instead of a link. The permanent fix is the
migration in
[`runbooks/github-org-migration.md`](runbooks/github-org-migration.md), written
and unscheduled.

One trap the workflow leaves behind: with no token it reported **success** while
skipping every real step, so a stale site looked shipped. That is logged as
separate operational work and is dormant, not fixed — it returns the moment the
token is rotated or removed.

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

---

## R14 — Production authentication runs on a dev-tier Auth0 tenant

**Description.** `/login` and `/signup` on `app.fbx1.com` hand off to
`dev-0l6ne8ms0d1s30aw.us.auth0.com`. It is visible without signing in: the
application's `content-security-policy` names that host in `form-action`.

A design partner's first screen after "Get started" therefore carries a red
dev-keys warning, the raw tenant id in the heading ("Log in to
dev-0l6ne8ms0d1s30aw to continue to CostFlow"), no CostFlow branding, and a
"Continue with Google" button on Auth0's shared development credentials, which
Google marks as an unverified app.

**Impact.** High, and it lands at the worst moment. Everything `/security`
argues about credential handling is contradicted by the screen that asks for
credentials, before any value has been shown. A development tenant's defaults
have also never been reviewed, which is why the application now refuses an
unverified email itself rather than trusting the tenant to do it.

**Mitigation.** None available in the codebase. `config.ts` already refuses to
boot with `COSTFLOW_AUTH=dev` in production, so this is not the app running dev
auth — it is production OIDC pointed at a development tenant, which the code
cannot detect and should not try to. The fix is a production Auth0 tenant with a
custom domain, real Google OAuth credentials and CostFlow branding, then
repointing the four `COSTFLOW_OIDC_*` variables.

**Status.** Open. Operator action, no code change. Changing the issuer
invalidates every existing session; accounts survive, because identity is keyed
on email rather than on the provider's subject.

