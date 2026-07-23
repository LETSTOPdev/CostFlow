import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { observeClickUpPages, transformClickUp } from '@costflow/ingestion';
import type { ClickUpMapping } from '@costflow/ingestion';
import { describeProviderConformance } from './spi-conformance';

const mapping: ClickUpMapping = {
  id: 'clickup-map',
  version: '1',
  statusMap: { backlog: 'queue', 'in progress': 'active', review: 'review', complete: 'done' },
  actorRoleMap: { 'Known Person': 'Ops' },
};

const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: () => 'anon-abcdef012345',
};

/** Epoch-ms helper for readable fixtures: day offsets from 2026-06-01T00:00Z. */
const DAY0 = 1780272000000; // 2026-06-01T00:00:00.000Z
const day = (n: number): string => String(DAY0 + n * 86_400_000);
const dayIso = (n: number): string => new Date(DAY0 + n * 86_400_000).toISOString();

interface TaskSpec {
  id: string;
  status: string;
  type?: string;
  assignees?: { username?: string | null; email?: string | null }[];
  created?: string;
  updated?: string;
  due?: string | null;
}

function tasksPage(specs: TaskSpec[], lastPage = true): string {
  return JSON.stringify({
    tasks: specs.map((s) => ({
      id: s.id,
      name: `Task ${s.id}`,
      status: { status: s.status, type: s.type ?? 'custom', orderindex: 1, color: '#888' },
      date_created: s.created ?? day(0),
      date_updated: s.updated ?? day(30),
      due_date: s.due ?? null,
      assignees: s.assignees ?? [{ username: 'Known Person', email: 'kp@example.test' }],
    })),
    last_page: lastPage,
  });
}

interface ResidencySpec {
  status: string;
  since: string;
  orderindex?: number;
}

function residencyPage(byTask: Record<string, ResidencySpec[]>): string {
  const doc: Record<string, unknown> = {};
  for (const [taskId, entries] of Object.entries(byTask)) {
    const current = entries[entries.length - 1];
    doc[taskId] = {
      current_status: {
        status: current?.status,
        color: '#888',
        total_time: { by_minute: 1, since: current?.since },
      },
      // status_history is ordered by workflow orderindex (NOT entry order)
      // and includes the current status — mirroring the real API.
      status_history: [...entries]
        .sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0))
        .map((entry) => ({
          status: entry.status,
          color: '#888',
          type: 'custom',
          orderindex: entry.orderindex ?? 0,
          total_time: { by_minute: 1, since: entry.since },
        })),
    };
  }
  return JSON.stringify(doc);
}

function run(
  specs: TaskSpec[],
  residency?: Record<string, ResidencySpec[]>,
  extra: Partial<Parameters<typeof transformClickUp>[0]> = {},
) {
  return transformClickUp({
    batchId: 'b',
    taskPages: [tasksPage(specs)],
    timeInStatusPages: residency ? [residencyPage(residency)] : undefined,
    mapping,
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: ctx,
    ...extra,
  });
}

describe('clickup transform (ADR-0005: CU1–CU5)', () => {
  it('CU1: reconstructs the entry chain by entry instant, not workflow orderindex', () => {
    // The task moved backlog → review → back to in progress. The API returns
    // status_history sorted by WORKFLOW position (backlog 0, in progress 1,
    // review 2) — the transform must re-derive the true traversal from each
    // entry's `since` instant.
    const batch = run([{ id: 't1', status: 'in progress', created: day(0) }], {
      t1: [
        { status: 'backlog', since: day(0), orderindex: 0 },
        { status: 'review', since: day(4), orderindex: 2 },
        { status: 'in progress', since: day(10), orderindex: 1 },
      ],
    });
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name, e.at])).toEqual([
      [null, 'backlog', dayIso(0)],
      ['backlog', 'review', dayIso(4)],
      ['review', 'in progress', dayIso(10)],
    ]);
  });

  it('CU1: current status duplicated in history collapses to one entry (no self-transition)', () => {
    const batch = run([{ id: 't1', status: 'in progress', created: day(0) }], {
      t1: [{ status: 'in progress', since: day(0), orderindex: 1 }],
    });
    // history + current_status both name "in progress" at the same instant.
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name])).toEqual([
      [null, 'in progress'],
    ]);
  });

  it('CU2: a task without residency data derives the arrival-only event', () => {
    const batch = run([{ id: 't9', status: 'backlog', type: 'open', created: day(0) }]);
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name, e.at])).toEqual([
      [null, 'backlog', dayIso(0)],
    ]);
    expect(batch.capability.hasEventHistory).toBe(true);
  });

  it('CU3: first assignee is the actor; extra assignees surface in a diagnostic', () => {
    const batch = run([
      {
        id: 't1',
        status: 'backlog',
        assignees: [
          { username: 'Known Person' },
          { username: 'Second Person' },
          { username: 'Third Person' },
        ],
      },
    ]);
    expect(batch.items[0]?.actor).toEqual({ kind: 'role', roleRef: 'Ops' });
    expect(batch.diagnostics.map((d) => d.message).join(' ')).toContain('2 additional assignee(s)');
  });

  it('CU3: assignee username falls back to email; unmapped actors pseudonymize', () => {
    const batch = run([
      { id: 't1', status: 'backlog', assignees: [{ username: null, email: 'x@example.test' }] },
    ]);
    expect(batch.items[0]?.actor).toEqual({ kind: 'unknown', pseudonym: 'anon-abcdef012345' });
  });

  it('CU4: unmapped current status drops the row (with its history); unmapped history status is a hard error', () => {
    const dropped = run([{ id: 't1', status: 'someday', created: day(0) }], {
      t1: [{ status: 'someday', since: day(0) }],
    });
    expect(dropped.items).toHaveLength(0);
    expect(dropped.counts.dropped).toBe(1);
    expect(dropped.diagnostics.map((d) => d.message).join(' ')).toContain('"someday"');
    expect(dropped.events).toHaveLength(0);

    expect(() =>
      run([{ id: 't1', status: 'review', created: day(0) }], {
        t1: [
          { status: 'mystery lane', since: day(0), orderindex: 0 },
          { status: 'review', since: day(5), orderindex: 2 },
        ],
      }),
    ).toThrow(/mystery lane/);
  });

  it('CU5: a non-final page with no continuation refuses import', () => {
    expect(() =>
      transformClickUp({
        batchId: 'b',
        taskPages: [tasksPage([{ id: 't1', status: 'backlog' }], false)],
        mapping,
        importedAt: '2026-07-20T00:00:00Z',
        pseudonymization: ctx,
      }),
    ).toThrow(/silently truncated/);
  });

  it('duplicate task ids (tasks-in-multiple-lists) are dropped visibly, not double-counted', () => {
    const batch = run([
      { id: 'tdup', status: 'backlog' },
      { id: 'tdup', status: 'review' },
    ]);
    expect(batch.items).toHaveLength(1);
    expect(batch.counts).toEqual({ totalRows: 2, imported: 1, dropped: 1 });
    expect(batch.diagnostics.map((d) => d.message).join(' ')).toContain('Duplicate task id');
  });

  it('epoch-ms values arrive as strings or numbers; garbage is a warning, never a crash', () => {
    const raw = JSON.parse(tasksPage([{ id: 't1', status: 'backlog' }])) as {
      tasks: Record<string, unknown>[];
    };
    (raw.tasks[0] as Record<string, unknown>)['date_created'] = 1780272000000; // number form
    (raw.tasks[0] as Record<string, unknown>)['due_date'] = 'not-a-number';
    const batch = transformClickUp({
      batchId: 'b',
      taskPages: [JSON.stringify({ tasks: raw.tasks, last_page: true })],
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
      pseudonymization: ctx,
    });
    expect(batch.items[0]?.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(batch.items[0]?.dueAt).toBeNull();
    expect(batch.diagnostics.map((d) => d.message).join(' ')).toContain('due_date');
  });

  it('an epoch beyond the Date range degrades to a diagnostic, never a crash', () => {
    // Values in (8.64e15, 2^53] pass Number.isSafeInteger but make
    // Date.toISOString throw — every raw field must degrade, not crash.
    const batch = run(
      [
        {
          id: 'evil',
          status: 'backlog',
          created: '8640000000000001', // one ms past the Date range
          updated: '-8640000000000001',
          due: String(Number.MAX_SAFE_INTEGER),
        },
        { id: 'ok', status: 'in progress', created: day(0) },
      ],
      {
        // The corrupt residency instant is skipped; the valid entry survives.
        ok: [
          { status: 'backlog', since: day(0), orderindex: 0 },
          { status: 'in progress', since: '9007199254740991', orderindex: 1 },
        ],
      },
    );
    expect(batch.items).toHaveLength(2);
    expect(batch.items[0]).toMatchObject({ createdAt: null, dueAt: null, lastUpdatedAt: null });
    expect(batch.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(3);
    const messages = batch.diagnostics.map((d) => d.message).join(' ');
    expect(messages).toContain('date_created');
    expect(messages).toContain('date_updated');
    expect(messages).toContain('due_date');
    // 'evil' has no anchor instant, so only 'ok' derives its arrival event.
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name])).toEqual([[null, 'backlog']]);
  });

  it('single-task residency documents (externally keyed) join the chain like bulk pages', () => {
    const single = JSON.stringify({
      current_status: {
        status: 'in progress',
        color: '#888',
        total_time: { by_minute: 1, since: day(6) },
      },
      status_history: [
        {
          status: 'backlog',
          color: '#888',
          type: 'open',
          orderindex: 0,
          total_time: { by_minute: 1, since: day(0) },
        },
        {
          status: 'in progress',
          color: '#888',
          type: 'custom',
          orderindex: 1,
          total_time: { by_minute: 1, since: day(6) },
        },
      ],
    });
    const batch = run([{ id: 'lone', status: 'in progress', created: day(0) }], undefined, {
      singleTimeInStatusByTask: { lone: single },
    });
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name, e.at])).toEqual([
      [null, 'backlog', dayIso(0)],
      ['backlog', 'in progress', dayIso(6)],
    ]);
  });

  it('provider is stamped clickup and pseudonymization scope is recorded', () => {
    const batch = run([{ id: 't1', status: 'backlog' }]);
    expect(batch.provider).toBe('clickup');
    expect(batch.pseudonymizationScope).toBe('test-org');
  });

  describe('observeClickUpPages (mapping-form vocabulary)', () => {
    it('unions task statuses with residency statuses and hints from status types', () => {
      const pages = [
        tasksPage([
          { id: 't1', status: 'backlog', type: 'open' },
          { id: 't2', status: 'complete', type: 'closed', assignees: [{ username: 'B Person' }] },
        ]),
      ];
      const residency = [
        residencyPage({
          t2: [
            { status: 'retired lane', since: day(0), orderindex: 0 },
            { status: 'complete', since: day(2), orderindex: 3 },
          ],
        }),
      ];
      const observed = observeClickUpPages(pages, residency);
      expect(observed.statuses).toEqual(['backlog', 'complete', 'retired lane']);
      expect(observed.actors).toEqual(['B Person', 'Known Person']);
      expect(observed.statusHints).toEqual({ backlog: 'queue', complete: 'done' });
      expect(observed.itemCount).toBe(2);
    });

    it('reads single-task-shaped residency documents too', () => {
      const single = JSON.stringify({
        current_status: { status: 'qa lane', total_time: { by_minute: 1, since: day(1) } },
        status_history: [],
      });
      const observed = observeClickUpPages(
        [tasksPage([{ id: 't1', status: 'backlog', type: 'open' }])],
        [single],
      );
      expect(observed.statuses).toEqual(['backlog', 'qa lane']);
    });
  });

  describe('SPI conformance (ADR-0005: every connector runs the same suite)', () => {
    describeProviderConformance(() =>
      run(
        [
          { id: 'c1', status: 'review', created: day(0), updated: day(40), due: day(35) },
          {
            id: 'c2',
            status: 'in progress',
            created: day(2),
            assignees: [{ username: 'Mystery Person' }],
          },
          { id: 'c3', status: 'backlog', type: 'open', created: day(5), due: null },
          { id: 'c4', status: 'not-mapped-anywhere', created: day(6) },
        ],
        {
          c1: [
            { status: 'backlog', since: day(0), orderindex: 0 },
            { status: 'in progress', since: day(3), orderindex: 1 },
            { status: 'review', since: day(20), orderindex: 2 },
          ],
          c2: [
            { status: 'backlog', since: day(2), orderindex: 0 },
            { status: 'in progress', since: day(9), orderindex: 1 },
          ],
        },
      ),
    );
  });
});
