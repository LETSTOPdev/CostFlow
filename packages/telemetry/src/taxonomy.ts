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
