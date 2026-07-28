import { describe, expect, it } from 'vitest';
import {
  byStrongestConfidence,
  composeConfidence,
  type ConfidenceTier,
} from '@costflow/cost-engine';

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

describe('tier ordering is a declared rule, not an alphabetical coincidence', () => {
  it('orders strongest first, independent of letter order', () => {
    const tiers: ConfidenceTier[] = ['C', 'A', 'B'];
    expect([...tiers].sort(byStrongestConfidence)).toEqual(['A', 'B', 'C']);
    expect(byStrongestConfidence('A', 'C')).toBeLessThan(0);
    expect(byStrongestConfidence('C', 'A')).toBeGreaterThan(0);
    expect(byStrongestConfidence('B', 'B')).toBe(0);
  });

  /**
   * The point of exporting the comparator: consumers ranking findings by
   * confidence (doc 07 §1.4) must not re-derive the order from the letters.
   * It agrees with composeConfidence, which is the other side of the same rule.
   */
  it('agrees with composition about which tier is weaker', () => {
    const composed = composeConfidence([
      { tier: 'B', reason: 'b' },
      { tier: 'C', reason: 'c' },
    ]);
    expect(composed.tier).toBe('C');
    expect(byStrongestConfidence('B', composed.tier)).toBeLessThan(0);
  });
});
