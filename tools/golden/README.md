# Golden datasets — the engines' constitution

`fixtures/` holds the input CSVs, raw provider pages, mapping templates,
assumption sets, and the synthetic pseudonymization salt. `expected/<fixture>/`
holds the frozen outputs (`run.json`, `report.md`, `telemetry.jsonl`) that CI
compares byte-exactly against every pipeline run (NFR-1). Six fixtures:
`demo-ops` (CSV snapshot-only, F2 + visible F1 skip), `demo-flow` (CSV items +
event history, multi-signal), and one per connector — `demo-jira`,
`demo-monday`, `demo-asana`, `demo-clickup` — each transforming realistic raw
API pages through its provider transform (the SPI promise tests). All actor
values in fixtures are synthetic; the privacy test asserts none of them reach
expected outputs.

## Rules

1. **Never hand-edit anything in `expected/`.**
2. Regeneration is a deliberate act (roadmap IR2), only via:

   ```
   pnpm golden:update
   ```

3. A PR that regenerates golden output must:
   - state **why** the output changed (which engine/renderer change caused it),
   - include the relevant version bump on the engine or model that changed
     (doc 05 A4),
   - show the diff of `expected/` in the PR description.
4. "No golden changes" is an explicit claim in every PR touching `domain`,
   `friction`, `cost-engine`, `analysis`, or `reporting` — say it even when
   the diff is empty.
