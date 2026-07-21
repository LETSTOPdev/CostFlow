import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { transformMonday } from '@costflow/ingestion';
import type { MondayMapping } from '@costflow/ingestion';
import { describeProviderConformance } from './spi-conformance';

const mapping: MondayMapping = {
  id: 'monday-map',
  version: '1',
  statusColumnId: 'status',
  statusMap: {
    Backlog: 'queue',
    'Working on it': 'active',
    'Waiting for review': 'review',
    Done: 'done',
  },
  peopleColumnId: 'person',
  dueDateColumnId: 'date4',
  activityLogsComplete: true,
  actorRoleMap: { 'Known Person': 'Ops' },
};

const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: () => 'anon-abcdef012345',
};

/** M2 helper: ISO → monday's 17-digit 100ns-unit timestamp string. */
function ts17(iso: string): string {
  return `${Date.parse(iso)}0000`;
}

interface ItemSpec {
  id: string;
  status: string;
  person?: string;
  due?: string;
  created?: string;
  updated?: string;
}
interface ActivitySpec {
  pulseId: number | string;
  at: string;
  from: string | null;
  to: string;
  columnId?: string;
  event?: string;
}

function itemsPage(specs: ItemSpec[]): string {
  return JSON.stringify({
    data: {
      boards: [
        {
          items_page: {
            cursor: null,
            items: specs.map((s) => ({
              id: s.id,
              name: `Item ${s.id}`,
              created_at: s.created ?? '2026-06-01T00:00:00Z',
              updated_at: s.updated ?? '2026-07-01T00:00:00Z',
              column_values: [
                { id: 'status', text: s.status },
                { id: 'person', text: s.person ?? '' },
                { id: 'date4', text: s.due ?? '' },
              ],
            })),
          },
        },
      ],
    },
  });
}

function activityPage(specs: ActivitySpec[]): string {
  return JSON.stringify({
    data: {
      boards: [
        {
          activity_logs: specs.map((s) => ({
            event: s.event ?? 'update_column_value',
            created_at: ts17(s.at),
            data: JSON.stringify({
              pulse_id: s.pulseId,
              column_id: s.columnId ?? 'status',
              value: { label: { text: s.to } },
              previous_value: s.from === null ? null : { label: { text: s.from } },
            }),
          })),
        },
      ],
    },
  });
}

function run(
  items: ItemSpec[],
  activity?: ActivitySpec[],
  overrides: Partial<Parameters<typeof transformMonday>[0]> = {},
) {
  return transformMonday({
    batchId: 'b',
    itemsPages: [itemsPage(items)],
    activityPages: activity === undefined ? undefined : [activityPage(activity)],
    mapping,
    importedAt: '2026-07-20T00:00:00Z',
    pseudonymization: ctx,
    ...overrides,
  });
}

describe('monday transform (doc 15 P2: M1–M6)', () => {
  it('M1: only the designated status column produces transitions', () => {
    const batch = run(
      [{ id: '1', status: 'Working on it', person: 'Known Person' }],
      [
        { pulseId: 1, at: '2026-06-10T00:00:00Z', from: 'Backlog', to: 'Working on it' },
        {
          pulseId: 1,
          at: '2026-06-12T00:00:00Z',
          from: 'x',
          to: 'y',
          columnId: 'other_column',
        },
      ],
    );
    expect(batch.events.map((e) => [e.from?.name ?? null, e.to.name])).toEqual([
      [null, 'Backlog'],
      ['Backlog', 'Working on it'],
    ]);
  });

  it('M2: 17-digit activity timestamps convert to exact ISO instants', () => {
    const batch = run(
      [{ id: '1', status: 'Working on it' }],
      [{ pulseId: 1, at: '2026-06-18T00:00:00Z', from: 'Backlog', to: 'Working on it' }],
    );
    expect(batch.events[1]?.at).toBe('2026-06-18T00:00:00.000Z');
  });

  it('M3: the first person listed in a people column is the actor', () => {
    const batch = run([
      { id: '1', status: 'Backlog', person: 'Known Person, Second Person' },
      { id: '2', status: 'Backlog', person: 'Zecret Human, Known Person' },
    ]);
    expect(batch.items[0]?.actor).toEqual({ kind: 'role', roleRef: 'Ops' });
    expect(batch.items[1]?.actor).toEqual({ kind: 'unknown', pseudonym: 'anon-abcdef012345' });
    expect(JSON.stringify(batch)).not.toContain('Zecret');
  });

  it('M4: unattested activity logs yield items only, a diagnostic, and no events', () => {
    const batch = run(
      [{ id: '1', status: 'Backlog' }],
      [{ pulseId: 1, at: '2026-06-10T00:00:00Z', from: 'Backlog', to: 'Working on it' }],
      { mapping: { ...mapping, activityLogsComplete: false } },
    );
    expect(batch.events).toHaveLength(0);
    expect(batch.capability.hasEventHistory).toBe(false);
    expect(batch.diagnostics.some((d) => d.message.includes('not attested complete'))).toBe(true);
  });

  it('M6: activity for items outside the snapshot is excluded with a counted diagnostic', () => {
    const batch = run(
      [{ id: '1', status: 'Backlog' }],
      [{ pulseId: 999, at: '2026-06-10T00:00:00Z', from: 'Backlog', to: 'Done' }],
    );
    expect(batch.events.map((e) => e.to.name)).toEqual(['Backlog']); // arrival only
    expect(
      batch.diagnostics.some((d) =>
        d.message.includes('1 activity entry reference item(s) outside the snapshot'),
      ),
    ).toBe(true);
  });

  it('J3: dropped items (unmapped status) take their activity with them, silently', () => {
    const batch = run(
      [{ id: '1', status: 'Weird Status' }],
      [{ pulseId: 1, at: '2026-06-10T00:00:00Z', from: 'Backlog', to: 'Weird Status' }],
    );
    expect(batch.counts).toEqual({ totalRows: 1, imported: 0, dropped: 1 });
    expect(batch.events).toHaveLength(0);
    expect(batch.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('J1: an item with no transitions gets an arrival into its current status', () => {
    const batch = run([{ id: '7', status: 'Backlog', created: '2026-06-05T00:00:00Z' }], []);
    expect(batch.events).toEqual([
      {
        workItemId: '7',
        from: null,
        to: { name: 'Backlog', kind: 'queue' },
        at: '2026-06-05T00:00:00Z',
      },
    ]);
  });

  it('a transition referencing an unmapped status on an imported item is a hard error', () => {
    expect(() =>
      run(
        [{ id: '1', status: 'Working on it' }],
        [{ pulseId: 1, at: '2026-06-10T00:00:00Z', from: 'Mystery', to: 'Working on it' }],
      ),
    ).toThrow(/"Mystery" is not in statusMap/);
  });
});

describe('provider conformance: monday', () => {
  describeProviderConformance(() =>
    run(
      [
        {
          id: '1',
          status: 'Waiting for review',
          person: 'Known Person',
          due: '2026-07-01',
          created: '2026-06-01T00:00:00Z',
        },
        { id: '2', status: 'Backlog', person: 'Zecret Human' },
        { id: '3', status: 'Unmapped Weirdness' },
      ],
      [{ pulseId: 1, at: '2026-06-10T00:00:00Z', from: 'Backlog', to: 'Waiting for review' }],
    ),
  );
});
