# CostFlow engineering documentation

Internal engineering documentation. Not customer-facing.

Its purpose is to let a completely new AI session understand this project and
become productive without any prior chat history. **These documents are the
canonical source of truth for the current state of the project.**

They describe **now**, never history. They are rewritten in place rather than
appended to; git holds the history.

## Start here

1. [`../CLAUDE.md`](../CLAUDE.md) — one screen
2. **this file** — how the documentation is organised
3. [`00-project-brief.md`](00-project-brief.md) — what CostFlow is, under five minutes
4. [`09-ai-context.md`](09-ai-context.md) — **how to work on this repository**

`09-ai-context.md` is the operational guide: verification, architecture reviews,
implementation quality, the Definition of Done, deployment verification, and the
mistakes that have actually been made here. **Every rule about how to work lives
there and nowhere else** — the other documents describe the system, not the
process.

## The living documents

| File | Single responsibility |
|---|---|
| [`00-project-brief.md`](00-project-brief.md) | What CostFlow is and where it stands. **Read first.** |
| [`01-architecture.md`](01-architecture.md) | Stable architecture. No temporary detail. |
| [`02-current-state.md`](02-current-state.md) | What is true today: shipped, deployed, in progress. |
| [`03-roadmap.md`](03-roadmap.md) | Future work only. Finished milestones are deleted. |
| [`04-engineering-principles.md`](04-engineering-principles.md) | What the system believes about numbers, attribution and vocabulary. |
| [`05-decisions.md`](05-decisions.md) | Permanent decisions with reasons, tradeoffs, consequences. **Rare by design.** |
| [`06-known-risks.md`](06-known-risks.md) | Active risks only. Resolved ones are deleted. |
| [`07-testing.md`](07-testing.md) | What the test suites are and what the gate guarantees. |
| [`08-admin.md`](08-admin.md) | Running it: deploys, env vars, debugging production. |
| [`09-ai-context.md`](09-ai-context.md) | How an AI assistant should work here. |

## Two directories that are NOT living documents

**[`adr/`](adr)** — architecture decision records, amended in place rather than
rewritten. Several are cited from source code.

**[`reference/`](reference)** — the original design corpus (`00`–`21` plus
`BIBLE.md`), immutable. Several hold reasoning still load-bearing and reproduced
nowhere else.

> **Numbering trap.** Source code cites those as `doc 07 §1.2`, `doc 14 FS-4`,
> `doc 03 P4` — meaning `reference/NN-*.md`, never the living documents above.
> Do not renumber or move them; a test fails the build if a cited one disappears.

How to treat both is in [`09-ai-context.md` §8](09-ai-context.md).

## Maintaining these documents

Updating them is part of the Definition of Done for every task, not a follow-up.
The rules, and which document owns what, are in
[`09-ai-context.md` §7](09-ai-context.md).

`apps/cli/test/docs-sync.test.ts` enforces the mechanically checkable parts.
