import { parse } from 'csv-parse/sync';
import type { ImportBatch, ImportDiagnostic, IsoDateString, WorkItem } from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';
import type { MappingTemplate } from '../../mapping-template';

export const CSV_PROVIDER = 'csv';

/**
 * Structural problems with the file itself (not row-level data quality).
 * These fail the import loudly: proceeding would misread the file while
 * looking healthy (R-04/R-05).
 */
export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

export interface CsvImportInput {
  readonly batchId: string;
  /** Raw file content; reading the file is the effectful edge's job. */
  readonly csvText: string;
  readonly mapping: MappingTemplate;
  /** Explicit input — the core never reads a clock (doc 05 §3). */
  readonly importedAt: IsoDateString;
}

/**
 * The full provider contract for CSV (doc 05 §4): extract (parse), map (apply
 * template), land (immutable batch + diagnostics + capability profile).
 * Pure: string in, batch out.
 */
export function importCsv(input: CsvImportInput): ImportBatch {
  const { batchId, csvText, mapping, importedAt } = input;

  const diagnostics: ImportDiagnostic[] = [];

  // Header validation before any row is read (R-04/R-05): csv-parse silently
  // resolves duplicate headers last-wins, and a typo'd mapping column would
  // otherwise null a field for every row while looking like a data gap.
  const headerRows = parse(csvText, { to_line: 1, trim: true, bom: true }) as string[][];
  const header = headerRows[0] ?? [];
  if (header.length === 0) {
    throw new CsvImportError('CSV has no header row.');
  }
  const mappedColumns = Object.values(mapping.columns).filter((c): c is string => c !== undefined);
  const missing = mappedColumns.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new CsvImportError(
      `Mapped column(s) not found in CSV header: ${missing.map((c) => `"${c}"`).join(', ')}. ` +
        `Header columns are: ${header.map((c) => `"${c}"`).join(', ')}.`,
    );
  }
  const counts = new Map<string, number>();
  for (const column of header) {
    counts.set(column, (counts.get(column) ?? 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  const duplicatedMapped = duplicated.filter((c) => mappedColumns.includes(c));
  if (duplicatedMapped.length > 0) {
    throw new CsvImportError(
      `CSV header contains duplicate mapped column(s): ${duplicatedMapped
        .map((c) => `"${c}"`)
        .join(', ')} — the file is ambiguous and cannot be imported safely.`,
    );
  }
  for (const column of duplicated) {
    diagnostics.push({
      row: 0,
      severity: 'warning',
      message: `Duplicate unmapped column "${column}" in header — only its last occurrence is readable.`,
    });
  }

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const items: WorkItem[] = [];

  const readDate = (
    row: Record<string, string>,
    rowNum: number,
    column: string | undefined,
    field: string,
  ): IsoDateString | null => {
    if (!column) return null;
    const raw = row[column]?.trim() ?? '';
    if (raw === '') return null;
    if (parseIsoUtc(raw) === null) {
      diagnostics.push({
        row: rowNum,
        severity: 'warning',
        message: `Unparseable ${field} "${raw}" — field ignored (ISO dates only in M0).`,
      });
      return null;
    }
    return raw;
  };

  const seenIds = new Map<string, number>();

  records.forEach((row, index) => {
    const rowNum = index + 1;
    const status = row[mapping.columns.status]?.trim() ?? '';
    const stageKind = mapping.statusMap[status];
    if (stageKind === undefined) {
      diagnostics.push({
        row: rowNum,
        severity: 'dropped',
        message: `Status "${status}" is not mapped to a stage kind — row dropped.`,
      });
      return;
    }
    const sourceId = mapping.columns.itemId
      ? (row[mapping.columns.itemId]?.trim() ?? `row-${rowNum}`)
      : `row-${rowNum}`;
    // R-06: duplicate ids would make trace evidence ambiguous; disambiguate
    // deterministically and say so, never silently.
    const occurrence = (seenIds.get(sourceId) ?? 0) + 1;
    seenIds.set(sourceId, occurrence);
    const canonicalId = occurrence === 1 ? sourceId : `${sourceId}#${occurrence}`;
    if (occurrence > 1) {
      diagnostics.push({
        row: rowNum,
        severity: 'warning',
        message: `Duplicate item id "${sourceId}" — imported as "${canonicalId}".`,
      });
    }
    const role = mapping.columns.role ? (row[mapping.columns.role]?.trim() ?? '') : '';
    items.push({
      id: canonicalId,
      sourceId,
      title: row[mapping.columns.title]?.trim() ?? '',
      stage: { name: status, kind: stageKind },
      roleRef: role === '' ? null : role,
      createdAt: readDate(row, rowNum, mapping.columns.createdAt, 'createdAt'),
      dueAt: readDate(row, rowNum, mapping.columns.dueAt, 'dueAt'),
      lastUpdatedAt: readDate(row, rowNum, mapping.columns.lastUpdatedAt, 'lastUpdatedAt'),
    });
  });

  return {
    id: batchId,
    provider: CSV_PROVIDER,
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: records.length,
      imported: items.length,
      dropped: records.length - items.length,
    },
    diagnostics,
    capability: {
      hasEventHistory: false,
      hasDueDates: mapping.columns.dueAt !== undefined && items.some((i) => i.dueAt !== null),
      hasLastUpdated:
        mapping.columns.lastUpdatedAt !== undefined && items.some((i) => i.lastUpdatedAt !== null),
      hasRoles: mapping.columns.role !== undefined && items.some((i) => i.roleRef !== null),
    },
    items,
  };
}
