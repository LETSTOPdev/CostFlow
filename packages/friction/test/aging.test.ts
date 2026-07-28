import { describe, expect, it } from 'vitest';
import type { ImportBatch, WorkItem } from '@costflow/domain';
import { AGING_SIGNAL, checkRequirements, detectAging } from '@costflow/friction';

const NOW = '2026-07-20T00:00:00Z';

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 'x',
    sourceId: 'x',
    originScopeId: null,
    title: 'Item',
    stage: { name: 'Working on it', kind: 'active' },
    actor: { kind: 'role', roleRef: 'Ops' },
    createdAt: null,
    dueAt: null,
    lastUpdatedAt: '2026-06-01',
    ...overrides,
  };
}

function batch(items: WorkItem[], overrides: Partial<ImportBatch> = {}): ImportBatch {
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
      hasDueDates: false,
      hasLastUpdated: true,
      hasActors: true,
    },
    evidence: [],
    scopes: [],
    pseudonymizationScope: null,
    items,
    events: [],
    ...overrides,
  };
}

describe('f2-aging detector', () => {
  it('excludes terminal, fresh, and undated items; groups by stage; sums excess days', () => {
    const instances = detectAging(
      batch([
        item({ id: 'stale-1', lastUpdatedAt: '2026-06-20' }), // 30d aging, 16 excess
        item({ id: 'stale-2', lastUpdatedAt: '2026-06-05' }), // 45d aging, 31 excess
        item({ id: 'fresh', lastUpdatedAt: '2026-07-18' }), // 2d — below threshold
        item({ id: 'done', stage: { name: 'Done', kind: 'done' }, lastUpdatedAt: '2026-01-01' }),
        item({ id: 'undated', lastUpdatedAt: null }),
        item({
          id: 'blocked-1',
          stage: { name: 'Stuck', kind: 'blocked' },
          lastUpdatedAt: '2026-06-10', // 40d aging, 26 excess
        }),
      ]),
      { thresholdDays: 14, now: NOW },
    );

    expect(instances).toHaveLength(2);
    const active = instances.find((i) => i.location.stage.name === 'Working on it');
    expect(active?.magnitude.value).toBe(47);
    expect(active?.evidence.map((e) => e.workItemId)).toEqual(['stale-2', 'stale-1']);
    const blocked = instances.find((i) => i.location.stage.name === 'Stuck');
    expect(blocked?.magnitude.value).toBe(26);
  });

  it('exactly-at-threshold items are not flagged', () => {
    const instances = detectAging(batch([item({ lastUpdatedAt: '2026-07-06' })]), {
      thresholdDays: 14,
      now: NOW,
    }); // 14 days — not beyond threshold
    expect(instances).toHaveLength(0);
  });

  it('is deterministic: identical inputs give identical output', () => {
    const b = batch([item({ id: 'a' }), item({ id: 'b', lastUpdatedAt: '2026-05-01' })]);
    const one = detectAging(b, { thresholdDays: 14, now: NOW });
    const two = detectAging(b, { thresholdDays: 14, now: NOW });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('throws on an invalid analysis time instead of silently finding nothing (regression: R-01)', () => {
    const b = batch([item({ lastUpdatedAt: '2026-05-01' })]);
    expect(() => detectAging(b, { thresholdDays: 14, now: '20/07/2026' })).toThrow(
      /Invalid analysis time/,
    );
    expect(() => detectAging(b, { thresholdDays: 14, now: 'garbage' })).toThrow(
      /Invalid analysis time/,
    );
  });

  it('declares its snapshot requirement so batches without lastUpdated skip it visibly', () => {
    const result = checkRequirements(AGING_SIGNAL, {
      hasEventHistory: false,
      hasDueDates: true,
      hasLastUpdated: false,
      hasActors: true,
    });
    expect(result.canRun).toBe(false);
    if (!result.canRun) expect(result.reason).toContain('hasLastUpdated');
  });
});

describe('origin partitioning', () => {
  /**
   * Two teams whose boards both have a status called "In review" run two
   * different review queues. Grouping by stage name alone reports one finding
   * that belongs to neither of them.
   */
  it('splits one stage name across two origins into two findings', () => {
    const stage = { name: 'In review', kind: 'review' as const };
    const found = detectAging(
      batch([
        item({ id: 'a', stage, originScopeId: 'eng' }),
        item({ id: 'b', stage, originScopeId: 'eng' }),
        item({ id: 'c', stage, originScopeId: 'legal' }),
      ]),
      { thresholdDays: 5, now: NOW },
    );
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.location.originScopeId).sort()).toEqual(['eng', 'legal']);
    // Ids stay distinct so nothing downstream can conflate them.
    expect(new Set(found.map((f) => f.id)).size).toBe(2);
    // Each carries only its own team's items.
    const eng = found.find((f) => f.location.originScopeId === 'eng');
    expect(eng?.evidence.map((e) => e.workItemId).sort()).toEqual(['a', 'b']);
  });

  /** An import with no scope structure keeps exactly the ids it always had. */
  it('leaves ids untouched when there is no origin', () => {
    const found = detectAging(
      batch([item({ id: 'a', stage: { name: 'In review', kind: 'review' } })]),
      { thresholdDays: 5, now: NOW },
    );
    expect(found[0]?.id).toBe('f2-aging:in-review');
  });
});
