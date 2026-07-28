# 01 — Personas and User Journeys

## 1. Core User Personas

The critical structural fact about CostFlow's market: **the person who feels the
pain, the person who operates the product, and the person who pays are three
different people.** The product must serve all three or the sale dies.

### P1 — The Champion / Operator: "Maya", Head of PMO / Ops Analyst / Chief of Staff

- **Who**: Owns operational reporting in a 100–2,000 person company. Lives in
  Monday/Jira exports and spreadsheets. Regularly asked by executives "why is
  everything slow?" and has no quantified answer.
- **Goal**: Walk into the quarterly ops review with a defensible, money-denominated
  answer instead of a wall of status charts.
- **What she does in CostFlow**: uploads CSVs, builds mappings, sets rate cards,
  curates which findings go into the exec report. She is the primary daily user.
- **Design consequence**: the mapping wizard and assumption UX are built for her —
  spreadsheet-literate, not technical. If Maya can't self-serve, nothing else matters.
- **Her career risk is our adoption risk**: if CostFlow's numbers get challenged in
  the exec meeting and collapse, Maya looks bad and never opens it again.
  Explainability is Maya's body armor. This is why explainability is a product
  pillar, not a feature.

### P2 — The Economic Buyer: "Daniel", COO / VP Operations

- **Who**: Accountable for operational efficiency. Drowning in dashboards, starving
  for prioritization. Approves the budget.
- **Goal**: Know which 2–3 frictions to invest in fixing this quarter, with an ROI
  story he can defend to the CEO/CFO.
- **What he does in CostFlow**: consumes the executive report and the ranked
  friction list. Ten minutes a week, maybe. He may never log in — the exported
  report may be his entire experience. **Design consequence**: the export is a
  first-class product surface, not an afterthought.

### P3 — The Validator / Skeptic: "Rivka", CFO / Head of Finance

- **Who**: Will be shown CostFlow's numbers by Daniel and will immediately ask
  "where does this number come from?"
- **Goal**: Not be embarrassed by a vendor's fantasy math entering board decks.
- **What she does in CostFlow**: audits. Clicks a number, expects to see formula,
  inputs, and assumptions — and expects the assumptions to be *hers* (her rate
  cards, her deal values), not ours.
- **Design consequence**: the assumption model must be customer-owned and the audit
  trail complete. Rivka never becomes a fan; the win condition is that she stops
  objecting.

### P4 — The Data Source Owner: "Tom", Team Lead / Department Manager

- **Who**: His team's board is the data. He will be named (as a *team*, never as
  individuals) in friction reports.
- **Goal**: Not be unfairly blamed; ideally, use the data to get resources
  ("this approval bottleneck you keep routing through my team costs 40k/quarter —
  give me headcount or change the process").
- **Design consequence**: friction must be attributed to **process stages and
  queues, not to people**. Framing matters: "the approval stage holds items 9 days"
  is actionable; "Tom's team is slow" is a political grenade that gets the product
  banned. This shapes the domain model's attribution design (doc 02) and the
  never-implement list (doc 06).

### Deliberately not a persona (MVP)

- **Individual contributors**: they never use CostFlow and are never identified by
  it. This is a feature.
- **External consultants**: a real future channel (they'd love this tool for
  client engagements) — parked, revisit post-PMF.

## 2. User Journeys

### J1 — First value: from CSV to insight (the make-or-break journey, target < 30 min)

1. Maya exports her Monday board(s) to CSV — an action she already knows.
2. Signs up, creates an org, uploads the CSV(s).
3. **Mapping wizard**: CostFlow proposes a column mapping (heuristics + AI
   suggestion, human-confirmed — doc 05); Maya adjusts and confirms. The wizard
   states plainly what the data can and cannot support: *"No status-history
   detected — wait-time and rework analysis unavailable for this file; aging,
   overdue, and WIP analysis available."* Honesty here builds the trust we spend
   later.
4. **Assumption setup**: Maya enters or accepts default blended hourly rates per
   role/team; optionally adds deal values / SLA figures. Clearly labeled: "You can
   refine these anytime; every result shows which assumptions it used."
5. **Friction report renders**: ranked list of frictions with cost ranges, grouped
   by process/team/type.
6. Maya clicks the top item → drill-down: which items, what formula, which
   assumptions. She spot-checks two items against reality. They hold up.
7. She exports the executive summary and sends it to Daniel.

**Failure modes we design against**: mapping too hard (→ templates, AI-suggested
mapping); garbage CSV (→ import diagnostics that say exactly what's wrong and
what's still possible); "these numbers are made up" (→ ranges + drill-down +
customer-owned assumptions).

### J2 — The executive consumption loop (Daniel, weekly/monthly)

1. Receives the exported summary (or a link): top 5 frictions, cost ranges, trend
   vs. last period, one suggested action each.
2. Picks one friction, opens the drill-down enough to satisfy himself, brings it
   to the ops meeting: "approval-stage wait cost us an estimated 120–180k this
   quarter; here's the proposed fix and its ROI."
3. The decision gets made on money, not urgency — the product's core promise
   fulfilled.

### J3 — The audit (Rivka, once, early — the trust gate)

1. Rivka is shown a number. She clicks it.
2. Sees: formula (plain language + math), input data (the actual work items),
   assumptions used (rate card v3, *edited by Maya on Jan 12*), confidence tier
   and why (e.g., "no status history → durations estimated from date fields").
3. She changes an assumption (rate 85 → 60) and watches every dependent number
   recompute. Now it's *her* model. Objection retired.

This journey is why the cost engine must be deterministic and fast to recompute
(doc 03): "change assumption → watch numbers move" is the single most trust-
building interaction in the product.

### J4 — The recurring loop (Maya, weekly — the retention story pre-integration)

1. Maya re-exports and re-uploads; the saved mapping template applies automatically
   — zero-config from the second upload on.
2. CostFlow computes deltas: friction cost trend, new frictions, resolved ones.
3. "Approval wait cost down 30% since the process change" — the product now
   *proves ROI of fixes*, closing the loop it opened. This is what makes CostFlow
   a habit instead of a one-shot report, and it is the argument that will justify
   building live integrations (which merely automate this journey).

### J5 — Building a business case (the expansion journey, thin in MVP)

1. Daniel asks: "what if we cut approval latency in half?"
2. Maya opens the scenario calculator on that friction: reduce by 50% → projected
   savings range per quarter.
3. Export as a one-page business case: cost of problem, cost of fix (manual
   input), payback period.

MVP ships only the simple percentage-reduction calculator. Full scenario modeling
(structural what-ifs) is post-PMF — but the domain model reserves a place for it
(doc 02, Scenario).
