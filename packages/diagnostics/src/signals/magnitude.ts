import type { FrictionInstance } from '@costflow/analysis';

/**
 * Per-item magnitudes behind one friction instance, in that instance's own
 * unit. Narrows on `frictionType`, so a new friction family fails the type
 * checker here rather than silently contributing zero.
 */
export function itemMagnitudes(instance: FrictionInstance): number[] {
  switch (instance.frictionType) {
    case 'aging':
      return instance.evidence.map((e) => e.excessDays);
    case 'queue-wait':
      return instance.evidence.map((e) => e.waitHours);
    case 'overdue':
      return instance.evidence.map((e) => e.overdueDays);
  }
}

/**
 * Human-readable unit label for a magnitude unit string.
 * Unknown units fall through to the raw string rather than being dropped: an
 * unlabelled number is recoverable, a missing one is not.
 */
const UNIT_LABELS: Readonly<Record<string, string>> = {
  'item-days-overdue': 'item-days overdue',
  'item-days-beyond-threshold': 'item-days beyond the aging threshold',
  'item-hours-waiting': 'item-hours waiting',
};

export const unitLabel = (unit: string): string => UNIT_LABELS[unit] ?? unit;
