import type { IsoDateString } from './work-item';

const MS_PER_DAY = 86_400_000;

/**
 * Strict ISO parse to UTC epoch millis. Date-only values are UTC midnight.
 * Returns null for anything unparseable — callers surface a diagnostic rather
 * than guessing (doc 03 P5: degrade honestly, never fabricate).
 */
export function parseIsoUtc(value: string): number | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
  if (!dateOnly.test(value) && !dateTime.test(value)) return null;
  const normalized = dateOnly.test(value) ? `${value}T00:00:00Z` : value.replace(' ', 'T');
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days elapsed from `from` to `to` (floor). Negative if `to` precedes `from`. */
export function wholeDaysBetween(from: IsoDateString, to: IsoDateString): number | null {
  const fromMs = parseIsoUtc(from);
  const toMs = parseIsoUtc(to);
  if (fromMs === null || toMs === null) return null;
  return Math.floor((toMs - fromMs) / MS_PER_DAY);
}
