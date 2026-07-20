import { describe, expect, it } from 'vitest';
import type { AssumptionSet } from '@costflow/domain';
import { resolveActorRate } from '@costflow/cost-engine';

const assumptions: AssumptionSet = {
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [
    { roleRef: 'Legal', hourlyRate: '120', provenance: 'customer-customized' },
    { roleRef: 'Temp', hourlyRate: '50', provenance: 'vendor-suggested' },
  ],
  defaultRate: { hourlyRate: '75', provenance: 'vendor-suggested' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
};

describe('resolveActorRate (R-20 rules 8–10)', () => {
  it('mapped role with a customer rate: no confidence cap, role-labeled source', () => {
    const r = resolveActorRate(assumptions, { kind: 'role', roleRef: 'Legal' });
    expect(r).toEqual({
      hourlyRate: '120',
      provenance: 'customer-customized',
      source: 'rates.Legal',
      cap: null,
    });
  });

  it('mapped role with a default-provenance rate is capped', () => {
    const r = resolveActorRate(assumptions, { kind: 'role', roleRef: 'Temp' });
    expect(r.cap?.tier).toBe('C');
  });

  it('mapped role WITHOUT a rate entry falls to default rate — never another role (rule 9)', () => {
    const r = resolveActorRate(assumptions, { kind: 'role', roleRef: 'Unbudgeted' });
    expect(r.hourlyRate).toBe('75');
    expect(r.source).toBe('defaultRate:role-without-rate');
    expect(r.cap?.tier).toBe('C');
  });

  it('unknown (pseudonymized) and missing actors are distinguishable and capped (rule 10)', () => {
    const unknown = resolveActorRate(assumptions, { kind: 'unknown', pseudonym: 'anon-abc' });
    const missing = resolveActorRate(assumptions, { kind: 'missing' });
    expect(unknown.source).toBe('defaultRate:unmapped-actor');
    expect(missing.source).toBe('defaultRate:missing-actor');
    expect(unknown.cap?.tier).toBe('C');
    expect(missing.cap?.tier).toBe('C');
    // The pseudonym itself never leaks into the trace label.
    expect(unknown.source).not.toContain('anon-abc');
  });
});
