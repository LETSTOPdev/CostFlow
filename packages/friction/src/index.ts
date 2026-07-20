export type {
  FrictionSignalMeta,
  FrictionInstance,
  AgingInstance,
  AgingEvidence,
  QueueWaitInstance,
  QueueWaitEvidence,
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
