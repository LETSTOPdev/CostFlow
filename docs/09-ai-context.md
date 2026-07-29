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
documentation immediately, even if unrelated to your task. See §8.

---

## 3. Start as a customer, not as an engineer

**Every milestone begins by looking at the product, before reading any
architecture.** Founder directive, 2026-07-28. In this order:

1. **The rendered UI** — the actual HTML a signed-in customer receives.
2. **The exported report** — `/reports/:runId/print`, the surface that gets
   forwarded to people who never opened CostFlow.
3. **Onboarding** — connect, scope, statuses, actors, assumptions, in sequence.
4. **The dashboard** — what a returning user sees first.

Only then the implementation.

**Why this is a rule and not a preference.** The last milestone found a defect
that no amount of reading the architecture would have surfaced: the printable
export never rendered the recommendations at all, and on the report page they
came last, after the methodology. Both facts lived in the ORDER of a template
literal and the argument list of two call sites. The architecture was correct
and the product was wrong.

**The product experience is the primary design input. Architecture exists to
support it, not the other way around.** When the two disagree about what to
build next, the experience wins and the architecture changes.

### The milestone loop

> **Read `03-roadmap.md` first.** As of 2026-07-29 the build phase is complete
> and the product is feature-complete: the current phase is Design Partner
> Validation, and **new capabilities are not to be started**. The loop below
> still governs anything that does get built — a defect a real customer hit, a
> clarity fix, a fault found by the ritual — but "implement the highest-impact
> items" no longer means shipping features nobody has asked for yet. Where you
> would once have proposed a capability, propose reading what real usage says
> instead, and name the observation any proposal came from.

Founder directive, 2026-07-28: act as Product & Technical Lead. Do not wait for
every UX issue to be named. Each milestone runs:

1. **The cold-start walkthrough** (below). Not optional, and it comes first.
2. Rank the observations by customer impact, not engineering elegance.
3. Investigate the implementation before proposing anything.
4. Implement the highest-impact items that need no product-policy decision.
5. Stop and present trade-offs ONLY for a genuine product decision, or when
   there are several valid architectural directions.
6. Otherwise continue through implementation, testing, deployment and
   documentation without interrupting.

### The cold-start walkthrough — a permanent ritual

**Before every milestone**, run `pnpm preview` and go through the whole product
as though seeing it for the first time.

**Do not look for bugs.** Look for the moments where an executive would
hesitate, misunderstand something, stop reading, lose confidence, or fail to
immediately understand the value. Those are different from defects and mostly
invisible to a test suite.

Record every observation, then classify each one:

| | |
|---|---|
| **Confusing** | It is there and it works, but the reader cannot tell what it means or what to do with it. |
| **Missing** | The reader needs something at this moment and it does not exist. |
| **Incorrect** | It states or implies something untrue, or is right but reads as wrong. |
| **Low-value** | It occupies attention it does not earn. Removing it is the fix. |

Then, of every screen, ask the question that outranks all the others:

> **"If I were the CEO of this company, would I immediately know what to do
> after reading this screen?"**

**If the answer is no, explain why before writing any code.** The explanation is
the work; the fix is downstream of it. An observation you cannot articulate is
one you do not understand yet.

Then, immediately, the second question:

> **"Why should the CEO trust this recommendation?"**

**If the answer is not obvious from the screen itself, improve the screen before
improving the engine.** Every recommendation earns the reader's trust before it
asks for action, and the executive should never have to INFER why CostFlow
reached its conclusion. A correct recommendation nobody believes is worth
nothing, and belief is a property of the screen, not of the arithmetic behind
it. "It is traceable if you open the drill-down" is not an answer — the basis
has to be legible where the claim is made.

**Fix the highest-impact observations before extending the engine.**

Then rank what survives against the four adoption outcomes (founder directive,
2026-07-29; stated in full in `03-roadmap.md`). **Say which one an improvement
serves when you propose it:**

1. Increase a customer's confidence.
2. Reduce onboarding friction.
3. Improve the quality of the first report.
4. Increase the likelihood of a second analysis.

If it serves none of them, question whether it should be built now at all. And
when a proposal depends on a belief about how customers behave rather than on
something observed, it is an **assumption** — add it to *Unvalidated assumptions*
in `06-known-risks.md` and do not build around it. Marking one is finishing the
thought, not deferring the work.

Two standards to hold. **The product should be easier to understand than it is
to explain** — if explaining a screen takes longer than reading it, the screen
is wrong. And the North Star in `00-project-brief.md`: under two minutes, and
complete confidence about the single highest-impact next action.

The question to optimise against, every time:

> **"If an executive opened CostFlow for the first time today, what would
> prevent them from immediately understanding its value?"**

The goal is that every screen makes an executive think *this tells me exactly
what I need to do next*.

### How to actually see it

```
pnpm preview
```

There is also a `costflow-preview` entry in `.claude/launch.json` pointing at the
same script, so a preview tool that reads launch configurations opens the stub
server rather than `costflow-web`, which wires the real gateways and cannot get
past `/connect` without a live provider token.

The real server on `http://127.0.0.1:3901` — same `buildServer`, routes,
templates and CSP as production — with the test stub gateways in place of the
HTTP ones. Sign in at `/login` with any email, connect ClickUp with any token
starting `pk_`, and walk the funnel. The ClickUp stub serves a Space → Folder →
List hierarchy, so container selection, path-aware search and per-origin
attribution all have something real to act on. Source and rationale in
`apps/web/test/preview.ts`.

That substitution is the point: the dev server in `.claude/launch.json` wires the
REAL gateways, so without a live provider token you cannot get past `/connect`,
which is exactly where looking at the product stops being possible.

Drive it with `curl -c/-b` on a cookie jar and read the HTML — strip the tags and
print the text. What you are checking is the ORDER and the WORDS, which plain
text shows more clearly than a screenshot does. Note that the in-app browser
reliably hangs navigating to `file://`, so saving a page and opening it is not a
route.

Rendering through a test works too, and is cheaper for a single surface.

---

## 4. Engineering philosophy, in one paragraph

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

## 5. Approaching architecture changes

**Look at the product first (§3).** An architecture review that opens with the
canonical model rather than with what a customer sees has started in the wrong
place.

**Operate autonomously; interrupt only for these three.** Founder directive,
2026-07-28, superseding the earlier propose-and-wait default:

1. **A genuine product decision** — one the project's principles cannot settle.
   Bring the trade-offs, not a recommendation dressed as a question.
2. **Several architectural directions with meaningful trade-offs.** Not "two ways
   to write this"; two futures the codebase would live in.
3. **Customer feedback that contradicts a current assumption.** That outranks
   everything, including a decision already made.

Everything else runs to completion: implementation, tests, deploy, verify, docs.
The bar for interrupting is that the answer changes what gets built, and cannot
be inferred from `04-engineering-principles.md`, `05-decisions.md`, or the North
Star. Notice the asymmetry — shipping something wrong is recoverable in one
commit; asking the founder to adjudicate what you could have reasoned out costs
them the thing autonomy was meant to buy.

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

## 6. Implementation quality

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

## 7. Reviews

### Reviewing your own work before showing it

- Does every claim you are about to make hold against the code you just read?
- Did you run the full gate — `pnpm check` — not just the tests you touched?
- Did anything you changed make a document wrong? (§8)
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

## 8. The Definition of Done: documentation is part of it

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
7. **`reference/` and `adr/` are historical and are not rewritten.** See §9.
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
| Made a decision that will shape future architecture, product strategy or a recurring choice | `05-decisions.md` — **rare**; plus an ADR if also load-bearing and hard to reverse |
| Adopted a rule others must follow | `04-engineering-principles.md` |
| Discovered or resolved a risk | `06-known-risks.md` — **delete** resolved ones |
| Added a test suite or changed the gate | `07-testing.md` |
| Changed env vars, deploys, or debugging steps | `08-admin.md` |
| Changed how an assistant should work | this document |

Some of this is enforced by `apps/cli/test/docs-sync.test.ts`. Most is not, and
is your responsibility.

**A decision record is exceptional.** `05-decisions.md` keeps its authority by
staying short, so most good work produces none. A UX refinement or an
implementation improvement is not a decision — the commit message, the test that
pins the behaviour, and `02-current-state.md` already carry it. A rule others
must follow is a principle, not a decision. Before writing a record, ask whether
a session a year from now would be worse off without it; if the honest answer is
no, the work is still done. Nine were written in a single session once, five of
which were refinements of the other four, and the document was harder to trust
for it.

---

## 9. `reference/` and `adr/`

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

## 10. Deployment and production verification

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

## 11. Never change these without strong evidence

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

## 12. Common mistakes

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

## 13. Tone and reporting

Write for a founder who reads carefully and dislikes padding.

- Lead with the finding, not the process that produced it.
- Report outcomes faithfully. If tests failed, say so with the output. If you
  skipped something, say that.
- No hedging on things you verified; no confidence on things you did not.
- Corrections are one sentence, then move on. Do not ruminate.
- **Product copy and prose to the founder:** no em or en dashes, no bullet
  separators, no ellipses. Internal documents and ADRs use them freely — match
  the surrounding file.
