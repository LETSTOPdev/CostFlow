import { describe, expect, it } from 'vitest';
import type { CapabilityProfile, ImportBatch, WorkItem, WorkItemEvent } from '@costflow/domain';
import { ImportError } from '../src/errors';
import { mergeBatches } from '../src/merge';

/**
 * Merging several origins into one analysis.
 *
 * The properties under test are the ones that decide whether a multi-scope
 * total can be trusted: that fetch order never reaches a number, that an item
 * in two Lists is counted once, that a capability only one origin has does not
 * become a claim about all of them, and that the reason for that is legible.
 */

const item = (id: string, actor = 'Ops'): WorkItem => ({
  id,
  sourceId: id,
  originScopeId: null,
  title: `Item ${id}`,
  stage: { name: 'backlog', kind: 'queue' },
  actor: { kind: 'role', roleRef: actor },
  createdAt: '2026-07-01T00:00:00Z',
  dueAt: null,
  lastUpdatedAt: null,
});

const event = (itemId: string): WorkItemEvent => ({
  workItemId: itemId,
  from: null,
  to: { name: 'backlog', kind: 'queue' },
  at: '2026-07-01T00:00:00Z',
});

const FULL: CapabilityProfile = {
  hasEventHistory: true,
  hasDueDates: true,
  hasLastUpdated: true,
  hasActors: true,
};

function batch(overrides: Partial<ImportBatch> & { scopeId: string; label: string }): ImportBatch {
  const items = overrides.items ?? [];
  return {
    id: `batch-${overrides.scopeId}`,
    provider: 'clickup',
    mappingTemplateId: 'ws-1',
    mappingTemplateVersion: '1',
    importedAt: '2026-07-20T00:00:00Z',
    counts: { totalRows: items.length, imported: items.length, dropped: 0 },
    diagnostics: [],
    capability: FULL,
    evidence: [],
    scopes: [{ id: overrides.scopeId, label: overrides.label, itemCount: items.length }],
    pseudonymizationScope: 'org-1',
    items,
    events: [],
    ...overrides,
  } as ImportBatch;
}

const merge = (batches: ImportBatch[]): ImportBatch =>
  mergeBatches({ batches, batchId: 'batch-merged', importedAt: '2026-07-20T00:00:00Z' });

describe('merging origins into one batch', () => {
  it('records what it covered, sorted, with each origin item count', () => {
    const merged = merge([
      batch({ scopeId: '902', label: 'Backlog', items: [item('b1')] }),
      batch({ scopeId: '901', label: 'Sprint Board', items: [item('a1'), item('a2')] }),
    ]);
    expect(merged.scopes).toEqual([
      { id: '901', label: 'Sprint Board', itemCount: 2 },
      { id: '902', label: 'Backlog', itemCount: 1 },
    ]);
    expect(merged.counts).toEqual({ totalRows: 3, imported: 3, dropped: 0 });
  });

  /** Fetch order is a network accident. It must not reach a number. */
  it('is independent of the order the origins were fetched in', () => {
    const one = batch({ scopeId: '901', label: 'Sprint Board', items: [item('a1')] });
    const two = batch({ scopeId: '902', label: 'Backlog', items: [item('b1')] });
    expect(JSON.stringify(merge([one, two]))).toBe(JSON.stringify(merge([two, one])));
  });

  /**
   * A ClickUp task can belong to several Lists. Counting it twice inflates
   * every total, invisibly.
   */
  it('counts an item that appears in two origins once, and says so', () => {
    const merged = merge([
      batch({ scopeId: '901', label: 'Sprint Board', items: [item('shared'), item('a1')] }),
      batch({ scopeId: '902', label: 'Backlog', items: [item('shared'), item('b1')] }),
    ]);
    expect(merged.items.map((i) => i.id)).toEqual(['shared', 'a1', 'b1']);
    expect(merged.counts).toEqual({ totalRows: 4, imported: 3, dropped: 1 });
    // The origin that lost the contest reports zero for that item.
    expect(merged.scopes.find((s) => s.id === '902')?.itemCount).toBe(1);
    expect(merged.diagnostics.map((d) => d.message)).toContain(
      'Backlog: 1 item(s) also appear in another selected origin and were counted once, under the first origin that contained them.',
    );
  });

  it('drops the duplicate history with the duplicate item, and keeps the survivor whole', () => {
    const merged = merge([
      batch({
        scopeId: '901',
        label: 'Sprint Board',
        items: [item('shared')],
        events: [event('shared')],
      }),
      batch({
        scopeId: '902',
        label: 'Backlog',
        items: [item('shared')],
        events: [event('shared')],
      }),
    ]);
    expect(merged.events).toHaveLength(1);
  });

  /**
   * The rule that stops a detector reporting a confident figure for work it
   * never observed: what only some origins can support, none of them claims.
   */
  it('takes the intersection of capability, never the union', () => {
    const merged = merge([
      batch({ scopeId: '901', label: 'Sprint Board', items: [item('a1')] }),
      batch({
        scopeId: '902',
        label: 'Backlog',
        items: [item('b1')],
        capability: { ...FULL, hasEventHistory: false },
      }),
    ]);
    expect(merged.capability.hasEventHistory).toBe(false);
    expect(merged.capability.hasActors).toBe(true);
  });

  it('explains which origins cost the workspace that capability', () => {
    const merged = merge([
      batch({ scopeId: '901', label: 'Sprint Board', items: [item('a1')] }),
      batch({ scopeId: '903', label: 'Design', items: [item('c1')] }),
      batch({
        scopeId: '902',
        label: 'Backlog',
        items: [item('b1')],
        capability: { ...FULL, hasEventHistory: false },
      }),
    ]);
    const note = merged.evidence.find((n) => n.subject === 'events');
    expect(note?.weakness).toBe('partial-coverage');
    expect(note?.detail).toContain('1 of the 3 selected origins carry no status history');
    expect(note?.detail).toContain('Backlog');
  });

  it('says nothing about partial coverage when every origin agrees', () => {
    const merged = merge([
      batch({ scopeId: '901', label: 'Sprint Board', items: [item('a1')] }),
      batch({ scopeId: '902', label: 'Backlog', items: [item('b1')] }),
    ]);
    expect(merged.evidence).toEqual([]);
  });

  it('attributes a per-origin diagnostic to its origin, and leaves a single origin alone', () => {
    const diagnostics = [{ row: 3, severity: 'warning' as const, message: 'Something odd.' }];
    const alone = merge([batch({ scopeId: '901', label: 'Sprint Board', diagnostics })]);
    expect(alone.diagnostics[0]?.message).toBe('Something odd.');

    const several = merge([
      batch({ scopeId: '901', label: 'Sprint Board', diagnostics }),
      batch({ scopeId: '902', label: 'Backlog' }),
    ]);
    expect(several.diagnostics[0]?.message).toBe('Sprint Board: Something odd.');
  });

  it('refuses to merge imports that are not describing the same thing', () => {
    expect(() =>
      merge([
        batch({ scopeId: '901', label: 'Sprint Board' }),
        batch({ scopeId: 'OPS', label: 'Operations', provider: 'jira' }),
      ]),
    ).toThrow(ImportError);
  });

  it('refuses a batch that does not say which origin it came from', () => {
    expect(() => merge([{ ...batch({ scopeId: '901', label: 'A' }), scopes: [] }])).toThrow(
      ImportError,
    );
  });
});
