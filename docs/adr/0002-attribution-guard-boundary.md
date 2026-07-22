# ADR-0002 — Response-layer attribution guard, fail-closed

**Status**: accepted (P4.3) · **Binds**: FR-17, NFR-5, doc 06 §15

## Decision

FR-17 — "no screen, export, or API response ranks or scores an individual" —
is enforced by a **single structural choke point at the reporting layer**, not
by UI convention. `apps/web/src/attribution.ts` exposes a pure
`findIndividualAttribution(body, observedActors)` /
`assertNoIndividualAttribution(...)`; `GET /reports/:runId` calls it on the
fully rendered report bytes immediately before responding.

If any raw observed-actor identity appears verbatim in the rendered output the
handler **fails closed**: it withholds the entire response (HTTP 500), logs a
sanitized `attribution-guard-blocked {surface, leaked:<count>}` line (a count
only — never the leaking value), and does **not** record the view. A clean
(pseudonymized) report renders normally.

The check is deterministic exact-substring matching — no heuristics, no fuzzy
matching, no AI — so the guard's behavior is fully predictable and testable.
`AttributionGuardError` carries only a count, so the leaking value cannot ride
out on an error object or a stack trace.

## Why

- **Defense in depth.** The primary control is pseudonymization at ingestion
  (NFR-5): a correct report never contains a person's raw identity. The guard
  is the last line — it turns "we believe reports are clean" into "a report
  that names a person cannot be served."
- **One choke point, not N call sites.** doc 06 §15 names the reporting layer
  as the single place individual-attribution risk concentrates. Enforcing
  there (rather than sprinkling checks through renderers) makes the guarantee
  auditable and impossible to forget when a new report surface is added — new
  surfaces route through the same handler.
- **Fail closed, not fail open.** A false positive withholds a report (a
  visible, recoverable annoyance); a false negative would leak an individual's
  cost attribution (a privacy breach). The asymmetry dictates the direction:
  when in doubt, withhold.
- **Count-only diagnostics.** Operators need to know the guard fired without
  the log itself becoming the leak. The error and the log carry a count and a
  surface tag, never the matched value.

## Scope & limits

- The guard covers the rendered report surface (`GET /reports/:runId`). There
  is no run-JSON download or export surface yet; when one is added it MUST call
  the same guard before emitting bytes (this ADR is the standing requirement).
- The match is against the workspace's `observedActors` (the raw identity
  vocabulary captured at onboarding). Empty/whitespace actor values are ignored
  — they cannot identify anyone.
