# CostFlow Friction Report

Run `golden-demo-flow` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-flow` (provider: csv, mapping `demo-flow-board` v1, imported 2026-07-20T00:00:00Z)

- Rows: 4 total, 4 imported, 0 dropped
- Capability profile: event history yes · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 3 of 3 in-flight items carry due dates
- Lifecycle events imported: 11
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 2 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): ran — 2 finding(s)
- Overdue exposure (`f3-overdue@1.0.0`): ran — 1 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | queue-wait | stage "Contract Review" (review) | 1104 item-hours-waiting | 496 USD – 1,986 USD (expected ~993 USD) | B |
| 2 | queue-wait | stage "Backlog" (queue) | 1080 item-hours-waiting | 376 USD – 1,502 USD (expected ~751 USD) | A |
| 3 | aging | stage "Contract Review" (review) | 5 item-days-beyond-threshold | 90 USD – 360 USD (expected ~180 USD) | B |

## Unpriced frictions

Detected but not priced — the magnitude is real; the missing input is named.

- aging at stage "Working on it" — 16 item-days-beyond-threshold. Not priced: Rests on vendor-suggested assumption(s): defaultRate:unmapped-actor — confirm or customize them to price this friction, or run in simulation mode.
- overdue at stage "Contract Review" — 5 item-days-overdue. Not priced: Missing assumption parameters.overdueAttentionHoursPerDay — add it to price overdue frictions.

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 2 of 3 in-flight items (67%) sit in queue- or review-kind stages; the largest single pool is stage "Contract Review" (2 items).

## Drill-down #1: queue-wait at stage "Contract Review"

**What is this?** Estimated follow-up cost of 3 item(s) waiting in stage "Contract Review", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-flow-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 2001 "Vendor agreement" | 25 | 1 | yes | 0.1–0.4 | 120/h (rates.Legal) | 300 USD – 1,200 USD (expected ~600 USD) |
| 2002 "Supplier onboarding" | 19 | 2 | no | 0.1–0.4 | 95/h (rates.Finance) | 180 USD – 722 USD (expected ~361 USD) |
| 2004 "NDA batch" | 2 | 1 | yes | 0.1–0.4 | 80/h (rates.Procurement) | 16 USD – 64 USD (expected ~32 USD) |

**What was assumed?**

- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Finance` = 95 USD/h — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer
- `rates.Procurement` = 80 USD/h — customized by customer

**Confidence B**, limited by:

- B: Includes open stage intervals measured to the analysis time.

## Drill-down #2: queue-wait at stage "Backlog"

**What is this?** Estimated follow-up cost of 3 item(s) waiting in stage "Backlog", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-flow-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 2004 "NDA batch" | 38 | 1 | no | 0.1–0.4 | 80/h (rates.Procurement) | 304 USD – 1,216 USD (expected ~608 USD) |
| 2002 "Supplier onboarding" | 5 | 1 | no | 0.1–0.4 | 95/h (rates.Finance) | 48 USD – 190 USD (expected ~95 USD) |
| 2001 "Vendor agreement" | 2 | 1 | no | 0.1–0.4 | 120/h (rates.Legal) | 24 USD – 96 USD (expected ~48 USD) |

**What was assumed?**

- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Finance` = 95 USD/h — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer
- `rates.Procurement` = 80 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

## Drill-down #3: aging at stage "Contract Review"

**What is this?** Estimated attention cost of 1 item(s) aging beyond 14 days in stage "Contract Review".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-flow-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 2001 "Vendor agreement" | 5 | 0.15–0.6 | 120/h (rates.Legal) | 90 USD – 360 USD (expected ~180 USD) |

**What was assumed?**

- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

---

Engine versions: analysis 0.4.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
