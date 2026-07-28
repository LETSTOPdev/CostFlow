import { describe, expect, it } from 'vitest';
import type { AssumptionSet, ImportBatch } from '@costflow/domain';
import type { AgingInstance, QueueWaitInstance } from '@costflow/friction';
import { COST_MODEL_REGISTRY } from '@costflow/cost-engine';

const assumptions: AssumptionSet = {
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [],
  defaultRate: { hourlyRate: '75', provenance: 'vendor-suggested' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
};

const batch: ImportBatch = {
  id: 'b',
  provider: 'csv',
  mappingTemplateId: 'm',
  mappingTemplateVersion: '1',
  importedAt: '2026-07-20T00:00:00Z',
  counts: { totalRows: 0, imported: 0, dropped: 0 },
  diagnostics: [],
  capability: {
    hasEventHistory: true,
    hasDueDates: false,
    hasLastUpdated: false,
    hasActors: false,
  },
  evidence: [],
  pseudonymizationScope: null,
  items: [],
  events: [],
};

const agingInstance: AgingInstance = {
  id: 'f2-aging:x',
  signalId: 'f2-aging',
  signalVersion: '1.0.0',
  frictionType: 'aging',
  location: { stage: { name: 'X', kind: 'active' } },
  magnitude: { unit: 'item-days-beyond-threshold', value: 5 },
  evidence: [],
};

const queueInstance: QueueWaitInstance = {
  id: 'f1-queue-wait:x',
  signalId: 'f1-queue-wait',
  signalVersion: '1.0.0',
  frictionType: 'queue-wait',
  location: { stage: { name: 'X', kind: 'review' } },
  magnitude: { unit: 'item-hours-waiting', value: 24 },
  evidence: [],
};

describe('cost-model registry (R-11)', () => {
  it('the wrong model refuses the wrong evidence type at runtime', () => {
    const agingModel = COST_MODEL_REGISTRY['f2-aging'];
    const queueModel = COST_MODEL_REGISTRY['f1-queue-wait'];
    expect(() => agingModel?.price(queueInstance, assumptions, batch)).toThrow(
      /cm-aging-attention cannot price "queue-wait" evidence/,
    );
    expect(() => queueModel?.price(agingInstance, assumptions, batch)).toThrow(
      /cm-queue-wait-attention cannot price "aging" evidence/,
    );
  });

  it('queue-wait pricing declares itself unavailable without its assumption (no crash, no invention)', () => {
    const queueModel = COST_MODEL_REGISTRY['f1-queue-wait'];
    const readiness = queueModel?.canPrice(assumptions);
    expect(readiness).toEqual({
      ok: false,
      reason:
        'Missing assumption parameters.queueWaitAttentionHoursPerDay — add it to price queue-wait frictions.',
    });
  });

  it('every registry entry prices exactly the signal it declares', () => {
    for (const [signalId, entry] of Object.entries(COST_MODEL_REGISTRY)) {
      expect(entry.appliesToSignal).toBe(signalId);
    }
  });
});
