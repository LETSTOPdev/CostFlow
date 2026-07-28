import type { AnalysisRun, FrictionInstance } from '@costflow/analysis';
import type { StageRef, WorkItem } from '@costflow/domain';
import { count } from './magnitude';
import { composeConfidence, type ConfidenceCap } from '@costflow/cost-engine';
import { checkCapabilities, type DiagnosticSignalMeta, type EvidenceProfile } from '../capability';
import type { DiagnosticFinding, DiagnosticUnavailable } from '../finding';
import { INTERVENTIONS } from '../intervention';

/**
 * D4 — Missing ownership (doc 07 §1.2).
 *
 * "Items wait because nobody holds them." Doc 07 lists D4 as one of the few
 * factors that works on snapshots rather than event history, which is why it
 * ships in OI1.
 *
 * Only CURRENT ownership is needed, and that travels with the item snapshot;
 * `assignment-history` (who held an item over time) is a strictly stronger
 * capability this diagnostic does not require.
 *
 * The claim is comparative, never absolute. "19% of items have no owner" is a
 * fact about data hygiene, not a diagnosis of friction. D4 fires only when
 * unowned items are OVER-REPRESENTED among the items actually carrying
 * friction — that lift is the whole finding. Two consequences fall out, both
 * wanted:
 *
 *  - A workspace that simply never mapped an actor column has every item
 *    unowned, so the lift is zero and D4 stays silent instead of reporting a
 *    mapping gap as a bottleneck.
 *  - A workspace where unowned items are no worse than owned ones produces no
 *    finding at all. That is doc 07 §1.3's "zero findings is a legal and honest
 *    outcome", and it is exactly what partner run cu01 produces.
 */
export const OWNERSHIP_SIGNAL: DiagnosticSignalMeta = {
  id: 'd4-missing-ownership',
  version: '1.0.0',
  name: 'Missing ownership',
  requires: ['stage-snapshots'],
};

/** Declared thresholds. Displayed with the finding — never tuned per tenant. */
export const OWNERSHIP_THRESHOLDS = {
  /** Below this, one item flips the comparison. */
  minFrictionItems: 5,
  /** Unowned items must be at least this share of friction-carrying items. */
  minSharePercent: 30,
  /** …and must exceed the workspace's own base rate by at least this much. */
  minLiftPoints: 15,
} as const;

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export function detectMissingOwnership(
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
  const check = checkCapabilities(OWNERSHIP_SIGNAL, profile);
  if (!check.canRun) {
    return {
      findings: [],
      unavailable: {
        signalId: OWNERSHIP_SIGNAL.id,
        signalVersion: OWNERSHIP_SIGNAL.version,
        signalName: OWNERSHIP_SIGNAL.name,
        missing: check.missing,
        reason: check.reason,
      },
    };
  }

  const items = run.batch.items as readonly WorkItem[];
  if (items.length === 0) return { findings: [], unavailable: null };

  const byId = new Map(items.map((i) => [i.id, i]));
  const unowned = (item: WorkItem | undefined): boolean => item?.actor.kind === 'missing';

  const baseUnowned = items.filter(unowned).length;
  const baseSharePercent = pct(baseUnowned, items.length);

  // Distinct items carrying friction evidence, and where their unowned ones sit.
  const frictionItemIds = new Set<string>();
  const unownedByStage = new Map<
    string,
    { stage: StageRef; originScopeId: string | null; count: number }
  >();
  for (const instance of run.frictions as readonly FrictionInstance[]) {
    for (const e of instance.evidence) {
      if (frictionItemIds.has(e.workItemId)) continue;
      frictionItemIds.add(e.workItemId);
      if (!unowned(byId.get(e.workItemId))) continue;
      const key = `${instance.location.originScopeId ?? ''}\u0000${instance.location.stage.name}`;
      const bucket = unownedByStage.get(key) ?? {
        stage: instance.location.stage,
        originScopeId: instance.location.originScopeId,
        count: 0,
      };
      bucket.count += 1;
      unownedByStage.set(key, bucket);
    }
  }

  const frictionItems = frictionItemIds.size;
  if (frictionItems < OWNERSHIP_THRESHOLDS.minFrictionItems) {
    return { findings: [], unavailable: null };
  }

  const frictionUnowned = [...unownedByStage.values()].reduce((s, b) => s + b.count, 0);
  const frictionSharePercent = pct(frictionUnowned, frictionItems);
  const liftPoints = frictionSharePercent - baseSharePercent;

  if (
    frictionSharePercent < OWNERSHIP_THRESHOLDS.minSharePercent ||
    liftPoints < OWNERSHIP_THRESHOLDS.minLiftPoints
  ) {
    return { findings: [], unavailable: null };
  }

  // Subject is the stage holding the most unowned friction (ADR-0006 §2).
  const top = [...unownedByStage.values()].sort(
    (a, b) => b.count - a.count || a.stage.name.localeCompare(b.stage.name),
  )[0];
  if (!top) return { findings: [], unavailable: null };

  const caps: ConfidenceCap[] = [];
  if (frictionItems < OWNERSHIP_THRESHOLDS.minFrictionItems * 2) {
    caps.push({
      tier: 'B',
      reason: `Comparison rests on ${frictionItems} items carrying friction; the lift is directionally sound but thinly evidenced.`,
    });
  }

  return {
    findings: [
      {
        signalId: OWNERSHIP_SIGNAL.id,
        signalVersion: OWNERSHIP_SIGNAL.version,
        signalName: OWNERSHIP_SIGNAL.name,
        subject: { stage: top.stage, originScopeId: top.originScopeId },
        sharePercent: frictionSharePercent,
        shareOf: 'items carrying friction that have no owner',
        facts: {
          unownedItems: baseUnowned,
          totalItems: items.length,
          baseSharePercent,
          frictionItems,
          frictionUnowned,
          frictionSharePercent,
          liftPoints,
          unownedInSubjectStage: top.count,
        },
        statement:
          `${frictionSharePercent}% of the items carrying friction have no owner, against ` +
          `${baseSharePercent}% across the workspace as a whole — unowned work is ` +
          `${liftPoints} points over-represented among the items going wrong. ` +
          `Stage "${top.stage.name}" holds the largest group of them (${count(top.count)}).`,
        confidence: composeConfidence([...inherited, ...caps]),
        intervention: { ...INTERVENTIONS['assign-ownership'], stage: top.stage },
      },
    ],
    unavailable: null,
  };
}
