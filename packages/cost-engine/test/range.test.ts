import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addRanges, dec, makeRange, rangeToSpec, scaleRange } from '@costflow/cost-engine';

const orderedTriple = fc
  .tuple(
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
  )
  .map(([a, b, c]) => {
    const sorted = [a, b, c].sort((x, y) => x - y) as [number, number, number];
    return makeRange(dec(sorted[0]), dec(sorted[1]), dec(sorted[2]));
  });

describe('range algebra invariants (doc 07 §4.4 rule 1)', () => {
  it('construction rejects disordered bounds', () => {
    expect(() => makeRange(dec(2), dec(1), dec(3))).toThrow(/invariant/);
    expect(() => makeRange(dec(1), dec(5), dec(3))).toThrow(/invariant/);
  });

  it('addition preserves ordering and never narrows relative width', () => {
    fc.assert(
      fc.property(orderedTriple, orderedTriple, (a, b) => {
        const sum = addRanges(a, b);
        expect(sum.low.lte(sum.expected)).toBe(true);
        expect(sum.expected.lte(sum.high)).toBe(true);
        // Width only grows: width(sum) = width(a) + width(b) ≥ max(width(a), width(b))
        const width = (r: typeof sum) => r.high.sub(r.low);
        expect(width(sum).gte(width(a))).toBe(true);
        expect(width(sum).gte(width(b))).toBe(true);
      }),
    );
  });

  it('scaling by a non-negative factor preserves ordering', () => {
    fc.assert(
      fc.property(orderedTriple, fc.integer({ min: 0, max: 10_000 }), (r, k) => {
        const scaled = scaleRange(r, dec(k));
        expect(scaled.low.lte(scaled.expected)).toBe(true);
        expect(scaled.expected.lte(scaled.high)).toBe(true);
      }),
    );
    expect(() => scaleRange(makeRange(dec(1), dec(2), dec(3)), dec(-1))).toThrow(/non-negative/);
  });

  it('arithmetic is exact decimal, not float', () => {
    const r = makeRange(dec('0.1'), dec('0.1'), dec('0.1'));
    const sum = addRanges(addRanges(r, r), r);
    expect(rangeToSpec(sum).expected).toBe('0.3'); // 0.1+0.1+0.1 === 0.3 exactly
  });
});
