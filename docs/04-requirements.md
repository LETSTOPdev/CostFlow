# 04 — Functional & Non-Functional Requirements

Requirements are numbered for traceability (FR-x / NFR-x) and tagged
**[MVP]** or **[Post-MVP]**. "Must/never" language is deliberate.

## 1. Functional Requirements

### Ingestion & mapping

- **FR-1 [MVP]** Users can upload CSV files exported from external tools; the
  system parses common encodings/delimiters and reports unparseable rows with
  reasons rather than failing the whole file.
- **FR-2 [MVP]** A mapping wizard maps source columns to canonical fields and
  source statuses to canonical `stage_kind`s. The system proposes a mapping
  (heuristic + AI-suggested, doc 05); the user confirms. Nothing is ingested on
  an unconfirmed mapping.
- **FR-3 [MVP]** Mappings are saved as versioned MappingTemplates, reusable and
  editable; a re-upload matching a known shape auto-applies its template.
- **FR-4 [MVP]** Every import produces an ImportBatch with diagnostics and a
  capability profile (has history? due dates? actors/roles?) that downstream
  features consult. The user is shown, in plain language, which analyses this
  data enables and which it cannot support and why.
- **FR-5 [MVP]** Imports are immutable and re-runnable: uploading a corrected
  file creates a new batch; batches can be archived, never edited.
- **FR-6 [Post-MVP]** Live providers (Monday, Jira, ClickUp, HubSpot) feed the
  same pipeline via the same MappingTemplate machinery; live and CSV sources can
  coexist in one org.

### Assumptions

- **FR-7 [MVP]** Users manage rate cards (cost per role/team) with full version
  history; regional/industry defaults are available and visibly labeled as
  defaults until confirmed or overridden.
- **FR-8 [MVP]** Users can attach value attributions (deal value, SLA penalty,
  value-per-day) to processes or work-item types. All optional.
- **FR-9 [MVP]** Every analysis run freezes the assumption set it used;
  changing assumptions never rewrites an existing run's results — it enables a
  new run, and the user can diff the two.

### Analysis

- **FR-10 [MVP]** The system runs the MVP friction detectors (F1–F6, doc 02 §4)
  over selected import batches, producing friction instances with evidence sets.
- **FR-11 [MVP]** Detectors run only when their declared data requirements are
  met by the batch capability profile; skipped detectors are reported as skipped
  with the reason (graceful degradation is visible, not silent).
- **FR-12 [MVP]** The cost engine prices friction instances per the F×→C×
  contract, producing CostEstimates as ranges with confidence tiers, model
  versions, assumption references, and full formula traces (doc 03).
- **FR-13 [MVP]** Frictions lacking required value attributions are shown with
  time-denominated magnitude and an "attach value to price this" affordance —
  never a fabricated dollar figure.
- **FR-14 [MVP]** Analysis runs are immutable, listable, and diffable
  (trend view between any two runs over comparable scopes).

### Reporting & explainability

- **FR-15 [MVP]** A ranked friction view orders priced frictions by expected
  cost, filterable by workspace, process, team, friction type, and time window.
- **FR-16 [MVP]** Every displayed number drills down to: plain-language claim,
  substituted formula, contributing work items, and assumptions with provenance
  (the four questions, doc 03 §E1).
- **FR-17 [MVP]** Attribution in all UI and exports is to process/stage/team/
  work-type only. No screen, export, or API response ranks or scores
  individuals. (Enforced at the API layer, not by UI convention — see doc 06.)
- **FR-18 [MVP]** One-click executive summary export (PDF/slides): top frictions,
  ranges with uncertainty framing intact, trend vs. prior run, methodology
  appendix auto-included.
- **FR-19 [MVP]** A simple scenario calculator per friction: "reduce by N%" →
  projected savings range, exportable as a one-page business case.
- **FR-20 [Post-MVP]** AI-drafted insight narratives, generated strictly from
  formula traces, always marked as drafts for human approval (doc 05).

### Tenancy & administration

- **FR-21 [MVP]** Organizations with basic member management (invite, remove,
  role: admin/member). Workspaces partition data within an org.
- **FR-22 [MVP]** Users can permanently delete an import batch or their entire
  org's data; deletion cascades to derived analyses.

## 2. Non-Functional Requirements

### Trust & correctness (the ones that define us)

- **NFR-1 Determinism.** Identical (data, assumptions, model versions) must
  yield byte-identical results, across time and environments. This is a tested
  invariant, not an aspiration.
- **NFR-2 Auditability.** Any historical number must be fully reconstructible:
  which batches, mappings, model versions, assumption versions produced it.
- **NFR-3 Numeric hygiene.** Money uses exact decimal arithmetic (no binary
  floats in currency paths); currency is explicit everywhere; rounding happens
  once, at display.

### Security & privacy

- **NFR-4 Tenant isolation.** Org data is hard-isolated; cross-tenant access is
  structurally impossible, not policy-suppressed. (Mechanism is an implementation
  choice; the requirement is that isolation failures are type/schema errors, not
  missing WHERE clauses.)
- **NFR-5 Data minimization.** Imported names/emails of actors are pseudonymized
  at ingestion for analytical storage; reports need roles and teams, not
  identities. We should be able to answer "what PII do you hold?" with "close to
  none, and here's the list."
- **NFR-6 Compliance posture.** Designed for GDPR from day one (deletion,
  export, processing records); SOC 2 controls planned pre-enterprise-sales, not
  retrofitted. Customer work data never trains shared models (doc 05).

### Performance & scale (honest, modest targets)

- **NFR-7** MVP scale target: 100k work items / 1M events per org, imported in
  < 5 min, full analysis run in < 2 min, drill-downs interactive (< 2s). This is
  batch analytics, not real-time infrastructure — we refuse to build for
  imaginary scale (doc 05, principles).
- **NFR-8** Assumption-edit → new-run recompute on a typical org (< 10k items)
  fast enough for the J3 interaction to feel live (< 30s).

### Operability & evolution

- **NFR-9** Cost model and detector versions are registry-listed; any run
  records exact versions; two engine versions can execute side-by-side for
  calibration.
- **NFR-10** The system is buildable and runnable by a small team: boring,
  widely-known technology; single deployable unit until scale forces otherwise;
  no distributed-systems machinery in the MVP.
- **NFR-11** Availability target for MVP is business-hours-grade (99.5%). This
  is an analytical tool, not a pager product; we spend the reliability budget on
  correctness instead.
