/**
 * Telemetry taxonomy v1 (doc 15 P3, frozen in doc 09 before code).
 *
 * Two kinds with a hard line between them:
 *  - 'derived': pure functions of the immutable AnalysisRun artifact —
 *    deterministic, reproducible, auditable by construction. Emitted only by
 *    deriveRunTelemetry in this package.
 *  - 'interaction': effectful-edge measurements (wall clock, durations,
 *    outcomes). Constructed ONLY in apps/* — this package deliberately
 *    exports no interaction constructor.
 *
 * Versioning law: any field addition/removal/semantic change bumps the event
 * version. Emitters may only emit registered events (asserted by test).
 *
 * Privacy: events carry counts, booleans, durations, engine-owned
 * identifiers, the opaque runId, and the pinned analysis time — never
 * titles, stage names (or instance ids, which embed stage slugs), actor
 * values or pseudonyms, role names, emails, money, magnitudes, assumption
 * values, customer-authored ids, org scopes, salts, paths, or site/project
 * identifiers (doc 09 P3 constraints).
 */
export type TelemetryKind = 'derived' | 'interaction';

export interface TelemetryEvent {
  readonly event: string;
  readonly version: string;
  readonly kind: TelemetryKind;
  /** Derived: the run's pinned analysis time. Interaction: edge wall clock. */
  readonly at: string;
  /** Present on derived events only in v1 (funnel linkage is a P4 decision). */
  readonly runId?: string | undefined;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface TelemetryEventMeta {
  readonly event: string;
  readonly version: string;
  readonly kind: TelemetryKind;
  readonly description: string;
}

export const TELEMETRY_TAXONOMY: readonly TelemetryEventMeta[] = [
  {
    event: 'tm-run',
    version: '1.0.0',
    kind: 'derived',
    description:
      'One per analysis run: policy, provider, counts, capability, tiers, pricing outcomes, provenance mix.',
  },
  {
    event: 'tm-detector',
    version: '1.0.0',
    kind: 'derived',
    description: 'One per detector outcome, in engine order: status and instance count.',
  },
  {
    event: 'tm-cli-analyze',
    version: '1.0.0',
    kind: 'interaction',
    description: 'CLI analyze invocation outcome and duration.',
  },
  {
    event: 'tm-cli-fetch',
    version: '1.0.0',
    kind: 'interaction',
    description: 'CLI fetch invocation outcome and duration.',
  },
  {
    event: 'tm-cli-preflight',
    version: '1.0.0',
    kind: 'interaction',
    description: 'CLI preflight invocation outcome and duration.',
  },
  // P4.1 onboarding funnel (web edge) — additive registry entries.
  {
    event: 'tm-web-signin',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Web sign-in outcome.',
  },
  {
    event: 'tm-web-workspace-connected',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Provider workspace connected (or refused) in the web app.',
  },
  {
    event: 'tm-web-scope-selected',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Imported scope chosen for a connected workspace.',
  },
  {
    event: 'tm-web-statuses-mapped',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Status mapping step completed (counts only).',
  },
  {
    event: 'tm-web-actors-mapped',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Actor-to-role mapping step completed (counts only).',
  },
  {
    event: 'tm-web-assumptions-confirmed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Assumption capture completed: accepted/customized/vendor-remaining counts.',
  },
  {
    event: 'tm-web-run',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Web-initiated analysis job outcome and duration.',
  },
  {
    event: 'tm-web-report-viewed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Report page viewed; flags the first view of a run.',
  },
  // P4.3 data lifecycle (FR-22): permanent deletion. Scope enum + cascade
  // count only — never an identity, workspace name, or customer id.
  {
    event: 'tm-web-data-deleted',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Permanent deletion completed: scope (workspace|org) and cascaded run count.',
  },
  // P4.4 organization & membership management. All fields are enums/counts —
  // never emails, org names, tokens, or user ids.
  {
    event: 'tm-web-org-renamed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Organization display name changed (no name value carried).',
  },
  {
    event: 'tm-web-member-invited',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Invitation created for a role (role enum only).',
  },
  {
    event: 'tm-web-invite-accepted',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Invitation accepted at sign-in; joined role (role enum only).',
  },
  {
    event: 'tm-web-invite-revoked',
    version: '1.0.0',
    kind: 'interaction',
    description: 'Pending invitation revoked.',
  },
  {
    event: 'tm-web-member-role-changed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'A member role was changed (new role enum only).',
  },
  {
    event: 'tm-web-member-removed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'A member was removed from the organization.',
  },
  {
    event: 'tm-web-workspace-member-added',
    version: '1.0.0',
    kind: 'interaction',
    description: 'A member was granted access to a workspace.',
  },
  {
    event: 'tm-web-workspace-member-removed',
    version: '1.0.0',
    kind: 'interaction',
    description: 'A member workspace access grant was revoked.',
  },
];

/** One JSONL line per event, fixed envelope key order — byte-deterministic. */
export function serializeTelemetry(events: readonly TelemetryEvent[]): string {
  return events
    .map((e) =>
      JSON.stringify(
        e.runId === undefined
          ? { event: e.event, version: e.version, kind: e.kind, at: e.at, fields: e.fields }
          : {
              event: e.event,
              version: e.version,
              kind: e.kind,
              at: e.at,
              runId: e.runId,
              fields: e.fields,
            },
      ),
    )
    .map((line) => `${line}\n`)
    .join('');
}
