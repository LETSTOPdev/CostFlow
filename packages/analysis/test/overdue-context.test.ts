import { describe, expect, it } from 'vitest';
import type { AssumptionSet, ImportBatch, WorkItem } from '@costflow/domain';
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
    overdueAttentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
};

function item(id: string, overrides: Partial<WorkItem>): WorkItem {
  return {
    id,
    sourceId: id,
    title: `Item ${id}`,
    stage: { name: 'Doing', kind: 'active' },
    actor: { kind: 'role', roleRef: 'Ops' },
    createdAt: '2026-05-01',
    dueAt: null,
    lastUpdatedAt: null,
    ...overrides,
  };
}

function batch(items: WorkItem[]): ImportBatch {
  return {
    id: 'b',
    provider: 'csv',
    mappingTemplateId: 'm',
    mappingTemplateVersion: '1',
    importedAt: NOW,
    counts: { totalRows: items.length, imported: items.length, dropped: 0 },
    diagnostics: [],
    capability: {
      hasEventHistory: false,
      hasDueDates: items.some((i) => i.dueAt !== null),
      hasLastUpdated: items.some((i) => i.lastUpdatedAt !== null),
      hasActors: true,
    },
    evidence: [],
    pseudonymizationScope: null,
    items,
    events: [],
  };
}

describe('F3 in the analysis pipeline (doc 12 §10) + F6 as context (doc 14)', () => {
  it('adding due dates changes only F3 — F2 estimates stay byte-identical', () => {
    const base = [item('stale', { lastUpdatedAt: '2026-06-01' })];
    const withDue = [item('stale', { lastUpdatedAt: '2026-06-01', dueAt: '2026-07-10' })];
    const runBase = runAnalysis({ runId: 'r', now: NOW, batch: batch(base), assumptions });
    const runDue = runAnalysis({ runId: 'r', now: NOW, batch: batch(withDue), assumptions });

    const f2 = (run: typeof runBase) =>
      run.estimates.filter((e) => e.costModelId === 'cm-aging-attention');
    // dueAt appears inside batch items, so compare F2 estimate content, which
    // is the invariance that matters: same instance, same numbers, same trace.
    expect(JSON.stringify(f2(runDue))).toBe(JSON.stringify(f2(runBase)));
    expect(runDue.estimates.some((e) => e.costModelId === 'cm-overdue-attention')).toBe(true);
    expect(runBase.detectors.find((d) => d.signalId === 'f3-overdue')?.status).toBe('skipped');
  });

  it('an item unevaluable by F2 (no lastUpdated) is still priced by F3 — complementarity', () => {
    const run = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('ghost', { dueAt: '2026-07-01', lastUpdatedAt: null })]),
      assumptions,
    });
    expect(run.detectors.find((d) => d.signalId === 'f2-aging')?.status).toBe('skipped');
    expect(run.frictions.map((f) => f.frictionType)).toEqual(['overdue']);
    expect(run.estimates[0]?.costModelId).toBe('cm-overdue-attention');
  });

  it('context observations exist, are versioned, and never enter frictions/pricing/estimates', () => {
    const run = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('a', {}), item('b', { stage: { name: 'Backlog', kind: 'queue' } })]),
      assumptions,
    });
    expect(run.context).toHaveLength(1);
    const observation = run.context[0];
    expect(observation).toMatchObject({ signalId: 'c6-wip-load', signalVersion: '1.0.0' });
    expect(observation?.statement).toContain('1 of 2 in-flight items (50%)');
    // Structurally incapable of carrying money or grades:
    expect(Object.keys(observation ?? {}).sort()).toEqual([
      'facts',
      'signalId',
      'signalName',
      'signalVersion',
      'statement',
    ]);
    // And never referenced by the pricing pipeline:
    expect(run.frictions.some((f) => f.signalId.startsWith('c6'))).toBe(false);
    expect(run.pricing.some((p) => p.frictionInstanceId.startsWith('c6'))).toBe(false);
    expect(JSON.stringify(run.estimates)).not.toContain('c6-wip-load');
  });

  it('context computation cannot alter estimates: runs with identical frictions but different pooling produce identical estimates', () => {
    // Same priced item; second run adds done items that change nothing in-flight.
    const a = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('late', { dueAt: '2026-07-01' })]),
      assumptions,
    });
    const b = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([
        item('late', { dueAt: '2026-07-01' }),
        item('closed', { stage: { name: 'Done', kind: 'done' } }),
      ]),
      assumptions,
    });
    expect(JSON.stringify(a.estimates)).toBe(JSON.stringify(b.estimates));
  });

  it('report mode unprices instances touching vendor-suggested inputs; simulation mode prices them with caps (doc 03 P4 amended)', () => {
    // Missing actor → vendor-suggested default rate becomes load-bearing.
    const items = [item('late-unowned', { dueAt: '2026-07-01', actor: { kind: 'missing' } })];

    const report = runAnalysis({ runId: 'r', now: NOW, batch: batch(items), assumptions });
    expect(report.pricingPolicy).toBe('report');
    expect(report.estimates).toHaveLength(0);
    const outcome = report.pricing[0];
    expect(outcome?.status).toBe('skipped');
    expect(outcome?.reason).toContain('vendor-suggested');
    expect(outcome?.reason).toContain('defaultRate:missing-actor');
    expect(outcome?.reason).toContain('simulation mode');

    const simulation = runAnalysis(
      { runId: 'r', now: NOW, batch: batch(items), assumptions, mode: 'simulation' },
      undefined,
    );
    expect(simulation.pricingPolicy).toBe('simulation');
    expect(simulation.estimates).toHaveLength(1);
    expect(simulation.estimates[0]?.confidence.tier).toBe('C');

    // Same inputs, both modes: friction detection is identical — policy only
    // gates pricing, never detection.
    expect(JSON.stringify(report.frictions)).toBe(JSON.stringify(simulation.frictions));
  });

  it('customer-accepted provenance is customer-owned: prices in report mode', () => {
    const accepted: AssumptionSet = {
      ...assumptions,
      parameters: {
        ...assumptions.parameters,
        overdueAttentionHoursPerDay: {
          range: { low: '0.1', expected: '0.2', high: '0.4' },
          provenance: 'customer-accepted',
        },
      },
    };
    const run = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('late', { dueAt: '2026-07-01' })]),
      assumptions: accepted,
    });
    expect(run.estimates).toHaveLength(1);
    expect(run.estimates[0]?.confidence.tier).toBe('A');
  });

  it('empty in-flight set → no context observation, not a fabricated one', () => {
    const run = runAnalysis({
      runId: 'r',
      now: NOW,
      batch: batch([item('closed', { stage: { name: 'Done', kind: 'done' } })]),
      assumptions,
    });
    expect(run.context).toEqual([]);
  });
});
