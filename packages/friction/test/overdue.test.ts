import { describe, expect, it } from 'vitest';
import type { ImportBatch, StageRef, WorkItem } from '@costflow/domain';
import { OVERDUE_SIGNAL, checkRequirements, detectOverdue } from '@costflow/friction';

const NOW = '2026-07-20T00:00:00Z';
const ACTIVE: StageRef = { name: 'Doing', kind: 'active' };
const QUEUE: StageRef = { name: 'Backlog', kind: 'queue' };
const DONE: StageRef = { name: 'Done', kind: 'done' };

function item(id: string, dueAt: string | null, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    sourceId: id,
    title: `Item ${id}`,
    stage: ACTIVE,
    actor: { kind: 'role', roleRef: 'Ops' },
    createdAt: '2026-05-01',
    dueAt,
    lastUpdatedAt: null,
    ...overrides,
  };
}

function batch(items: WorkItem[]): ImportBatch {
  return {
    id: 'b1',
    provider: 'csv',
    mappingTemplateId: 'm',
    mappingTemplateVersion: '1',
    importedAt: NOW,
    counts: { totalRows: items.length, imported: items.length, dropped: 0 },
    diagnostics: [],
    capability: {
      hasEventHistory: false,
      hasDueDates: true,
      hasLastUpdated: false,
      hasActors: true,
    },
    evidence: [],
    pseudonymizationScope: null,
    items,
    events: [],
  };
}

describe('f3-overdue detector (doc 12 §4/§9)', () => {
  it('detects only in-flight items ≥1 whole day past due, grouped by stage', () => {
    const instances = detectOverdue(
      batch([
        item('late-10', '2026-07-10'), // 10d overdue
        item('late-3', '2026-07-17', { stage: QUEUE }), // 3d, other stage
        item('future', '2026-08-01'),
        item('no-due', null),
        item('done-late', '2026-06-01', { stage: DONE }), // terminal → F3b's job, excluded
      ]),
      { now: NOW },
    );
    expect(instances.map((i) => [i.location.stage.name, i.magnitude.value])).toEqual([
      ['Doing', 10],
      ['Backlog', 3],
    ]);
    expect(instances[0]?.magnitude.unit).toBe('item-days-overdue');
    expect(instances[0]?.evidence[0]).toMatchObject({
      workItemId: 'late-10',
      dueAt: '2026-07-10',
      overdueDays: 10,
      dueBeforeCreated: false,
    });
  });

  it('day-granularity boundary: due exactly at now or overdue by hours → excluded today', () => {
    const instances = detectOverdue(
      batch([
        item('at-now', '2026-07-20T00:00:00Z'),
        item('by-hours', '2026-07-19T02:00:00Z'), // 22h → floor 0 days
      ]),
      { now: NOW },
    );
    expect(instances).toHaveLength(0);
  });

  it('flags dueBeforeCreated instead of hiding or excluding it (doc 12 §9)', () => {
    const instances = detectOverdue(
      batch([item('weird', '2026-04-01', { createdAt: '2026-05-01' })]),
      { now: NOW },
    );
    expect(instances[0]?.evidence[0]).toMatchObject({
      workItemId: 'weird',
      overdueDays: 110,
      dueBeforeCreated: true,
    });
  });

  it('computes batch-wide shared-due-date cohorts among overdue items only', () => {
    const instances = detectOverdue(
      batch([
        item('a', '2026-07-01'),
        item('b', '2026-07-01', { stage: QUEUE }),
        item('c', '2026-07-01'),
        item('solo', '2026-07-05'),
        item('future-same', '2026-08-01'), // not overdue → not in any cohort
      ]),
      { now: NOW },
    );
    const all = instances.flatMap((i) => i.evidence);
    expect(all.find((e) => e.workItemId === 'a')?.sharedDueDateCohortSize).toBe(2);
    expect(all.find((e) => e.workItemId === 'b')?.sharedDueDateCohortSize).toBe(2);
    expect(all.find((e) => e.workItemId === 'solo')?.sharedDueDateCohortSize).toBe(0);
  });

  it('orders evidence by overdueDays desc then id; instances by magnitude desc then id', () => {
    const instances = detectOverdue(
      batch([item('b', '2026-07-15'), item('a', '2026-07-15'), item('big', '2026-06-20')]),
      { now: NOW },
    );
    expect(instances[0]?.evidence.map((e) => e.workItemId)).toEqual(['big', 'a', 'b']);
  });

  it('is deterministic and throws on an invalid analysis time (R-01 discipline)', () => {
    const b = batch([item('x', '2026-07-01')]);
    expect(JSON.stringify(detectOverdue(b, { now: NOW }))).toBe(
      JSON.stringify(detectOverdue(b, { now: NOW })),
    );
    expect(() => detectOverdue(b, { now: '20/07/2026' })).toThrow(/Invalid analysis time/);
  });

  it('requires hasDueDates and is skipped visibly without it', () => {
    const result = checkRequirements(OVERDUE_SIGNAL, {
      hasEventHistory: true,
      hasDueDates: false,
      hasLastUpdated: true,
      hasActors: true,
    });
    expect(result.canRun).toBe(false);
    if (!result.canRun) expect(result.reason).toContain('hasDueDates');
  });
});
