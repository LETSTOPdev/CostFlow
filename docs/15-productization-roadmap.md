# 15 — Phase 2: Productization Roadmap

**Status: plan awaiting approval. Supersedes doc 08's Phase-1 sequencing where
they conflict (founder directive 2026-07-20: productization before further
detectors). All architectural principles (docs 00–07, 12–14), the provenance
policy (doc 03 P4 as amended), guardrails, and never-lists remain binding.**

Directive: shift development to the platform. Detector families frozen unless
platform work reveals a concrete need. Priorities as given: (1) connectors,
(2) unified import pipeline, (3) onboarding flow, (4) reporting experience,
(5) scenario engine.

## 1. Two sequencing challenges before building (stated once, then your call)

**Challenge 1 — depth before breadth on connectors.** Eight production-quality
connectors built up-front is eight integration surfaces to maintain before one
customer uses any of them — and doc 08 §15's rule ("build connectors in the
order paying partners demand them") was evidence-based, not timidity. The
amended proposal: build the **Provider SPI v2 once, prove it with two
connectors** (Jira first, then Monday), and slot the remaining six behind
demand evidence. Jira first because it maximizes three things at once: market
size, data richness (its changelog is the only mainstream source of the
ordered event history F1 needs — cu01 proved ClickUp can't provide it), and
Cycle-2 readiness (a Jira partner becomes analyzable the day one appears).
Every additional connector after the second should be a ~1-week slice if
doc 05's "the integration roadmap is an extractor roadmap" promise is true —
and P2 is precisely the test of that promise.

**Challenge 2 — the unified pipeline is not new work; the onboarding flow is
the real mountain.** Priority 2 already exists: the ingestion SPI (extract →
map → land) has been the only door into the canonical model since M0, and CSV
has walked through it from day one. What P1 adds is the *API-provider
generalization* (auth config, pagination, rate limits, event extraction) — an
extension, not a redesign. Priority 3, however, silently contains the entire
M2 self-serve spine from doc 08: persistence, tenancy, authentication, and a
web application — none of which exist. The plan makes that explicit instead
of discovering it mid-build.

## 2. Milestones

```
P1  Provider SPI v2 + Jira connector (CLI-operable)      ~2 wks
P2  Monday + Asana connectors (the SPI promise test)     ~1.5 wks
P3  Telemetry: the product measures itself               ~1.5 wks   ← added 2026-07-20
P4  Self-serve spine: DB, auth, web app, onboarding      ~6-7 wks   ← the mountain
P5  Reporting experience: dashboard, trends, drilldowns  ~4 wks
P6  Scenario engine + simulation UX (doc 07 replay)      ~3 wks
P7+ Connector long tail (Linear, GH Projects, Trello,
    ADO) — slotted individually on demand evidence        ~1 wk each
```

### P1 — Provider SPI v2 + Jira connector

- SPI v2: provider descriptor (auth requirements, capabilities it CAN
  deliver), paginated extraction contract, event-history extraction as a
  first-class optional capability, provider conformance test suite (the
  doc 05 §4 contract, executable — CSV refactored to pass it unchanged).
- Jira Cloud connector: REST v3 search + changelog → canonical items AND
  WorkItemEvents (strict validation unchanged — Jira's changelog is the first
  real chance to feed F1 honestly). Token auth (email+token) via local file,
  same salt/pseudonymization edge rules as cu01.
- CLI: `costflow fetch --provider jira ...` writing raw JSON + derived
  canonical input, preserving the raw/derived separation the partner toolkit
  already enforces.
- Built against Jira's documented API schema with synthetic conformance
  fixtures (API-shape test data, not fake customer data); validated against a
  real workspace the moment one exists.
- DoD: conformance suite green for csv+jira; goldens untouched byte-for-byte;
  boundaries hold (`providers/jira` visible only inside ingestion); a
  fixture-driven end-to-end run incl. events → F1 pricing.

### P2 — Monday + Asana connectors

- Same SPI, no SPI changes allowed (that's the test — any needed SPI change
  is a P2 finding, documented before made). Monday: GraphQL items + activity
  log where plan permits; Asana: tasks + stories-derived events where honest
  (stories that don't yield valid ordered transitions are recorded as
  unavailable, never repaired into events).
- DoD: conformance suite green ×4; capability profiles honestly differ per
  provider; doc 05 promise verdict written in the log.

### P3 — Telemetry (inserted by founder directive: product learning before real customers)

Purpose: product learning, not analytics dashboards. Same philosophy as
everything else in CostFlow:

- **Derived, not sprayed.** Wherever possible telemetry events are computed
  FROM immutable run artifacts (analysis duration, detector outcomes, priced/
  unpriced counts, provider used, capability profile, provenance mix) — which
  makes them deterministic, reproducible, and auditable by construction.
  Interaction events (onboarding step reached, mapping completed, assumption
  confirmed, export clicked) are appended at the effectful edge only.
- **Event taxonomy is versioned** like signals (`tm-<name>@x.y.z`), with a
  registry; schema changes bump versions; artifacts pin them.
- **Privacy-preserving by construction**: no titles, no actor values, no
  assumption VALUES (only provenance states and counts), org-scoped ids only —
  the same reporting-layer discipline (FR-17/N1) applied to exhaust.
- **Local-first, opt-in outward**: in the CLI era events append to a local
  JSONL; nothing leaves the machine without explicit opt-in (doc 08 §11
  posture). The funnel metrics named in the directive (onboarding completion,
  connector success/failure, mapping completion, assumption confirmation,
  first report, first priced friction, simulation usage, export, duration,
  provider-specific failures) define the initial taxonomy.
- P4's onboarding flow ships pre-instrumented because P3 lands first — the
  R4/R7 tripwires from doc 06 become measured quantities on day one.

### P4 — Self-serve spine + onboarding (doc 08 M2, resurrected and sharpened)

- Postgres (append-only batches/runs, two-layer tenancy), managed auth,
  React/Vite web app — the stack decisions of doc 08 §4 stand.
- Onboarding flow = the product form of everything M1 proved: connect (token
  paste or CSV upload) → status→stage-kind mapping wizard (human-confirmed;
  provider metadata as suggestion only — cu01's "testing typed done" lesson) →
  actor→role mapping with pseudonymization default → **assumption capture via
  the accept-to-confirm ladder** (vendor suggestions become customer-accepted
  by explicit act — the provenance model's product debut) → first report in
  report mode, unlocks named per unpriced friction.
- DoD: a new user reaches an honest first report unassisted in <30 min
  (doc 00's bar, now with connectors); FR-17 attribution guard enforced at
  the API layer; deletion cascade works end-to-end.

### P5 — Reporting experience

Dashboard (ranked frictions, context signals, coverage lines), trend view
over run history (the diff machinery gets its UI), drill-down rendering of
formula traces (the four E1 questions as interactive surfaces, not markdown),
executive export (doc 08 M3's strip-test PDF). Confidence tiers and
provenance labels rendered as first-class UI, not footnotes.

### P6 — Scenario engine + simulation experience

Doc 07 §3's counterfactual replay, starting with the percentage-reduction
calculator (FR-19) and the simulation-mode register: what-if runs clearly
bannered, never rankable alongside report-mode results, transforms versioned.
This is where `--simulation` grows from a CLI flag into a product surface.

## 3. Constraints carried forward (unchanged, non-negotiable)

Purity and boundary rules (engines never see providers; `providers/*` visible
only inside ingestion); golden discipline with hand-computed expectations
before regeneration; determinism gates; privacy rules (raw actor values never
leave the edge; pseudonymization mandatory); provenance-gated report mode;
N-rules incl. N5 (no write-back to source systems — connectors are read-only
by construction); M1 partner-data rules whenever real workspaces appear.
Detector families stay frozen; if platform work surfaces a concrete detector
need, it gets a doc-12-style design note first, per the docs 12–14 admission
rules.

## 4. What P1 explicitly does NOT include

OAuth flows (token auth first; OAuth arrives with the web app in P3),
webhooks/live sync (doc 05: scheduled pull comes first, and only post-P3),
incremental sync, rate-limit backoff sophistication beyond politeness,
Jira Server/Data Center (Cloud only), and any schema change to the canonical
model — schema pressure discovered while building connectors is recorded for
review, exactly as in M1.
