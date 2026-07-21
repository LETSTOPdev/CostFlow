import { describe, expect, it } from 'vitest';
import { ImportError, importCsv } from '@costflow/ingestion';
import type { MappingTemplate } from '@costflow/ingestion';

const mapping: MappingTemplate = {
  id: 'events-map',
  version: '1',
  columns: { itemId: 'ID', title: 'Title', status: 'Status', createdAt: 'Created' },
  statusMap: { Backlog: 'queue', Doing: 'active', Review: 'review', Done: 'done' },
  events: { columns: { itemId: 'ID', from: 'From', to: 'To', at: 'At' } },
};

const ITEMS = [
  'ID,Title,Status,Created',
  '1,Alpha,Review,2026-06-01',
  '2,Beta,Doing,2026-06-01',
].join('\n');

function run(eventsCsv: string, itemsCsv = ITEMS, m = mapping) {
  return importCsv({
    batchId: 'b',
    csvText: itemsCsv,
    eventsCsvText: eventsCsv,
    mapping: m,
    importedAt: '2026-07-20T00:00:00Z',
  });
}

describe('event-history import: strict validation, no silent repair', () => {
  it('imports a valid history in deterministic per-item (timestamp, file row) order', () => {
    const events = [
      'ID,From,To,At',
      '2,,Backlog,2026-06-01T00:00:00Z',
      '1,,Backlog,2026-06-02T00:00:00Z',
      '1,Backlog,Review,2026-06-05T00:00:00Z',
      '2,Backlog,Doing,2026-06-03T00:00:00Z',
    ].join('\n');
    const batch = run(events);
    expect(batch.capability.hasEventHistory).toBe(true);
    expect(batch.events.map((e) => [e.workItemId, e.to.name, e.at])).toEqual([
      ['1', 'Backlog', '2026-06-02T00:00:00Z'],
      ['1', 'Review', '2026-06-05T00:00:00Z'],
      ['2', 'Backlog', '2026-06-01T00:00:00Z'],
      ['2', 'Doing', '2026-06-03T00:00:00Z'],
    ]);
  });

  it('equal timestamps keep file order (documented tie-break, not repair)', () => {
    const events = [
      'ID,From,To,At',
      '1,,Backlog,2026-06-02T00:00:00Z',
      '1,Backlog,Doing,2026-06-02T00:00:00Z',
      '1,Doing,Review,2026-06-02T00:00:00Z',
    ].join('\n');
    const batch = run(events);
    expect(batch.events.map((e) => e.to.name)).toEqual(['Backlog', 'Doing', 'Review']);
  });

  it('rejects events referencing unknown work items', () => {
    const events = 'ID,From,To,At\nnope,,Backlog,2026-06-02T00:00:00Z';
    expect(() => run(events)).toThrow(ImportError);
    expect(() => run(events)).toThrow(/unknown work item/);
  });

  it('rejects unparseable timestamps', () => {
    const events = 'ID,From,To,At\n1,,Backlog,02/06/2026';
    expect(() => run(events)).toThrow(/unparseable timestamp/);
  });

  it('rejects statuses missing from statusMap', () => {
    const events = 'ID,From,To,At\n1,,Somewhere Odd,2026-06-02T00:00:00Z';
    expect(() => run(events)).toThrow(/"Somewhere Odd" is not in statusMap/);
  });

  it('rejects inconsistent from-chains instead of repairing them', () => {
    const events = [
      'ID,From,To,At',
      '1,,Backlog,2026-06-02T00:00:00Z',
      '1,Review,Done,2026-06-05T00:00:00Z',
    ].join('\n');
    expect(() => run(events)).toThrow(/from "Review" does not match previous stage "Backlog"/);
  });

  it('rejects events before item creation', () => {
    const events = 'ID,From,To,At\n1,,Backlog,2026-05-20T00:00:00Z';
    expect(() => run(events)).toThrow(/precedes item "1" creation/);
  });

  it('rejects event history when item ids are duplicated (ambiguous linkage)', () => {
    const itemsWithDupes = [
      'ID,Title,Status,Created',
      '1,Alpha,Review,2026-06-01',
      '1,Alpha again,Doing,2026-06-01',
    ].join('\n');
    const events = 'ID,From,To,At\n1,,Backlog,2026-06-02T00:00:00Z';
    expect(() => run(events, itemsWithDupes)).toThrow(/duplicate item ids/);
  });

  it('rejects an events file when the mapping has no events section', () => {
    const bare: MappingTemplate = { ...mapping, events: undefined };
    const events = 'ID,From,To,At\n1,,Backlog,2026-06-02T00:00:00Z';
    expect(() => run(events, ITEMS, bare)).toThrow(/no "events" section/);
  });

  it('validates the events header like any other file (missing mapped column)', () => {
    const events = 'ID,From,To\n1,,Backlog';
    expect(() => run(events)).toThrow(/not found in event-history CSV header: "At"/);
  });
});
