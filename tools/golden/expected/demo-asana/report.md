# CostFlow Friction Report

Run `golden-demo-asana` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-asana` (provider: asana, mapping `asana-legal-project` v1, imported 2026-07-20T00:00:00Z)

- Rows: 3 total, 3 imported, 0 dropped
- Capability profile: event history yes · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 1 of 2 in-flight items carry due dates
- Lifecycle events imported: 7
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

### Import diagnostics

- Row 3 \[warning]: 1 section move(s) in other projects ignored (outside scoped project "555").

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 1 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): ran — 2 finding(s)
- Overdue exposure (`f3-overdue@1.0.0`): ran — 1 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | queue-wait | stage "Intake" (queue) | 1272 item-hours-waiting | 238 USD – 952 USD (expected ~476 USD) | C |
| 2 | queue-wait | stage "Legal review" (review) | 384 item-hours-waiting | 176 USD – 704 USD (expected ~352 USD) | B |
| 3 | overdue | stage "Legal review" (review) | 8 item-days-overdue | 88 USD – 352 USD (expected ~176 USD) | A |
| 4 | aging | stage "Intake" (queue) | 8 item-days-beyond-threshold | 42 USD – 168 USD (expected ~84 USD) | C |

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 2 of 2 in-flight items (100%) sit in queue- or review-kind stages; the largest single pool is stage "Intake" (1 items).

## Drill-down #1: queue-wait at stage "Intake"

**What is this?** Estimated follow-up cost of 3 item(s) waiting in stage "Intake", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-asana-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 9002 "Update onboarding checklist" | 42 | 1 | yes | 0.1–0.4 | 35/h (defaultRate:unmapped-actor) | 147 USD – 588 USD (expected ~294 USD) |
| 9001 "Draft NDA for new vendor" | 7 | 1 | no | 0.1–0.4 | 110/h (rates.Legal) | 77 USD – 308 USD (expected ~154 USD) |
| 9003 "Ship pricing page update" | 4 | 1 | no | 0.1–0.4 | 35/h (defaultRate:missing-actor) | 14 USD – 56 USD (expected ~28 USD) |

**What was assumed?**

- `defaultRate:missing-actor` = 35 USD/h — customized by customer
- `defaultRate:unmapped-actor` = 35 USD/h — customized by customer
- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Legal` = 110 USD/h — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to item(s) with no actor.
- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).
- B: Includes open stage intervals measured to the analysis time.

## Drill-down #2: queue-wait at stage "Legal review"

**What is this?** Estimated follow-up cost of 1 item(s) waiting in stage "Legal review", observed from event history.

**How was it computed?** `Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range`
(cost model `cm-queue-wait-attention@1.0.0`, assumption set `demo-asana-assumptions` v1)

**What data went in?**

| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|---|
| 9001 "Draft NDA for new vendor" | 16 | 1 | yes | 0.1–0.4 | 110/h (rates.Legal) | 176 USD – 704 USD (expected ~352 USD) |

**What was assumed?**

- `parameters.queueWaitAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — customized by customer
- `rates.Legal` = 110 USD/h — customized by customer

**Confidence B**, limited by:

- B: Includes open stage intervals measured to the analysis time.

## Drill-down #3: overdue at stage "Legal review"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "Legal review".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-asana-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| 9001 "Draft NDA for new vendor" | 8 | 2026-07-12 | 0.1–0.4 | 110/h (rates.Legal) | 88 USD – 352 USD (expected ~176 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer
- `rates.Legal` = 110 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

## Drill-down #4: aging at stage "Intake"

**What is this?** Estimated attention cost of 1 item(s) aging beyond 14 days in stage "Intake".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-asana-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| 9002 "Update onboarding checklist" | 8 | 0.15–0.6 | 35/h (defaultRate:unmapped-actor) | 42 USD – 168 USD (expected ~84 USD) |

**What was assumed?**

- `defaultRate:unmapped-actor` = 35 USD/h — customized by customer
- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to unmapped (pseudonymized) actor(s).
- B: Durations inferred from snapshot dates, not event history.

---

Engine versions: analysis 0.5.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
