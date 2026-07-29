# CostFlow — project brief

**Read this first.** Under five minutes. Everything else exists to expand on it.

If you are an AI assistant, read [`09-ai-context.md`](09-ai-context.md) next — it
is the operational guide for working on this repository.

---

## What CostFlow is

A live production SaaS that reads a team's work-tracker data and answers three
questions in order:

1. **What is going wrong?** Work sitting in queues, going stale, missing its due
   date.
2. **What does it cost?** Priced in defensible ranges, every number traceable to
   the assumption that produced it.
3. **Where should attention go?** Which stage holds the friction, and what
   intervention fits it.

It connects to Jira, ClickUp, or a CSV export, and produces an executive report
plus a set of recommended actions.

Live at **https://app.fbx1.com**, free public beta.

## The North Star

> **CostFlow succeeds if an executive can open a report, spend less than two
> minutes reading it, and leave with complete confidence about the single
> highest-impact action they should take next.**

Founder directive, 2026-07-28. Everything else exists to support that outcome.
When choosing between several good implementations, prefer the one that makes
the executive's next decision clearer.

The engine is a means. Sophistication that never reaches a report is not
progress. See the priority order at the head of [`03-roadmap.md`](03-roadmap.md),
which governs what gets built next, and the cold-start ritual in
[`09-ai-context.md`](09-ai-context.md) §3, which governs how it is chosen.

## Who it is for

The buyer is an executive or operations leader who suspects their delivery
process is expensive but cannot prove it. The user is whoever owns the process.

The distinguishing promise: **every figure survives a hostile CFO.** Competing
tools produce numbers from opaque models. CostFlow produces numbers whose
derivation is one click away, whose assumptions are the customer's own, and
whose confidence is stated rather than implied.

## Product philosophy

Four commitments, in priority order. When they conflict, the earlier wins.

**Deterministic, never probabilistic.** No LLM is anywhere in the numeric path.
The same inputs always produce byte-identical output. This is enforced by golden
artifacts in CI, not by convention.

**Never fabricate a value.** If an input is missing, the number is not computed
and the gap is shown with its reason. A detector that cannot run says so. A
friction that cannot be priced says why. Silent omission is banned.

**Explain everything.** Every cost carries a formula trace. Every confidence
grade names its binding constraint. Every diagnostic carries the evidence that
produced it.

**Measure systems, not people.** CostFlow attributes cost to stages, queues and
dependencies — never to a named individual. This is enforced at three layers,
not left to convention. It is a deliberate market position: a tool that ranks
employees is a performance-management tool, which is a different product.

## Core architecture

```
work tracker → ingestion → canonical model → detectors → cost engine → artifact
                                                                          │
                                            ┌─────────────────────────────┤
                                            ▼                             ▼
                                       diagnostics                   reporting
                                    (where to act)              (what it costs)
                                            │                             │
                                            └──────────► web app ◄────────┘
```

Two properties do most of the work:

**The engine is pure and frozen.** Everything from ingestion through pricing is
side-effect-free, takes time as an explicit input, and never reads a clock, a
network, or an environment variable. It is pinned by byte-identical golden
artifacts; changing it requires regenerating them with a stated reason.

**The run artifact is self-contained.** A completed analysis embeds its own
input batch, assumption set, and every engine version. Any number in it can be
reconstructed years later from the artifact alone — which is what makes
run-over-run comparison trustworthy.

Everything downstream — diagnostics, comparison, reporting, the web UI — reads
that artifact and adds no numbers of its own.

Full detail: **`01-architecture.md`**.

## Implementation status

**The build phase is complete and the core product is feature-complete**
(founder directive, 2026-07-29). The current phase is **Design Partner
Validation**: no new capabilities, and remaining product work is driven by
evidence from real companies using their own data. What that means in practice
is the first section of `03-roadmap.md`.

**Shipped and live.** The product works end to end: connect a tracker, map
statuses, set assumptions, run an analysis, read a priced report with
recommended actions, and compare against the previous run.

- Nine pure packages, two applications (CLI and web).
- A test suite gated on every change (`pnpm check`).
- 100% server-rendered, zero client JavaScript, strict CSP.
- Multi-tenant with an internal operations console and customer database.

Detail: **`02-current-state.md`**.

## Completed milestones

- **The engine and product spine** — ingestion, three friction detectors, the
  cost engine, reporting, the self-serve web product, auth, multi-tenancy.
- **Multi-platform connectors** — Jira and ClickUp behind one provider contract.
- **Admin operations console and customer database** — cross-tenant, allowlist
  gated, fully audited.
- **OI1, Operational Intelligence** — diagnostics that say where attention pays
  off, with findings and interventions kept epistemically separate.
- **MC-5, connector capability expansion** — evidence quality as a first-class
  domain concept.
- **MW1, comparability verdict** — run-over-run comparison that refuses to draw
  a trend when the two runs are not measuring the same thing.
- **Multi-scope monitoring** — a workspace spans several Spaces, Folders, Lists
  or projects, with what each run actually covered recorded on the artifact.

## Current milestone

**None active.** The last four milestones completed and the founder chose to
stop expanding that area until real customers have used it.

The stated next area is the admin dashboard, but its scope is unconfirmed — the
console and customer database already exist, so the question is what to add
rather than what to build. **Ask before starting.**

## Immediate next priorities

1. **Unblock `/admin` in production.** The `COSTFLOW_ADMIN_EMAILS` environment
   variable does not include the operator's email, so the console is
   inaccessible. This is an operator action in Railway, not a code change. See
   `08-admin.md`.
2. **Get OI1 in front of real customers.** It is built and live but unexercised.
   The founder explicitly wants evidence from real workspaces before building
   the layer above it.
3. **Confirm the next milestone.** See `03-roadmap.md` for the candidates.

## The rest of the documentation

| Read when you need | File |
|---|---|
| How the system fits together | `01-architecture.md` |
| What is true today | `02-current-state.md` |
| What is planned and why | `03-roadmap.md` |
| The rules we follow on purpose | `04-engineering-principles.md` |
| Why things are the way they are | `05-decisions.md` |
| What could go wrong | `06-known-risks.md` |
| How correctness is enforced | `07-testing.md` |
| Deploying and debugging production | `08-admin.md` |
| **How to work on this repository** | [`09-ai-context.md`](09-ai-context.md) |
| The original design corpus | `reference/`, and `adr/` for decision records |

**Before you change anything**, read `04-engineering-principles.md`. Several
rules in it are non-obvious and are enforced by CI in ways that will fail your
build for reasons that look mysterious otherwise.
