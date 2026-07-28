import { describe, expect, it } from 'vitest';
import type { AssumptionSet, ImportBatch, WorkItem, WorkItemEvent } from '@costflow/domain';
import { runAnalysis } from '@costflow/analysis';

const NOW = '2026-07-20T00:00:00Z';

const assumptions: AssumptionSet = {
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [{ roleRef: 'Ops', hourlyRate: '90', provenance: 'customer-customized' }],
  defaultRate: { hourlyRate: '75', provenance: 'vendor-suggested' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
};

function item(id: string, stage: WorkItem['stage'], lastUpdatedAt: string | null): WorkItem {
  return {
    id,
    sourceId: id,
    originScopeId: null,
    title: `Item ${id}`,
    stage,
    actor: { kind: 'role', roleRef: 'Ops' },
    createdAt: '2026-05-01',
    dueAt: null,
    lastUpdatedAt,
  };
}

function batch(items: WorkItem[], events: WorkItemEvent[] = []): ImportBatch {
  return {
    id: 'b',
    provider: 'csv',
    mappingTemplateId: 'm',
    mappingTemplateVersion: '1',
    importedAt: NOW,
    counts: { totalRows: items.length, imported: items.length, dropped: 0 },
    diagnostics: [],
    capability: {
      hasEventHistory: events.length > 0,
      hasDueDates: false,
      hasLastUpdated: items.some((i) => i.lastUpdatedAt !== null),
      hasActors: true,
    },
    evidence: [],
    scopes: [],
    pseudonymizationScope: null,
    items,
    events,
  };
}

const REVIEW = { name: 'Review', kind: 'review' } as const;
const staleItem = item('stale', { name: 'Doing', kind: 'active' }, '2026-06-01');

describe('analysis dispatch through the cost-model registry (R-11)', () => {
  it('prices instances whose model is ready and records priced outcomes', () => {
    const run = runAnalysis({ runId: 'r', now: NOW, batch: batch([staleItem]), assumptions });
    expect(run.pricing).toEqual([
      {
        frictionInstanceId: 'f2-aging:doing',
        status: 'priced',
        costModelId: 'cm-aging-attention',
        costModelVersion: '1.0.0',
      },
    ]);
    expect(run.estimates).toHaveLength(1);
  });

  it('a friction whose model lacks its assumption is skipped visibly, not crashed or hidden', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'waiting', from: null, to: REVIEW, at: '2026-07-01T00:00:00Z' },
    ];
    const run = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('waiting', REVIEW, null)], events),
      assumptions, // no queueWaitAttentionHoursPerDay
    });
    const queueOutcome = run.pricing.find((p) => p.frictionInstanceId.startsWith('f1-queue-wait'));
    expect(queueOutcome?.status).toBe('skipped');
    expect(queueOutcome?.reason).toContain('queueWaitAttentionHoursPerDay');
    expect(run.frictions).toHaveLength(1);
    expect(run.estimates).toHaveLength(0);
  });

  it('a signal with no registered model is skipped with an explicit reason', () => {
    const run = runAnalysis(
      { runId: 'r', now: NOW, batch: batch([staleItem]), assumptions },
      {}, // empty registry — the injectable seam exists exactly for this test
    );
    expect(run.pricing).toEqual([
      {
        frictionInstanceId: 'f2-aging:doing',
        status: 'skipped',
        reason: 'No cost model registered for signal "f2-aging".',
      },
    ]);
  });

  it('adding event history does not alter unrelated F2 results (Part C req 12)', () => {
    const items = [staleItem, item('waiting', REVIEW, '2026-07-19')];
    const events: WorkItemEvent[] = [
      { workItemId: 'waiting', from: null, to: REVIEW, at: '2026-07-01T00:00:00Z' },
    ];
    const without = runAnalysis({ runId: 'r', now: NOW, batch: batch(items), assumptions });
    const withEvents = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch(items, events),
      assumptions,
    });
    const f2 = (run: typeof without) =>
      run.estimates.filter((e) => e.costModelId === 'cm-aging-attention');
    expect(JSON.stringify(f2(withEvents))).toBe(JSON.stringify(f2(without)));
  });

  it('multi-signal runs are deterministic end to end', () => {
    const fullAssumptions: AssumptionSet = {
      ...assumptions,
      parameters: {
        ...assumptions.parameters,
        queueWaitAttentionHoursPerDay: {
          range: { low: '0.1', expected: '0.2', high: '0.4' },
          provenance: 'customer-customized',
        },
      },
    };
    const items = [staleItem, item('waiting', REVIEW, null)];
    const events: WorkItemEvent[] = [
      { workItemId: 'waiting', from: null, to: REVIEW, at: '2026-07-01T00:00:00Z' },
    ];
    const make = () =>
      JSON.stringify(
        runAnalysis({
          runId: 'r',
          now: NOW,
          batch: batch(items, events),
          assumptions: fullAssumptions,
        }),
      );
    expect(make()).toBe(make());
  });
});
