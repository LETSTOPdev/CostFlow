# Engineering principles

Rules we follow on purpose. Most are enforced by CI; where they are, it says so.

If a rule here seems to be getting in your way, that is usually the rule working.
Read its reasoning before routing around it.

---

## Determinism

### Deterministic over probabilistic

No LLM, no randomness, and no wall-clock read anywhere in the numeric path. Time
is an explicit input to every pure function. The same inputs produce
byte-identical output forever.

*Enforced:* golden artifacts in `tools/golden/`, compared byte-for-byte in CI.

*Why:* the product's entire claim is that a number survives being challenged. A
figure that cannot reproduce itself cannot be defended, and one indefensible
number discredits every other number in the report.

### Pure packages stay pure

Nothing under `packages/` performs I/O, reads an environment variable, reads a
clock, or imports a Node builtin. Effects live at the edges in `apps/`.

*Enforced:* `dependency-cruiser` fails the build on a Node builtin import or an
`apps/` import from a package.

### The dependency arrow points one way

Consumers depend on producers, never the reverse. `analysis` may not import
`comparison` or `diagnostics`.

*Why:* otherwise a downstream need silently changes how a run is produced, and
the artifact stops being a stable record.

---

## Honesty about numbers

### Never fabricate a value

If an input is missing, do not compute the number. A detector whose requirements
the data cannot meet is **skipped visibly with the reason**. A friction that
cannot be priced is **recorded as skipped with the reason**. Silent omission is
banned.

*Why:* a missing number is recoverable. A quietly invented one is not, and the
reader has no way to tell them apart.

### Explain every calculation

Every cost carries a formula trace: per-item terms, the assumptions used, and
each assumption's provenance. Prose about a number is rendered *from* its trace,
never written alongside it.

### Ranges, not points

Uncertainty originates in assumptions and flows outward. Estimates are ranges.
Ranges widen through composition and never narrow.

### Money is decimal, never float

Decimal strings at rest, exact decimal arithmetic in the engine, rounding only
at display.

### Confidence composes by minimum, and names its constraint

A chain is as strong as its weakest link, and the binding constraint is
displayed. "Confidence B, limited by: no event history in this import" turns a
badge into an action.

Nothing may display higher confidence than any of its inputs. Grades are
assigned by evidence class, never by a tunable score.

### Never re-derive engine law at the edges

Money arithmetic, range algebra, confidence composition and tier ordering live
in the engine and are imported. A renderer that reimplements one will drift.

*This has happened:* the render layer once sorted confidence tiers by letter,
which was correct only by the coincidence that A/B/C run strongest to weakest.

---

## Evidence and trust

### Capabilities describe observability; evidence quality describes trust

Two separate models, deliberately.

- **Capability** — can this be observed at all? Gates whether a diagnostic runs.
- **Evidence quality** — how good is what was observed? Caps confidence.

Conflating them would mean either refusing to run on imperfect data or running
on it while claiming full confidence.

### Evidence before assumptions

Prefer what was observed. Where something had to be derived, say so in the
artifact so every downstream consumer can account for it.

### Absent is not empty

A field missing from a stored artifact means *unknown*. A field present and
empty means *we looked and found nothing*. Never default the first to the
second — that retroactively certifies data nobody checked.

*Applies concretely:* stored artifacts are parsed with an unchecked cast, so a
run predating a field genuinely has `undefined` at runtime despite the type.

### A weakness names a problem, never a mechanism

A new `EvidenceWeakness` is warranted only when it names a genuinely different
*epistemological problem*, never a different *mechanism* producing one already
named. "This platform collapses repeat visits to a status" is a mechanism; the
problem is that the sequence had to be derived rather than read.

*Why:* mechanism-shaped vocabulary grows once per platform quirk, which is a
provider taxonomy wearing a domain name.

---

## Attribution

### Measure systems, not people

CostFlow attributes cost to stages, queues and dependencies — never to a named
individual.

**Load is a property of the system. Rate is a property of the person.**

The test: if a number would change because a person got faster, it is forbidden;
if it would change because the organisation routed work differently, it is
permitted. Queue depth and wait are fair game, including comparatively.
Per-person throughput is not.

*Enforced at three layers:* `ActorRef` makes raw identity unrepresentable in the
model; every friction instance is located at a stage; and the reporting layer
fails closed on any raw identity in the rendered bytes.

*The commercial and legal reasoning, and what it costs us, is D3 in
`05-decisions.md`.*

### Findings and interventions are separate

**Diagnostics measure. Playbooks recommend.**

A finding is arithmetic over the customer's data and would be identical for
anyone. An intervention is a curated recommendation matched to it. They render
as separate blocks with explicit provenance.

*Why:* presenting them together lets the recommendation borrow the
measurement's authority. See D8 in `05-decisions.md`.

### Impact and complexity never fuse into one score

Operational impact is measured. Implementation complexity is a declared property
of the intervention, uniform across tenants. They are shown side by side and
complexity never reorders the list.

*Why:* combining a measured money range with a declared complexity class
manufactures a number with no evidentiary basis. See D9 in `05-decisions.md`.

### Confidence gates magnitude

A finding never outranks one of a strictly higher grade, regardless of size.
Showing a flashy low-evidence finding above a solid one is how diagnostic
credibility dies.

### Suppress when the number would mislead; downgrade when it is sound but uncertain

A grade is a caveat, and a caveat on a headline is still a headline. "80% of your
overdue exposure is in one stage" reads as a finding whether or not it is
labelled B — and at three items it is a statement about three items.

The test: if a reader who fully understood the caveat would act the same way, a
grade suffices. If they would act on something the evidence cannot support,
suppress.

Every diagnostic must declare its minimum evidence, whether shortfall suppresses
or downgrades, and why.

---

## Vocabulary

### Closed unions are closed on purpose

`EvidenceWeakness`, `EvidenceSubject`, intervention primitives, comparability
aspects and stage kinds are closed. Extending one is a deliberate decision
recorded in an ADR.

`EventType` is deliberately **open**, so new analytics never require a
migration. The asymmetry is the point: analytics vocabulary should be cheap to
extend; the language the engine reasons in should not be.

### Every member earns its place from a real case

Do not add a vocabulary member for a case that has not occurred. Where a
vocabulary was derived from cases already present in the codebase, say so.

### Provider names never leave ingestion

Downstream code speaks the canonical model. A diagnostic asks "do I have
transition history?", never "is this ClickUp?".

*Enforced:* `dependency-cruiser` plus a test that fails the build if a provider
name appears anywhere in `packages/diagnostics` — including in a comment, since
a named platform in a comment is where the first special case gets written.

---

## Privacy and safety

### Logs carry booleans, enums and ids only

Never emails, tokens, salts, item titles, or customer content. A count is fine;
the value that produced it is not.

### Secrets are ciphertext at rest and never rendered

AES-256-GCM, decrypted only at the moment of use.

### Tenancy law

Every application query is tenant-scoped. The single sanctioned exception is the
admin console's `admin*` methods: cross-tenant, allowlist-gated, fully audited,
and pinned by tests asserting no secret or raw financial content appears in any
console projection.

### Fail closed

When a guard is uncertain, withhold. A false positive withholds a report, which
is visible and recoverable; a false negative leaks, which is not.

### `partner-runs/` is real customer data

Git-ignored. Never commit it, never print raw actor values, never let findings
leave the machine.

---

## Building

### Refactor because reality demands it, not because you can already imagine it

The governing rule. An abstraction with one caller is a liability. Where debt is
known but not yet worth paying down, record it with **the trigger that makes it
worth doing** rather than acting speculatively.

### Root cause, not workarounds

### Verify actual state before acting

Do not assume auth, configuration, or production behaviour. Check.

*This has cost real time.* A stale internal note contradicted the code and was
believed; it cost a milestone's premise. The note is still wrong and still on the
machine — R5 in `06-known-risks.md`.

### The gate is the approval mechanism

`pnpm check` — typecheck, lint, format, boundaries, tests — before any deploy.
A gate that fails intermittently stops being read, so a flaky test is a bug in
the test.

### Deploy is push to `main`

There is no separate deploy step and no staging environment. Confirm before
pushing, and verify the deployed commit on both replicas afterwards.
