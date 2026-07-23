# ADR-0005 — Multi-platform connector architecture

**Status**: accepted · **Binds**: doc 06 N4, doc 15 P1/P2 (provider SPI), BIBLE §3 invariant 9

## Context

CostFlow is a deterministic Work Intelligence platform; Jira was the first
connector, not the product. The engine (pure packages) was provider-agnostic
from P1 — canonical `ImportBatch`, per-provider transforms under
`ingestion/providers/<id>/`, a conformance suite every transform must pass —
but the **web product layer had fossilized around Jira**: `WorkspaceRecord`
hard-coded the Jira credential triple (`site`/`email`/token) with
`provider: 'jira'` as a type literal, `ServerDeps` was typed against
`JiraGateway` by name, `jobs.ts` called `transformJira` unconditionally, and
`/connect`–`/scope` rendered Jira-only forms and vocabulary. The N4 rule
("provider concepts must not leak past the ingestion SPI") was enforced by
dependency-cruiser for pure packages only — `apps/` was exempt, exactly where
the violations lived.

## Decision

**1. The web app gets a first-class connector layer** (`apps/web/src/connectors/`):

- `types.ts` — the contract. A `Connector` is a descriptor (onboarding
  vocabulary + form fields), an effectful `ConnectorGateway`
  (`listScopes`/`fetchAll` → an opaque provider-private `RawFetch` bundle),
  and pure adapters (`parseConnectForm`, `describeConnection`, `observe`,
  `buildBatch`). This mirrors the engine SPI's fetch/transform split: the
  gateway is the effectful half at the edge; `buildBatch` delegates to the
  pure ingestion transform.
- `registry.ts` — static, explicit wiring; no plugins, no reflection (R-11).
  The composition root (`main.ts`) builds each connector around its
  production HTTP gateway; tests build the same registry around stubs.
- One module per platform (`jira.ts`, `clickup.ts`) owning ALL of that
  platform's product-layer knowledge: wire shapes, credential layout, copy,
  help text, scope naming, status-hint derivation.

**2. The workspace data model is provider-shaped, not Jira-shaped.**
`WorkspaceRecord.provider` is an open string; the Jira triple is replaced by
`connectionParams` (non-secret, connector-defined shape) + `tokenCiphertext`
(the one secret, AES-encrypted); `projectKey`/`projectName` generalize to
`scopeId`/`scopeName` (kept on the legacy DB columns); `statusHints` stores
connector-suggested status→stage defaults captured at scope time. The
migration is idempotent and in-place: legacy `site`/`email` columns go
nullable and backfill `connection_params` exactly once.

**3. Provider dispatch happens exactly once**, in `executeJob`: workspace
provider id → registry → `gateway.fetchAll` → `connector.buildBatch` →
`runAnalysis`. Nothing downstream of the canonical batch knows the provider.
Routes resolve the same registry for vocabulary and forms; `/connect` shows a
provider picker when nothing is connected.

**4. The N4 boundary now covers the product layer.** A dependency-cruiser
rule (`web-provider-modules-only-in-connectors`) forbids importing concrete
connector modules from anywhere in `apps/web/src` except the composition
root, the connectors directory itself, and `demo-live.ts` (which synthesizes
Jira-shaped demo data by design). Engine-side rules are unchanged.

**5. Switching platforms is a reconnect, not a migration.** Connecting a
different provider on an existing workspace replaces the connection and
resets scope/mapping/hints (onboarding returns to `connected`); runs are
append-only history and are kept. Same-provider reconnect refreshes
credentials and keeps everything.

## ClickUp (the second connector, proving the seam)

- **Scope** = a ClickUp List (discovered Workspace → Space → Folder →
  List, folderless included). **Auth** = personal API token, raw
  `Authorization` header (no Bearer), token-only connect form.
- **History**: ClickUp has no transition log; the Total-Time-in-Status
  endpoints expose per-status residency (`since` = most recent entry
  instant). Derivation rules CU1–CU5 (documented in the transform) mirror
  the J-rules: CU1 reconstructs the entry chain ordered by `since` (bounce
  sequences collapse — total wait is conserved, never overstated); CU2
  derives arrival-only events when residency is absent (ClickApp disabled);
  CU3 takes the first assignee as the actor with a counted diagnostic for
  the rest; CU4 = J3 drop/refuse asymmetry; CU5 = J2 hard error on
  truncated pagination.
- Fields no detector consumes (priority, estimates, points, custom fields,
  comments) are deliberately NOT canonicalized: the canonical model carries
  exactly what the engine prices; widening it is an engine-versioned
  decision, not a connector decision.
- Rate limits (100 req/min on most plans) are absorbed in the gateway with
  windowed 429 retries; the bulk residency endpoint takes 2–100 ids per
  call, chunks rebalanced so none is a singleton.

## Why

- **One seam, two proofs.** The abstraction was extracted from a working
  Jira implementation and immediately validated by a second, structurally
  different platform (hierarchical scopes, token-only auth, residency-style
  history). Every future connector reuses the same seam.
- **Descriptor-driven onboarding kills copy drift.** Vocabulary
  ("project"/"List", "issues"/"tasks"), form fields, and help text live in
  the connector module, so `/connect`, `/scope`, and the mapping steps are
  provider-correct by construction.
- **The engine stays frozen.** No pure-package behavior changed; all
  existing goldens are byte-identical. ClickUp adds a transform + fixtures +
  its own golden, alongside the others.
- **Honesty rules survive translation.** Every provider quirk becomes a
  named, documented derivation rule with the same posture as J1–J3: derive
  only from observed facts, degrade capabilities visibly, hard-error rather
  than silently truncate.

## Alternatives rejected

- **Bolting ClickUp onto the Jira code paths** (a `provider` switch inside
  routes/jobs): duplicates business logic per platform and makes the third
  connector quadratically worse.
- **A plugin/loader system**: runtime indirection for a compile-time-known
  set; R-11 forbids it. The registry is explicit data.
- **Normalizing credentials into typed per-provider columns**: a schema
  migration per connector. `connection_params` jsonb + one encrypted secret
  covers every token-ish auth model; OAuth flows (Linear, Azure DevOps) add
  fields inside the connector's own params shape, not new columns.
