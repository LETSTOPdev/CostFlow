import { describe, expect, it } from 'vitest';
import type { PseudonymizationContext } from '@costflow/domain';
import { ImportError, importCsv } from '@costflow/ingestion';
import type { MappingTemplate } from '@costflow/ingestion';

const mapping: MappingTemplate = {
  id: 'test-map',
  version: '1',
  columns: {
    itemId: 'ID',
    title: 'Title',
    status: 'Status',
    actor: 'Actor',
    lastUpdatedAt: 'Updated',
  },
  statusMap: { Open: 'active', Done: 'done' },
  actorRoleMap: { 'known person': 'Ops' },
};

// Deterministic fake for library-level tests; the real HMAC lives at the edge.
const ctx: PseudonymizationContext = {
  scopeId: 'test-org',
  pseudonymFor: (raw) => `anon-len${raw.length}`,
};

const IMPORTED_AT = '2026-07-20T00:00:00Z';

function run(csv: string, overrides: Partial<Parameters<typeof importCsv>[0]> = {}) {
  return importCsv({
    batchId: 'b',
    csvText: csv,
    mapping,
    importedAt: IMPORTED_AT,
    pseudonymization: ctx,
    ...overrides,
  });
}

describe('csv provider (extract → map → land)', () => {
  it('maps known statuses, drops unmapped rows with a diagnostic, flags bad dates', () => {
    const csv = [
      'ID,Title,Status,Actor,Updated',
      '1,Alpha,Open,known person,2026-06-01',
      '2,Beta,Weird Status,known person,2026-06-01',
      '3,Gamma,Open,,garbage-date',
    ].join('\n');
    const batch = run(csv);

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
    expect(gamma?.actor).toEqual({ kind: 'missing' });
    expect(gamma?.lastUpdatedAt).toBeNull();
  });

  it('resolves actors: mapped → role, unmapped → pseudonym, empty → missing (R-20)', () => {
    const csv = [
      'ID,Title,Status,Actor,Updated',
      '1,A,Open,known person,2026-06-01',
      '2,B,Open,Sarah Secret,2026-06-01',
      '3,C,Open,,2026-06-01',
    ].join('\n');
    const batch = run(csv);
    expect(batch.items.map((i) => i.actor)).toEqual([
      { kind: 'role', roleRef: 'Ops' },
      { kind: 'unknown', pseudonym: 'anon-len12' },
      { kind: 'missing' },
    ]);
    expect(batch.pseudonymizationScope).toBe('test-org');
    // The raw actor value must not exist anywhere in the batch.
    expect(JSON.stringify(batch)).not.toContain('Sarah Secret');
  });

  it('refuses unmapped actors when no pseudonymization context is provided', () => {
    const csv = 'ID,Title,Status,Actor,Updated\n1,A,Open,Sarah Secret,2026-06-01';
    expect(() => run(csv, { pseudonymization: undefined })).toThrow(
      /no pseudonymization context was provided/,
    );
  });

  it('rejects duplicate mapped headers instead of silently reading last-wins (regression: R-04)', () => {
    const csv = 'ID,Status,Status,Title,Actor,Updated\n1,Open,Done,A,known person,2026-06-01';
    expect(() => run(csv)).toThrow(ImportError);
    expect(() => run(csv)).toThrow(/duplicate mapped column/i);
  });

  it('warns on duplicate unmapped headers but proceeds', () => {
    const csv = 'ID,Title,Status,Actor,Updated,Notes,Notes\n1,A,Open,known person,2026-06-01,x,y';
    const batch = run(csv);
    expect(batch.counts.imported).toBe(1);
    expect(batch.diagnostics).toContainEqual({
      row: 0,
      severity: 'warning',
      message:
        'Duplicate unmapped column "Notes" in CSV header — only its last occurrence is readable.',
    });
  });

  it('rejects mappings that reference columns missing from the header (regression: R-05)', () => {
    const csv = 'ID,Title,Status,Actor\n1,A,Open,known person';
    expect(() => run(csv)).toThrow(/Mapped column\(s\) not found in CSV header: "Updated"/);
  });

  it('rejects an empty file', () => {
    expect(() => run('')).toThrow(/no header row/);
  });

  it('disambiguates duplicate item ids deterministically with a warning (regression: R-06)', () => {
    const csv = [
      'ID,Title,Status,Actor,Updated',
      '1,First,Open,known person,2026-06-01',
      '1,Second,Open,known person,2026-06-02',
      '1,Third,Open,known person,2026-06-03',
    ].join('\n');
    const batch = run(csv);
    expect(batch.items.map((i) => i.id)).toEqual(['1', '1#2', '1#3']);
    expect(batch.items.map((i) => i.sourceId)).toEqual(['1', '1', '1']);
    expect(batch.diagnostics.filter((d) => d.message.includes('Duplicate item id'))).toHaveLength(
      2,
    );
  });

  it('is immutable-by-convention and deterministic', () => {
    const csv = 'ID,Title,Status,Actor,Updated\n1,A,Open,known person,2026-06-01';
    expect(JSON.stringify(run(csv))).toBe(JSON.stringify(run(csv)));
  });
});
