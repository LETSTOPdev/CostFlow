import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { countClickUpTasks, observeClickUpTaskPages, transformClickUp } from '@costflow/ingestion';
import type { ClickUpMapping } from '@costflow/ingestion';
import { describeProviderConformance } from './spi-conformance';

const mapping: ClickUpMapping = {
  id: 'clickup-map',
  version: '1',
  statusMap: {
    'to do': 'queue',
    'in progress': 'active',
    review: 'review',
    complete: 'done',
  },
  actorRoleMap: { 'Known Person': 'Ops' },
};

const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: () => 'anon-abcdef012345',
};

interface TaskSpec {
  id: string;
  name?: string;
  status?: string;
  assignees?: { id: number | string; username: string | null }[];
  created?: string | number | null;
  updated?: string | number | null;
  due?: string | number | null;
}

// 2026-06-01T00:00:00.000Z and friends, as ClickUp emits them: ms-epoch strings.
const JUN_1 = '1780272000000';
const JUL_1 = '1782864000000';
const JUL_10 = '1783641600000';

function page(specs: TaskSpec[], lastPage = true): string {
  return JSON.stringify({
    tasks: specs.map((s) => ({
      id: s.id,
      name: s.name ?? `Task ${s.id}`,
      status: s.status === undefined ? { status: 'to do' } : { status: s.status },
      assignees: s.assignees ?? [],
      date_created: s.created === undefined ? JUN_1 : s.created,
      date_updated: s.updated === undefined ? JUL_1 : s.updated,
      due_date: s.due === undefined ? null : s.due,
    })),
    last_page: lastPage,
  });
}

function run(pagesByList: Record<string, string[]>) {
  return transformClickUp({
    batchId: 'b',
    taskPagesByList: pagesByList,
    mapping,
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: ctx,
  });
}

describe('clickup transform (doc 18 §5: CU1–CU8)', () => {
  it('CU1: millisecond-epoch strings become ISO-8601 UTC', () => {
    const batch = run({ l1: [page([{ id: 't1', created: JUN_1, updated: JUL_1, due: JUL_10 }])] });
    expect(batch.items[0]).toMatchObject({
      createdAt: '2026-06-01T00:00:00.000Z',
      lastUpdatedAt: '2026-07-01T00:00:00.000Z',
      dueAt: '2026-07-10T00:00:00.000Z',
    });
  });

  it('CU1: an unparseable timestamp warns and the field is ignored', () => {
    const batch = run({ l1: [page([{ id: 't1', due: 'not-a-date' }])] });
    expect(batch.items[0]?.dueAt).toBeNull();
    expect(batch.diagnostics).toEqual([
      {
        row: 1,
        severity: 'warning',
        message: 'Unparseable due_date "not-a-date" on t1 — field ignored.',
      },
    ]);
  });

  it('CU2: a list whose final page lacks last_page:true is a hard error', () => {
    expect(() => run({ l1: [page([{ id: 't1' }], false)] })).toThrow(
      /list l1 are truncated .*last_page/,
    );
  });

  it('CU2: multi-page lists are accepted when the final page is terminal', () => {
    const batch = run({ l1: [page([{ id: 't1' }], false), page([{ id: 't2' }], true)] });
    expect(batch.counts).toEqual({ totalRows: 2, imported: 2, dropped: 0 });
  });

  it('CU3: the primary assignee is the lowest user id, with a counting diagnostic', () => {
    const batch = run({
      l1: [
        page([
          {
            id: 't1',
            assignees: [
              { id: 402, username: 'Secret Human' },
              { id: 17, username: 'Known Person' },
            ],
          },
        ]),
      ],
    });
    expect(batch.items[0]?.actor).toEqual({ kind: 'role', roleRef: 'Ops' });
    expect(batch.diagnostics).toEqual([
      {
        row: 1,
        severity: 'warning',
        message:
          'Task "t1" has 2 assignees — attributed to the deterministic primary ' +
          '(lowest user id); 1 not attributed.',
      },
    ]);
  });

  it('CU4: no events, structurally — event-history capability is false', () => {
    const batch = run({ l1: [page([{ id: 't1' }])] });
    expect(batch.events).toEqual([]);
    expect(batch.capability.hasEventHistory).toBe(false);
  });

  it('CU5: an unmapped current status drops the row with a diagnostic', () => {
    const batch = run({ l1: [page([{ id: 't1', status: 'weird custom' }, { id: 't2' }])] });
    expect(batch.counts).toEqual({ totalRows: 2, imported: 1, dropped: 1 });
    expect(batch.diagnostics[0]).toEqual({
      row: 1,
      severity: 'dropped',
      message: 'Status "weird custom" is not mapped to a stage kind — row dropped.',
    });
  });

  it('CU7: closed/done tasks are imported as terminal-stage items', () => {
    const batch = run({ l1: [page([{ id: 't1', status: 'complete' }])] });
    expect(batch.items[0]?.stage).toEqual({ name: 'complete', kind: 'done' });
  });

  it('CU8: a task in more than one list is imported once, counted once', () => {
    const batch = run({
      l1: [page([{ id: 'shared' }, { id: 'only-1' }])],
      l2: [page([{ id: 'shared' }, { id: 'only-2' }])],
    });
    expect(batch.counts).toEqual({ totalRows: 3, imported: 3, dropped: 0 });
    expect(batch.items.map((i) => i.id)).toEqual(['shared', 'only-1', 'only-2']);
    expect(batch.diagnostics).toEqual([
      {
        row: 3,
        severity: 'warning',
        message: 'Task "shared" appears in more than one list — imported once.',
      },
    ]);
  });

  it('unmapped assignees are pseudonymized; unassigned tasks are missing actors', () => {
    const batch = run({
      l1: [
        page([
          { id: 't1', assignees: [{ id: 9, username: 'Secret Human' }] },
          { id: 't2', assignees: [] },
        ]),
      ],
    });
    expect(batch.items[0]?.actor).toEqual({ kind: 'unknown', pseudonym: 'anon-abcdef012345' });
    expect(batch.items[1]?.actor).toEqual({ kind: 'missing' });
    expect(JSON.stringify(batch)).not.toContain('Secret Human');
  });

  it('a page without a tasks array is a hard error', () => {
    expect(() => run({ l1: ['{"not":"tasks"}'] })).toThrow(/has no "tasks" array/);
  });

  it('zero pages overall is a hard error', () => {
    expect(() => run({})).toThrow(/received no task pages/);
    expect(() => run({ l1: [] })).toThrow(/received no task pages/);
  });

  it('list iteration order is deterministic regardless of input key order', () => {
    const a = run({ b: [page([{ id: 't2' }])], a: [page([{ id: 't1' }])] });
    const b = run({ a: [page([{ id: 't1' }])], b: [page([{ id: 't2' }])] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });
});

describe('clickup raw-document inspectors', () => {
  it('countClickUpTasks counts distinct task ids across lists (CU8 semantics)', () => {
    expect(
      countClickUpTasks({
        l1: [page([{ id: 'shared' }, { id: 'a' }])],
        l2: [page([{ id: 'shared' }, { id: 'b' }])],
      }),
    ).toBe(3);
  });

  it('observeClickUpTaskPages collects every status and EVERY assignee username', () => {
    const observed = observeClickUpTaskPages({
      l1: [
        page([
          {
            id: 't1',
            status: 'in progress',
            assignees: [
              { id: 2, username: 'Beta Person' },
              { id: 1, username: 'Alpha Person' },
            ],
          },
          { id: 't2', status: 'to do', assignees: [{ id: 3, username: null }] },
        ]),
      ],
    });
    expect(observed.statuses).toEqual(['in progress', 'to do']);
    expect(observed.actors).toEqual(['Alpha Person', 'Beta Person']);
  });
});

describe('provider conformance: clickup', () => {
  describeProviderConformance(() =>
    run({
      l1: [
        page([
          {
            id: 'c1',
            status: 'review',
            assignees: [{ id: 17, username: 'Known Person' }],
            due: JUL_1,
          },
          { id: 'c2', status: 'to do', assignees: [{ id: 9, username: 'Secret Human' }] },
          { id: 'c3', status: 'weird', assignees: [] },
        ]),
      ],
    }),
  );
});
