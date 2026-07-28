# CostFlow engineering documentation

Internal engineering documentation. Not customer-facing.

Its purpose is to let a completely new AI session understand the current state of
this project without any prior chat history. **These documents are the canonical
source of truth.**

## Definition of Done

**A task is not complete until the documentation reflects it.** This applies to
every milestone, feature, architectural decision, refactor, deployment, and
change in production behaviour — not only to large ones.

Before you call anything finished:

1. **Update every affected document.** Not a note promising to update it later.
2. **Remove what is now obsolete.** Do not accumulate history. If a sentence
   describes how things used to be, delete it.
3. **Keep the documentation synchronised with the code.** They are one artifact
   in two forms.
4. **Fix documentation that no longer matches reality the moment you find it**,
   even if it is unrelated to what you were doing. A stale document is worse
   than a missing one, because it is believed. This has already cost this
   project a milestone's premise once.
5. **Do not create hand-off documents, milestone summaries, or changelogs**
   unless explicitly asked. Rewrite these documents instead. Git holds history.
6. **Keep `00-project-brief.md` under five minutes to read.** It is the entry
   point for every future session; if it grows, move detail into the document
   that owns it.
7. **`reference/` and `adr/` are historical and are not rewritten.** Reference
   documents are immutable design notes. ADRs are decision records, amended in
   place rather than rewritten.
8. **The living documents in this folder are the canonical source of truth for
   the current state of the project.**

Then do a final pass: read what you changed and ask whether a stranger reading
only these documents would now have an accurate picture. If not, you are not
done.

Some of this is enforced by `apps/cli/test/docs-sync.test.ts`, which fails the
build when the documentation and the codebase disagree in ways a test can see.
Most of it is not mechanically checkable and is your responsibility.

## For any AI assistant working on this project

1. **Read `00-project-brief.md` first.** Always. It is under five minutes and it
   tells you what everything else is for.
2. **Never redesign previously approved architecture without concrete evidence.**
   The decisions in `05-decisions.md` were reasoned through and are load-bearing.
   Disagreeing with one is fine; doing so without evidence from the code or from
   real data is not.
3. **Prefer implementation over abstraction.** The governing rule of this
   codebase: *refactor because reality demands it, not because you can already
   imagine it.* An abstraction with one caller is a liability.
4. **Update the documentation after every completed milestone.** Not as a final
   chore — as part of the milestone.
5. **Treat these documents as canonical truth.**
6. **If documentation and code disagree, the code is the evidence.** Investigate,
   determine the real behaviour, then correct the documentation. Do not assume
   either one is right. This has mattered here: a stale note once cost a
   milestone's entire premise.
7. **Do not write temporary notes, historical summaries, hand-off documents, or
   changelogs.** Rewrite these documents in place so they always describe NOW.
   Git already stores history; duplicating it here makes the docs untrustworthy.
8. **Keep it concise and current.** A long document nobody finishes is worse
   than a short one everybody does.

## The documents

| File | Single responsibility |
|---|---|
| `00-project-brief.md` | What CostFlow is and where it stands. **Read first.** |
| `01-architecture.md` | Stable architecture only. No temporary detail. |
| `02-current-state.md` | What is true today: shipped, deployed, in progress. |
| `03-roadmap.md` | Future work only. Finished milestones are deleted, not archived. |
| `04-engineering-principles.md` | Rules we follow on purpose, and why. |
| `05-decisions.md` | Permanent architectural decisions with tradeoffs. |
| `06-known-risks.md` | Active risks only. Resolved ones are deleted. |
| `07-testing.md` | Testing philosophy and what the gate guarantees. |
| `08-admin.md` | Running it: deploys, env vars, debugging production. |

## Two directories that are NOT living documents

**`adr/`** — Architecture Decision Records, numbered and immutable by
convention. An ADR records a decision at a point in time and is amended in
place rather than rewritten. `05-decisions.md` indexes them and states what each
one means today; the ADRs themselves carry the full reasoning. Several are cited
directly from source code.

**`reference/`** — the original design corpus (`00`–`21` plus `BIBLE.md`).
These are design notes, not current-state documents, and several contain
reasoning that is still load-bearing and not reproduced elsewhere: the decision
layer design, the signal taxonomy, the cost engine principles, the detector
designs.

> **Numbering note.** Source code contains 162 references of the form `doc 07
> §1.2`, `doc 14 FS-4`, `doc 03 P4`. Those all mean `reference/NN-*.md`, never
> the living documents in this folder. The reference files kept their original
> filenames precisely so those citations still resolve. When you write a new
> citation, use the full path.
