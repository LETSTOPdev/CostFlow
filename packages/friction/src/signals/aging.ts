import type { ImportBatch, IsoDateString, StageRef } from '@costflow/domain';
import { isTerminal, parseIsoUtc, wholeDaysBetween } from '@costflow/domain';
import type { AgingEvidence, AgingInstance, FrictionSignalMeta } from '../signal';
import { locationId, locationKey } from './slug';

/**
 * F2 — Aging / stagnation (doc 02 §4): an in-flight item untouched beyond a
 * threshold is likely forgotten or silently blocked. Snapshot-capable: this is
 * the detector that works on any export, which is why it leads the MVP set.
 */
export const AGING_SIGNAL: FrictionSignalMeta = {
  id: 'f2-aging',
  // 1.1.0 — instances are located at (origin, stage) rather than stage alone,
  // so two teams sharing a status name are two findings. Identical output for a
  // single-origin import.
  version: '1.1.0',
  name: 'Aging / stagnation',
  requires: ['hasLastUpdated'],
};

export interface AgingParams {
  readonly thresholdDays: number;
  /** Explicit analysis time — never a clock read (doc 05 §3). */
  readonly now: IsoDateString;
}

/**
 * One instance per stage holding aging items, ordered deterministically
 * (magnitude desc, then stage name). Items missing lastUpdatedAt are not
 * evaluable and are simply absent from evidence — their absence was already
 * surfaced as an import diagnostic, not invented into a duration (doc 03 P5).
 */
export function detectAging(batch: ImportBatch, params: AgingParams): AgingInstance[] {
  // R-01: an unparseable analysis time is an input error, never data
  // degradation — silently skipping every item would assert "no frictions"
  // about data that was never actually analyzed (doc 03 P5).
  if (parseIsoUtc(params.now) === null) {
    throw new Error(
      `Invalid analysis time "${params.now}" — expected ISO-8601 (YYYY-MM-DD or full timestamp).`,
    );
  }
  const byLocation = new Map<
    string,
    { stage: StageRef; originScopeId: string | null; evidence: AgingEvidence[] }
  >();

  for (const item of batch.items) {
    if (isTerminal(item.stage) || item.lastUpdatedAt === null) continue;
    const agingDays = wholeDaysBetween(item.lastUpdatedAt, params.now);
    if (agingDays === null || agingDays <= params.thresholdDays) continue;
    const key = locationKey(item.originScopeId, item.stage.name);
    const entry = byLocation.get(key) ?? {
      stage: item.stage,
      originScopeId: item.originScopeId,
      evidence: [],
    };
    entry.evidence.push({
      workItemId: item.id,
      title: item.title,
      actor: item.actor,
      lastUpdatedAt: item.lastUpdatedAt,
      agingDays,
      excessDays: agingDays - params.thresholdDays,
    });
    byLocation.set(key, entry);
  }

  const instances: AgingInstance[] = [...byLocation.values()].map(
    ({ stage, originScopeId, evidence }) => {
      const sorted = [...evidence].sort(
        (a, b) => b.excessDays - a.excessDays || a.workItemId.localeCompare(b.workItemId),
      );
      return {
        id: locationId(AGING_SIGNAL.id, originScopeId, stage.name),
        signalId: AGING_SIGNAL.id,
        signalVersion: AGING_SIGNAL.version,
        frictionType: 'aging' as const,
        location: { stage, originScopeId },
        magnitude: {
          unit: 'item-days-beyond-threshold',
          value: sorted.reduce((sum, e) => sum + e.excessDays, 0),
        },
        evidence: sorted,
      };
    },
  );

  return instances.sort(
    (a, b) => b.magnitude.value - a.magnitude.value || a.id.localeCompare(b.id),
  );
}
