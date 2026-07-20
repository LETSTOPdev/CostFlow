import type { AssumptionSet, ImportBatch } from '@costflow/domain';
import type { FrictionInstance } from '@costflow/friction';
import { countEligibleItemsWithoutEvents } from '@costflow/friction';
import type { CostEstimate } from './estimate';
import { AGING_ATTENTION_MODEL, priceAgingInstance } from './models/aging-attention-cost';
import {
  QUEUE_WAIT_ATTENTION_MODEL,
  priceQueueWaitInstance,
} from './models/queue-wait-attention-cost';

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
  readonly price: (
    instance: FrictionInstance,
    assumptions: AssumptionSet,
    batch: ImportBatch,
  ) => CostEstimate;
}

export const COST_MODEL_REGISTRY: Readonly<Record<string, CostModelEntry>> = {
  [AGING_ATTENTION_MODEL.appliesToSignal]: {
    id: AGING_ATTENTION_MODEL.id,
    version: AGING_ATTENTION_MODEL.version,
    appliesToSignal: AGING_ATTENTION_MODEL.appliesToSignal,
    canPrice: () => ({ ok: true }),
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
};
