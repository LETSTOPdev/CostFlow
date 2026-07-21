import { describe, expect, it } from 'vitest';
import { importCsv } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import type { AssumptionSet } from '@costflow/domain';
import {
  TELEMETRY_TAXONOMY,
  classifySkipReason,
  deriveRunTelemetry,
  serializeTelemetry,
} from '@costflow/telemetry';

const assumptions: AssumptionSet = {
  id: 'test-assumptions',
  version: '1',
  currency: 'USD',
  rates: [{ roleRef: 'Ops', hourlyRate: '90', provenance: 'customer-measured' }],
  defaultRate: { hourlyRate: '30', provenance: 'vendor-suggested' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.15', expected: '0.3', high: '0.6' },
      provenance: 'customer-accepted',
    },
  },
};

function makeRun() {
  const batch = importCsv({
    batchId: 'batch-t',
    csvText: [
      'ID,Title,Status,Actor,Updated,Due',
      '1,Secret Alpha,Open,Known Person,2026-06-01,2026-07-01',
      '2,Secret Beta,Weird,,2026-06-02,',
    ].join('\n'),
    mapping: {
      id: 'secret-mapping',
      version: '9',
      columns: {
        itemId: 'ID',
        title: 'Title',
        status: 'Status',
        actor: 'Actor',
        lastUpdatedAt: 'Updated',
        dueAt: 'Due',
      },
      statusMap: { Open: 'active' },
      actorRoleMap: { 'Known Person': 'Ops' },
    },
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: { scopeId: 'secret-org', pseudonymFor: () => 'anon-abcdef012345' },
  });
  return runAnalysis({ runId: 'run-t', now: '2026-07-20T00:00:00Z', batch, assumptions });
}

describe('deriveRunTelemetry (P3 proofs at unit level)', () => {
  it('proof 4: deterministic — two derivations serialize byte-identically', () => {
    expect(serializeTelemetry(deriveRunTelemetry(makeRun()))).toBe(
      serializeTelemetry(deriveRunTelemetry(makeRun())),
    );
  });

  it('proof 1: derivation does not mutate the run artifact', () => {
    const run = makeRun();
    const before = JSON.stringify(run);
    deriveRunTelemetry(run);
    expect(JSON.stringify(run)).toBe(before);
  });

  it('proof 5: emits only taxonomy-registered derived events, stamped with the pinned time', () => {
    const registeredDerived = new Set(
      TELEMETRY_TAXONOMY.filter((m) => m.kind === 'derived').map((m) => `${m.event}@${m.version}`),
    );
    for (const event of deriveRunTelemetry(makeRun())) {
      expect(event.kind).toBe('derived');
      expect(registeredDerived.has(`${event.event}@${event.version}`)).toBe(true);
      expect(event.at).toBe('2026-07-20T00:00:00Z'); // run.now, never a clock
      expect(event.runId).toBe('run-t');
    }
  });

  it('proof 3: counts and states only — no titles, stages, actors, ids, or values', () => {
    const serialized = serializeTelemetry(deriveRunTelemetry(makeRun()));
    for (const secret of [
      'Secret Alpha',
      'Secret Beta',
      'Open', // stage name
      'Weird',
      'Known Person',
      'anon-', // even pseudonyms stay out
      'Ops', // role name
      'secret-mapping', // customer-authored mapping id
      'secret-org', // pseudonymization scope
      '"90"', // rate value
      '"30"',
      'USD',
    ]) {
      expect(serialized, `must not contain ${secret}`).not.toContain(secret);
    }
  });

  it('counts provenance states across rates, defaultRate, and present parameters only', () => {
    const [runEvent] = deriveRunTelemetry(makeRun());
    expect(runEvent?.fields['provenanceMix']).toEqual({
      vendorSuggested: 1, // defaultRate
      customerAccepted: 1, // attentionHoursPerDay
      customerCustomized: 1, // agingThresholdDays
      customerMeasured: 1, // rates.Ops
    });
    // Optional queue-wait/overdue parameters are absent and NOT counted.
  });

  it('classifies skip reasons by engine-owned prefixes, deterministically', () => {
    expect(classifySkipReason('Rests on vendor-suggested assumption(s): x')).toBe(
      'vendorSuggestedGate',
    );
    expect(classifySkipReason('Missing assumption parameters.x — add it')).toBe(
      'missingAssumption',
    );
    expect(classifySkipReason('No cost model registered for signal "x".')).toBe('noCostModel');
    expect(classifySkipReason('Anything else')).toBe('other');
    expect(classifySkipReason(undefined)).toBe('other');
  });

  it('records skipped detectors with a missing-capability class', () => {
    const run = makeRun(); // no events → f1-queue-wait skipped
    const detectorEvents = deriveRunTelemetry(run).filter((e) => e.event === 'tm-detector');
    const queueWait = detectorEvents.find((e) => e.fields['signalId'] === 'f1-queue-wait');
    expect(queueWait?.fields['status']).toBe('skipped');
    expect(queueWait?.fields['skipReasonClass']).toBe('missing-capability');
  });
});
