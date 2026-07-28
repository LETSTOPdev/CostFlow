/**
 * Evidence translation (ADR-0006; founder directive 2026-07-28).
 *
 * The diagnostics layer reasons in `EvidenceCapability` and knows nothing about
 * platforms. This module is the ONLY place the two worlds meet: it turns a
 * connector, that platform's limits, the workspace's plan, and what a given
 * import actually contained into an `EvidenceProfile` plus a customer-facing
 * explanation for anything missing.
 *
 * The explanation is the point. "Not computable" is a dead end; these three are
 * not the same sentence, and only one of them is something the customer can act
 * on today:
 *
 *   platform-cannot  the connected platform has no way to expose this
 *   plan-gated       it can, but this workspace's plan or configuration does not  ← actionable
 *   import-lacked    it does, but this particular import did not carry it         ← actionable
 *   not-built        CostFlow does not read this from any platform yet
 *
 * Adding a connector means adding a `provides` declaration, never a branch here
 * and never a line in packages/diagnostics.
 */
import type { CapabilityProfile, ImportBatch } from '@costflow/domain';
import {
  EVIDENCE_CAPABILITIES,
  type EvidenceCapability,
  type EvidenceProfile,
} from '@costflow/diagnostics';

export type AbsenceReason = 'platform-cannot' | 'plan-gated' | 'import-lacked' | 'not-built';

/** What one platform is able to expose, declared by its connector. */
export interface ConnectorEvidence {
  /** Capabilities this platform can expose at all. */
  readonly canProvide: readonly EvidenceCapability[];
  /**
   * Of those, the ones that depend on a plan tier or a workspace setting the
   * customer controls. Absent + gated is the one message worth sending, because
   * it is the one a workspace admin can fix.
   */
  readonly planGated: readonly EvidenceCapability[];
  /** How the customer turns on a gated capability. Keyed by capability. */
  readonly planGateHint: Readonly<Partial<Record<EvidenceCapability, string>>>;
}

export interface CapabilityStatus {
  readonly capability: EvidenceCapability;
  readonly present: boolean;
  readonly reason: AbsenceReason | null;
  /** Customer-facing, values-safe. Empty when the capability is present. */
  readonly explanation: string;
}

export interface EvidenceAssessment {
  readonly profile: EvidenceProfile;
  readonly statuses: readonly CapabilityStatus[];
}

/** Human labels for the vocabulary, used in customer-facing copy. */
export const CAPABILITY_LABELS: Readonly<Record<EvidenceCapability, string>> = {
  'stage-snapshots': 'stage snapshots',
  'status-history': 'status history',
  'transition-history': 'transition history',
  'assignment-history': 'assignment history',
  'due-dates': 'due dates',
  'dependency-graph': 'dependency graph',
  'approval-chain': 'approval chain',
  'capacity-signals': 'capacity signals',
};

/**
 * What THIS import actually contained. Deliberately separate from what the
 * platform could have supplied: a workspace whose plan exposes history still
 * produces an import without it if the scope was narrow or the fetch degraded.
 */
function realized(batch: Pick<ImportBatch, 'items' | 'events' | 'capability'>): EvidenceProfile {
  const cap: CapabilityProfile = batch.capability;
  // Canonical WorkItemEvents are ordered and timestamped by construction, so
  // their presence IS transition history. `from` being null (arrival-only
  // sources) makes them less descriptive, not less ordered — detectQueueWait
  // never reads it. What cannot produce them at all is an aggregate
  // time-in-status feed, which is why that is a separate capability.
  const hasTransitions = cap.hasEventHistory && batch.events.length > 0;
  return {
    'stage-snapshots': batch.items.length > 0,
    // Durations per status are derivable from ordered transitions; the reverse
    // is not true. Anything that yields transitions yields status history.
    'status-history': hasTransitions,
    'transition-history': hasTransitions,
    'assignment-history': false,
    'due-dates': cap.hasDueDates,
    'dependency-graph': false,
    'approval-chain': false,
    'capacity-signals': false,
  };
}

/**
 * Capabilities CostFlow cannot ingest from ANY platform yet. Absent here is a
 * roadmap fact, not a limitation of the customer's tool, and saying so honestly
 * is the difference between "your platform is deficient" and "we do not read
 * this yet".
 */
const NOT_BUILT: readonly EvidenceCapability[] = [
  'assignment-history',
  'dependency-graph',
  'approval-chain',
  'capacity-signals',
];

export function assessEvidence(
  connector: { readonly name: string; readonly provides: ConnectorEvidence },
  batch: Pick<ImportBatch, 'items' | 'events' | 'capability'>,
): EvidenceAssessment {
  const have = realized(batch);
  const { canProvide, planGated, planGateHint } = connector.provides;

  const statuses = EVIDENCE_CAPABILITIES.map((capability): CapabilityStatus => {
    const label = CAPABILITY_LABELS[capability];
    if (have[capability]) {
      return { capability, present: true, reason: null, explanation: '' };
    }
    if (NOT_BUILT.includes(capability)) {
      return {
        capability,
        present: false,
        reason: 'not-built',
        explanation: `CostFlow does not read ${label} from any connected platform yet.`,
      };
    }
    if (!canProvide.includes(capability)) {
      return {
        capability,
        present: false,
        reason: 'platform-cannot',
        explanation: `${connector.name} does not expose ${label}.`,
      };
    }
    if (planGated.includes(capability)) {
      const hint = planGateHint[capability];
      return {
        capability,
        present: false,
        reason: 'plan-gated',
        explanation: hint
          ? `${connector.name} can expose ${label}, but this workspace does not. ${hint}`
          : `${connector.name} can expose ${label}, but this workspace's plan or settings do not.`,
      };
    }
    return {
      capability,
      present: false,
      reason: 'import-lacked',
      explanation: `${connector.name} exposes ${label}, but this import did not include it.`,
    };
  });

  return { profile: have, statuses };
}

/** The statuses a customer can do something about, most actionable first. */
export function actionableGaps(assessment: EvidenceAssessment): readonly CapabilityStatus[] {
  const rank: Record<AbsenceReason, number> = {
    'plan-gated': 0,
    'import-lacked': 1,
    'platform-cannot': 2,
    'not-built': 3,
  };
  return assessment.statuses
    .filter((s) => !s.present && s.reason !== null)
    .sort(
      (a, b) =>
        rank[a.reason as AbsenceReason] - rank[b.reason as AbsenceReason] ||
        a.capability.localeCompare(b.capability),
    );
}
