import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dec, decToString, formatWholeMoney } from '@costflow/cost-engine';

describe('canonical decimal serialization (regression: R-03)', () => {
  it('never emits exponential notation, including ≥1e21', () => {
    expect(decToString(dec('1000000000000000000000'))).toBe('1000000000000000000000');
    expect(decToString(dec('10000000000000000000000'))).toBe('10000000000000000000000');
  });

  it('round-trips and stays plain-decimal for arbitrary values', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 6 }),
        (units, scale) => {
          const value = dec(units.toString()).div(dec(10 ** scale));
          const s = decToString(value);
          expect(s).not.toMatch(/e/i);
          expect(dec(s).eq(value)).toBe(true);
        },
      ),
    );
  });
});

describe('money display formatting (regression: R-02)', () => {
  it('handles negatives correctly (review repro: "-0.5" rendered as "1")', () => {
    expect(formatWholeMoney('-0.5', 'USD')).toBe('0 USD');
    expect(formatWholeMoney('-5.7', 'USD')).toBe('-6 USD');
    expect(formatWholeMoney('-1234.5', 'USD')).toBe('-1,234 USD');
  });

  it('uses ROUND_HALF_EVEN at display (ADR-0001), not half-up', () => {
    expect(formatWholeMoney('0.5', 'USD')).toBe('0 USD');
    expect(formatWholeMoney('1.5', 'USD')).toBe('2 USD');
    expect(formatWholeMoney('2.5', 'USD')).toBe('2 USD');
    expect(formatWholeMoney('1054.5', 'USD')).toBe('1,054 USD');
  });

  it('handles large magnitudes without throwing (review repro: 1e+22 threw)', () => {
    expect(formatWholeMoney('10000000000000000000000', 'USD')).toBe(
      '10,000,000,000,000,000,000,000 USD',
    );
  });

  it('groups digits deterministically without locale machinery', () => {
    expect(formatWholeMoney('0', 'EUR')).toBe('0 EUR');
    expect(formatWholeMoney('999', 'EUR')).toBe('999 EUR');
    expect(formatWholeMoney('1000', 'EUR')).toBe('1,000 EUR');
    expect(formatWholeMoney('123456789.4', 'EUR')).toBe('123,456,789 EUR');
  });
});
