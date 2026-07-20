# 06 — Never-Implement List, Open Architectural Questions, Existential Risks

## 1. Things That Must NEVER Be Implemented

These are standing constraints. Overturning any of them requires an explicit,
written decision by founders — never an engineering judgment call.

- **N1 — Individual performance scoring.** No ranking, scoring, flagging, or
  cost-attribution of named individuals, ever — in UI, exports, or API. Customers
  *will* ask ("which employee causes the most delay?"). The answer is no:
  it converts an analytics purchase into a works-council/legal fight in most of
  Europe, it poisons the data source (people game statuses the moment statuses
  judge them, destroying the signal our product runs on), and it moves us into a
  regulatory category (employee monitoring) we never want to inhabit. Enforced
  structurally: the reporting layer's attribution guard (FR-17) is the single
  choke point, and individual identities are pseudonymized at ingestion (NFR-5).

- **N2 — Non-deterministic numbers.** No LLM, heuristic, or "smart adjustment"
  in the numeric path. Already argued (doc 03 P1); recorded here because the
  temptation will recur every time a model demo looks impressive.

- **N3 — Fabricated dollars for unpriceable friction.** If required inputs are
  missing, we show time-denominated magnitude and say what's missing. No
  "industry-average deal size" silently substituted.

- **N4 — Provider concepts in the core.** No Monday/Jira/etc. vocabulary,
  field, or special case outside `packages/ingestion/providers/`. Build-enforced
  (doc 05 §3).

- **N5 — Write-back to source systems without a dedicated decision document.**
  Read-only is a security posture, a sales asset, and a trust story. (Doc 05 §4.)

- **N6 — Silent mutation of shipped numbers.** No live-updating of figures in
  existing runs/reports. Recompute is always an explicit, logged act producing a
  new run. A number an executive saw must remain reconstructible forever (NFR-2).

- **N7 — Cross-tenant data mixing.** No benchmarks, no "similar companies," no
  shared model training on customer data — until a dedicated, legally-reviewed
  benchmark architecture exists (Open Question Q4). No shortcuts before that.

- **N8 — Book-grade financial claims.** CostFlow estimates decision-grade
  economics. No feature may present output as accounting truth, feed a general
  ledger, or generate compliance-grade financial statements.

- **N9 — Surveillance-adjacent expansion** (keystroke/activity/calendar/message
  monitoring as friction inputs). Our inputs are work-item lifecycle data that
  orgs already consider managerial. The moment we ingest individual behavioral
  exhaust, N1's rationale collapses from underneath us.

## 2. Open Architectural Questions

Genuinely open — each needs evidence or a founder decision, and each has a
recorded default so work can proceed if evidence doesn't arrive.

- **Q1 — Point of canonical truth for currency.** Single org currency (default)
  vs. multi-currency with conversion? Default: single currency per org in MVP;
  multi-currency orgs pick one reporting currency. Revisit at first multinational
  design partner.

- **Q2 — Horizontal wedge vs. vertical wedge.** The model is vertical-agnostic,
  but should go-to-market lead with one process type (e.g., approval latency in
  professional-services ops) where the story is sharpest? Default: horizontal
  product, vertical *marketing* — pick the sharpest story per design partner.
  Decide after 5–10 design-partner sessions reveal where ranking credibility
  lands fastest.

- **Q3 — How far to trust snapshot inference.** When history is absent, how
  aggressively may detectors infer durations (e.g., from created/due/updated
  dates)? Conservative inference widens ranges; aggressive inference risks N3
  territory. Default: infer only with explicit "inferred from dates" labeling
  and confidence capped at C. Needs calibration against design-partner data
  where we *do* have history to compare.

- **Q4 — Benchmark architecture.** The long-term data moat (cross-customer
  friction benchmarks) needs an opt-in, aggregation-threshold, legally-reviewed
  design. Not an MVP question, but the *consent language* in early contracts is
  — decide before the first paid contract, or we may never be able to use early
  data. **This is time-sensitive despite being post-MVP.**

- **Q5 — Assumption defaults sourcing.** Where do "sane default rate cards" come
  from, and how do we keep them defensible (published salary data + methodology
  note)? Default: minimal region/role table with a citations page; never present
  a default as customer-confirmed.

- **Q6 — The FBX1 brand.** What does "Powered by FBX1" actually name — the
  deterministic cost engine (recommended, doc 05 §5), the AI layer (not
  recommended), or nothing yet (also respectable)? Founder decision; no
  engineering dependency.

- **Q7 — Event-store granularity.** Store canonical events only, or also retain
  raw provider payloads per batch for re-mapping without re-upload? Default:
  retain raw uploads (cheap, enables "fix mapping, re-derive without asking the
  customer for the file again"), with retention limits and deletion cascade
  (FR-22). Revisit if storage economics or privacy posture says otherwise.

- **Q8 — Multi-source identity resolution.** When Jira and HubSpot data coexist,
  do we resolve the same human/team across sources? Default: no resolution in
  MVP (single-source orgs); design the Actor model so a resolution layer can be
  added without migration (Actor already has per-source identity keys).

## 3. Risks That Could Invalidate the Product

Ordered by severity × likelihood. Each has a falsification signal — the
observable fact that tells us the risk is materializing — because a risk list
without tripwires is decoration.

- **R1 — Executives don't trust computed costs (the existential one).**
  Everything in docs 03 is mitigation (ranges, customer-owned assumptions,
  explainability, conservative bias). *Tripwire*: in design-partner sessions,
  execs engage with the ranking but refuse to repeat any number in their own
  meetings. If ranges + drill-down don't fix that, the product may need to
  retreat to time-denominated friction analytics (still useful, much smaller
  company) — better to learn this in month 3 than year 2.

- **R2 — Garbage in: customer data too poor to support even MVP detectors.**
  Many real boards have no history, inconsistent statuses, dead items. Mitigated
  by snapshot-capable detectors, capability profiles, and honest degradation —
  but if typical exports support only F2/F3 (aging/overdue), first-run value may
  be too thin. *Tripwire*: >half of design-partner first uploads yield fewer
  than three priced frictions. Response: invest in the "what to export and how"
  guidance and inference calibration (Q3) before any new features.

- **R3 — The insight is a shrug.** "Approval stage costs $150k/quarter" → "we
  knew approvals were slow." The product must consistently surface *surprise in
  the ordering* (the #1 friction is not what they'd have guessed) or *ammunition*
  (they knew, but couldn't justify the fix budget — now they can). *Tripwire*:
  design partners agree with every ranking and change no decisions. Response:
  sharpen the scenario/business-case layer (J5) — the value may be less
  "discovery" and more "justification," which changes marketing, not
  architecture.

- **R4 — One-report churn.** Customer gets the big insight once, fixes two
  things, stops uploading. Mitigated by trend loops (J4) and the fix-ROI story;
  live integrations (post-PMF) largely exist to kill this risk. *Tripwire*: the
  MVP success metric — second upload within 3 weeks — failing below ~50%.

- **R5 — Platform absorption.** Monday/Atlassian ship a "cost of delay" widget.
  Their structural weaknesses: single-source-only (we're cross-tool), incentive
  to flatter their own product's role in workflows, and no appetite for the
  assumption/audit machinery that makes numbers defensible. Our defense is depth
  in the cost model + multi-source neutrality + the exec relationship.
  *Tripwire*: platform announcement + design partners saying "we'll wait to see
  the native one." Response: accelerate cross-source and benchmark
  differentiation; avoid ever being distribution-dependent on one platform.

- **R6 — Political rejection inside the customer.** Friction reports name
  teams' bottlenecks; a powerful stakeholder whose stage tops the ranking can
  kill the deal. Mitigated by process-not-people attribution (N1) and by framing
  drill-downs as resource cases ("this stage needs capacity") rather than blame.
  *Tripwire*: champions asking to hide specific teams/stages from reports —
  which is also a feature request we should honor (scoped visibility) before it
  becomes churn.

- **R7 — Assumption-setup friction kills time-to-value.** If rate cards and
  value attribution feel like homework, users bounce before the first report.
  Mitigated by labeled defaults and by showing unpriced (time-denominated)
  results *immediately*, with pricing unlocking progressively as assumptions
  arrive. *Tripwire*: funnel analytics showing drop-off at assumption setup
  >30%.

- **R8 — Category-creation cost.** "Business Friction Intelligence" is a new
  category; new categories are expensive to explain. Mitigation: sell the
  artifact, not the category — the exec-ready friction/ROI report is instantly
  legible even when the category isn't. *Tripwire*: consistent "so it's a
  dashboard?" reactions in sales conversations despite the report demo.
