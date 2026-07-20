import type { AssumptionSet, RangeSpec } from '@costflow/domain';
import { rateForRole } from '@costflow/domain';
import type { FrictionInstance } from '@costflow/friction';
import { dec } from '../decimal';
import { addRanges, rangeFromSpec, rangeToSpec, scaleRange, ZERO_RANGE } from '../range';
import { composeConfidence, type Confidence, type ConfidenceCap } from '../confidence';

/**
 * cm-aging-attention — prices F2 aging as carrying/attention cost (lens L1/C5,
 * doc 02 §5): each item aging beyond threshold consumes an assumed slice of
 * daily attention, priced at the role's rate. Documented bias: this
 * underestimates — it prices attention drag only, not deferred value (L2),
 * which needs value attribution the customer has not supplied.
 */
export const AGING_ATTENTION_MODEL = {
  id: 'cm-aging-attention',
  version: '1.0.0',
  appliesToSignal: 'f2-aging',
  lens: 'L1-direct-resource-cost',
} as const;

/** One priced term per evidence item — the trace is built from these, never alongside them (doc 03 E3). */
export interface TraceTerm {
  readonly workItemId: string;
  readonly excessDays: number;
  readonly attentionHoursPerDay: RangeSpec;
  readonly hourlyRate: string;
  readonly rateSource: string;
  readonly subtotal: RangeSpec;
}

export interface FormulaTrace {
  readonly claim: string;
  readonly formula: string;
  readonly terms: readonly TraceTerm[];
  readonly assumptionsUsed: readonly {
    readonly ref: string;
    readonly value: string;
    readonly provenance: string;
  }[];
  readonly inputs: { readonly workItemIds: readonly string[] };
}

export interface CostEstimate {
  readonly frictionInstanceId: string;
  readonly costModelId: string;
  readonly costModelVersion: string;
  readonly cost: RangeSpec;
  readonly currency: string;
  readonly confidence: Confidence;
  readonly assumptionSetId: string;
  readonly assumptionSetVersion: string;
  readonly trace: FormulaTrace;
}

export function priceAgingInstance(
  instance: FrictionInstance,
  assumptions: AssumptionSet,
): CostEstimate {
  const attention = rangeFromSpec(assumptions.parameters.attentionHoursPerDay.range);
  const caps: ConfidenceCap[] = [
    {
      tier: 'B',
      reason: 'Durations inferred from snapshot dates, not event history.',
    },
  ];
  if (assumptions.parameters.attentionHoursPerDay.provenance === 'default') {
    caps.push({ tier: 'C', reason: 'Attention-hours assumption is an unconfirmed default.' });
  }
  if (assumptions.parameters.agingThresholdDays.provenance === 'default') {
    caps.push({ tier: 'C', reason: 'Aging threshold is an unconfirmed default.' });
  }

  const terms: TraceTerm[] = [];
  let total = ZERO_RANGE;
  const assumptionsUsed = new Map<string, { ref: string; value: string; provenance: string }>();

  assumptionsUsed.set('attentionHoursPerDay', {
    ref: 'parameters.attentionHoursPerDay',
    value: `${assumptions.parameters.attentionHoursPerDay.range.low}–${assumptions.parameters.attentionHoursPerDay.range.high} h/day (expected ${assumptions.parameters.attentionHoursPerDay.range.expected})`,
    provenance: assumptions.parameters.attentionHoursPerDay.provenance,
  });
  assumptionsUsed.set('agingThresholdDays', {
    ref: 'parameters.agingThresholdDays',
    value: `${assumptions.parameters.agingThresholdDays.value} days`,
    provenance: assumptions.parameters.agingThresholdDays.provenance,
  });

  let defaultRateUsed = false;
  for (const evidence of instance.evidence) {
    const rate = rateForRole(assumptions, evidence.roleRef);
    if (rate.matchedRole === null && !defaultRateUsed) {
      defaultRateUsed = true;
      caps.push({
        tier: 'C',
        reason: 'Default hourly rate applied to one or more items without a matched role.',
      });
    }
    const rateSource = rate.matchedRole === null ? 'defaultRate' : `rates.${rate.matchedRole}`;
    assumptionsUsed.set(rateSource, {
      ref: rateSource,
      value: `${rate.hourlyRate} ${assumptions.currency}/h`,
      provenance: rate.provenance,
    });
    const subtotal = scaleRange(attention, dec(evidence.excessDays).mul(dec(rate.hourlyRate)));
    terms.push({
      workItemId: evidence.workItemId,
      excessDays: evidence.excessDays,
      attentionHoursPerDay: assumptions.parameters.attentionHoursPerDay.range,
      hourlyRate: rate.hourlyRate,
      rateSource,
      subtotal: rangeToSpec(subtotal),
    });
    total = addRanges(total, subtotal);
  }

  return {
    frictionInstanceId: instance.id,
    costModelId: AGING_ATTENTION_MODEL.id,
    costModelVersion: AGING_ATTENTION_MODEL.version,
    cost: rangeToSpec(total),
    currency: assumptions.currency,
    confidence: composeConfidence(caps),
    assumptionSetId: assumptions.id,
    assumptionSetVersion: assumptions.version,
    trace: {
      claim: `Estimated attention cost of ${instance.evidence.length} item(s) aging beyond ${assumptions.parameters.agingThresholdDays.value} days in stage "${instance.location.stage.name}".`,
      formula:
        'Σ over items: excessDays × attentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range',
      terms,
      assumptionsUsed: [...assumptionsUsed.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
      inputs: { workItemIds: instance.evidence.map((e) => e.workItemId) },
    },
  };
}
