import type { ImportBatch, StageKind } from '@costflow/domain';
import { isTerminal } from '@costflow/domain';
import type { FrictionSignalMeta } from './signal';

/**
 * Context Signals (doc 14): explain conditions that cause or amplify
 * frictions. Deliberately structurally incapable of carrying money — no cost,
 * no confidence, no rank fields exist on this type, and observations live
 * outside the friction/pricing pipeline entirely. They inform interpretation;
 * they never mutate an estimate.
 */
export interface ContextObservation {
  readonly signalId: string;
  readonly signalVersion: string;
  readonly signalName: string;
  /** Human-readable, values-safe explanatory statement (customer stage names only). */
  readonly statement: string;
  /** Machine-readable counts backing the statement. */
  readonly facts: Readonly<Record<string, number>>;
}

/**
 * C6 — work-in-flight load (doc 14: F6 re-homed as context). States where
 * in-flight work is pooled, judgment-free: no "overload" claim, no threshold,
 * no drag factor — those failed the FS-2/3/4 tests and stay failed.
 */
export const WIP_LOAD_SIGNAL: FrictionSignalMeta = {
  id: 'c6-wip-load',
  version: '1.0.0',
  name: 'Work-in-flight load',
  requires: [],
};

export function observeWipLoad(batch: ImportBatch): ContextObservation | null {
  const inFlight = batch.items.filter((item) => !isTerminal(item.stage));
  if (inFlight.length === 0) return null;

  const byKind: Record<StageKind, number> = {
    queue: 0,
    active: 0,
    review: 0,
    blocked: 0,
    done: 0,
    abandoned: 0,
  };
  const byStage = new Map<string, number>();
  for (const item of inFlight) {
    byKind[item.stage.kind] += 1;
    byStage.set(item.stage.name, (byStage.get(item.stage.name) ?? 0) + 1);
  }

  const waiting = byKind.queue + byKind.review;
  const waitingShare = Math.round((waiting / inFlight.length) * 100);
  const [largestStage, largestCount] = [...byStage.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0] as [string, number];

  return {
    signalId: WIP_LOAD_SIGNAL.id,
    signalVersion: WIP_LOAD_SIGNAL.version,
    signalName: WIP_LOAD_SIGNAL.name,
    statement: `${waiting} of ${inFlight.length} in-flight items (${waitingShare}%) sit in queue- or review-kind stages; the largest single pool is stage "${largestStage}" (${largestCount} items).`,
    facts: {
      inFlight: inFlight.length,
      queueKind: byKind.queue,
      reviewKind: byKind.review,
      activeKind: byKind.active,
      blockedKind: byKind.blocked,
      waitingSharePercent: waitingShare,
    },
  };
}
