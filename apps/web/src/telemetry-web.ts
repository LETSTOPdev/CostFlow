import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TelemetryEvent } from '@costflow/telemetry';
import { serializeTelemetry } from '@costflow/telemetry';

/**
 * Web-edge interaction telemetry (doc 09 P4.1 plan §6): the onboarding
 * funnel. Constructors live ONLY at this edge (P3 separation law); fields
 * are counts/enums/booleans only — never customer vocabulary. Local file,
 * failure-contained, no transport (P3 privacy posture unchanged).
 */

export type WebTelemetryEventName =
  | 'tm-web-signin'
  | 'tm-web-workspace-connected'
  | 'tm-web-scope-selected'
  | 'tm-web-statuses-mapped'
  | 'tm-web-actors-mapped'
  | 'tm-web-assumptions-confirmed'
  | 'tm-web-run'
  | 'tm-web-report-viewed'
  | 'tm-web-data-deleted'
  | 'tm-web-org-renamed'
  | 'tm-web-member-invited'
  | 'tm-web-invite-accepted'
  | 'tm-web-invite-revoked'
  | 'tm-web-member-role-changed'
  | 'tm-web-member-removed'
  | 'tm-web-workspace-member-added'
  | 'tm-web-workspace-member-removed';

export function webEvent(
  event: WebTelemetryEventName,
  fields: Readonly<Record<string, unknown>>,
): TelemetryEvent {
  return {
    event,
    version: '1.0.0',
    kind: 'interaction',
    at: new Date(Date.now()).toISOString(),
    fields,
  };
}

export type TelemetrySink = (event: TelemetryEvent) => void;

/** Default sink: same local interaction log the CLI edge uses. */
export function fileTelemetrySink(): TelemetrySink {
  return (event) => {
    try {
      const toggle = process.env['COSTFLOW_TELEMETRY'];
      if (toggle === 'off' || toggle === '0') return;
      const dir = process.env['COSTFLOW_TELEMETRY_DIR'] ?? '.costflow';
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'interactions.jsonl'), serializeTelemetry([event]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Warning: interaction telemetry not recorded (${message}) — request unaffected.`,
      );
    }
  };
}
