import type { AssumptionSet } from '@costflow/domain';
import type { OverdueInstance } from '@costflow/friction';
import { dec } from '../decimal';
import { addRanges, rangeFromSpec, rangeToSpec, scaleRange, ZERO_RANGE } from '../range';
import { composeConfidence, type ConfidenceCap } from '../confidence';
import { resolveActorRate } from '../rate';
import type { CostEstimate, OverdueTraceTerm } from '../estimate';

/**
 * cm-overdue-attention — prices F3a open overdue exposure as chasing/
 * escalation attention per day past due (lens L1, doc 12 §6). Declared bias:
 * linear in overdue-days and therefore almost certainly an UNDERESTIMATE —
 * real chasing escalates with lateness, and deferred value (L2) is unpriced
 * until ValueAttribution exists. An escalation curve was considered and
 * rejected: an invented exponent has no defensible provenance.
 */
export const OVERDUE_ATTENTION_MODEL = {
  id: 'cm-overdue-attention',
  version: '1.0.0',
  appliesToSignal: 'f3-overdue',
  lens: 'L1-direct-resource-cost',
} as const;

/**
 * Milestone-gate clustering cap (doc 12 §7): fires when one exact due
 * timestamp covers more than half the instance's evidence AND the cohort has
 * at least 2 items — a cohort of 1 is not a cluster. Both constants are
 * version-bound signal semantics, not tunables.
 */
const CLUSTER_MIN_COHORT = 2;

export function priceOverdueInstance(
  instance: OverdueInstance,
  assumptions: AssumptionSet,
): CostEstimate {
  const parameter = assumptions.parameters.overdueAttentionHoursPerDay;
  if (!parameter) {
    throw new Error(
      'cm-overdue-attention requires the overdueAttentionHoursPerDay assumption — ' +
        'callers must check canPrice() first.',
    );
  }
  const attention = rangeFromSpec(parameter.range);

  const caps: ConfidenceCap[] = [];
  // No base cap: overdue-days derive from two explicit facts (customer's own
  // dueAt + pinned analysis time) — F3 is A-capable by design (doc 12 §7).
  const dueCounts = new Map<string, number>();
  for (const evidence of instance.evidence) {
    dueCounts.set(evidence.dueAt, (dueCounts.get(evidence.dueAt) ?? 0) + 1);
  }
  const maxCohort = Math.max(0, ...dueCounts.values());
  if (maxCohort >= CLUSTER_MIN_COHORT && maxCohort * 2 > instance.evidence.length) {
    caps.push({
      tier: 'B',
      reason: `${maxCohort} of ${instance.evidence.length} items in this instance share a single due date — dates may encode a milestone gate rather than per-item commitments.`,
    });
  }
  if (instance.evidence.some((e) => e.dueBeforeCreated)) {
    caps.push({
      tier: 'B',
      reason:
        'Includes item(s) whose due date precedes their creation — commitment semantics are suspect for those terms.',
    });
  }
  if (parameter.provenance === 'vendor-suggested') {
    caps.push({
      tier: 'C',
      reason: 'Overdue attention-hours assumption is vendor-suggested (unconfirmed).',
    });
  }

  const terms: OverdueTraceTerm[] = [];
  let total = ZERO_RANGE;
  const assumptionsUsed = new Map<string, { ref: string; value: string; provenance: string }>();
  const capReasons = new Set(caps.map((c) => c.reason));

  assumptionsUsed.set('overdueAttentionHoursPerDay', {
    ref: 'parameters.overdueAttentionHoursPerDay',
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
    const subtotal = scaleRange(attention, dec(evidence.overdueDays).mul(dec(rate.hourlyRate)));
    terms.push({
      kind: 'overdue-attention',
      workItemId: evidence.workItemId,
      overdueDays: evidence.overdueDays,
      dueAt: evidence.dueAt,
      attentionHoursPerDay: parameter.range,
      hourlyRate: rate.hourlyRate,
      rateSource: rate.source,
      subtotal: rangeToSpec(subtotal),
    });
    total = addRanges(total, subtotal);
  }

  return {
    frictionInstanceId: instance.id,
    costModelId: OVERDUE_ATTENTION_MODEL.id,
    costModelVersion: OVERDUE_ATTENTION_MODEL.version,
    cost: rangeToSpec(total),
    currency: assumptions.currency,
    confidence: composeConfidence(caps),
    assumptionSetId: assumptions.id,
    assumptionSetVersion: assumptions.version,
    trace: {
      claim: `Estimated chasing cost of ${instance.evidence.length} item(s) past their own due dates in stage "${instance.location.stage.name}".`,
      formula:
        'Σ over items: overdueDays × overdueAttentionHoursPerDay × hourlyRate(role); low/high follow the attention-hours range',
      terms,
      assumptionsUsed: [...assumptionsUsed.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
      inputs: { workItemIds: instance.evidence.map((e) => e.workItemId) },
    },
  };
}
