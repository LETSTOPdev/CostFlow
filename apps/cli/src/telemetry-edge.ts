import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TelemetryEvent } from '@costflow/telemetry';
import { serializeTelemetry } from '@costflow/telemetry';

/**
 * The effectful half of telemetry (doc 15 P3). Two destinations, both local:
 *  - derived events → <out>/telemetry.jsonl, a per-run artifact next to
 *    run.json (deterministic, golden-frozen);
 *  - interaction events → ${COSTFLOW_TELEMETRY_DIR:-.costflow}/interactions.jsonl,
 *    an append-only local log. COSTFLOW_TELEMETRY=off disables it.
 *
 * Nothing here can leave the machine: there is no transport, only files.
 * Every write is failure-contained (P3 proof 2): telemetry trouble prints one
 * stderr warning and never alters the exit code or the analysis artifacts.
 */

function warnOnce(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Warning: ${context} not recorded (${message}) — analysis unaffected.`);
}

export function writeDerivedTelemetry(outDir: string, events: readonly TelemetryEvent[]): void {
  try {
    writeFileSync(join(outDir, 'telemetry.jsonl'), serializeTelemetry(events));
  } catch (error) {
    warnOnce('derived telemetry', error);
  }
}

/** Interaction events are constructed ONLY here at the edge (P3 proof 5). */
export function interactionEvent(
  event: 'tm-cli-analyze' | 'tm-cli-fetch' | 'tm-cli-preflight',
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

export function appendInteractionEvent(event: TelemetryEvent): void {
  try {
    const toggle = process.env['COSTFLOW_TELEMETRY'];
    if (toggle === 'off' || toggle === '0') return;
    const dir = process.env['COSTFLOW_TELEMETRY_DIR'] ?? '.costflow';
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'interactions.jsonl'), serializeTelemetry([event]));
  } catch (error) {
    warnOnce('interaction telemetry', error);
  }
}
