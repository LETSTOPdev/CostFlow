# CostFlow Friction Report

Run `golden-demo-clickup` · analysis time 2026-07-20T00:00:00Z · currency USD

All figures are estimates with stated assumptions; every number below is
traceable to its formula, inputs, and assumption provenance.

## Data

Import batch `batch-golden-demo-clickup` (provider: clickup, mapping `clickup-legalops-space` v1, imported 2026-07-20T00:00:00Z)

- Rows: 4 total, 4 imported, 0 dropped
- Capability profile: event history no · last-updated dates yes · due dates yes · actors yes
- Due-date coverage: 2 of 3 in-flight items carry due dates
- Unmapped actors pseudonymized (scope `costflow-golden`); raw identities are not retained

### Import diagnostics

- Row 2 \[warning]: Task "cu-2" has 2 assignees — attributed to the deterministic primary (lowest user id); 1 not attributed.

## Detectors

- Aging / stagnation (`f2-aging@1.0.0`): ran — 1 finding(s)
- Queue wait (`f1-queue-wait@1.0.0`): **skipped** — Requires hasEventHistory — not present in this import.
- Overdue exposure (`f3-overdue@1.0.0`): ran — 1 finding(s)

## Ranked frictions

| # | Friction | Where | Magnitude | Estimated cost | Confidence |
|---|---|---|---|---|---|
| 1 | aging | stage "to do" (queue) | 65 item-days-beyond-threshold | 400 USD – 1,602 USD (expected ~801 USD) | C |
| 2 | overdue | stage "to do" (queue) | 10 item-days-overdue | 120 USD – 480 USD (expected ~240 USD) | A |

## Context

Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.

- Work-in-flight load (`c6-wip-load@1.0.0`): 2 of 3 in-flight items (67%) sit in queue- or review-kind stages; the largest single pool is stage "to do" (2 items).

## Drill-down #1: aging at stage "to do"

**What is this?** Estimated attention cost of 2 item(s) aging beyond 14 days in stage "to do".

**How was it computed?** `Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-aging-attention@1.0.0`, assumption set `demo-clickup-assumptions` v1)

**What data went in?**

| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|
| cu-3 "Archive stale intake forms" | 57 | 0.15–0.6 | 30/h (defaultRate:missing-actor) | 256 USD – 1,026 USD (expected ~513 USD) |
| cu-1 "Renew MSA with vendor" | 8 | 0.15–0.6 | 120/h (rates.Legal) | 144 USD – 576 USD (expected ~288 USD) |

**What was assumed?**

- `defaultRate:missing-actor` = 30 USD/h — customized by customer
- `parameters.agingThresholdDays` = 14 days — customized by customer
- `parameters.attentionHoursPerDay` = 0.15–0.6 h/day (expected 0.3) — customized by customer
- `rates.Legal` = 120 USD/h — customized by customer

**Confidence C**, limited by:

- C: Default hourly rate applied to item(s) with no actor.
- B: Durations inferred from snapshot dates, not event history.

## Drill-down #2: overdue at stage "to do"

**What is this?** Estimated chasing cost of 1 item(s) past their own due dates in stage "to do".

**How was it computed?** `Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range`
(cost model `cm-overdue-attention@1.0.0`, assumption set `demo-clickup-assumptions` v1)

**What data went in?**

| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |
|---|---|---|---|---|---|
| cu-1 "Renew MSA with vendor" | 10 | 2026-07-10T00:00:00.000Z | 0.1–0.4 | 120/h (rates.Legal) | 120 USD – 480 USD (expected ~240 USD) |

**What was assumed?**

- `parameters.overdueAttentionHoursPerDay` = 0.1–0.4 h/day (expected 0.2) — accepted by customer
- `rates.Legal` = 120 USD/h — customized by customer

**Confidence A** — no binding constraints: fully observed data and customer-confirmed assumptions.

---

Engine versions: analysis 0.4.0 · signals f2-aging@1.0.0, f1-queue-wait@1.0.0, f3-overdue@1.0.0 · context c6-wip-load@1.0.0 · cost models cm-aging-attention@1.0.0, cm-overdue-attention@1.0.0, cm-queue-wait-attention@1.0.0
