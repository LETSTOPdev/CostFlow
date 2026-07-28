import type { ActorRef, CapabilityKey, CapabilityProfile, StageRef } from '@costflow/domain';

/**
 * Versioned definition of a detectable pattern (doc 02 §2.4). Declared data
 * requirements are the mechanism behind graceful degradation (A7, FR-11):
 * a signal whose requirements a batch cannot meet is skipped visibly, with the
 * reason, never silently.
 */
export interface FrictionSignalMeta {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly requires: readonly CapabilityKey[];
}

export function checkRequirements(
  meta: FrictionSignalMeta,
  capability: CapabilityProfile,
): { canRun: true } | { canRun: false; reason: string } {
  const missing = meta.requires.filter((key) => !capability[key]);
  if (missing.length === 0) return { canRun: true };
  return {
    canRun: false,
    reason: `Requires ${missing.join(', ')} — not present in this import.`,
  };
}

/**
 * Concrete detections (doc 02 §2.4, generalized per R-11): common identity
 * and location, signal pinning, and signal-specific typed evidence as a
 * discriminated union — a cost model for one signal cannot type-check against
 * another's evidence. Attribution stays structural (a stage, never a person;
 * doc 06 N1); magnitude stays time-denominated (money is the cost engine's
 * judgment).
 */
interface FrictionInstanceBase {
  readonly id: string;
  readonly signalId: string;
  readonly signalVersion: string;
  /**
   * WHERE the friction is: a stage, within the origin that stage belongs to.
   *
   * The origin is what makes a multi-scope workspace answerable. Engineering
   * and Legal both having a status called "In review" is two queues owned by
   * two teams, and grouping them by stage name alone would report one blended
   * finding that names neither. `originScopeId` matches a `BatchScope.id` on
   * the batch, and is null when the import has no scope structure — in which
   * case grouping by (origin, stage) is exactly grouping by stage, which is why
   * this changes nothing for a single-origin import.
   */
  readonly location: { readonly stage: StageRef; readonly originScopeId: string | null };
  readonly magnitude: { readonly unit: string; readonly value: number };
}

export interface AgingEvidence {
  readonly workItemId: string;
  readonly title: string;
  readonly actor: ActorRef;
  readonly lastUpdatedAt: string;
  readonly agingDays: number;
  readonly excessDays: number;
}

export interface AgingInstance extends FrictionInstanceBase {
  readonly frictionType: 'aging';
  readonly evidence: readonly AgingEvidence[];
}

export interface QueueWaitEvidence {
  readonly workItemId: string;
  readonly title: string;
  readonly actor: ActorRef;
  /** Total observed wait in this stage across all visits, whole hours. */
  readonly waitHours: number;
  readonly visits: number;
  /** True when the last interval was still open at the analysis time. */
  readonly openAtAnalysisTime: boolean;
}

export interface QueueWaitInstance extends FrictionInstanceBase {
  readonly frictionType: 'queue-wait';
  readonly evidence: readonly QueueWaitEvidence[];
}

export interface OverdueEvidence {
  readonly workItemId: string;
  readonly title: string;
  readonly actor: ActorRef;
  /** The customer's own commitment — the threshold F3 never has to invent. */
  readonly dueAt: string;
  readonly overdueDays: number;
  /** Due date precedes creation — bulk-import artifact, disclosed not hidden. */
  readonly dueBeforeCreated: boolean;
  /** Other overdue items in the batch sharing this exact dueAt (doc 12 §5). */
  readonly sharedDueDateCohortSize: number;
}

export interface OverdueInstance extends FrictionInstanceBase {
  readonly frictionType: 'overdue';
  readonly evidence: readonly OverdueEvidence[];
}

export type FrictionInstance = AgingInstance | QueueWaitInstance | OverdueInstance;
