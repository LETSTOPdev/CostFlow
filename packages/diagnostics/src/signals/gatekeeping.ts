import type { AnalysisRun, FrictionInstance } from '@costflow/analysis';
import type { StageRef } from '@costflow/domain';
import { composeConfidence, type ConfidenceCap } from '@costflow/cost-engine';
import { checkCapabilities, type DiagnosticSignalMeta, type EvidenceProfile } from '../capability';
import type { DiagnosticFinding, DiagnosticUnavailable } from '../finding';
import { INTERVENTIONS } from '../intervention';

/**
 * D3 — Serial gatekeeping (doc 07 §1.2).
 *
 * "One approval stage that a disproportionate amount of work must pass
 * through, and whose wait dominates lead time." This is the highest-value
 * diagnostic in OI1 and the one with the hardest data requirement: it is a
 * claim about what items PASSED THROUGH, which a snapshot cannot support. A
 * snapshot says where work sits now; a census of a review stage is not a
 * bottleneck finding.
 *
 * `transition-history` is therefore a hard gate, and the honest consequence is
 * that D3 is simply unavailable on platforms that do not expose ordered,
 * timestamped stage entries. That unavailability is a product surface, not a
 * failure: the app edge turns it into "here is the capability you are missing,
 * and here is what would unlock it".
 *
 * Note the requirement is transition-history and NOT status-history. Durations
 * alone, with no instant attached, cannot say WHEN an item entered a stage and
 * so cannot produce wait. The two are separate capabilities precisely because
 * one platform's "we have status history" is not the other's — and a platform
 * whose residency entries do carry entry instants supplies transition history,
 * whatever it calls the endpoint.
 */
export const GATEKEEPING_SIGNAL: DiagnosticSignalMeta = {
  id: 'd3-serial-gatekeeping',
  version: '1.0.0',
  name: 'Serial gatekeeping',
  requires: ['transition-history'],
};

/** Declared thresholds. Displayed with the finding — never tuned per tenant. */
export const GATEKEEPING_THRESHOLDS = {
  /** The gate's share of all observed wait. */
  waitSharePercent: 40,
  /** …and the share of waiting items that passed through it. */
  pathSharePercent: 50,
  /** Below this, the share is 100% by construction and says nothing. */
  minStages: 2,
  /** Below this, the pattern is too thin to call systemic. */
  minItems: 5,
} as const;

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export function detectSerialGatekeeping(
  run: AnalysisRun,
  profile: EvidenceProfile,
  /**
   * Caps inherited from the artifact's evidence quality (doc 21), supplied by the
   * app edge. Passing them in rather than reading them keeps this layer blind to
   * WHY its confidence is capped, exactly as it is blind to why a capability is
   * missing. It only composes.
   */
  inherited: readonly ConfidenceCap[] = [],
): { findings: DiagnosticFinding[]; unavailable: DiagnosticUnavailable | null } {
  const check = checkCapabilities(GATEKEEPING_SIGNAL, profile);
  if (!check.canRun) {
    return {
      findings: [],
      unavailable: {
        signalId: GATEKEEPING_SIGNAL.id,
        signalVersion: GATEKEEPING_SIGNAL.version,
        signalName: GATEKEEPING_SIGNAL.name,
        missing: check.missing,
        reason: check.reason,
      },
    };
  }

  // Wait is the only magnitude that answers "how long did work sit here", and
  // queue-wait is the only signal that measures it.
  const waits = (run.frictions as readonly FrictionInstance[]).filter(
    (f): f is Extract<FrictionInstance, { frictionType: 'queue-wait' }> =>
      f.frictionType === 'queue-wait',
  );
  if (waits.length < GATEKEEPING_THRESHOLDS.minStages) return { findings: [], unavailable: null };

  const totalWait = waits.reduce((s, f) => s + f.magnitude.value, 0);
  if (totalWait <= 0) return { findings: [], unavailable: null };

  const allWaitingItems = new Set<string>();
  for (const f of waits) for (const e of f.evidence) allWaitingItems.add(e.workItemId);

  // A gate is a review-kind stage. A queue-kind stage holding the most wait is
  // a backlog, which is DC's finding, not gatekeeping.
  const gates = waits
    .filter((f) => f.location.stage.kind === 'review')
    .map((f) => ({
      stage: f.location.stage as StageRef,
      originScopeId: f.location.originScopeId,
      wait: f.magnitude.value,
      items: new Set(f.evidence.map((e) => e.workItemId)).size,
      largestItemWait: f.evidence.reduce((m, e) => Math.max(m, e.waitHours), 0),
    }))
    .sort((a, b) => b.wait - a.wait || a.stage.name.localeCompare(b.stage.name));

  const top = gates[0];
  if (!top) return { findings: [], unavailable: null };

  const waitSharePercent = pct(top.wait, totalWait);
  const pathSharePercent = pct(top.items, allWaitingItems.size);
  if (
    waitSharePercent < GATEKEEPING_THRESHOLDS.waitSharePercent ||
    pathSharePercent < GATEKEEPING_THRESHOLDS.pathSharePercent
  ) {
    return { findings: [], unavailable: null };
  }

  const caps: ConfidenceCap[] = [];
  if (top.items < GATEKEEPING_THRESHOLDS.minItems) {
    caps.push({
      tier: 'B',
      reason: `The gate's wait is observed on ${top.items} item${top.items === 1 ? '' : 's'}; fewer than ${GATEKEEPING_THRESHOLDS.minItems} is a pattern too thin to call systemic.`,
    });
  }
  const outlierShare = pct(top.largestItemWait, top.wait);
  if (outlierShare >= 50) {
    caps.push({
      tier: 'B',
      reason: `A single item accounts for ${outlierShare}% of this gate's wait — an outlier, not a standing bottleneck.`,
    });
  }

  return {
    findings: [
      {
        signalId: GATEKEEPING_SIGNAL.id,
        signalVersion: GATEKEEPING_SIGNAL.version,
        signalName: GATEKEEPING_SIGNAL.name,
        subject: { stage: top.stage, originScopeId: top.originScopeId },
        sharePercent: waitSharePercent,
        shareOf: 'observed waiting time',
        facts: {
          gateWaitHours: top.wait,
          totalWaitHours: totalWait,
          waitSharePercent,
          itemsThroughGate: top.items,
          itemsWaitingAnywhere: allWaitingItems.size,
          pathSharePercent,
          waitingStages: waits.length,
          largestSingleItemWaitHours: top.largestItemWait,
        },
        statement:
          `The approval stage "${top.stage.name}" accounts for ${waitSharePercent}% of all ` +
          `observed waiting time (${top.wait} of ${totalWait} item-hours) and sits in the path ` +
          `of ${pathSharePercent}% of the items that waited anywhere ` +
          `(${top.items} of ${allWaitingItems.size}). ` +
          `Work is queueing behind one gate rather than spreading across ${waits.length} waiting stages.`,
        confidence: composeConfidence([...inherited, ...caps]),
        intervention: { ...INTERVENTIONS['add-stage-sla'], stage: top.stage },
      },
    ],
    unavailable: null,
  };
}
