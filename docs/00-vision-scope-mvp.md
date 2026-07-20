# 00 — Product Vision, Scope, and MVP

## 1. Product Vision

### The one-sentence pitch

> CostFlow tells an executive, in dollars, what their organization's delays cost —
> and which one to fix first.

### The problem, stated precisely

Every work-tracking tool (Monday, Jira, ClickUp, Asana) already answers *"what is
late?"*. None of them answer the three questions executives actually ask:

1. **How much is this delay costing us?** (impact)
2. **Where are we losing the most money right now?** (aggregation)
3. **What should we fix first, and what is the ROI of fixing it?** (prioritization)

Today those questions are answered by gut feel, by whoever shouts loudest, or by a
consultant who builds a one-off spreadsheet that is stale in a month. CostFlow makes
that spreadsheet a living product.

### What CostFlow is

- A **read-only analytical layer** over the customer's existing work data.
- A **translation engine**: operational events (waiting, rework, handoffs) →
  financial impact (cost ranges with stated assumptions).
- A **prioritization instrument** for executives: a ranked, defensible,
  money-denominated list of organizational frictions.

### What CostFlow is not

- Not another project management tool. We never manage work; we price its friction.
- Not a BI tool. BI shows customers charts of whatever they ask for; we ship an
  opinionated financial model of friction. The opinion *is* the product.
- Not a time tracker. We infer cost from work-item lifecycle data the customer
  already has; we never ask employees to log anything.
- Not an employee performance tool. This is a hard ethical and commercial boundary
  (see doc 06).

### Why this can be a very large business

- The wedge is horizontal (every org with a work tracker has friction) but the
  monetization is executive-level: the buyer is the COO/CFO, not the team lead, so
  price anchors to consulting budgets and "cost savings identified," not to
  per-seat SaaS.
- The defensible asset over time is not the integrations — those commoditize — but
  (a) the canonical friction/cost model, (b) the assumption library ("what does an
  hour of a blocked approval cost in a 200-person fintech?"), and eventually
  (c) anonymized cross-customer benchmarks. Each is a compounding data asset.

### Honest challenge to the vision (recorded, not resolved)

The vision assumes executives will *trust computed dollar figures about their own
org*. This is the single biggest product risk (see doc 06, Risk R1). The entire
design — ranges, explainability, customer-owned assumptions — exists to buy that
trust. If we ever ship a number we cannot defend line-by-line in front of a CFO,
we have broken the product.

---

## 2. Product Scope

### In scope (the durable product boundary)

| Capability | Why it's in scope |
|---|---|
| Ingesting work-item lifecycle data from any source (CSV first) | Raw material for everything |
| Normalizing it into a canonical domain model | The architectural bet (doc 05) |
| Detecting friction patterns (doc 02, taxonomy) | The "what is wrong" layer |
| Pricing friction via a deterministic cost engine (doc 03) | The "what it costs" layer — the core IP |
| Ranking, aggregating, and trending friction cost | The "what to fix first" layer — the exec value |
| ROI scenarios ("if approval latency halves, you save X–Y/quarter") | Turns insight into a business case |
| Explainability of every number | Trust; non-negotiable |
| Exportable executive reporting | The artifact the champion shows the buyer |

### Out of scope (durably — not just for MVP)

- Executing or managing work (no tasks, no assignments, no write-back to sources).
- Individual performance measurement (banned; doc 06).
- General-purpose BI / arbitrary dashboarding.
- Financial accounting integration (we estimate economic impact; we do not touch
  the general ledger — different buyer, different compliance regime).

### Out of scope for MVP, in scope later

- Live integrations (Monday, Jira, ClickUp, HubSpot APIs) — post-PMF only.
- Cross-customer benchmarks — needs volume and a careful legal/privacy design.
- Continuous/streaming ingestion — batch re-upload is enough to prove value.
- AI narrative layer beyond basic explanation drafting (doc 05, AI responsibilities).

---

## 3. MVP Definition

### MVP thesis

> A customer with no integration, no onboarding call, and one CSV export from their
> existing tool reaches their first defensible cost insight in under 30 minutes.

The MVP is deliberately a **pipeline, end to end, at minimum width**: one ingestion
path (CSV), a handful of friction detectors, one cost model per friction type,
one report. Depth per stage comes later; the full spine must exist from day one
because the spine *is* the architecture bet.

### MVP scope — precisely

**1. CSV import (the only provider)**
- Upload one or more CSV exports (Monday and Jira export formats are the two we
  test against, but the mapper is generic).
- A mapping wizard: user maps their columns to canonical fields (item id, title,
  status, group/board, assignee-role, dates, status-change history if present).
- Mapping templates are saved and reusable — the second upload of the same shape
  is zero-config. **This mapping layer is a real product asset, not plumbing**:
  it is the same machinery every future live integration will use.
- Honest handling of missing data: if the CSV has no status-change history (many
  exports only have current state + dates), the product degrades gracefully to
  the friction detectors that work on snapshots (aging, overdue, WIP overload)
  and *says so explicitly* rather than fabricating durations.

**2. Assumption setup (the customer owns the numbers)**
- Rate cards: blended hourly cost per role/team (with sane, clearly-labeled
  defaults by region/industry the user can accept or override).
- Optional value parameters: revenue per deal for pipeline items, SLA penalty
  values, etc. All optional; the engine uses only what it has and says what it
  lacked.

**3. Friction detection (MVP set — snapshot-capable detectors prioritized)**
- Aging / stagnation (item unchanged beyond threshold).
- Overdue against stated due dates.
- Queue/wait time in a status (when history exists).
- Rework signal (status regressions, when history exists).
- WIP overload per team/group.
- Handoff count (when history exists).

**4. Cost estimation**
- Deterministic engine, versioned models, cost *ranges* with confidence tiers,
  every estimate carrying its formula, inputs, and assumption references (doc 03).

**5. The report (the actual deliverable)**
- Ranked friction list by estimated cost (range), aggregated by team / process /
  friction type.
- Drill-down from any aggregate number to the individual work items and the math.
- One-click executive summary export (PDF/slide-ready) — this is the artifact our
  champion forwards to the COO; it must be beautiful and self-explanatory.

**6. Multi-upload trend (thin)**
- Re-upload next week → same mapping template → "friction cost moved from X to Y."
  Thin, but it converts a one-shot analysis into a recurring habit, which is the
  whole retention story pre-integration.

### Explicitly NOT in MVP

- Any live integration or OAuth flow.
- User management beyond a basic org with a few members.
- AI chat, natural-language querying.
- Benchmarks, industry comparisons.
- Real-time anything.
- Scenario modeling beyond a simple "reduce this friction by N%" calculator.

### MVP success criteria (falsifiable)

- Time-to-first-insight from signup < 30 minutes, unassisted, for a Monday CSV.
- In ≥ 5 design-partner sessions, an executive looks at the top-ranked friction
  and says some version of "that ordering is right" — ranking credibility, not
  dollar precision, is the bar.
- ≥ 50% of design partners upload a second CSV within 3 weeks (the retention
  proxy that justifies building live integrations at all).

### Why this MVP and not alternatives we considered

- **Alternative: Monday-app-first (marketplace embed).** Faster distribution,
  but it would harden Monday assumptions into the core — exactly the mistake the
  architecture decision forbids — and puts our existence at the mercy of the
  platform most likely to clone us. Rejected for MVP; reconsidered post-PMF as a
  *distribution channel only* (doc 05, integrations strategy).
- **Alternative: services-led ("send us your export, we send a report").**
  Actually worth doing *in parallel manually* as customer development, but the
  MVP product must be self-serve or we learn nothing about whether the mapping
  and assumption UX can survive without us in the room.
- **Alternative: go deeper on one vertical process (e.g., only sales-pipeline
  friction).** Tempting and might be right — recorded as Open Question Q2
  (doc 06). The domain model is deliberately vertical-agnostic so this remains a
  go-to-market choice, not an architecture choice.
