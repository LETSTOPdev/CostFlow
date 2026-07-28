# Working on CostFlow

Deterministic Business Friction Intelligence. Live in production at
https://app.fbx1.com.

## Read these, in order

1. **[`docs/README.md`](docs/README.md)** — how the documentation works
2. **[`docs/00-project-brief.md`](docs/00-project-brief.md)** — what this is,
   under five minutes
3. **[`docs/09-ai-context.md`](docs/09-ai-context.md)** — **how to work here**

`docs/` is the canonical source of truth for the current state of the project.
`09-ai-context.md` is the operational guide: verification, architecture reviews,
implementation quality, the Definition of Done, deployment verification, and the
mistakes that have actually been made here. **All process guidance lives there.**

## The four that bite

- **Deploy is `git push origin main`.** No staging. `pnpm check` first, on the
  combined tree after `git fetch` — another session pushes here.
- **The engine is frozen.** Golden artifacts are compared byte for byte.
  Changing engine output needs `pnpm golden:update` and a stated reason.
- **Source code cites `doc 07 §1.2`, `doc 14 FS-4`.** Those mean
  `docs/reference/NN-*.md`, not the living `docs/0N-*.md`. Do not renumber them.
- **When documentation and code disagree, the code is the evidence.**
  Investigate, then fix the documentation — that is part of finishing the task.
