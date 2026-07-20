import type { AssumptionSet, ImportBatch } from '@costflow/domain';
import type { FrictionInstance } from '@costflow/friction';
import { countEligibleItemsWithoutEvents } from '@costflow/friction';
import type { CostEstimate } from './estimate';
import { AGING_ATTENTION_MODEL, priceAgingInstance } from './models/aging-attention-cost';
import {
  QUEUE_WAIT_ATTENTION_MODEL,
  priceQueueWaitInstance,
} from './models/queue-wait-attention-cost';
import { OVERDUE_ATTENTION_MODEL, priceOverdueInstance } from './models/overdue-attention-cost';
import { vendorSuggestedRateRefs } from './rate';

/**
 * The F×→C× contract as code (doc 02 §5, R-11): a static, versioned mapping
 * from signal id to the cost model that prices it. Deliberately a plain
 * object — no plugins, no reflection, no runtime loading. Each entry's price
 * function guards its evidence type at runtime; the discriminated instance
 * union guards it at compile time.
 */
export interface CostModelEntry {
  readonly id: string;
  readonly version: string;
  readonly appliesToSignal: string;
  /** Declares missing-assumption skips BEFORE pricing — skipping is honest, crashing is not. */
  readonly canPrice: (assumptions: AssumptionSet) => { ok: true } | { ok: false; reason: string };
  /**
   * Report-mode gate (doc 03 P4 as amended): refs of vendor-suggested
   * load-bearing inputs this instance's pricing would touch. Non-empty →
   * the instance is unpriced in report mode (no partial pricing); simulation
   * mode prices it with the vendor-suggested confidence caps intact.
   */
  readonly unconfirmedInputs: (instance: FrictionInstance, assumptions: AssumptionSet) => string[];
  readonly price: (
    instance: FrictionInstance,
    assumptions: AssumptionSet,
    batch: ImportBatch,
  ) => CostEstimate;
}

function vendorSuggestedParamRefs(
  assumptions: AssumptionSet,
  refs: readonly [
    (
      | 'agingThresholdDays'
      | 'attentionHoursPerDay'
      | 'queueWaitAttentionHoursPerDay'
      | 'overdueAttentionHoursPerDay'
    ),
    string,
  ][],
): string[] {
  const out: string[] = [];
  for (const [key, ref] of refs) {
    const parameter = assumptions.parameters[key];
    if (parameter && parameter.provenance === 'vendor-suggested') out.push(ref);
  }
  return out;
}

export const COST_MODEL_REGISTRY: Readonly<Record<string, CostModelEntry>> = {
  [AGING_ATTENTION_MODEL.appliesToSignal]: {
    id: AGING_ATTENTION_MODEL.id,
    version: AGING_ATTENTION_MODEL.version,
    appliesToSignal: AGING_ATTENTION_MODEL.appliesToSignal,
    canPrice: () => ({ ok: true }),
    unconfirmedInputs: (instance, assumptions) =>
      [
        ...vendorSuggestedRateRefs(
          assumptions,
          instance.evidence.map((e) => e.actor),
        ),
        ...vendorSuggestedParamRefs(assumptions, [
          ['attentionHoursPerDay', 'parameters.attentionHoursPerDay'],
          ['agingThresholdDays', 'parameters.agingThresholdDays'],
        ]),
      ].sort(),
    price: (instance, assumptions) => {
      if (instance.frictionType !== 'aging') {
        throw new Error(
          `${AGING_ATTENTION_MODEL.id} cannot price "${instance.frictionType}" evidence (instance ${instance.id}).`,
        );
      }
      return priceAgingInstance(instance, assumptions);
    },
  },
  [QUEUE_WAIT_ATTENTION_MODEL.appliesToSignal]: {
    id: QUEUE_WAIT_ATTENTION_MODEL.id,
    version: QUEUE_WAIT_ATTENTION_MODEL.version,
    appliesToSignal: QUEUE_WAIT_ATTENTION_MODEL.appliesToSignal,
    canPrice: (assumptions) =>
      assumptions.parameters.queueWaitAttentionHoursPerDay
        ? { ok: true }
        : {
            ok: false,
            reason:
              'Missing assumption parameters.queueWaitAttentionHoursPerDay — add it to price queue-wait frictions.',
          },
    unconfirmedInputs: (instance, assumptions) =>
      [
        ...vendorSuggestedRateRefs(
          assumptions,
          instance.evidence.map((e) => e.actor),
        ),
        ...vendorSuggestedParamRefs(assumptions, [
          ['queueWaitAttentionHoursPerDay', 'parameters.queueWaitAttentionHoursPerDay'],
        ]),
      ].sort(),
    price: (instance, assumptions, batch) => {
      if (instance.frictionType !== 'queue-wait') {
        throw new Error(
          `${QUEUE_WAIT_ATTENTION_MODEL.id} cannot price "${instance.frictionType}" evidence (instance ${instance.id}).`,
        );
      }
      return priceQueueWaitInstance(instance, assumptions, {
        eligibleItemsWithoutEvents: countEligibleItemsWithoutEvents(batch),
      });
    },
  },
  [OVERDUE_ATTENTION_MODEL.appliesToSignal]: {
    id: OVERDUE_ATTENTION_MODEL.id,
    version: OVERDUE_ATTENTION_MODEL.version,
    appliesToSignal: OVERDUE_ATTENTION_MODEL.appliesToSignal,
    canPrice: (assumptions) =>
      assumptions.parameters.overdueAttentionHoursPerDay
        ? { ok: true }
        : {
            ok: false,
            reason:
              'Missing assumption parameters.overdueAttentionHoursPerDay — add it to price overdue frictions.',
          },
    unconfirmedInputs: (instance, assumptions) =>
      [
        ...vendorSuggestedRateRefs(
          assumptions,
          instance.evidence.map((e) => e.actor),
        ),
        ...vendorSuggestedParamRefs(assumptions, [
          ['overdueAttentionHoursPerDay', 'parameters.overdueAttentionHoursPerDay'],
        ]),
      ].sort(),
    price: (instance, assumptions) => {
      if (instance.frictionType !== 'overdue') {
        throw new Error(
          `${OVERDUE_ATTENTION_MODEL.id} cannot price "${instance.frictionType}" evidence (instance ${instance.id}).`,
        );
      }
      return priceOverdueInstance(instance, assumptions);
    },
  },
};
