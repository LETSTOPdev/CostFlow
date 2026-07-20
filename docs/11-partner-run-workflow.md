# 11 — Processing a Real Partner Dataset Safely (M0 CLI Workflow)

This is the operational procedure for running CostFlow on a real external
dataset during the M0/M1 overlap. It exists so that the first partner run is a
checklist, not an improvisation. **Real customer data never enters this
repository** — no fixture, no test, no "temporary" file.

## 1. Required files

| File | Source | Contains |
|---|---|---|
| `items.csv` | Partner's board export (e.g., Monday) | Work items: id, title, status, owner, dates |
| `events.csv` *(optional)* | Partner's activity-log export | Status transitions: item id, from, to, timestamp |
| `mapping.json` | Written by us with the partner | Column mapping, status → stage-kind map, **actorRoleMap**, optional `events` section |
| `assumptions.json` | Written with the partner | Currency, rate cards, thresholds, attention ranges — customer-owned (doc 03 P4) |
| `salt.txt` | Generated per org, once | The pseudonymization salt (see §3) |

Keep all partner files in a dedicated directory OUTSIDE any git repository,
e.g. `~/partners/<org>/2026-07-20/`.

## 2. Mapping configuration

1. Start from [tools/golden/fixtures/mapping.json](../tools/golden/fixtures/mapping.json)
   as a shape reference (synthetic data only — never copy partner values into
   the repo).
2. Map `columns`: item id, title, status, actor (owner/assignee), dates.
3. Map every status value in the export to a `stage_kind`
   (`queue | active | review | blocked | done | abandoned`). Unmapped statuses
   drop rows visibly; the import diagnostics will tell you which.
4. **actorRoleMap**: with the partner, map each actor value (names, emails,
   team aliases) to a business role that exists in the rate cards, e.g.
   `"Sarah Cohen": "Legal"`. Anything left unmapped is pseudonymized — it will
   price at the default rate with confidence capped at C, so map what matters.
5. If an event export exists, add the `events` section (item id, from
   *(optional)*, to, timestamp columns). Timestamps must be ISO-8601 (M0
   limitation D-8 — transform the export first if needed, and record what you
   did).

## 3. Pseudonymization context handling

- Generate a salt once per organization:
  `openssl rand -hex 32 > ~/partners/<org>/salt.txt` — then treat it like a
  credential: never in the repo, never on the command line (only via
  `--salt-file`), never in chat/tickets.
- Pick a stable `--org` scope id (e.g., `acme-prod`). Same org + same salt →
  stable pseudonyms across runs (trend analysis works). Different orgs must
  have different salts — that is what makes pseudonyms unlinkable across
  customers.
- Losing the salt is acceptable (pseudonyms rotate on the next run); leaking
  it is not (it enables brute-force re-identification of name-shaped values).
- The salt participates in the default run-id derivation; the artifacts store
  only the scope id and `anon-<hex>` pseudonyms.

## 4. Running the analysis

```bash
# F2-only (no event history):
pnpm costflow analyze \
  --csv ~/partners/acme/2026-07-20/items.csv \
  --mapping ~/partners/acme/mapping.json \
  --assumptions ~/partners/acme/assumptions.json \
  --org acme-prod --salt-file ~/partners/acme/salt.txt \
  --now 2026-07-20T00:00:00Z \
  --out ~/partners/acme/2026-07-20/out

# With event history (adds F1 queue-wait):
pnpm costflow analyze \
  --csv ~/partners/acme/2026-07-20/items.csv \
  --events ~/partners/acme/2026-07-20/events.csv \
  --mapping ~/partners/acme/mapping.json \
  --assumptions ~/partners/acme/assumptions.json \
  --org acme-prod --salt-file ~/partners/acme/salt.txt \
  --now 2026-07-20T00:00:00Z \
  --out ~/partners/acme/2026-07-20/out
```

Pass an explicit `--now` (the export's date, midnight UTC) so re-runs are
reproducible and aging numbers don't drift with the wall clock.

## 5. Validation behavior — what will stop you, and what degrades

**Hard failures (exit 1, fix the input):** unparseable `--now`; missing or
duplicate *mapped* CSV header columns; mapping/assumption files that fail
schema validation (unknown keys included); actor column mapped without
`--org`/`--salt-file`; and any event-history problem — unknown item ids,
non-ISO timestamps, statuses missing from `statusMap`, `from`-chain
mismatches, events before item creation, duplicate item ids when events are
present. Event history is validated strictly and never silently repaired.

**Visible degradation (run proceeds, honestly):** rows with unmapped statuses
drop with diagnostics; bad item dates null the field with a warning; missing
event history skips F1 with the reason on the report; a missing
`queueWaitAttentionHoursPerDay` assumption leaves queue-wait frictions in the
"Unpriced frictions" section with the missing input named.

Read the report's **Data** and **Detectors** sections first in every session —
they say what the data supported.

## 6. Generated artifacts

- `out/run.json` — the immutable analysis run: canonical items (actors as
  roles/pseudonyms only), events, assumptions, detector outcomes, pricing
  outcomes, estimates with full formula traces. **Treat as confidential**: it
  contains work-item titles and the partner's rate card.
- `out/report.md` — the human-readable report (same confidentiality).

## 7. What is deliberately NOT retained

- Raw actor identifiers (names, emails, usernames, team aliases) — replaced by
  role refs or `anon-<hex>` pseudonyms at import; they exist in no artifact,
  warning, log, or trace.
- The salt — never copied anywhere; artifacts carry only the scope id.
- CostFlow keeps no copy of the partner's CSVs: the only outputs are the two
  artifact files you direct with `--out`.

Known retention caveat (say it to the partner): work-item **titles** are
retained in artifacts and may themselves contain personal data. If that is a
concern, have the partner strip/rename the title column before export, or map
a different column as `title`.

## 8. Deletion procedure (end of engagement, or on request)

```bash
rm -rf ~/partners/<org>/            # raw exports, salt, artifacts
```

Then verify: `ls ~/partners/<org>` errors; check `~/.zsh_history` for
accidentally pasted data paths with content (salts never appear on the
command line if this workflow was followed); empty the OS trash if the files
ever touched it. If artifacts were shared (e.g., the report sent back to the
partner), that copy is theirs; ours are gone. Record the deletion date in the
engagement notes.
