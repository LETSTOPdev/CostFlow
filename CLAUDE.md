# Working on CostFlow

**Read [`docs/00-project-brief.md`](docs/00-project-brief.md) first.** Under five
minutes, and it explains what everything else is for.

[`docs/`](docs/README.md) is the canonical source of truth. It describes the
current state, never the history.

## Definition of Done

**Updating the documentation is part of finishing the work, not a follow-up.**

For every milestone, feature, architectural decision, refactor, deployment, or
change in production behaviour, before calling it complete:

- Update every affected document under `docs/`.
- Delete what is now obsolete rather than appending to it.
- Fix any documentation you notice no longer matches reality, even if unrelated
  to your task.
- Keep `00-project-brief.md` readable in under five minutes.
- Do **not** write hand-off documents, milestone summaries, or changelogs unless
  explicitly asked.
- `docs/reference/` and `docs/adr/` are historical and are not rewritten.

Then re-read what you changed and ask whether a stranger reading only these
documents would have an accurate picture.

The full rules are in [`docs/README.md`](docs/README.md).

## Things that will bite you

- **Deploy is `git push origin main`.** No staging. Run `pnpm check` first, on
  the combined tree after `git fetch` — another session sometimes pushes here.
  Verify `/healthz` reports your SHA on both replicas afterwards.
- **The engine is frozen.** Golden artifacts are compared byte for byte.
  Changing anything under `packages/` that affects output requires
  `pnpm golden:update` and a stated reason.
- **Source code cites `doc 07 §1.2`, `doc 14 FS-4`, `doc 03 P4`.** Those mean
  `docs/reference/NN-*.md`, not the living `docs/0N-*.md`. Do not renumber the
  reference files.
- **When documentation and code disagree, the code is the evidence.**
  Investigate, then fix the documentation.
