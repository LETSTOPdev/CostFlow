import type { RangeSpec } from '@costflow/domain';
import { dec, decToString, type MoneyDecimal } from './decimal';

/**
 * Interval algebra for cost ranges (doc 03 P2, doc 07 §4.4 rule 1):
 * ranges only widen under composition, never narrow. Invariant low ≤ expected
 * ≤ high is enforced at construction — violating inputs are a thrown error,
 * not a silent reorder, because they indicate corrupt assumptions.
 */
export interface DecRange {
  readonly low: MoneyDecimal;
  readonly expected: MoneyDecimal;
  readonly high: MoneyDecimal;
}

export function rangeFromSpec(spec: RangeSpec): DecRange {
  return makeRange(dec(spec.low), dec(spec.expected), dec(spec.high));
}

export function makeRange(low: MoneyDecimal, expected: MoneyDecimal, high: MoneyDecimal): DecRange {
  if (low.gt(expected) || expected.gt(high)) {
    throw new Error(
      `Range invariant violated: low ≤ expected ≤ high required, got [${low}, ${expected}, ${high}]`,
    );
  }
  return { low, expected, high };
}

export const ZERO_RANGE: DecRange = {
  low: dec(0),
  expected: dec(0),
  high: dec(0),
};

export function addRanges(a: DecRange, b: DecRange): DecRange {
  return makeRange(a.low.add(b.low), a.expected.add(b.expected), a.high.add(b.high));
}

/** Scale by a non-negative exact scalar (e.g., excess days × rate). */
export function scaleRange(range: DecRange, factor: MoneyDecimal): DecRange {
  if (factor.isNegative()) {
    throw new Error(`Range scaling requires a non-negative factor, got ${factor}`);
  }
  return makeRange(range.low.mul(factor), range.expected.mul(factor), range.high.mul(factor));
}

export function rangeToSpec(range: DecRange): RangeSpec {
  return {
    low: decToString(range.low),
    expected: decToString(range.expected),
    high: decToString(range.high),
  };
}
