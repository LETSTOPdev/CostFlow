import type { StageRef } from './stage';
import type { IsoDateString } from './work-item';

/**
 * One immutable canonical lifecycle transition (doc 02 §2.2). Events are the
 * high-fidelity substrate for wait/rework/handoff analysis; snapshots remain
 * legal when history is absent.
 */
export interface WorkItemEvent {
  readonly workItemId: string;
  /** Stage before the transition; null when the source only records arrivals. */
  readonly from: StageRef | null;
  readonly to: StageRef;
  readonly at: IsoDateString;
}
