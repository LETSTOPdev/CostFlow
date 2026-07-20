export type {
  FrictionSignalMeta,
  FrictionInstance,
  AgingInstance,
  AgingEvidence,
  QueueWaitInstance,
  QueueWaitEvidence,
  OverdueInstance,
  OverdueEvidence,
} from './signal';
export { checkRequirements } from './signal';
export type { AgingParams } from './signals/aging';
export { AGING_SIGNAL, detectAging } from './signals/aging';
export type { QueueWaitParams } from './signals/queue-wait';
export {
  QUEUE_WAIT_SIGNAL,
  QUEUE_WAIT_ELIGIBLE_KINDS,
  detectQueueWait,
  countEligibleItemsWithoutEvents,
} from './signals/queue-wait';
export type { OverdueParams } from './signals/overdue';
export { OVERDUE_SIGNAL, detectOverdue } from './signals/overdue';
export type { ContextObservation } from './context';
export { WIP_LOAD_SIGNAL, observeWipLoad } from './context';
