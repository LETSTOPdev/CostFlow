import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { importCsv, transformJira } from '@costflow/ingestion';
import type { JiraMapping, MappingTemplate } from '@costflow/ingestion';
import { describeProviderConformance } from './spi-conformance';

const mapping: JiraMapping = {
  id: 'jira-map',
  version: '1',
  statusMap: { 'To Do': 'queue', 'In Progress': 'active', Review: 'review', Done: 'done' },
  actorRoleMap: { 'Known Person': 'Ops' },
};

const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: () => 'anon-abcdef012345',
};

interface IssueSpec {
  key: string;
  status: string;
  assignee?: string;
  created?: string;
  updated?: string;
  duedate?: string | null;
  histories?: { at: string; from: string; to: string }[];
  changelogTotal?: number;
}

function searchPage(specs: IssueSpec[]): string {
  return JSON.stringify({
    total: specs.length,
    issues: specs.map((s) => ({
      key: s.key,
      fields: {
        summary: `Issue ${s.key}`,
        status: { name: s.status },
        assignee: s.assignee ? { displayName: s.assignee } : null,
        created: s.created ?? '2026-06-01T00:00:00.000+0000',
        updated: s.updated ?? '2026-07-01T00:00:00.000+0000',
        duedate: s.duedate ?? null,
      },
      changelog: {
        total: s.changelogTotal ?? s.histories?.length ?? 0,
        histories: (s.histories ?? []).map((h) => ({
          created: h.at,
          items: [{ field: 'status', fromString: h.from, toString: h.to }],
        })),
      },
    })),
  });
}

function run(specs: IssueSpec[], extra: Partial<Parameters<typeof transformJira>[0]> = {}) {
  return transformJira({
    batchId: 'b',
    searchPages: [searchPage(specs)],
    mapping,
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: ctx,
    ...extra,
  });
}

describe('jira transform (doc 15 P1: J1/J2/J3)', () => {
  it('J1: derives the arrival event from created + first-transition from-status', () => {
    const batch = run([
      {
        key: 'A-1',
        status: 'In Progress',
        assignee: 'Known Person',
        created: '2026-06-01T00:00:00.000+0000',
        histories: [{ at: '2026-06-05T00:00:00.000+0000', from: 'To Do', to: 'In Progress' }],
      },
    ]);
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name, e.at])).toEqual([
      [null, 'To Do', '2026-06-01T00:00:00.000+0000'],
      ['To Do', 'In Progress', '2026-06-05T00:00:00.000+0000'],
    ]);
  });

  it('J1: an issue with no transitions gets an arrival into its current status', () => {
    const batch = run([{ key: 'A-2', status: 'To Do', assignee: 'Known Person' }]);
    expect(batch.events).toEqual([
      {
        workItemId: 'A-2',
        from: null,
        to: { name: 'To Do', kind: 'queue' },
        at: '2026-06-01T00:00:00.000+0000',
      },
    ]);
  });

  it('J2: truncated changelog without supplementary pages is a hard error', () => {
    expect(() =>
      run([
        {
          key: 'A-3',
          status: 'In Progress',
          histories: [{ at: '2026-06-05T00:00:00.000+0000', from: 'To Do', to: 'In Progress' }],
          changelogTotal: 150,
        },
      ]),
    ).toThrow(/truncated \(1 of 150 histories\)/);
  });

  it('J2: supplementary changelog pages satisfy the completeness requirement', () => {
    const supplementary = JSON.stringify({
      total: 1,
      isLast: true,
      values: [
        {
          created: '2026-06-05T00:00:00.000+0000',
          items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }],
        },
      ],
    });
    const batch = run([{ key: 'A-4', status: 'In Progress', histories: [], changelogTotal: 1 }], {
      supplementaryChangelogs: { 'A-4': [supplementary] },
    });
    expect(batch.events).toHaveLength(2); // arrival + transition
  });

  it('J3: dropped issues (unmapped status) take their events with them', () => {
    const batch = run([
      {
        key: 'A-5',
        status: 'Weird Status',
        histories: [{ at: '2026-06-05T00:00:00.000+0000', from: 'To Do', to: 'Weird Status' }],
      },
    ]);
    expect(batch.counts).toEqual({ totalRows: 1, imported: 0, dropped: 1 });
    expect(batch.events).toHaveLength(0);
  });

  it('J3: a transition referencing an unmapped status on an IMPORTED issue is a hard error', () => {
    expect(() =>
      run([
        {
          key: 'A-6',
          status: 'In Progress',
          histories: [
            { at: '2026-06-03T00:00:00.000+0000', from: 'To Do', to: 'Blocked Weirdly' },
            { at: '2026-06-05T00:00:00.000+0000', from: 'Blocked Weirdly', to: 'In Progress' },
          ],
        },
      ]),
    ).toThrow(/"Blocked Weirdly" is not in statusMap/);
  });

  it('unmapped assignees are pseudonymized; unassigned issues are missing actors', () => {
    const batch = run([
      { key: 'A-7', status: 'To Do', assignee: 'Secret Human' },
      { key: 'A-8', status: 'To Do' },
    ]);
    expect(batch.items[0]?.actor).toEqual({ kind: 'unknown', pseudonym: 'anon-abcdef012345' });
    expect(batch.items[1]?.actor).toEqual({ kind: 'missing' });
    expect(JSON.stringify(batch)).not.toContain('Secret Human');
  });

  it('chain validation applies across derived arrival + transitions', () => {
    expect(() =>
      run([
        {
          key: 'A-9',
          status: 'Review',
          histories: [
            { at: '2026-06-05T00:00:00.000+0000', from: 'In Progress', to: 'Review' }, // arrival says To Do? no: arrival derives from THIS from → 'In Progress'; chain ok
            { at: '2026-06-08T00:00:00.000+0000', from: 'To Do', to: 'Review' }, // mismatch: previous to = Review
          ],
        },
      ]),
    ).toThrow(/does not match previous stage/);
  });
});

describe('provider conformance: jira', () => {
  describeProviderConformance(() =>
    run([
      {
        key: 'C-1',
        status: 'Review',
        assignee: 'Known Person',
        duedate: '2026-07-01',
        histories: [{ at: '2026-06-10T00:00:00.000+0000', from: 'To Do', to: 'Review' }],
      },
      { key: 'C-2', status: 'To Do', assignee: 'Secret Human' },
      { key: 'C-3', status: 'Weird', assignee: 'Known Person' },
    ]),
  );
});

describe('provider conformance: csv', () => {
  const csvMapping: MappingTemplate = {
    id: 'csv-map',
    version: '1',
    columns: {
      itemId: 'ID',
      title: 'Title',
      status: 'Status',
      actor: 'Actor',
      dueAt: 'Due',
      lastUpdatedAt: 'Updated',
    },
    statusMap: { Open: 'active', Done: 'done' },
    actorRoleMap: { 'Known Person': 'Ops' },
  };
  const csv = [
    'ID,Title,Status,Actor,Due,Updated',
    '1,Alpha,Open,Known Person,2026-07-01,2026-06-01',
    '2,Beta,Open,Secret Human,,2026-06-05',
    '3,Gamma,Weird,,2026-07-02,2026-06-06',
  ].join('\n');
  describeProviderConformance(() =>
    importCsv({
      batchId: 'b',
      csvText: csv,
      mapping: csvMapping,
      importedAt: '2026-07-20T00:00:00Z',
      pseudonymization: ctx,
    }),
  );
});
