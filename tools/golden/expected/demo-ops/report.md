# CostFlow Friction Report

Run `golden-demo-ops` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-ops` (provider: csv, mapping `monday-standard-board` v2, imported 2026-07-20T00:00:00Z)

- Rows: 10 total, 9 imported, 1 dropped
- Capability profile: event history no · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 7 of 8 in-flight items carry due dates
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

### Import diagnostics

- Row 8 \[dropped]: Status "Some Unknown Status" is not mapped to a stage kind — row dropped.
- Row 9 \[warning]: Unparseable lastUpdatedAt "not-a-date" — field ignored (ISO dates only in M0).

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 3 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): **skipped** — Requires hasEventHistory — not present in this import.
- Overdue exposure (`f3-overdue@1.0.0`): ran — 3 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | overdue | stage "Waiting for approval" (review) | 84 item-days-overdue | 812 USD – 3,248 USD (expected ~1,624 USD) | A |
| 2 | aging | stage "Waiting for approval" (review) | 47 item-days-beyond-threshold | 660 USD – 2,640 USD (expected ~1,320 USD) | B |
| 3 | aging | stage "Stuck" (blocked) | 26 item-days-beyond-threshold | 273 USD – 1,092 USD (expected ~546 USD) | B |
| 4 | overdue | stage "Working on it" (active) | 19 item-days-overdue | 171 USD – 684 USD (expected ~342 USD) | A |
| 5 | overdue | stage "Stuck" (blocked) | 20 item-days-overdue | 140 USD – 560 USD (expected ~280 USD) | A |

## Unpriced frictions

Detected but not priced — the magnitude is real; the missing input is named.

- aging at stage "Working on it" — 72 item-days-beyond-threshold. Not priced: Rests on vendor-suggested assumption(s): defaultRate:missing-actor — confirm or customize them to price this friction, or run in simulation mode.

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 3 of 8 in-flight items (38%) sit in queue- or review-kind stages; the largest single pool is stage "Working on it" (4 items).

## Drill-down #1: overdue at stage "Waiting for approval"

**What is this?** Estimated chasing cost of 2 item(s) past their own due dates in stage "Waiting for approval".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 1003 "Onboard new supplier" | 49 | 2026-06-01 | 0.1–0.4 | 80/h (rates.Procurement) | 392 USD – 1,568 USD (expected ~784 USD) |
| 1001 "Renew vendor contract" | 35 | 2026-06-15 | 0.1–0.4 | 120/h (rates.Legal) | 420 USD – 1,680 USD (expected ~840 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer
- `rates.Procurement` = 80 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

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

- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer
- `rates.Procurement` = 80 USD/h — customized by customer

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

- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Marketing` = 70 USD/h — customized by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

## Drill-down #4: overdue at stage "Working on it"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Working on it".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 1009 "Legacy migration" | 19 | 2026-07-01 | 0.1–0.4 | 90/h (rates.IT) | 171 USD – 684 USD (expected ~342 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.IT` = 90 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

## Drill-down #5: overdue at stage "Stuck"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Stuck".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-ops-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 1004 "Website copy refresh" | 20 | 2026-06-30 | 0.1–0.4 | 70/h (rates.Marketing) | 140 USD – 560 USD (expected ~280 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Marketing` = 70 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

---

Engine versions: analysis 0.5.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
