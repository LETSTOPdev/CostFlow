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
  /**
   * The recommendation, phrased as a suggestion rather than a conclusion.
   *
   * This wording carries a boundary (doc 07 §2.1). CostFlow MEASURES that the
   * concentration exists; it does not derive that an escalation policy is the
   * best answer. That comes from a curated playbook authored by humans and
   * matched deterministically to the pattern. Imperative phrasing ("Add an
   * escalation rule") reads as a computed conclusion and quietly overclaims,
   * so the copy stays suggestive and the render layer labels its provenance.
   *
   * Structural and about the work — never about a person (ADR-0006 §2).
   */
  readonly recommendation: string;
}

export const INTERVENTIONS: Readonly<Record<InterventionPrimitive, InterventionSpec>> =
  Object.freeze({
    'review-queue': {
      primitive: 'review-queue',
      complexity: 'Low',
      effortClass: 'process-change',
      recommendation:
        'Review this queue directly, to establish whether the work in it is still wanted before treating the backlog as a capacity problem.',
    },
    'assign-ownership': {
      primitive: 'assign-ownership',
      complexity: 'Low',
      effortClass: 'process-change',
      recommendation:
        'Give the unowned items in this stage an explicit owner, so that responsibility for moving them is not left to whoever happens to notice.',
    },
    'escalate-on-age': {
      primitive: 'escalate-on-age',
      complexity: 'Low',
      effortClass: 'policy',
      recommendation:
        'Introduce an escalation policy for items that remain overdue beyond a threshold you define, so that ageing work surfaces without someone having to go looking for it.',
    },
    'add-stage-sla': {
      primitive: 'add-stage-sla',
      complexity: 'Low',
      effortClass: 'policy',
      recommendation:
        'Set a service-level target for this stage, so the wait becomes something the organization measures and owns rather than absorbs.',
    },
    'change-wip-limit': {
      primitive: 'change-wip-limit',
      complexity: 'Medium',
      effortClass: 'process-change',
      recommendation:
        'Introduce or adjust a work-in-progress limit for this stage, to stop new work entering faster than it can leave.',
    },
    'change-batching-cadence': {
      primitive: 'change-batching-cadence',
      complexity: 'Medium',
      effortClass: 'policy',
      recommendation:
        'Change how often work is released through this stage, if the delay follows your release rhythm rather than the volume of work.',
    },
    'reassign-routing': {
      primitive: 'reassign-routing',
      complexity: 'Medium',
      effortClass: 'process-change',
      recommendation:
        'Redistribute how work is routed into this stage, so that arriving volume is matched to where the capacity actually is.',
    },
    'remove-gate': {
      primitive: 'remove-gate',
      complexity: 'Medium',
      effortClass: 'policy',
      recommendation:
        'Consider removing this approval gate for lower-risk classes of work, so that scrutiny is spent where the risk actually is.',
    },
    'split-or-merge-stage': {
      primitive: 'split-or-merge-stage',
      complexity: 'High',
      effortClass: 'process-change',
      recommendation:
        'Consider splitting or merging this stage, if the work passing through it is really two different kinds of work with different needs.',
    },
    'add-capacity': {
      primitive: 'add-capacity',
      complexity: 'High',
      effortClass: 'staffing',
      recommendation:
        'Consider adding capacity to this stage, once the cheaper policy and routing options above have been ruled out.',
    },
  });

/** Where an intervention applies. A stage, never a person (ADR-0006 §2). */
export interface InterventionTarget {
  readonly stage: StageRef;
}
