import type { AssumptionSet, Provenance, RangeSpec } from '@costflow/domain';

/**
 * Vendor assumption catalog + provenance transition rules (doc 09 P4.1 plan
 * §5). Every assumption starts vendor-suggested; "Accept" (value untouched)
 * → customer-accepted; an edited value → customer-customized;
 * customer-measured is NOT settable in P4.1. A customer-owned state never
 * silently reverts to vendor-suggested. Report mode's unpriced-until-owned
 * gate (doc 03 P4) is the engine-side enforcement this UI teaches.
 */

export interface VendorParameterDefault {
  readonly range: RangeSpec;
}

export const VENDOR_DEFAULTS = {
  currency: 'USD',
  defaultRateHourly: '50',
  agingThresholdDays: 14,
  attentionHoursPerDay: { low: '0.15', expected: '0.3', high: '0.6' } satisfies RangeSpec,
  queueWaitAttentionHoursPerDay: { low: '0.1', expected: '0.2', high: '0.4' } satisfies RangeSpec,
  overdueAttentionHoursPerDay: { low: '0.1', expected: '0.2', high: '0.4' } satisfies RangeSpec,
} as const;

/** The assumption set as first presented: everything vendor-suggested. */
export function vendorSeededAssumptions(
  workspaceId: string,
  roles: readonly string[],
): AssumptionSet {
  return {
    id: `ws-${workspaceId}`,
    version: '1',
    currency: VENDOR_DEFAULTS.currency,
    rates: roles.map((roleRef) => ({
      roleRef,
      hourlyRate: VENDOR_DEFAULTS.defaultRateHourly,
      provenance: 'vendor-suggested' as const,
    })),
    defaultRate: { hourlyRate: VENDOR_DEFAULTS.defaultRateHourly, provenance: 'vendor-suggested' },
    parameters: {
      agingThresholdDays: {
        value: VENDOR_DEFAULTS.agingThresholdDays,
        provenance: 'vendor-suggested',
      },
      attentionHoursPerDay: {
        range: VENDOR_DEFAULTS.attentionHoursPerDay,
        provenance: 'vendor-suggested',
      },
      queueWaitAttentionHoursPerDay: {
        range: VENDOR_DEFAULTS.queueWaitAttentionHoursPerDay,
        provenance: 'vendor-suggested',
      },
      overdueAttentionHoursPerDay: {
        range: VENDOR_DEFAULTS.overdueAttentionHoursPerDay,
        provenance: 'vendor-suggested',
      },
    },
  };
}

/**
 * Transition rule for one submitted assumption: unchanged value + explicit
 * accept → customer-accepted; changed value → customer-customized; an
 * already-owned state with an unchanged value keeps its state (no silent
 * downgrade, no accidental upgrade).
 */
export function nextProvenance(
  previous: Provenance,
  valueChanged: boolean,
  accepted: boolean,
): Provenance {
  if (valueChanged) return 'customer-customized';
  if (previous === 'vendor-suggested') return accepted ? 'customer-accepted' : 'vendor-suggested';
  return previous;
}

export function countProvenance(assumptions: AssumptionSet): Record<Provenance, number> {
  const counts: Record<Provenance, number> = {
    'vendor-suggested': 0,
    'customer-accepted': 0,
    'customer-customized': 0,
    'customer-measured': 0,
  };
  for (const rate of assumptions.rates) counts[rate.provenance] += 1;
  counts[assumptions.defaultRate.provenance] += 1;
  counts[assumptions.parameters.agingThresholdDays.provenance] += 1;
  counts[assumptions.parameters.attentionHoursPerDay.provenance] += 1;
  if (assumptions.parameters.queueWaitAttentionHoursPerDay) {
    counts[assumptions.parameters.queueWaitAttentionHoursPerDay.provenance] += 1;
  }
  if (assumptions.parameters.overdueAttentionHoursPerDay) {
    counts[assumptions.parameters.overdueAttentionHoursPerDay.provenance] += 1;
  }
  return counts;
}
