# CostFlow Friction Report

Run `golden-demo-ops` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-ops` (provider: csv, mapping `monday-standard-board` v2, imported 2026-07-20T00:00:00Z)

- Rows: 10 total, 9 imported, 1 dropped
- Capability profile: event history no · last-updated dates yes · due dates yes · actors yes
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

### Import diagnostics

- Row 8 \[dropped]: Status "Some Unknown Status" is not mapped to a stage kind — row dropped.
- Row 9 \[warning]: Unparseable lastUpdatedAt "not-a-date" — field ignored (ISO dates only in M0).

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 3 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): **skipped** — Requires hasEventHistory — not present in this import.

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | aging | stage "Working on it" (active) | 72 item-days-beyond-threshold | 921 USD – 3,684 USD (expected ~1,842 USD) | C |
| 2 | aging | stage "Waiting for approval" (review) | 47 item-days-beyond-threshold | 660 USD – 2,640 USD (expected ~1,320 USD) | B |
| 3 | aging | stage "Stuck" (blocked) | 26 item-days-beyond-threshold | 273 USD – 1,092 USD (expected ~546 USD) | B |

## Drill-down #1: aging at stage "Working on it"

**What is this?** Estimated attention cost of 2 item(s) aging beyond 14 days in stage "Working on it".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 1005 "Annual audit prep" | 37 | 0.15–0.6 | 95/h (rates.Finance) | 527 USD – 2,109 USD (expected ~1,054 USD) |
| 1007 "CRM cleanup" | 35 | 0.15–0.6 | 75/h (defaultRate:missing-actor) | 394 USD – 1,575 USD (expected ~788 USD) |

**What was assumed?**

- `defaultRate:missing-actor` = 75 USD/h — **unconfirmed default**
- `parameters.agingThresholdDays` = 14 days — set by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — set by customer
- `rates.Finance` = 95 USD/h — set by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to item(s) with no actor.
- B: Durations inferred from snapshot dates, not event history.

## Drill-down #2: aging at stage "Waiting for approval"

**What is this?** Estimated attention cost of 2 item(s) aging beyond 14 days in stage "Waiting for approval".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 1003 "Onboard new supplier" | 31 | 0.15–0.6 | 80/h (rates.Procurement) | 372 USD – 1,488 USD (expected ~744 USD) |
| 1001 "Renew vendor contract" | 16 | 0.15–0.6 | 120/h (rates.Legal) | 288 USD – 1,152 USD (expected ~576 USD) |

**What was assumed?**

- `parameters.agingThresholdDays` = 14 days — set by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — set by customer
- `rates.Legal` = 120 USD/h — set by customer
- `rates.Procurement` = 80 USD/h — set by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

## Drill-down #3: aging at stage "Stuck"

**What is this?** Estimated attention cost of 1 item(s) aging beyond 14 days in stage "Stuck".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 1004 "Website copy refresh" | 26 | 0.15–0.6 | 70/h (rates.Marketing) | 273 USD – 1,092 USD (expected ~546 USD) |

**What was assumed?**

- `parameters.agingThresholdDays` = 14 days — set by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — set by customer
- `rates.Marketing` = 70 USD/h — set by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

---

Engine versions: analysis 0.2.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0 · cost models cm-aging-attention@1.0.0, cm-queue-wait-attention@1.0.0
