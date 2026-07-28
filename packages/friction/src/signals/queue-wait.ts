import type {
  ImportBatch,
  IsoDateString,
  StageKind,
  StageRef,
  WorkItemEvent,
} from '@costflow/domain';
import { isTerminal, parseIsoUtc } from '@costflow/domain';
import type { FrictionSignalMeta, QueueWaitEvidence, QueueWaitInstance } from '../signal';
import { locationId, locationKey } from './slug';

/**
 * F1 — Queue wait (doc 02 §4): time items spend sitting in queue/review-kind
 * stages, observed from event history. The single most exec-legible friction
 * (approval latency is F1 on review-kind stages).
 */
export const QUEUE_WAIT_SIGNAL: FrictionSignalMeta = {
  id: 'f1-queue-wait',
  // 1.1.0 — see the aging signal: located at (origin, stage).
  version: '1.1.0',
  name: 'Queue wait',
  requires: ['hasEventHistory'],
};

/** Wait is attributed only in these stage kinds (Part C req 6). */
export const QUEUE_WAIT_ELIGIBLE_KINDS: readonly StageKind[] = ['queue', 'review'];

export interface QueueWaitParams {
  /** Explicit analysis time — never a clock read (doc 05 §3). */
  readonly now: IsoDateString;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Deterministic interval semantics (documented rules, never silent repair):
 * - Events are pre-ordered by ingestion: per item by (timestamp, file row).
 * - An interval opens when an event moves the item INTO a stage and closes at
 *   the next event for that item.
 * - Time before an item's first event is never attributed (no inference).
 * - The last interval closes at the analysis time iff its stage is
 *   non-terminal — that item's evidence is marked open (confidence cap).
 *   Terminal stages end attribution entirely.
 * - Repeated visits (including reopened items) accumulate; equal-timestamp
 *   events produce zero-length intervals contributing 0.
 * - Durations are whole hours (floor) — integer arithmetic, no floats.
 */
export function detectQueueWait(batch: ImportBatch, params: QueueWaitParams): QueueWaitInstance[] {
  const nowMs = parseIsoUtc(params.now);
  if (nowMs === null) {
    throw new Error(
      `Invalid analysis time "${params.now}" — expected ISO-8601 (YYYY-MM-DD or full timestamp).`,
    );
  }

  const eventsByItem = new Map<string, WorkItemEvent[]>();
  for (const event of batch.events) {
    const list = eventsByItem.get(event.workItemId) ?? [];
    list.push(event);
    eventsByItem.set(event.workItemId, list);
  }

  interface LocationAccumulator {
    stage: StageRef;
    originScopeId: string | null;
    perItem: Map<string, { waitHours: number; visits: number; open: boolean }>;
  }
  const byLocation = new Map<string, LocationAccumulator>();
  const itemsById = new Map(batch.items.map((item) => [item.id, item]));

  const addWait = (stage: StageRef, itemId: string, hours: number, open: boolean): void => {
    // The wait happened in the queue of whichever origin the item belongs to.
    const originScopeId = itemsById.get(itemId)?.originScopeId ?? null;
    const key = locationKey(originScopeId, stage.name);
    const acc = byLocation.get(key) ?? { stage, originScopeId, perItem: new Map() };
    const entry = acc.perItem.get(itemId) ?? { waitHours: 0, visits: 0, open: false };
    entry.waitHours += hours;
    entry.visits += 1;
    entry.open = entry.open || open;
    acc.perItem.set(itemId, entry);
    byLocation.set(key, acc);
  };

  for (const [itemId, events] of eventsByItem) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i] as WorkItemEvent;
      if (!QUEUE_WAIT_ELIGIBLE_KINDS.includes(event.to.kind)) continue;
      const entryMs = parseIsoUtc(event.at) as number; // validated at ingestion
      const next = events[i + 1];
      if (next !== undefined) {
        const exitMs = parseIsoUtc(next.at) as number;
        addWait(event.to, itemId, Math.max(0, Math.floor((exitMs - entryMs) / MS_PER_HOUR)), false);
      } else if (!isTerminal(event.to)) {
        addWait(event.to, itemId, Math.max(0, Math.floor((nowMs - entryMs) / MS_PER_HOUR)), true);
      }
    }
  }

  const instances: QueueWaitInstance[] = [...byLocation.values()]
    .map(({ stage, originScopeId, perItem }) => {
      const evidence: QueueWaitEvidence[] = [...perItem.entries()]
        .filter(([, e]) => e.waitHours > 0)
        .map(([workItemId, e]) => {
          const item = itemsById.get(workItemId);
          return {
            workItemId,
            title: item?.title ?? '',
            actor: item?.actor ?? { kind: 'missing' as const },
            waitHours: e.waitHours,
            visits: e.visits,
            openAtAnalysisTime: e.open,
          };
        })
        .sort((a, b) => b.waitHours - a.waitHours || a.workItemId.localeCompare(b.workItemId));
      return { stage, originScopeId, evidence };
    })
    .filter(({ evidence }) => evidence.length > 0)
    .map(({ stage, originScopeId, evidence }) => ({
      id: locationId(QUEUE_WAIT_SIGNAL.id, originScopeId, stage.name),
      signalId: QUEUE_WAIT_SIGNAL.id,
      signalVersion: QUEUE_WAIT_SIGNAL.version,
      frictionType: 'queue-wait' as const,
      location: { stage, originScopeId },
      magnitude: {
        unit: 'item-hours-waiting',
        value: evidence.reduce((sum, e) => sum + e.waitHours, 0),
      },
      evidence,
    }));

  return instances.sort(
    (a, b) => b.magnitude.value - a.magnitude.value || a.id.localeCompare(b.id),
  );
}

/**
 * Items currently sitting in an eligible stage with no event history at all —
 * their wait is unobservable and must degrade confidence, not vanish (P5).
 */
export function countEligibleItemsWithoutEvents(batch: ImportBatch): number {
  const itemsWithEvents = new Set(batch.events.map((e) => e.workItemId));
  return batch.items.filter(
    (item) => QUEUE_WAIT_ELIGIBLE_KINDS.includes(item.stage.kind) && !itemsWithEvents.has(item.id),
  ).length;
}
