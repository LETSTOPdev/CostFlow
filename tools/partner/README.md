# Partner-run toolkit (M1 concierge)

Operational material for running CostFlow on a real external dataset, per
[docs/11-partner-run-workflow.md](../../docs/11-partner-run-workflow.md).
Everything here is data-free and committable; everything under
`partner-runs/` is git-ignored and never committed (guardrail test:
`apps/cli/test/partner-guardrail.test.ts`).

## Session flow

```
./tools/partner/new-run.sh <partner-code>     # scaffold + salt + templates
# drop raw exports into partner-runs/<code>/raw/  (originals, never edited)
# fill partner-runs/<code>/config/{mapping.json,assumptions.json} with partner
# follow partner-runs/<code>/notes/intake-checklist.md — passes 1..5 in order
./tools/partner/verify-privacy.sh <values-file> <output-paths...>
./tools/partner/cleanup.sh <partner-code>     # end of engagement / on request
```

| File                        | Purpose                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new-run.sh`                | Creates `partner-runs/<code>/{raw,config,output,notes}`, generates the org salt, copies templates, and verifies the directory is git-ignored before doing anything else |
| `intake-checklist.md`       | The pass-by-pass session procedure (copied into `notes/`)                                                                                                               |
| `findings-memo-template.md` | The findings memo skeleton (copied into `notes/`)                                                                                                                       |
| `run-commands.sh.template`  | Command sequence for preflight / F2-only / F1+F2 / reproducibility (copied into `config/run.sh`)                                                                        |
| `verify-privacy.sh`         | Greps outputs for raw actor values from a local values file; prints counts only, never values                                                                           |
| `cleanup.sh`                | Deletes a partner directory with confirmation and verifies absence                                                                                                      |

## Hard rules (repeated because they matter)

- Raw actor values never appear in: commits, docs, tests, logs kept outside
  `partner-runs/`, chat summaries, or this toolkit.
- The salt stays in `partner-runs/<code>/config/salt.txt`, referenced only via
  `--salt-file`. Never on argv, never pasted anywhere.
- `--now` is pinned to the export cutoff date, never the machine clock.
- Validation is never relaxed mid-session to make a report happen. A failed
  pass is a finding, not an obstacle.
