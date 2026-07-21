# CostFlow Friction Report

Run `golden-demo-monday` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-monday` (provider: monday, mapping `monday-ops-board` v1, imported 2026-07-20T00:00:00Z)

- Rows: 3 total, 3 imported, 0 dropped
- Capability profile: event history yes · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 2 of 2 in-flight items carry due dates
- Lifecycle events imported: 7
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 1 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): ran — 2 finding(s)
- Overdue exposure (`f3-overdue@1.0.0`): ran — 2 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | queue-wait | stage "Backlog" (queue) | 1440 item-hours-waiting | 510 USD – 2,040 USD (expected ~1,020 USD) | C |
| 2 | overdue | stage "Backlog" (queue) | 12 item-days-overdue | 120 USD – 480 USD (expected ~240 USD) | A |
| 3 | aging | stage "Backlog" (queue) | 6 item-days-beyond-threshold | 90 USD – 360 USD (expected ~180 USD) | B |
| 4 | queue-wait | stage "Waiting for review" (review) | 336 item-hours-waiting | 56 USD – 224 USD (expected ~112 USD) | C |
| 5 | overdue | stage "Waiting for review" (review) | 6 item-days-overdue | 24 USD – 96 USD (expected ~48 USD) | C |

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 2 of 2 in-flight items (100%) sit in queue- or review-kind stages; the largest single pool is stage "Backlog" (1 items).

## Drill-down #1: queue-wait at stage "Backlog"

**What is this?** Estimated follow-up cost of 3 item(s) waiting in stage "Backlog", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-monday-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 101 "Website redesign brief" | 45 | 1 | yes | 0.1–0.4 | 100/h (rates.Founder) | 450 USD – 1,800 USD (expected ~900 USD) |
| 102 "Vendor contract renewal" | 8 | 1 | no | 0.1–0.4 | 40/h (defaultRate:unmapped-actor) | 32 USD – 128 USD (expected ~64 USD) |
| 103 "Spring campaign wrap-up" | 7 | 1 | no | 0.1–0.4 | 40/h (defaultRate:missing-actor) | 28 USD – 112 USD (expected ~56 USD) |

**What was assumed?**

- `defaultRate:missing-actor` = 40 USD/h — customized by customer
- `defaultRate:unmapped-actor` = 40 USD/h — customized by customer
- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Founder` = 100 USD/h — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to item(s) with no actor.
- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).
- B: Includes open stage intervals measured to the analysis time.

## Drill-down #2: overdue at stage "Backlog"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Backlog".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-monday-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 101 "Website redesign brief" | 12 | 2026-07-08 | 0.1–0.4 | 100/h (rates.Founder) | 120 USD – 480 USD (expected ~240 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer
- `rates.Founder` = 100 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

## Drill-down #3: aging at stage "Backlog"

**What is this?** Estimated attention cost of 1 item(s) aging beyond 14 days in stage "Backlog".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-monday-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 101 "Website redesign brief" | 6 | 0.15–0.6 | 100/h (rates.Founder) | 90 USD – 360 USD (expected ~180 USD) |

**What was assumed?**

- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Founder` = 100 USD/h — customized by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

## Drill-down #4: queue-wait at stage "Waiting for review"

**What is this?** Estimated follow-up cost of 1 item(s) waiting in stage "Waiting for review", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-monday-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 102 "Vendor contract renewal" | 14 | 1 | yes | 0.1–0.4 | 40/h (defaultRate:unmapped-actor) | 56 USD – 224 USD (expected ~112 USD) |

**What was assumed?**

- `defaultRate:unmapped-actor` = 40 USD/h — customized by customer
- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).
- B: Includes open stage intervals measured to the analysis time.

## Drill-down #5: overdue at stage "Waiting for review"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Waiting for review".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-monday-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 102 "Vendor contract renewal" | 6 | 2026-07-14 | 0.1–0.4 | 40/h (defaultRate:unmapped-actor) | 24 USD – 96 USD (expected ~48 USD) |

**What was assumed?**

- `defaultRate:unmapped-actor` = 40 USD/h — customized by customer
- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).

---

Engine versions: analysis 0.4.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
