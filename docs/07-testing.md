# Testing

---

## Philosophy

**A test exists to catch a specific failure.** If it would not fail on a real
bug, it is decoration. When adding a regression test, prove it: revert the fix,
watch it go red, restore.

**The gate is the approval mechanism.** `pnpm check` runs before any deploy, and
a deploy is a push to `main`. So a flaky test is not an annoyance — it is a bug
in the test, because a gate that fails at random stops being read.

**Enforce mechanically, do not document and hope.** Where a rule matters, a test
should fail when it is broken. Several rules here are enforced by tests that
inspect the source tree, and one of them caught its own author.

**Determinism is testable, so test it.** Same inputs, same bytes.

---

## What the gate runs

```
pnpm check  =  typecheck → lint → format → dependency-cruiser → tests
```

**Currently 629 passing, 1 skipped, 66 files.**

The skip is the Postgres half of the store contract suite, which activates when
`COSTFLOW_TEST_DATABASE_URL` is set.

---

## Golden tests — the frozen engine

Six fixtures under `tools/golden/` are analysed end to end and their `run.json`
and `report.md` compared **byte for byte**.

This is what makes "the engine is frozen" enforceable. Any change to ingestion,
detection, pricing or reporting shows up as a golden diff, so changing engine
behaviour is a deliberate act: regenerate with `pnpm golden:update` and state why.

The goldens are also **evidence about behaviour**, not just a tripwire. Two
examples that mattered:

- A test asserts the ClickUp golden contains reconstructed events with populated
  transitions and a queue-wait detector that ran — so the connector can never
  advertise a capability the transform does not actually deliver.
- A test walks every golden, collects the magnitude units the engine really
  emits, and asserts each one maps to an intervention. Adding a friction family
  fails the build until someone decides what to recommend for it.

**Acceptance criterion for additive artifact changes:** every `report.md` must
stay byte-identical. If a field is genuinely additive, the rendered report cannot
move. Check it explicitly rather than assuming.

---

## Contract tests — the two stores

`apps/web/test/store-contract.test.ts` runs the same assertions against both the
in-memory and Postgres implementations, so behaviour cannot diverge.

**What it structurally cannot cover:** a failure specific to *how* one
implementation achieves a guarantee. The atomic double-submit guard claims
"one active job per workspace" — memory achieves it with a synchronous check,
Postgres with a partial unique index plus a separate recovery read. The window
between those two statements exists only in Postgres.

That gap hid a real production bug. Where an implementation has a failure mode
the other cannot have, it needs its own focused suite —
`apps/web/test/pg-job-claim.test.ts` drives `PgStore` through a scripted pool for
exactly this reason, keeping the regression pinned on every machine with no new
dependency.

---

## Structural tests — rules the build enforces

Under `apps/cli/test/`, these inspect the repository itself:

- **`boundaries.test.ts`** — dependency-cruiser passes, *and* a deliberately
  forbidden import fails. The guard is tested, not just run.
- **`purity-deps.test.ts`** — pure packages carry no unreviewed external
  dependency, and every package is listed so a new one cannot slip by.
- **`diagnostics-portability.test.ts`** — no provider name appears anywhere in
  `packages/diagnostics`, including comments; no diagnostic reads the raw
  capability profile instead of its declared gate; every declared diagnostic
  gates on its capabilities. *This caught provider names in its own author's doc
  comments.*
- **`diagnostics-unit-coverage.test.ts`** — every magnitude unit the goldens
  contain maps to an intervention.

---

## Privacy tests

Assert that known secret strings never appear in any admin console HTML, that
diagnostic findings carry no identity, and that the sanitised log lines contain
neither the attempted email nor the allowlist. These are the mechanical half of
the privacy rules in `04-engineering-principles.md`.

---

## Invariant tests

Budgets and properties rather than examples: report HTML size, time to render,
cold-start cost, report determinism, money-format safety.

**Measure the property, not a proxy for it.** The cold-start budget measured wall
time and failed intermittently — it was timing scheduler contention, not the
code. The same work benchmarks at 157ms wall alone, 56ms inside the suite, and
2,200ms+ on a loaded machine, while CPU time holds at ~70ms throughout. It now
asserts CPU time with a loose wall-clock backstop for async I/O, which is both
stable and a *tighter* guard than the padded budget it replaced.

---

## Postgres without Postgres

There is no Postgres server on the development machine and no Docker.

Postgres-specific paths are validated by driving the **real `PgStore`** against
**PGlite** (PostgreSQL compiled to WebAssembly) with the **real `schema.sql`**,
through a pool shim. This has caught real bugs, including a race that returned an
undefined record from the concurrency guard.

The harness lives outside the repo, so it is a manual validation step rather than
part of the gate. Anything it proves should be pinned by a committed test that
runs everywhere.

---

## Deployment validation

Before pushing:

1. `pnpm check` green on the **combined** tree, after `git fetch` and any rebase.
   Another session may have pushed; their commits are yours to verify too.
2. If any golden changed, confirm it was intended and state why in the commit.
3. If the artifact shape changed, confirm every `report.md` is byte-identical.

---

## Production verification

Deploy is a push to `main`, so verification happens afterwards, against the live
site. Poll `/healthz` until it reports the pushed SHA, then:

- **Both replicas** — repeat the health probe roughly ten times; every response
  must carry the new commit. There are two replicas and a rolling deploy, so a
  single probe proves nothing.
- **CSP intact** — `script-src 'none'` still present.
- **Gated routes still gated** — `/reports/*` and `/admin` redirect or 404 for
  an unauthenticated caller.
- **The Auth0 contract** — `/brand/logo.svg` returns 200. The Auth0 login page
  references it, so that route must never move.

What cannot be verified without credentials is stated plainly rather than
assumed. Signing in as the operator is not something to do on their behalf.

---

## Expectations when adding code

- A new store method needs coverage in the shared contract suite. If one
  implementation has a failure mode the other cannot have, it needs its own test
  too.
- A new diagnostic needs its capability gate, its minimum evidence, its
  suppression-or-downgrade behaviour, and a deterministic-ordering test.
- A new vocabulary member needs a test asserting the closed set is exhaustive
  where it matters.
- A new rendered surface that shows evidence must be covered by a test proving
  it routes through the attribution guard.
- Anything touching money needs an exact-decimal assertion, never a float
  comparison.
