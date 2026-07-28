import type { ActorRef } from './actor';
import type { StageRef } from './stage';

/**
 * ISO-8601 date ('YYYY-MM-DD') or datetime string, UTC-interpreted.
 * All temporal arithmetic happens on values of this type passed in explicitly;
 * nothing in the pure core ever reads a clock.
 */
export type IsoDateString = string;

/**
 * The canonical atom of work (doc 02 §2.2). Deliberately minimal: fields exist
 * only because a current consumer (detector, cost model, report) reads them.
 */
export interface WorkItem {
  /** Canonical id, unique within its import batch. */
  readonly id: string;
  /** The identifier the source system used (or a deterministic row ref). */
  readonly sourceId: string;
  readonly title: string;
  readonly stage: StageRef;
  /** Mapped role, pseudonymized unknown, or missing — never a raw identity. */
  readonly actor: ActorRef;
  /**
   * Which origin this item came from, matching a `BatchScope.id` on the batch;
   * null when the import has no scope structure (a CSV file).
   *
   * The field exists because a workspace can span several origins, and a
   * manager whose workspace covers Engineering and Legal needs to know WHOSE
   * review queue is expensive. Without it, two teams that happen to use the
   * same status name collapse into one friction and the report can only report
   * a blended total — which is aggregation where the question was attribution.
   *
   * An ID rather than the label: labels are customer content and would be
   * duplicated across every item, where the batch already carries each origin's
   * name exactly once.
   */
  readonly originScopeId: string | null;
  readonly createdAt: IsoDateString | null;
  readonly dueAt: IsoDateString | null;
  readonly lastUpdatedAt: IsoDateString | null;
}
