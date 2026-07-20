/**
 * Compile-time proof for R-11 req 10: the wrong cost model CANNOT price the
 * wrong evidence type. This file is type-checked by `pnpm typecheck` (it is
 * not a runtime test). If either `@ts-expect-error` becomes unnecessary —
 * i.e. the call starts type-checking — tsc fails the build with
 * "Unused '@ts-expect-error' directive".
 */
import type { AssumptionSet } from '@costflow/domain';
import type { AgingInstance, OverdueInstance, QueueWaitInstance } from '@costflow/friction';
import {
  priceAgingInstance,
  priceOverdueInstance,
  priceQueueWaitInstance,
} from '@costflow/cost-engine';

declare const assumptions: AssumptionSet;
declare const agingInstance: AgingInstance;
declare const queueWaitInstance: QueueWaitInstance;
declare const overdueInstance: OverdueInstance;

export function compileTimeGuards(): void {
  // @ts-expect-error — the aging model must not accept queue-wait evidence
  priceAgingInstance(queueWaitInstance, assumptions);

  // @ts-expect-error — the aging model must not accept overdue evidence
  priceAgingInstance(overdueInstance, assumptions);

  // @ts-expect-error — the queue-wait model must not accept aging evidence
  priceQueueWaitInstance(agingInstance, assumptions, { eligibleItemsWithoutEvents: 0 });

  // @ts-expect-error — the overdue model must not accept aging evidence
  priceOverdueInstance(agingInstance, assumptions);

  // @ts-expect-error — the overdue model must not accept queue-wait evidence
  priceOverdueInstance(queueWaitInstance, assumptions);
}
