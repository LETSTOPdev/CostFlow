import type { ImportBatch, IsoDateString, StageRef } from '@costflow/domain';
import { isTerminal, parseIsoUtc, wholeDaysBetween } from '@costflow/domain';
import type { FrictionSignalMeta, OverdueEvidence, OverdueInstance } from '../signal';
import { locationId, locationKey } from './slug';

/**
 * F3a — Open overdue exposure (doc 12): in-flight items past their own due
 * dates are commitment breaches in progress. Snapshot-capable; the threshold
 * is the customer's per-item due date — CostFlow imposes no temporal opinion.
 */
export const OVERDUE_SIGNAL: FrictionSignalMeta = {
  id: 'f3-overdue',
  // 1.1.0 — see the aging signal: located at (origin, stage).
  version: '1.1.0',
  name: 'Overdue exposure',
  requires: ['hasDueDates'],
};

export interface OverdueParams {
  /** Explicit analysis time — never a clock read (doc 05 §3). */
  readonly now: IsoDateString;
}

/**
 * Deterministic detection (doc 12 §4): non-terminal items with a due date,
 * `overdueDays = floor((now − dueAt)/1d) ≥ 1` (day granularity — an item
 * overdue by hours appears tomorrow, never fractionally). Grouped by the
 * stage where the late work currently sits (structural attribution, N1).
 * Not-yet-due items are ignored: no at-risk speculation (doc 07 rules).
 */
export function detectOverdue(batch: ImportBatch, params: OverdueParams): OverdueInstance[] {
  // R-01 discipline: an unparseable analysis time is an input error, never
  // data degradation.
  if (parseIsoUtc(params.now) === null) {
    throw new Error(
      `Invalid analysis time "${params.now}" — expected ISO-8601 (YYYY-MM-DD or full timestamp).`,
    );
  }

  interface Candidate {
    readonly stage: StageRef;
    readonly originScopeId: string | null;
    readonly evidence: Omit<OverdueEvidence, 'sharedDueDateCohortSize'>;
  }
  const candidates: Candidate[] = [];

  for (const item of batch.items) {
    if (isTerminal(item.stage) || item.dueAt === null) continue;
    const overdueDays = wholeDaysBetween(item.dueAt, params.now);
    if (overdueDays === null || overdueDays < 1) continue;
    const createdMs = item.createdAt === null ? null : parseIsoUtc(item.createdAt);
    const dueMs = parseIsoUtc(item.dueAt);
    candidates.push({
      stage: item.stage,
      originScopeId: item.originScopeId,
      evidence: {
        workItemId: item.id,
        title: item.title,
        actor: item.actor,
        dueAt: item.dueAt,
        overdueDays,
        dueBeforeCreated: createdMs !== null && dueMs !== null && dueMs < createdMs,
      },
    });
  }

  // Batch-wide cohorts of identical due timestamps among OVERDUE items only
  // (doc 12 §5) — the raw material for the milestone-gate confidence cap.
  const cohorts = new Map<string, number>();
  for (const c of candidates) {
    cohorts.set(c.evidence.dueAt, (cohorts.get(c.evidence.dueAt) ?? 0) + 1);
  }

  const byLocation = new Map<
    string,
    { stage: StageRef; originScopeId: string | null; evidence: OverdueEvidence[] }
  >();
  for (const c of candidates) {
    const key = locationKey(c.originScopeId, c.stage.name);
    const entry = byLocation.get(key) ?? {
      stage: c.stage,
      originScopeId: c.originScopeId,
      evidence: [],
    };
    entry.evidence.push({
      ...c.evidence,
      sharedDueDateCohortSize: (cohorts.get(c.evidence.dueAt) ?? 1) - 1,
    });
    byLocation.set(key, entry);
  }

  const instances: OverdueInstance[] = [...byLocation.values()].map(
    ({ stage, originScopeId, evidence }) => {
      const sorted = [...evidence].sort(
        (a, b) => b.overdueDays - a.overdueDays || a.workItemId.localeCompare(b.workItemId),
      );
      return {
        id: locationId(OVERDUE_SIGNAL.id, originScopeId, stage.name),
        signalId: OVERDUE_SIGNAL.id,
        signalVersion: OVERDUE_SIGNAL.version,
        frictionType: 'overdue' as const,
        location: { stage, originScopeId },
        magnitude: {
          unit: 'item-days-overdue',
          value: sorted.reduce((sum, e) => sum + e.overdueDays, 0),
        },
        evidence: sorted,
      };
    },
  );

  return instances.sort(
    (a, b) => b.magnitude.value - a.magnitude.value || a.id.localeCompare(b.id),
  );
}
