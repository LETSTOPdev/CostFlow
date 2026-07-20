import { describe, expect, it } from 'vitest';
import { CsvImportError, importCsv } from '@costflow/ingestion';
import type { MappingTemplate } from '@costflow/ingestion';

const mapping: MappingTemplate = {
  id: 'test-map',
  version: '1',
  columns: {
    itemId: 'ID',
    title: 'Title',
    status: 'Status',
    role: 'Role',
    lastUpdatedAt: 'Updated',
  },
  statusMap: { Open: 'active', Done: 'done' },
};

describe('csv provider (extract → map → land)', () => {
  it('maps known statuses, drops unmapped rows with a diagnostic, flags bad dates', () => {
    const csv = [
      'ID,Title,Status,Role,Updated',
      '1,Alpha,Open,Ops,2026-06-01',
      '2,Beta,Weird Status,Ops,2026-06-01',
      '3,Gamma,Open,,garbage-date',
    ].join('\n');
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });

    expect(batch.counts).toEqual({ totalRows: 3, imported: 2, dropped: 1 });
    expect(batch.diagnostics).toEqual([
      {
        row: 2,
        severity: 'dropped',
        message: 'Status "Weird Status" is not mapped to a stage kind — row dropped.',
      },
      {
        row: 3,
        severity: 'warning',
        message: 'Unparseable lastUpdatedAt "garbage-date" — field ignored (ISO dates only in M0).',
      },
    ]);
    const gamma = batch.items.find((i) => i.id === '3');
    expect(gamma?.roleRef).toBeNull();
    expect(gamma?.lastUpdatedAt).toBeNull();
  });

  it('capability profile reflects what the data actually supports', () => {
    const csv = 'ID,Title,Status,Role,Updated\n1,A,Open,Ops,2026-06-01';
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });
    expect(batch.capability).toEqual({
      hasEventHistory: false,
      hasDueDates: false,
      hasLastUpdated: true,
      hasRoles: true,
    });
  });

  it('rejects duplicate mapped headers instead of silently reading last-wins (regression: R-04)', () => {
    const csv = 'ID,Status,Status,Title,Role,Updated\n1,Open,Closed,A,Ops,2026-06-01';
    expect(() =>
      importCsv({ batchId: 'b', csvText: csv, mapping, importedAt: '2026-07-20T00:00:00Z' }),
    ).toThrow(CsvImportError);
    expect(() =>
      importCsv({ batchId: 'b', csvText: csv, mapping, importedAt: '2026-07-20T00:00:00Z' }),
    ).toThrow(/duplicate mapped column/i);
  });

  it('warns on duplicate unmapped headers but proceeds', () => {
    const csv = 'ID,Title,Status,Role,Updated,Notes,Notes\n1,A,Open,Ops,2026-06-01,x,y';
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });
    expect(batch.counts.imported).toBe(1);
    expect(batch.diagnostics).toContainEqual({
      row: 0,
      severity: 'warning',
      message:
        'Duplicate unmapped column "Notes" in header — only its last occurrence is readable.',
    });
  });

  it('rejects mappings that reference columns missing from the header (regression: R-05)', () => {
    const csv = 'ID,Title,Status,Role\n1,A,Open,Ops'; // no "Updated" column
    expect(() =>
      importCsv({ batchId: 'b', csvText: csv, mapping, importedAt: '2026-07-20T00:00:00Z' }),
    ).toThrow(/Mapped column\(s\) not found in CSV header: "Updated"/);
  });

  it('rejects an empty file', () => {
    expect(() =>
      importCsv({ batchId: 'b', csvText: '', mapping, importedAt: '2026-07-20T00:00:00Z' }),
    ).toThrow(/no header row/);
  });

  it('disambiguates duplicate item ids deterministically with a warning (regression: R-06)', () => {
    const csv = [
      'ID,Title,Status,Role,Updated',
      '1,First,Open,Ops,2026-06-01',
      '1,Second,Open,Ops,2026-06-02',
      '1,Third,Open,Ops,2026-06-03',
    ].join('\n');
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });
    expect(batch.items.map((i) => i.id)).toEqual(['1', '1#2', '1#3']);
    expect(batch.items.map((i) => i.sourceId)).toEqual(['1', '1', '1']);
    expect(batch.diagnostics.filter((d) => d.message.includes('Duplicate item id'))).toHaveLength(
      2,
    );
  });

  it('is immutable-by-convention and deterministic', () => {
    const csv = 'ID,Title,Status,Role,Updated\n1,A,Open,Ops,2026-06-01';
    const input = { batchId: 'b', csvText: csv, mapping, importedAt: '2026-07-20T00:00:00Z' };
    expect(JSON.stringify(importCsv(input))).toBe(JSON.stringify(importCsv(input)));
  });
});
