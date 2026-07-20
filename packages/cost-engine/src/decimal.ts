import { Decimal } from 'decimal.js';

/**
 * One configured Decimal class for every monetary computation (NFR-3, ADR-0001).
 * Precision and rounding are pinned here so results cannot vary by call site.
 */
export const Money = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
export type MoneyDecimal = InstanceType<typeof Money>;

export function dec(value: string | number): MoneyDecimal {
  return new Money(value);
}

/**
 * Canonical at-rest form: plain decimal string, full precision, NEVER
 * exponential notation (R-03: `toString()` switches to `1e+21` at large
 * magnitudes, which breaks every string consumer downstream).
 */
export function decToString(value: MoneyDecimal): string {
  return value.toFixed();
}

/**
 * The single display formatter for money (R-02): whole currency units,
 * ROUND_HALF_EVEN via the pinned Money class (ADR-0001), own digit grouping —
 * no locale machinery in the determinism path. Reporting must never do
 * monetary arithmetic or formatting on its own.
 */
export function formatWholeMoney(value: string, currency: string): string {
  const rounded = dec(value).toFixed(0);
  const normalized = rounded === '-0' ? '0' : rounded;
  const negative = normalized.startsWith('-');
  const digits = negative ? normalized.slice(1) : normalized;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped} ${currency}`;
}

/** Numeric ordering for decimal strings without float round-trips. */
export function compareDecimalStrings(a: string, b: string): number {
  return dec(a).comparedTo(dec(b));
}
