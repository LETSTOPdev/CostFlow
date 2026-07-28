import type { AnalysisRun, FrictionInstance } from '@costflow/analysis';
import type { StageRef } from '@costflow/domain';
import { composeConfidence, type ConfidenceCap } from '@costflow/cost-engine';
import { checkCapabilities, type DiagnosticSignalMeta, type EvidenceProfile } from '../capability';
import type { DiagnosticFinding, DiagnosticUnavailable } from '../finding';
import { INTERVENTIONS, type InterventionPrimitive } from '../intervention';
import { itemMagnitudes, unitLabel } from './magnitude';

/**
 * DC — Friction concentration.
 *
 * "Is the organization's friction spread evenly, or does one stage own most of
 * it?" Concentration is the cheapest actionable finding in the taxonomy: it
 * needs no event history, no second actor, and no vendor assumption. It rests
 * on stages and the friction instances the engine already produced, which is
 * why it is the diagnostic that works on every supported platform.
 *
 * Validated against partner run cu01, where it identifies one queue stage
 * holding 80% of the workspace's entire overdue exposure across 23 items.
 */
export const CONCENTRATION_SIGNAL: DiagnosticSignalMeta = {
  id: 'dc-friction-concentration',
  version: '1.0.0',
  name: 'Friction concentration',
  requires: ['stage-snapshots'],
};

/** Declared thresholds. Displayed with the finding — never tuned per tenant. */
export const CONCENTRATION_THRESHOLDS = {
  /** Below this share, "concentrated" is not a claim worth making. */
  sharePercent: 50,
  /**
   * With one contributing stage the share is 100% by construction and carries
   * no information. Concentration is a comparative claim or it is nothing.
   */
  minStages: 2,
  /**
   * A hard floor, NOT a confidence cap. Below this the finding is suppressed
   * entirely rather than shown at a lower grade.
   *
   * A grade is a caveat, and a caveat on a headline is still a headline: "80% of
   * your overdue exposure is in one stage" reads as a finding whether or not it
   * is labelled B, and on a three-item workspace it is really a statement about
   * three items. Very small workspaces are exactly where a confident-sounding
   * number does the most damage to trust, so the honest move is silence.
   */
  minItems: 5,
  /** A single item at or above this share of the stage total is an outlier, not a pattern. */
  outlierItemSharePercent: 50,
} as const;

/**
 * Magnitude units are NOT commensurable: item-days-overdue, item-hours-waiting
 * and item-days-beyond-threshold measure different things, and summing them
 * produces a number that means nothing. Concentration is therefore computed
 * within a single unit, and the finding names it.
 */
const INTERVENTION_BY_UNIT: Readonly<Record<string, InterventionPrimitive>> = {
  'item-days-overdue': 'escalate-on-age',
  'item-hours-waiting': 'add-stage-sla',
  'item-days-beyond-threshold': 'review-queue',
};

/**
 * Fails closed: an unmapped unit yields NO intervention, and the caller drops
 * the finding rather than attaching a default.
 *
 * A silent fallback would turn a renamed or newly added magnitude unit into
 * confident but wrong advice, which is the worst failure this layer can have —
 * a recommendation the evidence does not support is more damaging than no
 * recommendation. Skipping rather than throwing is deliberate: with two
 * replicas, a rolling deploy guarantees the older one reads artifacts written
 * by the newer engine, so an unknown unit is an expected transient, not a bug.
 *
 * Exhaustiveness is enforced at build time instead, by a test that walks the
 * golden artifacts and asserts every unit the engine actually emits is mapped.
 */
export const interventionForUnit = (unit: string): InterventionPrimitive | null =>
  INTERVENTION_BY_UNIT[unit] ?? null;

interface StageBucket {
  readonly stage: StageRef;
  total: number;
  items: number;
  largestItem: number;
}

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export function detectConcentration(
  run: AnalysisRun,
  profile: EvidenceProfile,
): { findings: DiagnosticFinding[]; unavailable: DiagnosticUnavailable | null } {
  const check = checkCapabilities(CONCENTRATION_SIGNAL, profile);
  if (!check.canRun) {
    return {
      findings: [],
      unavailable: {
        signalId: CONCENTRATION_SIGNAL.id,
        signalVersion: CONCENTRATION_SIGNAL.version,
        signalName: CONCENTRATION_SIGNAL.name,
        missing: check.missing,
        reason: check.reason,
      },
    };
  }

  // unit → stage name → bucket
  const byUnit = new Map<string, Map<string, StageBucket>>();
  for (const instance of run.frictions as readonly FrictionInstance[]) {
    const unit = instance.magnitude.unit;
    const stages = byUnit.get(unit) ?? new Map<string, StageBucket>();
    const key = instance.location.stage.name;
    const bucket = stages.get(key) ?? {
      stage: instance.location.stage,
      total: 0,
      items: 0,
      largestItem: 0,
    };
    bucket.total += instance.magnitude.value;
    const magnitudes = itemMagnitudes(instance);
    bucket.items += magnitudes.length;
    bucket.largestItem = Math.max(bucket.largestItem, ...magnitudes, 0);
    stages.set(key, bucket);
    byUnit.set(unit, stages);
  }

  const findings: DiagnosticFinding[] = [];
  // Deterministic order: largest total first, then unit name.
  const units = [...byUnit.entries()].sort((a, b) => {
    const ta = [...a[1].values()].reduce((s, x) => s + x.total, 0);
    const tb = [...b[1].values()].reduce((s, x) => s + x.total, 0);
    return tb - ta || a[0].localeCompare(b[0]);
  });

  for (const [unit, stages] of units) {
    const buckets = [...stages.values()].filter((b) => b.total > 0);
    if (buckets.length < CONCENTRATION_THRESHOLDS.minStages) continue;

    const total = buckets.reduce((s, b) => s + b.total, 0);
    if (total <= 0) continue;

    const top = [...buckets].sort(
      (a, b) => b.total - a.total || a.stage.name.localeCompare(b.stage.name),
    )[0] as StageBucket;

    const sharePercent = pct(top.total, total);
    if (sharePercent < CONCENTRATION_THRESHOLDS.sharePercent) continue;
    // Suppressed outright, not downgraded — see the threshold's note.
    if (top.items < CONCENTRATION_THRESHOLDS.minItems) continue;

    const outlierSharePercent = pct(top.largestItem, top.total);
    const caps: ConfidenceCap[] = [];
    if (outlierSharePercent >= CONCENTRATION_THRESHOLDS.outlierItemSharePercent) {
      caps.push({
        tier: 'B',
        reason: `A single item accounts for ${outlierSharePercent}% of this stage's total — an outlier, not a systemic pattern.`,
      });
    }

    // No mapped intervention means no advice we can stand behind for this unit.
    const primitive = interventionForUnit(unit);
    if (primitive === null) continue;
    const intervention = INTERVENTIONS[primitive];
    findings.push({
      signalId: CONCENTRATION_SIGNAL.id,
      signalVersion: CONCENTRATION_SIGNAL.version,
      signalName: CONCENTRATION_SIGNAL.name,
      subject: { stage: top.stage },
      sharePercent,
      shareOf: unitLabel(unit),
      facts: {
        stageMagnitude: top.total,
        workspaceMagnitude: total,
        sharePercent,
        items: top.items,
        contributingStages: buckets.length,
        largestSingleItem: top.largestItem,
        largestItemSharePercent: outlierSharePercent,
      },
      statement:
        `Stage "${top.stage.name}" holds ${sharePercent}% of this workspace's ${unitLabel(unit)} ` +
        `(${top.total} of ${total}) across ${top.items} item${top.items === 1 ? '' : 's'}, ` +
        `spread over ${buckets.length} stages with friction. ` +
        (outlierSharePercent >= CONCENTRATION_THRESHOLDS.outlierItemSharePercent
          ? `One item accounts for ${outlierSharePercent}% of that, so the concentration is driven by an outlier.`
          : `No single item accounts for more than ${outlierSharePercent}% of it, so the pattern is systemic rather than outlier-driven.`),
      confidence: composeConfidence(caps),
      intervention: { ...intervention, stage: top.stage },
    });
  }

  return { findings, unavailable: null };
}
