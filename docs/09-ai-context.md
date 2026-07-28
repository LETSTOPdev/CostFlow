# Working on this repository

The operational guide for any AI assistant working on CostFlow. Not about the
product — about how to work here.

Everything about *what the system is* lives in the other documents. This one is
about *how you behave*.

---

## 1. Starting a session

Read, in this order:

1. **`CLAUDE.md`** (repo root) — one screen. What this project is and the rules
   that bite.
2. **`docs/README.md`** — how the documentation is organised and maintained.
3. **`docs/00-project-brief.md`** — under five minutes. What CostFlow is, where
   it stands, what is next.
4. **This document** — how to work.

That is enough to be productive. Read further only when the task requires it:

| Task | Read |
|---|---|
| Touching the engine, adding a package | `01-architecture.md` |
| Anything about numbers, attribution, vocabulary | `04-engineering-principles.md` |
| Wondering why something is the way it is | `05-decisions.md` |
| Adding tests, changing the gate | `07-testing.md` |
| Deploying, debugging production | `08-admin.md` |
| Planning work | `02-current-state.md`, `03-roadmap.md`, `06-known-risks.md` |

**Then orient yourself in the actual repository before writing anything.** Check
`git log --oneline -10`, `git status`, and whether `main` is in sync with
`origin`. Another session sometimes pushes here.

---

## 2. Verify, do not assume

**The code is the evidence. Documentation is a claim about the code.**

Before asserting how something works — in a plan, a review, or a message to the
founder — read the implementation. Not the comment above it, not a document, not
your memory of a previous session.

This is the single most valuable habit in this repository, and its absence has
been the most expensive mistake:

- A note in `partner-runs/` stated that a platform could not supply ordered
  transition history. The ingestion transform had been reconstructing it for
  months and a golden artifact proved it. Believing the note cost an entire
  milestone's premise, produced a wrong customer-facing message in production,
  and put a wrong assertion in a test with a confident comment explaining why it
  was right.
- A citation to `doc 18` sat in a test for a document that only ever existed on
  an archived branch.

**How to verify a claim:**

```bash
grep -rn "thing" --include="*.ts" packages apps    # find it
```

then read the function, not the comment. For behaviour that is hard to read,
run it: the goldens under `tools/golden/expected/` are real artifacts, and a
short `npx tsx` script against them answers most questions definitively.

**When documentation and code disagree, the code wins** — then fix the
documentation immediately, even if unrelated to your task. See §7.

---

## 3. Engineering philosophy, in one paragraph

Every number CostFlow shows must survive a hostile CFO. That single commitment
produces the rest: determinism over probability, never fabricating a value,
explaining every calculation, ranges rather than point estimates, and confidence
that names its own binding constraint. Attribution is structural — stages and
queues, never people — for reasons that are commercial and legal as well as
principled.

**The full set is `04-engineering-principles.md`. Read it before changing
anything that produces a number.** Several of its rules are enforced by CI in
ways that will fail your build for reasons that look mysterious otherwise.

---

## 4. Approaching architecture changes

**Propose before you build.** The founder works by approval gate: propose, get an
explicit go-ahead, implement, stop for review. Do not start a milestone
unprompted.

For anything structural — a new package, a change to the canonical model, a new
vocabulary, a change to how numbers are produced — write an architecture review
first. What it must contain:

- **What you verified in the code**, not what you assumed. Cite files and lines.
- **Which packages change**, and which are frozen and therefore need golden
  regeneration with a stated reason.
- **Every new type or contract**, and for each: *why does this belong in this
  layer rather than one higher or lower?* That question has repeatedly exposed
  designs that looked fine and were not.
- **Backwards compatibility** for stored artifacts, and whether a migration is
  needed.
- **What you are deliberately not doing**, and why.

Then stop and wait.

**Expect to be wrong, and welcome it.** The founder's pushback has repeatedly
been better reasoned than the proposal. On this project that has produced: the
attribution rule that resolved a conflict without amending an ADR, the rejection
of a provenance field that would have become a provider taxonomy in the domain,
the removal of a vocabulary member that described a mechanism rather than a
problem, and the separation of measured findings from selected recommendations.
None of those were in the first draft.

**Do not redesign approved architecture without concrete evidence.** Disagreeing
is fine; disagreeing on aesthetics is not. Bring a case from the code or from
real data.

---

## 5. Implementation quality

**Prefer implementation over abstraction.** An abstraction with one caller is a
liability. The governing rule: *refactor because reality demands it, not because
you can already imagine it.* Where you see debt that is not yet worth paying
down, record it with **the trigger that makes it worth doing** rather than acting
speculatively — `reference/20-oi1-retrospective.md` is the register, and it is
not a backlog.

**Root cause, not workarounds.** If a fix requires understanding something first,
understand it first.

**Match the surrounding code.** Comment density, naming, idiom. A file should not
announce that a different author wrote part of it.

**Comments explain why, not what.** The non-obvious reasoning, the constraint
that forced a shape, the thing that will look like a mistake to the next reader.
Where a rule is subtle, say what breaks if it is violated.

**Write the test that would have caught the bug**, and prove it: revert the fix,
watch it fail, restore. A test that passes on broken code is decoration.

**Enforce mechanically where you can.** Several rules here are enforced by tests
that inspect the source tree — provider names in the diagnostics package, doc
citations, dependency boundaries. One of them caught its own author. If a rule
matters and can be checked, check it.

**Never re-derive engine law at the edges.** Money arithmetic, range algebra,
confidence composition and tier ordering live in the engine and are imported.

---

## 6. Reviews

### Reviewing your own work before showing it

- Does every claim you are about to make hold against the code you just read?
- Did you run the full gate — `pnpm check` — not just the tests you touched?
- Did anything you changed make a document wrong? (§7)
- Are you reporting what actually happened, including what failed or was skipped?

### Reviewing code you did not write

Another session pushes to `main` here. Their commits become yours to verify the
moment you rebase onto them.

- **A new `Store` method needs contract-test coverage.** One arrived without it
  and contained a real production race that returned `undefined` typed as a
  record, which the caller dereferenced immediately.
- **Passing tests on the in-memory adapter prove little about Postgres.** Where
  an implementation has a failure mode the other cannot have, it needs its own
  test.
- **Check the gate was actually run.** A push once left `format:check` failing
  for everyone downstream.

### Reporting findings

State the defect, the concrete failure scenario, and the evidence. If you are
uncertain, say so rather than hedging with confident language. If you were wrong
earlier, correct it plainly in one sentence and move on.

---

## 7. The Definition of Done: documentation is part of it

**A task is not complete until the documentation reflects it.** This applies to
every milestone, feature, architectural decision, refactor, deployment, and
change in production behaviour — not only large ones.

1. **Update every affected document** under `docs/` before calling the work
   finished. Not a note promising to do it later.
2. **Delete what is now obsolete.** Do not accumulate history. If a sentence
   describes how things used to be, remove it.
3. **Keep documentation synchronised with the code.** They are one artifact in
   two forms.
4. **Fix documentation that no longer matches reality the moment you find it**,
   even if unrelated to your task.
5. **Never create hand-off documents, milestone summaries, or changelogs** unless
   explicitly asked. Rewrite the living documents instead. Git holds history.
6. **Keep `00-project-brief.md` under five minutes.** If it grows, move the
   detail into whichever document owns that subject.
7. **`reference/` and `adr/` are historical and are not rewritten.** See §8.
8. **The living documents `00`–`09` are the canonical source of truth.**

**Never write down a value that changes on most commits.** A passing-test count
and a deployed commit SHA were both tried and were wrong within the hour. Point
at the command or endpoint that answers authoritatively — `pnpm check`,
`/healthz`. A document that is usually slightly wrong is one nobody checks, and
then a real error hides in it.

### Which document owns what

| Changed | Update |
|---|---|
| Shipped a feature, deployed, changed production behaviour | `02-current-state.md` |
| Finished or added planned work | `03-roadmap.md` — **delete** finished milestones |
| Added a package, changed data flow or a core model | `01-architecture.md` |
| Made a decision with tradeoffs worth recording | `05-decisions.md`, and an ADR if load-bearing |
| Adopted a rule others must follow | `04-engineering-principles.md` |
| Discovered or resolved a risk | `06-known-risks.md` — **delete** resolved ones |
| Added a test suite or changed the gate | `07-testing.md` |
| Changed env vars, deploys, or debugging steps | `08-admin.md` |
| Changed how an assistant should work | this document |

Some of this is enforced by `apps/cli/test/docs-sync.test.ts`. Most is not, and
is your responsibility.

---

## 8. `reference/` and `adr/`

**Neither is a living document. Neither is rewritten.**

**`docs/reference/`** is the original design corpus — design notes from before
and during construction. Several hold reasoning that is still load-bearing and
reproduced nowhere else: the decision-layer design, the signal taxonomy's
four-test rule, the cost engine principles, the detector designs.

Treat them as **immutable historical references**. They may describe plans that
were never built or were built differently. When one contradicts the code, the
code is right and the *living* documents get corrected — not the reference.

> **Numbering trap.** Source code contains 162 citations of the form
> `doc 07 §1.2`, `doc 14 FS-4`, `doc 03 P4`. Those mean `docs/reference/NN-*.md`,
> never the living `docs/0N-*.md`. The reference files kept their original
> filenames precisely so those citations resolve. **Do not renumber, move, or
> delete them** — a test fails the build if a cited one disappears.

**`docs/adr/`** holds architecture decision records. An ADR captures a decision
at a point in time, with its context and consequences. It is **amended in place**
when a decision changes, never rewritten to look as though the original reasoning
never happened. Several are cited from source code.

Write a new ADR when a decision is load-bearing, hard to reverse, and would
otherwise be re-litigated. `05-decisions.md` indexes them and says what each
means today.

---

## 9. Deployment and production verification

**Deploy is `git push origin main`.** There is no separate deploy step and no
staging environment. Railway builds, runs migrations in a pre-deploy phase, and
gates on the healthcheck.

**Confirm before pushing.** Pushing is deploying. Treat it as an outward-facing,
hard-to-reverse action.

### Before pushing

1. `git fetch` and rebase if `origin/main` moved. Another session pushes here.
2. `pnpm check` green on the **combined** tree — their commits are yours to
   verify too.
3. If any golden changed, confirm it was intended and say why in the commit.
4. If the artifact shape changed, confirm every `report.md` is byte-identical.

### After pushing

Poll `/healthz` until it reports your SHA, then:

- **Probe roughly ten times.** Two replicas and a rolling deploy mean a single
  probe proves nothing — every response must carry the new commit.
- **CSP intact** — `script-src 'none'` still present.
- **Gated routes still gated** — `/reports/*` and `/admin` redirect or 404 for an
  unauthenticated caller.
- **`/brand/logo.svg` returns 200** — the Auth0 login page references it.

**State what you could not verify.** Anything requiring the operator's
credentials is theirs to check, not yours to attempt.

---

## 10. Never change these without strong evidence

Each is load-bearing and enforced. Changing one is a decision, not a refactor.

- **The frozen engine.** Golden artifacts are compared byte for byte. Changing
  engine behaviour requires `pnpm golden:update` **and a stated reason**.
- **The attribution guard.** Fail-closed, exact-substring, at the reporting
  layer. Any new surface rendering evidence must route through it.
- **Tenancy scoping.** Every query is tenant-scoped. The admin console's
  cross-tenant methods are the one sanctioned exception, and they are
  allowlist-gated and audited.
- **Zero client JavaScript and `script-src 'none'`.**
- **Closed vocabularies** — evidence weaknesses and subjects, intervention
  primitives, comparability aspects, stage kinds. Extending one is an ADR-level
  decision. (`EventType` is deliberately open; the asymmetry is the point.)
- **`/brand/logo.svg`** — an Auth0 URL contract. Never move or rename it.
- **Pure-package purity and the dependency direction.**
- **Log content: booleans, enums, ids and counts only.** Never emails, tokens,
  salts, titles, or customer content.
- **`partner-runs/` stays local.** Real customer data, git-ignored. Never commit
  it, never print raw actor values.

---

## 11. Common mistakes

Every one of these has actually happened here.

**Trusting a document over the code.** The most expensive mistake available. See
§2.

**Renumbering or moving `docs/reference/`.** 162 source comments cite those files
by number, and the compiler cannot check a comment.

**Writing a volatile value into documentation.** A test count or deployed SHA is
wrong within the hour.

**Assuming the in-memory adapter proves the Postgres path.** It cannot. Their
failure modes differ by construction.

**Measuring a proxy instead of the property.** A budget test measured wall-clock
time and was really measuring scheduler contention; it failed at random until it
measured CPU time instead. A gate that fails randomly stops being read.

**Ordering by magnitude without gating on confidence.** A flashy low-evidence
finding above a solid one is how credibility dies. Confidence gates first,
always.

**Adding a vocabulary member for a mechanism.** A new member must name a
different *problem*, not a different *cause of a problem already named* — that
grows the vocabulary once per platform quirk.

**Pushing without fetching.** A concurrent session pushes here.

**Re-deriving engine law in a renderer.** Confidence tiers were once sorted by
letter, correct only by the coincidence that A/B/C run strongest to weakest.

**Defaulting absent to empty.** A field missing from a stored artifact means
*unknown*, not *nothing was found*. Defaulting retroactively certifies data
nobody checked.

**Building the thing that already exists.** Check `02-current-state.md` and the
routes before starting. The admin console was nearly rebuilt.

---

## 12. Tone and reporting

Write for a founder who reads carefully and dislikes padding.

- Lead with the finding, not the process that produced it.
- Report outcomes faithfully. If tests failed, say so with the output. If you
  skipped something, say that.
- No hedging on things you verified; no confidence on things you did not.
- Corrections are one sentence, then move on. Do not ruminate.
- **Product copy and prose to the founder:** no em or en dashes, no bullet
  separators, no ellipses. Internal documents and ADRs use them freely — match
  the surrounding file.
