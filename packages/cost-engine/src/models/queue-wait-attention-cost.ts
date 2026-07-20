import type { AssumptionSet } from '@costflow/domain';
import type { QueueWaitInstance } from '@costflow/friction';
import { dec, decToString } from '../decimal';
import { addRanges, rangeFromSpec, rangeToSpec, scaleRange, ZERO_RANGE } from '../range';
import { composeConfidence, type ConfidenceCap } from '../confidence';
import { resolveActorRate } from '../rate';
import type { CostEstimate, QueueWaitTraceTerm } from '../estimate';

/**
 * cm-queue-wait-attention — prices F1 queue wait as follow-up/chasing
 * attention consumed while items sit in queue/review stages (lens L1). The
 * deferred-value lens (L2/C4) needs customer value attribution and is a later
 * model; this one is deliberately the conservative labor framing. Requires
 * the OPTIONAL queueWaitAttentionHoursPerDay assumption — absent means the
 * instance is reported unpriced (FR-13), never priced with an invented value.
 */
export const QUEUE_WAIT_ATTENTION_MODEL = {
  id: 'cm-queue-wait-attention',
  version: '1.0.0',
  appliesToSignal: 'f1-queue-wait',
  lens: 'L1-direct-resource-cost',
} as const;

export const HOURS_PER_DAY = 24;

export function priceQueueWaitInstance(
  instance: QueueWaitInstance,
  assumptions: AssumptionSet,
  context: { readonly eligibleItemsWithoutEvents: number },
): CostEstimate {
  const parameter = assumptions.parameters.queueWaitAttentionHoursPerDay;
  if (!parameter) {
    throw new Error(
      'cm-queue-wait-attention requires the queueWaitAttentionHoursPerDay assumption — ' +
        'callers must check canPrice() first.',
    );
  }
  const attention = rangeFromSpec(parameter.range);

  const caps: ConfidenceCap[] = [];
  if (instance.evidence.some((e) => e.openAtAnalysisTime)) {
    caps.push({
      tier: 'B',
      reason: 'Includes open stage intervals measured to the analysis time.',
    });
  }
  if (context.eligibleItemsWithoutEvents > 0) {
    caps.push({
      tier: 'B',
      reason: `${context.eligibleItemsWithoutEvents} item(s) currently in queue/review stages have no event history — their wait is unobserved.`,
    });
  }
  if (parameter.provenance === 'default') {
    caps.push({
      tier: 'C',
      reason: 'Queue-wait attention-hours assumption is an unconfirmed default.',
    });
  }

  const terms: QueueWaitTraceTerm[] = [];
  let total = ZERO_RANGE;
  const assumptionsUsed = new Map<string, { ref: string; value: string; provenance: string }>();
  const capReasons = new Set(caps.map((c) => c.reason));

  assumptionsUsed.set('queueWaitAttentionHoursPerDay', {
    ref: 'parameters.queueWaitAttentionHoursPerDay',
    value: `${parameter.range.low}–${parameter.range.high} h/day (expected ${parameter.range.expected})`,
    provenance: parameter.provenance,
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
    const waitDays = dec(evidence.waitHours).div(HOURS_PER_DAY);
    const subtotal = scaleRange(attention, waitDays.mul(dec(rate.hourlyRate)));
    terms.push({
      kind: 'queue-wait-attention',
      workItemId: evidence.workItemId,
      waitHours: evidence.waitHours,
      waitDays: decToString(waitDays),
      visits: evidence.visits,
      openAtAnalysisTime: evidence.openAtAnalysisTime,
      attentionHoursPerDay: parameter.range,
      hourlyRate: rate.hourlyRate,
      rateSource: rate.source,
      subtotal: rangeToSpec(subtotal),
    });
    total = addRanges(total, subtotal);
  }

  return {
    frictionInstanceId: instance.id,
    costModelId: QUEUE_WAIT_ATTENTION_MODEL.id,
    costModelVersion: QUEUE_WAIT_ATTENTION_MODEL.version,
    cost: rangeToSpec(total),
    currency: assumptions.currency,
    confidence: composeConfidence(caps),
    assumptionSetId: assumptions.id,
    assumptionSetVersion: assumptions.version,
    trace: {
      claim: `Estimated follow-up cost of ${instance.evidence.length} item(s) waiting in stage "${instance.location.stage.name}", observed from event history.`,
      formula:
        'Σ over items: waitDays × queueWaitAttentionHoursPerDay × hourlyRate(role); waitDays = observed waitHours ÷ 24; low/high follow the attention-hours range',
      terms,
      assumptionsUsed: [...assumptionsUsed.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
      inputs: { workItemIds: instance.evidence.map((e) => e.workItemId) },
    },
  };
}
