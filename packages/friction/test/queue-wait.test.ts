import { describe, expect, it } from 'vitest';
import type { ImportBatch, StageRef, WorkItem, WorkItemEvent } from '@costflow/domain';
import {
  QUEUE_WAIT_SIGNAL,
  checkRequirements,
  countEligibleItemsWithoutEvents,
  detectQueueWait,
} from '@costflow/friction';

const NOW = '2026-07-20T00:00:00Z';
const QUEUE = { name: 'Backlog', kind: 'queue' } as const;
const REVIEW = { name: 'Review', kind: 'review' } as const;
const ACTIVE = { name: 'Doing', kind: 'active' } as const;
const DONE = { name: 'Done', kind: 'done' } as const;

function item(id: string, stage: StageRef = ACTIVE): WorkItem {
  return {
    id,
    sourceId: id,
    title: `Item ${id}`,
    stage,
    actor: { kind: 'role', roleRef: 'Ops' },
    createdAt: '2026-06-01',
    dueAt: null,
    lastUpdatedAt: null,
  };
}

function batch(items: WorkItem[], events: WorkItemEvent[]): ImportBatch {
  return {
    id: 'b1',
    provider: 'csv',
    mappingTemplateId: 'm',
    mappingTemplateVersion: '1',
    importedAt: NOW,
    counts: { totalRows: items.length, imported: items.length, dropped: 0 },
    diagnostics: [],
    capability: {
      hasEventHistory: events.length > 0,
      hasDueDates: false,
      hasLastUpdated: false,
      hasActors: true,
    },
    pseudonymizationScope: null,
    items,
    events,
  };
}

describe('f1-queue-wait detector', () => {
  it('attributes wait only to queue/review stages and accumulates repeated visits', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'a', from: null, to: QUEUE, at: '2026-06-01T00:00:00Z' },
      { workItemId: 'a', from: QUEUE, to: ACTIVE, at: '2026-06-03T00:00:00Z' }, // queue 48h
      { workItemId: 'a', from: ACTIVE, to: REVIEW, at: '2026-06-10T00:00:00Z' },
      { workItemId: 'a', from: REVIEW, to: ACTIVE, at: '2026-06-12T00:00:00Z' }, // review 48h
      { workItemId: 'a', from: ACTIVE, to: REVIEW, at: '2026-06-20T00:00:00Z' },
      { workItemId: 'a', from: REVIEW, to: DONE, at: '2026-06-21T00:00:00Z' }, // review +24h, terminal
    ];
    const instances = detectQueueWait(batch([item('a', DONE)], events), { now: NOW });

    expect(instances.map((i) => [i.location.stage.name, i.magnitude.value])).toEqual([
      ['Review', 72],
      ['Backlog', 48],
    ]);
    const review = instances[0];
    expect(review?.evidence[0]).toMatchObject({
      workItemId: 'a',
      waitHours: 72,
      visits: 2,
      openAtAnalysisTime: false,
    });
  });

  it('closes an open interval at the analysis time and marks it open; terminal stages end attribution', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'open', from: null, to: REVIEW, at: '2026-07-18T00:00:00Z' }, // open, 48h to now
      { workItemId: 'done', from: null, to: DONE, at: '2026-07-01T00:00:00Z' }, // terminal: no open interval
    ];
    const instances = detectQueueWait(batch([item('open', REVIEW), item('done', DONE)], events), {
      now: NOW,
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.evidence).toEqual([
      expect.objectContaining({ workItemId: 'open', waitHours: 48, openAtAnalysisTime: true }),
    ]);
  });

  it('zero-length intervals (equal timestamps) contribute nothing', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'a', from: null, to: QUEUE, at: '2026-06-01T00:00:00Z' },
      { workItemId: 'a', from: QUEUE, to: ACTIVE, at: '2026-06-01T00:00:00Z' },
    ];
    expect(detectQueueWait(batch([item('a')], events), { now: NOW })).toHaveLength(0);
  });

  it('throws on an invalid analysis time (R-01 discipline applies to every detector)', () => {
    expect(() => detectQueueWait(batch([item('a')], []), { now: 'garbage' })).toThrow(
      /Invalid analysis time/,
    );
  });

  it('requires event history and is skipped visibly without it', () => {
    const result = checkRequirements(QUEUE_WAIT_SIGNAL, {
      hasEventHistory: false,
      hasDueDates: true,
      hasLastUpdated: true,
      hasActors: true,
    });
    expect(result.canRun).toBe(false);
    if (!result.canRun) expect(result.reason).toContain('hasEventHistory');
  });

  it('counts eligible items with no events for the confidence cap', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'tracked', from: null, to: REVIEW, at: '2026-07-01T00:00:00Z' },
    ];
    const b = batch(
      [item('tracked', REVIEW), item('untracked-review', REVIEW), item('untracked-active', ACTIVE)],
      events,
    );
    expect(countEligibleItemsWithoutEvents(b)).toBe(1);
  });

  it('is deterministic: identical inputs give identical output', () => {
    const events: WorkItemEvent[] = [
      { workItemId: 'a', from: null, to: QUEUE, at: '2026-06-01T00:00:00Z' },
      { workItemId: 'b', from: null, to: QUEUE, at: '2026-06-02T00:00:00Z' },
    ];
    const b = batch([item('a', QUEUE), item('b', QUEUE)], events);
    expect(JSON.stringify(detectQueueWait(b, { now: NOW }))).toBe(
      JSON.stringify(detectQueueWait(b, { now: NOW })),
    );
  });
});
