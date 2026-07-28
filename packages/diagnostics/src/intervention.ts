/**
 * Intervention primitives and their declared implementation complexity
 * (ADR-0006 §3 and §5).
 *
 * The set is CLOSED. This is what makes ADR-0006's governing rule structural
 * rather than aspirational: no call site can ever emit "coach" or "review
 * performance", because those verbs do not exist in the type. Adding one is an
 * amendment to the ADR, not a patch.
 */
import type { StageRef } from '@costflow/domain';

export const INTERVENTION_PRIMITIVES = [
  'review-queue',
  'assign-ownership',
  'escalate-on-age',
  'add-stage-sla',
  'change-wip-limit',
  'change-batching-cadence',
  'reassign-routing',
  'remove-gate',
  'split-or-merge-stage',
  'add-capacity',
] as const;

export type InterventionPrimitive = (typeof INTERVENTION_PRIMITIVES)[number];

/** Doc 07 §2.2 effort classes, ordered cheapest-to-try first. */
export type EffortClass = 'policy' | 'process-change' | 'staffing' | 'tooling';

export type Complexity = 'Low' | 'Medium' | 'High';

/**
 * Declared, uniform across every tenant, and displayed (ADR-0006 §5). This is a
 * property of the ACTION, never an inference about the organization: the engine
 * cannot know how hard it is for a particular company to add an approver, so it
 * does not pretend to. A customer who disagrees edits it under the
 * assumption-ownership principle (doc 03 P4); until then everyone sees the same
 * table, and the table is visible.
 *
 * Complexity NEVER reorders a list. Impact and complexity are separate axes and
 * are never fused into one score (ADR-0006 §5).
 */
export interface InterventionSpec {
  readonly primitive: InterventionPrimitive;
  readonly complexity: Complexity;
  readonly effortClass: EffortClass;
  /** Imperative, structural, and about the work — never about a person. */
  readonly label: string;
}

export const INTERVENTIONS: Readonly<Record<InterventionPrimitive, InterventionSpec>> =
  Object.freeze({
    'review-queue': {
      primitive: 'review-queue',
      complexity: 'Low',
      effortClass: 'process-change',
      label: 'Review this queue',
    },
    'assign-ownership': {
      primitive: 'assign-ownership',
      complexity: 'Low',
      effortClass: 'process-change',
      label: 'Assign ownership for the unowned items in this stage',
    },
    'escalate-on-age': {
      primitive: 'escalate-on-age',
      complexity: 'Low',
      effortClass: 'policy',
      label: 'Add an escalation rule for items past their due date',
    },
    'add-stage-sla': {
      primitive: 'add-stage-sla',
      complexity: 'Low',
      effortClass: 'policy',
      label: 'Set a service-level target for this stage',
    },
    'change-wip-limit': {
      primitive: 'change-wip-limit',
      complexity: 'Medium',
      effortClass: 'process-change',
      label: 'Introduce or adjust a work-in-progress limit',
    },
    'change-batching-cadence': {
      primitive: 'change-batching-cadence',
      complexity: 'Medium',
      effortClass: 'policy',
      label: 'Change how often work is released through this stage',
    },
    'reassign-routing': {
      primitive: 'reassign-routing',
      complexity: 'Medium',
      effortClass: 'process-change',
      label: 'Redistribute how work is routed into this stage',
    },
    'remove-gate': {
      primitive: 'remove-gate',
      complexity: 'Medium',
      effortClass: 'policy',
      label: 'Remove this approval gate for lower-risk item classes',
    },
    'split-or-merge-stage': {
      primitive: 'split-or-merge-stage',
      complexity: 'High',
      effortClass: 'process-change',
      label: 'Split or merge this stage',
    },
    'add-capacity': {
      primitive: 'add-capacity',
      complexity: 'High',
      effortClass: 'staffing',
      label: 'Add capacity to this stage',
    },
  });

/** Where an intervention applies. A stage, never a person (ADR-0006 §2). */
export interface InterventionTarget {
  readonly stage: StageRef;
}
