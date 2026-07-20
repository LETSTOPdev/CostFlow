/**
 * Canonical stage kinds (doc 02 §2.2). Provider status vocabulary dies at the
 * mapping boundary; detectors reason only over these six kinds.
 */
export const STAGE_KINDS = ['queue', 'active', 'review', 'blocked', 'done', 'abandoned'] as const;

export type StageKind = (typeof STAGE_KINDS)[number];

/** Kinds in which a work item is no longer in flight. */
export const TERMINAL_STAGE_KINDS: readonly StageKind[] = ['done', 'abandoned'];

export interface StageRef {
  /** The customer's own stage name, preserved for reporting ("Waiting for approval"). */
  readonly name: string;
  readonly kind: StageKind;
}

export function isTerminal(stage: StageRef): boolean {
  return TERMINAL_STAGE_KINDS.includes(stage.kind);
}
