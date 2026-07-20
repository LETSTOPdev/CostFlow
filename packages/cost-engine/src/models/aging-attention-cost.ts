import type { AssumptionSet } from '@costflow/domain';
import type { AgingInstance } from '@costflow/friction';
import { dec } from '../decimal';
import { addRanges, rangeFromSpec, rangeToSpec, scaleRange, ZERO_RANGE } from '../range';
import { composeConfidence, type ConfidenceCap } from '../confidence';
import { resolveActorRate } from '../rate';
import type { AgingTraceTerm, CostEstimate } from '../estimate';

/**
 * cm-aging-attention — prices F2 aging as carrying/attention cost (lens L1/C5,
 * doc 02 §5): each item aging beyond threshold consumes an assumed slice of
 * daily attention, priced at the actor's resolved role rate. Documented bias:
 * this underestimates — it prices attention drag only, not deferred value
 * (L2), which needs value attribution the customer has not supplied.
 */
export const AGING_ATTENTION_MODEL = {
  id: 'cm-aging-attention',
  version: '1.0.0',
  appliesToSignal: 'f2-aging',
  lens: 'L1-direct-resource-cost',
} as const;

export function priceAgingInstance(
  instance: AgingInstance,
  assumptions: AssumptionSet,
): CostEstimate {
  const attention = rangeFromSpec(assumptions.parameters.attentionHoursPerDay.range);
  const caps: ConfidenceCap[] = [
    {
      tier: 'B',
      reason: 'Durations inferred from snapshot dates, not event history.',
    },
  ];
  if (assumptions.parameters.attentionHoursPerDay.provenance === 'vendor-suggested') {
    caps.push({
      tier: 'C',
      reason: 'Attention-hours assumption is vendor-suggested (unconfirmed).',
    });
  }
  if (assumptions.parameters.agingThresholdDays.provenance === 'vendor-suggested') {
    caps.push({ tier: 'C', reason: 'Aging threshold is vendor-suggested (unconfirmed).' });
  }

  const terms: AgingTraceTerm[] = [];
  let total = ZERO_RANGE;
  const assumptionsUsed = new Map<string, { ref: string; value: string; provenance: string }>();
  const capReasons = new Set(caps.map((c) => c.reason));

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

  for (const evidence of instance.evidence) {
    const rate = resolveActorRate(assumptions, evidence.actor);
    if (rate.cap && !capReasons.has(rate.cap.reason)) {
      capReasons.add(rate.cap.reason);
      caps.push(rate.cap);
    }
    assumptionsUsed.set(rate.source, {
      ref: rate.source,
      value: `${rate.hourlyRate} ${assumptions.currency}/h`,
      provenance: rate.provenance,
    });
    const subtotal = scaleRange(attention, dec(evidence.excessDays).mul(dec(rate.hourlyRate)));
    terms.push({
      kind: 'aging-attention',
      workItemId: evidence.workItemId,
      excessDays: evidence.excessDays,
      attentionHoursPerDay: assumptions.parameters.attentionHoursPerDay.range,
      hourlyRate: rate.hourlyRate,
      rateSource: rate.source,
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
