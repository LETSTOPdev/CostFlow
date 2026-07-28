# Current state

What is true today. Rewrite this document rather than appending to it.

---

## Production

| | |
|---|---|
| URL | https://app.fbx1.com |
| Status | Live, free public beta |
| Deployed commit | `f2b7646` |
| Replicas | 2, both serving |
| Health | `GET /healthz` returns `{"status":"ok","commit":"<sha>"}` |
| CSP | `script-src 'none'` — verified in production |

Deploy is **push to `main`**. Railway auto-builds, runs migrations in a
pre-deploy phase (never chained with start), and gates on the healthcheck.

## The gate

`pnpm check` = typecheck → lint → format → dependency-cruiser → tests.

**629 passing, 1 skipped, 66 files.** Green on `main`.

The skip is the Postgres half of the store contract suite, which needs
`COSTFLOW_TEST_DATABASE_URL`. No Postgres runs on the development machine; the
Postgres paths are validated against PGlite instead (see `07-testing.md`).

## What works end to end

A customer can sign up, connect Jira or ClickUp, select a scope, map statuses to
stage kinds, map actors to roles, set salary and attention assumptions, run an
analysis, and read a priced report with a formula trace behind every number.

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

**Comparison (MW1).** Comparability verdict across six aspects — engine,
detectors, assumptions, scope, evidence, policy — plus a per-instance and
per-signal diff. The report's trend section is gated on it.

**Evidence quality.** `EvidenceWeakness` × `EvidenceSubject` recorded on the
import batch and carried in the artifact. ClickUp declares its reconstruction
limits; other providers currently declare none.

**Admin console.** Twenty routes at `/admin`: executive dashboard, customer
database with per-customer detail, activity feed, onboarding funnel, monitoring
workspaces, organisations, users, workspaces, jobs, runs, invitations, audit log,
global search, system diagnostics, and three audited actions. Backed by eighteen
cross-tenant store methods. Gated by an email allowlist; non-admins get a 404
with no disclosure.

## Active milestone

**None.** OI1, MC-5 and MW1 completed and the founder chose to stop expanding
that area until real customers have exercised it.

The next area named was the admin dashboard, but the console and customer
database already exist, so the scope is **unconfirmed**. Ask before building.

## Current priorities

1. **`/admin` is inaccessible in production.** `COSTFLOW_ADMIN_EMAILS` does not
   contain the operator's email. Operator action in Railway, not a code change.
   Procedure in `08-admin.md`.
2. **OI1 has never been used by a real customer.** It is live but unexercised.
   The founder wants evidence from real workspaces before anything is built on
   top of it.
3. **Confirm the next milestone.** Candidates in `03-roadmap.md`.

## Open work

**Unconfirmed product questions**
- Should the recommendations section appear on `/demo` and `/try/report`? Those
  are public marketing surfaces; showing it would demonstrate the layer to
  prospects.
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
