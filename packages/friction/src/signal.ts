import type { CapabilityKey, CapabilityProfile, StageRef } from '@costflow/domain';

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
 * A concrete detection (doc 02 §2.4). Attribution is structural — a stage,
 * never a person (doc 06 N1). Magnitude is time-denominated; money is the cost
 * engine's judgment, not the detector's.
 */
export interface FrictionInstance {
  readonly id: string;
  readonly signalId: string;
  readonly signalVersion: string;
  readonly frictionType: string;
  readonly location: { readonly stage: StageRef };
  readonly magnitude: { readonly unit: string; readonly value: number };
  readonly evidence: readonly AgingEvidence[];
}

export interface AgingEvidence {
  readonly workItemId: string;
  readonly title: string;
  readonly roleRef: string | null;
  readonly lastUpdatedAt: string;
  readonly agingDays: number;
  readonly excessDays: number;
}
