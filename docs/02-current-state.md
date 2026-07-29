# Current state

What is true today. Rewrite this document rather than appending to it.

---

## Production

| | |
|---|---|
| URL | https://app.fbx1.com |
| Status | Live, free public beta |
| Deployed commit | whatever `/healthz` reports — check it, do not trust a written SHA |
| Replicas | 2, both serving |
| Health | `GET /healthz` returns `{"status":"ok","commit":"<sha>"}` |
| CSP | `script-src 'none'` — verified in production |

Deploy is **push to `main`**. Railway auto-builds, runs migrations in a
pre-deploy phase (never chained with start), and gates on the healthcheck.

## The gate

`pnpm check` = typecheck → lint → format → dependency-cruiser → tests.

Green on `main`, with one skip: the Postgres half of the store contract suite,
which needs `COSTFLOW_TEST_DATABASE_URL`. No Postgres runs on the development
machine; those paths are validated against PGlite instead (`07-testing.md`).

Run `pnpm check` for the current count. It is deliberately not written down here
— a number that changes on almost every commit would be stale more often than
not, and a document that is usually slightly wrong stops being trusted.

## What works end to end

A customer can sign up, connect Jira or ClickUp, search and select **any number
of scopes at any level of the platform's hierarchy** (a ClickUp Space, a Folder,
individual Lists, several Jira projects), map statuses to stage kinds, map
actors to roles, set pay (as an hourly rate or a monthly salary that is divided
into one) and attention assumptions, run an analysis, and read a priced report
with a formula trace behind every number.

On top of that:

- **Recommendations** — where attention pays off, with evidence and a fitted
  intervention.
- **Run-over-run comparison** — a trend, or a refusal with the reason.
- **Monitoring Workspaces** — a named, persistent operational view holding every
  run against one part of the organisation.
- **Team access** — invitations, roles, org-scoped visibility.
- **Erasure** — transactional deletion of a workspace and everything derived
  from it.

## Shipped subsystems

**Engine.** Three friction detectors (queue wait, aging, overdue) and one
context signal (WIP load). Decimal money, ranged estimates, A/B/C confidence
composed by weakest link, full formula traces. Pinned by six golden artifacts.

**Connectors.** Jira and ClickUp in-product, plus CSV. Monday and Asana have
pure ingestion transforms but no web wiring.

**Diagnostics (OI1).** Friction concentration, missing ownership, serial
gatekeeping. Capability-gated, evidence-quality-aware, provider-blind by
enforced test.

**Comparison (MW1).** Comparability verdict across seven aspects — engine,
detectors, assumptions, scope, coverage, evidence, policy — plus a per-instance
and per-signal diff. Both surfaces that make a run-over-run claim are gated on
it: the report's trend section, and the dashboard's delta line, which withholds
the comparison entirely rather than asserting one the report refuses to make.

**Evidence quality.** `EvidenceWeakness` × `EvidenceSubject` recorded on the
import batch and carried in the artifact. ClickUp declares its reconstruction
limits; other providers currently declare none.

**Acquisition.** The landing page promises what the product is best at — the
highest-leverage change to make in your delivery process, and what it is costing
not to make it — and the product screenshot mirrors the real report's order:
action, evidence, then the ranked list. The stage vocabulary shown before signup
matches the six kinds the product actually uses.

**The public surface claims only what exists.** Pricing states that billing is
not built and no plan cap is enforced, and marks the four features that do not
exist yet — machine-readable export, a second workspace, SSO/SAML, a
customer-visible audit log — as planned. `/docs` is the documentation rather
than a list of chapters that were never written: the six onboarding steps, both
connector setups, the stage kinds, what a confidence tier means, how assumption
provenance decides what gets priced, and a section on every case where the
product refuses to answer. Security and Privacy say that assignee display names
are stored in workspace configuration so roles can be mapped, which
"pseudonymized before analysis" was true of but did not cover. A test pins each
of these, because an over-promise is a regression like any other.

**Report structure.** The report is an executive briefing, ordered for a
two-minute read: the single highest-leverage action, the cost at stake beneath
it as the evidence that acting is worth it, a labelled boundary, then all
supporting detail including the total across the analysis (D22). Every
recommendation states its basis where it is made — the confidence tier and what
it means, that the finding is measured while the intervention is selected, and
where the figures open into their formulas. It says it was chosen for strongest
evidence rather than largest figure, and the cost-ordered list below explains
why its order differs.

The lead is never empty while money is priced: with no diagnostic above its
evidence gate it names the largest measured cost and labels it as measured, and
a run that found frictions but priced none reads as a blocked analysis with
confirming the assumptions as the action, never as a healthy result. A run that
imported no work items says there was nothing to analyse and links to the scope
step, rather than reporting health for a process it never saw. Its money
figure says it covers the whole stage, and how many frictions that spans, so it
can be reconciled against the ranked list below. Durations and due dates are
formatted for a reader; the artifact keeps full decimal precision and the
original ISO strings. Unpriced frictions name their origin, like the ranked
ones, and name the assumption they are waiting on in the words the customer
chose it by. The statuses step explains what each of the six stage kinds
changes, because that choice decides whether time is measured as work or as
waiting; the roles step says that skipping it caps the report at confidence C;
the assumptions step says what leaving a value unconfirmed will produce, before
the button rather than in the report.

The run history names what each analysis found rather than listing dollar
amounts. The printable export and both public sample surfaces render the same
body; the public ones mark the recommendations as computed from demonstration
data.

**Per-origin attribution.** Friction is located at (origin, stage), so a
workspace spanning several teams reports which team's queue is expensive rather
than one blended figure. See D19.

**Multi-scope.** A workspace analyses a SET of origins. The selection may name
a container, and what it covers is resolved on every run and recorded on the
artifact, so a Space that gains a List shows up as a coverage change rather than
a total that grew for no visible reason. Merging is deterministic: items
de-duplicate across origins, capability is the intersection, evidence is the
union attributed per origin. See D16 and D17.

**Onboarding.** Scope selection is a multi-select with server-side search,
select-all and clear (a GET round trip and hidden inputs, since there is no
client JavaScript), grouped by the platform's own hierarchy. The rate card leads
with the people mapped to each role, and pay can be entered as a monthly salary
that is divided into an hourly rate by exact decimal arithmetic — the salary and
divisor live in workspace configuration, not in the assumption set, so the
engine still prices on hourly rates alone.

**Admin console.** Twenty routes at `/admin`: executive dashboard, customer
database with per-customer detail, activity feed, onboarding funnel, monitoring
workspaces, organisations, users, workspaces, jobs, runs, invitations, audit log,
global search, system diagnostics, and three audited actions. Backed by eighteen
cross-tenant store methods. Gated by an email allowlist; non-admins get a 404
with no disclosure.

## Active milestone

**None, and none is to be started.** Founder directive, 2026-07-29: the build
phase is complete and the core product is feature-complete. The current phase is
**Design Partner Validation** — no new capabilities, and remaining product work
driven by evidence from real companies rather than internal intuition. What to
do instead is the first section of `03-roadmap.md`.

A launch readiness review preceded the decision: the public surface was checked
for over-promises, under-explanations, inconsistent terminology and places a
first-time executive could lose trust, and what it found was fixed.

## Current priorities

Both are operator actions, not code changes, and both gate the phase:

1. **`/admin` is inaccessible in production.** `COSTFLOW_ADMIN_EMAILS` does not
   contain the operator's email, so no funnel, usage or health data can be read
   — which is the whole point of a validation phase. Procedure in `08-admin.md`.
2. **No real Jira or ClickUp account has ever been connected.** Every
   walkthrough, test and golden runs against stubs or recorded fixtures. One
   real connection before any partner is invited (R11).

## Open work

**Unconfirmed product questions**
- Billing is a Lemon Squeezy-shaped scaffold with nothing behind it: every
  organisation is plan `beta`, status `free_beta`, provider `none`, all dates
  null. The schema maps one-to-one onto Lemon Squeezy records, so integrating
  fills fields rather than reshaping anything.

**Known limits of the admin console**, documented in its own UI
- Product usage is aggregated per organisation, not per person, although the
  event spine records an actor on every event.
- The customer table scans a bounded 2,000 rows because the health score is
  computed on read rather than stored. It truncates silently past that.
- Middle funnel steps have no historical timing.

**Deferred with reasons recorded** — see `03-roadmap.md` and
`reference/20-oi1-retrospective.md`. The retrospective is a register of latent
debt where each item states the trigger that makes it worth doing. It is not a
backlog; do not action an item because it is listed.

**Founder-gated operations** — verified Postgres backups and a restore drill,
uptime and error alerting, Railway plan upgrade. All require the account owner.
