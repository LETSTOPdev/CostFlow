# CostFlow Friction Report

Run `golden-demo-jira` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-jira` (provider: jira, mapping `jira-ops-project` v1, imported 2026-07-20T00:00:00Z)

- Rows: 3 total, 3 imported, 0 dropped
- Capability profile: event history yes · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 2 of 3 in-flight items carry due dates
- Lifecycle events imported: 6
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 1 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): ran — 2 finding(s)
- Overdue exposure (`f3-overdue@1.0.0`): ran — 2 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | queue-wait | stage "To Do" (queue) | 1536 item-hours-waiting | 531 USD – 2,124 USD (expected ~1,062 USD) | C |
| 2 | overdue | stage "To Do" (queue) | 19 item-days-overdue | 171 USD – 684 USD (expected ~342 USD) | A |
| 3 | aging | stage "To Do" (queue) | 11 item-days-beyond-threshold | 148 USD – 594 USD (expected ~297 USD) | B |
| 4 | queue-wait | stage "Review" (review) | 288 item-hours-waiting | 144 USD – 576 USD (expected ~288 USD) | B |
| 5 | overdue | stage "Review" (review) | 10 item-days-overdue | 120 USD – 480 USD (expected ~240 USD) | A |

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 2 of 3 in-flight items (67%) sit in queue- or review-kind stages; the largest single pool is stage "In Progress" (1 items).

## Drill-down #1: queue-wait at stage "To Do"

**What is this?** Estimated follow-up cost of 3 item(s) waiting in stage "To Do", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-jira-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| OPS-3 "Quarterly access audit" | 49 | 1 | yes | 0.1–0.4 | 90/h (rates.Ops) | 441 USD – 1,764 USD (expected ~882 USD) |
| OPS-2 "Vendor risk review" | 10 | 1 | no | 0.1–0.4 | 30/h (defaultRate:unmapped-actor) | 30 USD – 120 USD (expected ~60 USD) |
| OPS-1 "Renew data processing agreement" | 5 | 1 | no | 0.1–0.4 | 120/h (rates.Legal) | 60 USD – 240 USD (expected ~120 USD) |

**What was assumed?**

- `defaultRate:unmapped-actor` = 30 USD/h — customized by customer
- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer
- `rates.Ops` = 90 USD/h — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).
- B: Includes open stage intervals measured to the analysis time.

## Drill-down #2: overdue at stage "To Do"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "To Do".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-jira-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| OPS-3 "Quarterly access audit" | 19 | 2026-07-01 | 0.1–0.4 | 90/h (rates.Ops) | 171 USD – 684 USD (expected ~342 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer
- `rates.Ops` = 90 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

## Drill-down #3: aging at stage "To Do"

**What is this?** Estimated attention cost of 1 item(s) aging beyond 14 days in stage "To Do".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-jira-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| OPS-3 "Quarterly access audit" | 11 | 0.15–0.6 | 90/h (rates.Ops) | 148 USD – 594 USD (expected ~297 USD) |

**What was assumed?**

- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Ops` = 90 USD/h — customized by customer

**Confidence B**, limited by:

- B: Durations inferred from snapshot dates, not event history.

## Drill-down #4: queue-wait at stage "Review"

**What is this?** Estimated follow-up cost of 1 item(s) waiting in stage "Review", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-jira-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| OPS-1 "Renew data processing agreement" | 12 | 1 | yes | 0.1–0.4 | 120/h (rates.Legal) | 144 USD – 576 USD (expected ~288 USD) |

**What was assumed?**

- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer

**Confidence B**, limited by:

- B: Includes open stage intervals measured to the analysis time.

## Drill-down #5: overdue at stage "Review"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Review".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-jira-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| OPS-1 "Renew data processing agreement" | 10 | 2026-07-10 | 0.1–0.4 | 120/h (rates.Legal) | 120 USD – 480 USD (expected ~240 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer
- `rates.Legal` = 120 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

---

Engine versions: analysis 0.4.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
