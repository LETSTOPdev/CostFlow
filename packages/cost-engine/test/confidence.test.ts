import { describe, expect, it } from 'vitest';
import { composeConfidence } from '@costflow/cost-engine';

describe('confidence composition (doc 07 §4.4 rules 2 & 4)', () => {
  it('composes by minimum with the binding constraint first', () => {
    const c = composeConfidence([
      { tier: 'B', reason: 'snapshot data' },
      { tier: 'C', reason: 'default assumption' },
    ]);
    expect(c.tier).toBe('C');
    expect(c.reasons[0]).toContain('default assumption');
  });

  it('no caps means tier A with no reasons', () => {
    expect(composeConfidence([])).toEqual({ tier: 'A', reasons: [] });
  });

  it('never reports higher than any input (no downstream laundering)', () => {
    const tiers = ['A', 'B', 'C'] as const;
    for (const a of tiers) {
      for (const b of tiers) {
        const composed = composeConfidence([
          { tier: a, reason: 'x' },
          { tier: b, reason: 'y' },
        ]);
        const order = { A: 3, B: 2, C: 1 };
        expect(order[composed.tier]).toBeLessThanOrEqual(Math.min(order[a], order[b]));
      }
    }
  });
});
