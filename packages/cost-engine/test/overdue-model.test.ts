import { describe, expect, it } from 'vitest';
import type { AssumptionSet } from '@costflow/domain';
import type { OverdueEvidence, OverdueInstance } from '@costflow/friction';
import { COST_MODEL_REGISTRY, priceOverdueInstance } from '@costflow/cost-engine';

const assumptions: AssumptionSet = {
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [{ roleRef: 'Ops', hourlyRate: '100', provenance: 'customer-customized' }],
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

function evidence(
  id: string,
  days: number,
  dueAt: string,
  extra: Partial<OverdueEvidence> = {},
): OverdueEvidence {
  return {
    workItemId: id,
    title: `Item ${id}`,
    actor: { kind: 'role', roleRef: 'Ops' },
    dueAt,
    overdueDays: days,
    dueBeforeCreated: false,
    sharedDueDateCohortSize: 0,
    ...extra,
  };
}

function instance(items: OverdueEvidence[]): OverdueInstance {
  return {
    id: 'f3-overdue:doing',
    signalId: 'f3-overdue',
    signalVersion: '1.0.0',
    frictionType: 'overdue',
    location: { stage: { name: 'Doing', kind: 'active' } },
    magnitude: {
      unit: 'item-days-overdue',
      value: items.reduce((s, e) => s + e.overdueDays, 0),
    },
    evidence: items,
  };
}

describe('cm-overdue-attention (doc 12 §6/§7)', () => {
  it('reaches confidence A with distinct dues and customer-owned assumptions', () => {
    const estimate = priceOverdueInstance(
      instance([evidence('a', 10, '2026-07-10'), evidence('b', 5, '2026-07-15')]),
      assumptions,
    );
    // 10×0.2×100 + 5×0.2×100 = 300 expected; low 150; high 600.
    expect(estimate.cost).toEqual({ low: '150', expected: '300', high: '600' });
    expect(estimate.confidence).toEqual({ tier: 'A', reasons: [] });
    expect(estimate.trace.terms.every((t) => t.kind === 'overdue-attention')).toBe(true);
    // Auditor's first question answered in every term: overdue relative to what?
    for (const term of estimate.trace.terms) {
      expect(term.kind === 'overdue-attention' && term.dueAt).toBeTruthy();
    }
  });

  it('caps at B when one due date covers more than half the evidence (milestone gate)', () => {
    const estimate = priceOverdueInstance(
      instance([
        evidence('a', 10, '2026-07-01'),
        evidence('b', 8, '2026-07-01'),
        evidence('c', 5, '2026-07-15'),
      ]),
      assumptions,
    );
    expect(estimate.confidence.tier).toBe('B');
    expect(estimate.confidence.reasons[0]).toContain('2 of 3 items');
    expect(estimate.confidence.reasons[0]).toContain('milestone gate');
  });

  it('a cohort of 1 or an exact 50% split is NOT a cluster (version-bound semantics)', () => {
    const single = priceOverdueInstance(instance([evidence('solo', 7, '2026-07-10')]), assumptions);
    expect(single.confidence.tier).toBe('A');
    const half = priceOverdueInstance(
      instance([
        evidence('a', 9, '2026-07-01'),
        evidence('b', 6, '2026-07-01'),
        evidence('c', 4, '2026-07-10'),
        evidence('d', 2, '2026-07-12'),
      ]),
      assumptions,
    );
    expect(half.confidence.tier).toBe('A'); // 2 of 4 = exactly half → no cap
  });

  it('caps at B when dueBeforeCreated items are included, and at C for default-rate actors', () => {
    const suspect = priceOverdueInstance(
      instance([evidence('a', 10, '2026-07-01', { dueBeforeCreated: true })]),
      assumptions,
    );
    expect(suspect.confidence.tier).toBe('B');
    expect(suspect.confidence.reasons[0]).toContain('precedes their creation');

    const missingActor = priceOverdueInstance(
      instance([evidence('a', 10, '2026-07-01', { actor: { kind: 'missing' } })]),
      assumptions,
    );
    expect(missingActor.confidence.tier).toBe('C');
  });

  it('caps at C when the overdue assumption is vendor-suggested', () => {
    const withDefault: AssumptionSet = {
      ...assumptions,
      parameters: {
        ...assumptions.parameters,
        overdueAttentionHoursPerDay: {
          range: { low: '0.1', expected: '0.2', high: '0.4' },
          provenance: 'vendor-suggested',
        },
      },
    };
    const estimate = priceOverdueInstance(instance([evidence('a', 10, '2026-07-01')]), withDefault);
    expect(estimate.confidence.tier).toBe('C');
    expect(estimate.confidence.reasons[0]).toContain('vendor-suggested');
  });

  it('registry: declares itself unavailable without its assumption; refuses wrong evidence', () => {
    const entry = COST_MODEL_REGISTRY['f3-overdue'];
    const bare: AssumptionSet = {
      ...assumptions,
      parameters: {
        agingThresholdDays: assumptions.parameters.agingThresholdDays,
        attentionHoursPerDay: assumptions.parameters.attentionHoursPerDay,
      },
    };
    expect(entry?.canPrice(bare)).toEqual({
      ok: false,
      reason:
        'Missing assumption parameters.overdueAttentionHoursPerDay — add it to price overdue frictions.',
    });
    const agingInstance = {
      id: 'f2-aging:x',
      signalId: 'f2-aging',
      signalVersion: '1.0.0',
      frictionType: 'aging',
      location: { stage: { name: 'X', kind: 'active' } },
      magnitude: { unit: 'item-days-beyond-threshold', value: 1 },
      evidence: [],
    } as const;
    expect(() => entry?.price(agingInstance, assumptions, {} as never)).toThrow(
      /cm-overdue-attention cannot price "aging" evidence/,
    );
  });
});
