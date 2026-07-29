# CostFlow

Deterministic Business Friction Intelligence. CostFlow reads a team's
work-tracker data and answers three questions: what is going wrong, what it
costs, and where attention should go — with every figure traceable to the
assumption that produced it.

Live at **https://app.fbx1.com**. The public site is **https://fbx1.com**.

---

## Documentation

**Start at [`docs/00-project-brief.md`](docs/00-project-brief.md).** It is under
five minutes and explains what everything else is for.

[`docs/`](docs/README.md) is the canonical source of truth for this project. It
describes the current state, not the history — the documents are rewritten in
place rather than appended to. Git holds the history.

|                                                                          |                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| [`docs/00-project-brief.md`](docs/00-project-brief.md)                   | **Read first.** What this is and where it stands. |
| [`docs/01-architecture.md`](docs/01-architecture.md)                     | How the system fits together.                     |
| [`docs/02-current-state.md`](docs/02-current-state.md)                   | What is true today.                               |
| [`docs/03-roadmap.md`](docs/03-roadmap.md)                               | What is planned, and why.                         |
| [`docs/04-engineering-principles.md`](docs/04-engineering-principles.md) | Rules we follow on purpose.                       |
| [`docs/05-decisions.md`](docs/05-decisions.md)                           | Why things are the way they are.                  |
| [`docs/06-known-risks.md`](docs/06-known-risks.md)                       | What could go wrong.                              |
| [`docs/07-testing.md`](docs/07-testing.md)                               | How correctness is enforced.                      |
| [`docs/08-admin.md`](docs/08-admin.md)                                   | Deploying and debugging production.               |

[`docs/adr/`](docs/adr) holds architecture decision records, several cited
directly from source code. [`docs/reference/`](docs/reference) holds the original
design corpus — design notes rather than current-state documents, still
load-bearing for the decision layer, the signal taxonomy, and the detector
designs.

> Source code cites those reference documents as `doc 07 §1.2`, `doc 14 FS-4`,
> `doc 03 P4`. Those mean `docs/reference/NN-*.md`, never the numbered documents
> above.

## Working on it

```bash
pnpm install
pnpm check      # typecheck, lint, format, boundaries, tests
```

`pnpm check` is the gate. It runs before any deploy, and **deploy is a push to
`main`** — there is no separate deploy step and no staging environment. One push
deploys both sides: Railway builds the application, Vercel builds the marketing
site.

Run an analysis from the command line against a fixture:

```bash
pnpm costflow analyze --csv tools/golden/fixtures/demo-ops.csv --mapping tools/golden/fixtures/mapping.json --assumptions tools/golden/fixtures/assumptions.json --org demo --salt-file tools/golden/fixtures/salt.txt
```

## For AI assistants

Read [`docs/README.md`](docs/README.md) before making changes. It states how
these documents are maintained and what is expected of you — in particular that
the documentation is updated as part of each milestone rather than afterwards,
and that when documentation and code disagree, the code is the evidence.
