import { expect, it } from 'vitest';
import type { ImportBatch } from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';

/**
 * Provider SPI conformance (doc 15 P1): every provider's pure transform must
 * satisfy these invariants on a representative valid fixture. Run by both the
 * CSV and Jira suites; every future connector (P2+) must import this.
 */
export function describeProviderConformance(make: () => ImportBatch): void {
  it('conformance: deterministic — two transforms are byte-identical', () => {
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it('conformance: item ids are unique and counts are coherent', () => {
    const batch = make();
    const ids = batch.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batch.counts.imported).toBe(batch.items.length);
    expect(batch.counts.totalRows).toBe(batch.counts.imported + batch.counts.dropped);
  });

  it('conformance: capability profile is honest', () => {
    const batch = make();
    expect(batch.capability.hasEventHistory).toBe(batch.events.length > 0);
    expect(batch.capability.hasDueDates).toBe(batch.items.some((i) => i.dueAt !== null));
    expect(batch.capability.hasLastUpdated).toBe(batch.items.some((i) => i.lastUpdatedAt !== null));
    expect(batch.capability.hasActors).toBe(batch.items.some((i) => i.actor.kind !== 'missing'));
  });

  it('conformance: events reference imported items, parse, and are ordered per item', () => {
    const batch = make();
    const ids = new Set(batch.items.map((i) => i.id));
    const lastPerItem = new Map<string, number>();
    for (const event of batch.events) {
      expect(ids.has(event.workItemId), `event references ${event.workItemId}`).toBe(true);
      const ms = parseIsoUtc(event.at);
      expect(ms, `event timestamp ${event.at}`).not.toBeNull();
      const previous = lastPerItem.get(event.workItemId);
      if (previous !== undefined) expect(ms as number).toBeGreaterThanOrEqual(previous);
      lastPerItem.set(event.workItemId, ms as number);
    }
  });

  it('conformance: no raw actor values — role, anon-pseudonym, or missing only', () => {
    const batch = make();
    for (const item of batch.items) {
      if (item.actor.kind === 'unknown') {
        expect(item.actor.pseudonym).toMatch(/^anon-[0-9a-f]{12}$/);
      }
    }
  });

  it('conformance: dates on items are ISO-parseable or null', () => {
    const batch = make();
    for (const item of batch.items) {
      for (const value of [item.createdAt, item.dueAt, item.lastUpdatedAt]) {
        if (value !== null) expect(parseIsoUtc(value)).not.toBeNull();
      }
    }
  });
}
