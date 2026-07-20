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
  readonly location: { readonly stage: StageRef };
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

export type FrictionInstance = AgingInstance | QueueWaitInstance;
