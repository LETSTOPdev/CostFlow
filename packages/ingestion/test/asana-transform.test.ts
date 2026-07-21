import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { transformAsana } from '@costflow/ingestion';
import type { AsanaMapping } from '@costflow/ingestion';
import { describeProviderConformance } from './spi-conformance';

const mapping: AsanaMapping = {
  id: 'asana-map',
  version: '1',
  projectGid: '555',
  statusMap: { Intake: 'queue', Doing: 'active', 'Legal review': 'review', Done: 'done' },
  completedStatus: 'Done',
  actorRoleMap: { 'Known Person': 'Legal' },
};

const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: () => 'anon-abcdef012345',
};

const SECTIONS = JSON.stringify({
  data: [
    { gid: 's1', name: 'Intake' },
    { gid: 's2', name: 'Doing' },
    { gid: 's3', name: 'Legal review' },
  ],
  next_page: null,
});

interface TaskSpec {
  gid: string;
  sectionGid?: string;
  sectionName?: string;
  projectGid?: string;
  extraMemberships?: { projectGid: string; sectionGid: string; sectionName: string }[];
  assignee?: string;
  created?: string;
  modified?: string;
  due?: string;
  completed?: boolean;
  completedAt?: string | null;
}
interface StorySpec {
  at: string;
  oldGid: string;
  oldName: string;
  newGid: string;
  newName: string;
  subtype?: string;
}

function taskPage(specs: TaskSpec[], nextPage: unknown = null): string {
  return JSON.stringify({
    data: specs.map((s) => ({
      gid: s.gid,
      name: `Task ${s.gid}`,
      created_at: s.created ?? '2026-06-01T00:00:00.000Z',
      modified_at: s.modified ?? '2026-07-01T00:00:00.000Z',
      due_on: s.due ?? null,
      completed: s.completed ?? false,
      completed_at: s.completedAt === undefined ? null : s.completedAt,
      assignee: s.assignee ? { name: s.assignee } : null,
      memberships: [
        {
          project: { gid: s.projectGid ?? '555' },
          section: { gid: s.sectionGid ?? 's1', name: s.sectionName ?? 'Intake' },
        },
        ...(s.extraMemberships ?? []).map((m) => ({
          project: { gid: m.projectGid },
          section: { gid: m.sectionGid, name: m.sectionName },
        })),
      ],
    })),
    next_page: nextPage,
  });
}

function storiesPage(specs: StorySpec[], nextPage: unknown = null): string {
  return JSON.stringify({
    data: specs.map((s) => ({
      created_at: s.at,
      resource_subtype: s.subtype ?? 'section_changed',
      old_section: { gid: s.oldGid, name: s.oldName },
      new_section: { gid: s.newGid, name: s.newName },
    })),
    next_page: nextPage,
  });
}

function run(
  tasks: TaskSpec[],
  storiesByTask: Record<string, readonly string[]> = {},
  overrides: Partial<Parameters<typeof transformAsana>[0]> = {},
) {
  return transformAsana({
    batchId: 'b',
    taskPages: [taskPage(tasks)],
    storiesByTask,
    sectionsDoc: SECTIONS,
    mapping,
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: ctx,
    ...overrides,
  });
}

describe('asana transform (doc 15 P2: A1–A5)', () => {
  it('A1: tasks without a scoped-project membership are dropped rows', () => {
    const batch = run([{ gid: '1', projectGid: '999' }]);
    expect(batch.counts).toEqual({ totalRows: 1, imported: 0, dropped: 1 });
    expect(batch.diagnostics[0]?.message).toContain('not a member of project "555"');
  });

  it('A1: multi-homed tasks take the scoped membership section', () => {
    const batch = run([
      {
        gid: '1',
        sectionGid: 's2',
        sectionName: 'Doing',
        extraMemberships: [{ projectGid: '999', sectionGid: 'x9', sectionName: 'Random' }],
      },
    ]);
    expect(batch.items[0]?.stage).toEqual({ name: 'Doing', kind: 'active' });
  });

  it('A2: completed tasks land in completedStatus with a derived completion event', () => {
    const batch = run(
      [
        {
          gid: '1',
          sectionGid: 's2',
          sectionName: 'Doing',
          completed: true,
          completedAt: '2026-07-02T00:00:00.000Z',
          created: '2026-06-01T00:00:00.000Z',
        },
      ],
      {},
    );
    expect(batch.items[0]?.stage).toEqual({ name: 'Done', kind: 'done' });
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name])).toEqual([
      [null, 'Doing'],
      ['Doing', 'Done'],
    ]);
  });

  it('A2: completed without completed_at is a hard error', () => {
    expect(() => run([{ gid: '1', completed: true, completedAt: null }])).toThrow(
      /completed but has no completed_at/,
    );
  });

  it('A2: a completedStatus missing from statusMap is a hard error', () => {
    expect(() =>
      run([{ gid: '1' }], {}, { mapping: { ...mapping, completedStatus: 'Finito' } }),
    ).toThrow(/completedStatus "Finito" is not a statusMap key/);
  });

  it('A3: foreign-project section moves are excluded with a counted diagnostic', () => {
    const batch = run([{ gid: '1' }], {
      '1': [
        storiesPage([
          {
            at: '2026-06-10T00:00:00.000Z',
            oldGid: 'x8',
            oldName: 'Foo',
            newGid: 'x9',
            newName: 'Bar',
          },
        ]),
      ],
    });
    expect(batch.events).toHaveLength(1); // arrival only
    expect(batch.diagnostics[0]?.message).toBe(
      '1 section move(s) in other projects ignored (outside scoped project "555").',
    );
    expect(JSON.stringify(batch.events)).not.toContain('Foo');
  });

  it('A3: a move mixing in-scope and out-of-scope sections is a hard error', () => {
    expect(() =>
      run([{ gid: '1' }], {
        '1': [
          storiesPage([
            {
              at: '2026-06-10T00:00:00.000Z',
              oldGid: 's1',
              oldName: 'Intake',
              newGid: 'x9',
              newName: 'Bar',
            },
          ]),
        ],
      }),
    ).toThrow(/mixing in-scope and out-of-scope sections/);
  });

  it('A4: arrival derives from the first in-scope story, else the current section', () => {
    const withStories = run(
      [
        {
          gid: '1',
          sectionGid: 's3',
          sectionName: 'Legal review',
          created: '2026-06-15T00:00:00.000Z',
        },
      ],
      {
        '1': [
          storiesPage([
            {
              at: '2026-06-22T00:00:00.000Z',
              oldGid: 's1',
              oldName: 'Intake',
              newGid: 's2',
              newName: 'Doing',
            },
            {
              at: '2026-07-04T00:00:00.000Z',
              oldGid: 's2',
              oldName: 'Doing',
              newGid: 's3',
              newName: 'Legal review',
            },
          ]),
        ],
      },
    );
    expect(withStories.events[0]).toEqual({
      workItemId: '1',
      from: null,
      to: { name: 'Intake', kind: 'queue' },
      at: '2026-06-15T00:00:00.000Z',
    });
    const noStories = run([{ gid: '2', created: '2026-06-08T00:00:00.000Z' }]);
    expect(noStories.events).toEqual([
      {
        workItemId: '2',
        from: null,
        to: { name: 'Intake', kind: 'queue' },
        at: '2026-06-08T00:00:00.000Z',
      },
    ]);
  });

  it('A5: a document claiming an unsupplied continuation page is a hard error', () => {
    expect(() => run([], {}, { taskPages: [taskPage([{ gid: '1' }], { offset: 'abc' })] })).toThrow(
      /non-null next_page/,
    );
    expect(() =>
      run([{ gid: '1' }], {
        '1': [storiesPage([], { offset: 'abc' })],
      }),
    ).toThrow(/non-null next_page/);
  });

  it('non-section stories are ignored', () => {
    const batch = run([{ gid: '1' }], {
      '1': [
        storiesPage([
          {
            at: '2026-06-10T00:00:00.000Z',
            oldGid: 's1',
            oldName: 'Intake',
            newGid: 's2',
            newName: 'Doing',
            subtype: 'comment_added',
          },
        ]),
      ],
    });
    expect(batch.events).toHaveLength(1); // arrival only
  });
});

describe('provider conformance: asana', () => {
  describeProviderConformance(() =>
    run(
      [
        {
          gid: '9001',
          sectionGid: 's3',
          sectionName: 'Legal review',
          assignee: 'Known Person',
          due: '2026-07-12',
          created: '2026-06-15T00:00:00.000Z',
        },
        { gid: '9002', assignee: 'Zecret Human', created: '2026-06-08T00:00:00.000Z' },
        { gid: '9003', projectGid: '999' },
      ],
      {
        '9001': [
          storiesPage([
            {
              at: '2026-06-22T00:00:00.000Z',
              oldGid: 's1',
              oldName: 'Intake',
              newGid: 's2',
              newName: 'Doing',
            },
            {
              at: '2026-07-04T00:00:00.000Z',
              oldGid: 's2',
              oldName: 'Doing',
              newGid: 's3',
              newName: 'Legal review',
            },
          ]),
        ],
      },
    ),
  );
});
