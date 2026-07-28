import { parse } from 'csv-parse/sync';
import type {
  ImportBatch,
  ImportDiagnostic,
  IsoDateString,
  PseudonymizationContext,
  WorkItem,
  WorkItemEvent,
} from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';
import type { MappingTemplate } from '../../mapping-template';
import { ImportError } from '../../errors';
import {
  buildCapability,
  orderAndValidateEvents,
  resolveActorValue,
  type CanonicalEventInput,
} from '../../canonical';

export const CSV_PROVIDER = 'csv';

export interface CsvImportInput {
  readonly batchId: string;
  /** Raw file content; reading the file is the effectful edge's job. */
  readonly csvText: string;
  /** Optional event-history file content; requires mapping.events. */
  readonly eventsCsvText?: string | undefined;
  readonly mapping: MappingTemplate;
  /** Explicit input — the core never reads a clock (doc 05 §3). */
  readonly importedAt: IsoDateString;
  /**
   * Required when an actor column is mapped: unmapped actor values are
   * replaced by deterministic org-scoped pseudonyms. Built at the edge; the
   * core never sees salts (R-20 rule 11).
   */
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

function parseHeader(csvText: string, label: string): string[] {
  const headerRows = parse(csvText, { to_line: 1, trim: true, bom: true }) as string[][];
  const header = headerRows[0] ?? [];
  if (header.length === 0) {
    throw new ImportError(`${label} has no header row.`);
  }
  return header;
}

function validateHeader(
  header: string[],
  mappedColumns: readonly string[],
  label: string,
  diagnostics: ImportDiagnostic[],
): void {
  const missing = mappedColumns.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new ImportError(
      `Mapped column(s) not found in ${label} header: ${missing.map((c) => `"${c}"`).join(', ')}. ` +
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
    throw new ImportError(
      `${label} header contains duplicate mapped column(s): ${duplicatedMapped
        .map((c) => `"${c}"`)
        .join(', ')} — the file is ambiguous and cannot be imported safely.`,
    );
  }
  for (const column of duplicated) {
    diagnostics.push({
      row: 0,
      severity: 'warning',
      message: `Duplicate unmapped column "${column}" in ${label} header — only its last occurrence is readable.`,
    });
  }
}

/**
 * The full provider contract for CSV (doc 05 §4): extract (parse), map (apply
 * template), land (immutable batch + diagnostics + capability profile).
 * Pure: strings in, batch out. Since P2 (D-16) the actor/event/capability
 * semantics are the shared canonical helpers — the same path every provider
 * takes.
 */
export function importCsv(input: CsvImportInput): ImportBatch {
  const { batchId, csvText, eventsCsvText, mapping, importedAt, pseudonymization } = input;

  const diagnostics: ImportDiagnostic[] = [];

  const header = parseHeader(csvText, 'CSV');
  const mappedColumns = Object.values(mapping.columns).filter((c): c is string => c !== undefined);
  validateHeader(header, mappedColumns, 'CSV', diagnostics);

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
  let duplicateIdCount = 0;

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
      duplicateIdCount += 1;
      diagnostics.push({
        row: rowNum,
        severity: 'warning',
        message: `Duplicate item id "${sourceId}" — imported as "${canonicalId}".`,
      });
    }
    // R-20: raw actor values are resolved here and never stored.
    const rawActor = mapping.columns.actor ? (row[mapping.columns.actor]?.trim() ?? '') : '';
    items.push({
      id: canonicalId,
      sourceId,
      // A file has no provider scope; see `ImportBatch.scopes`.
      originScopeId: null,
      title: row[mapping.columns.title]?.trim() ?? '',
      stage: { name: status, kind: stageKind },
      actor: mapping.columns.actor
        ? resolveActorValue(rawActor, mapping.actorRoleMap, pseudonymization)
        : { kind: 'missing' },
      createdAt: readDate(row, rowNum, mapping.columns.createdAt, 'createdAt'),
      dueAt: readDate(row, rowNum, mapping.columns.dueAt, 'dueAt'),
      lastUpdatedAt: readDate(row, rowNum, mapping.columns.lastUpdatedAt, 'lastUpdatedAt'),
    });
  });

  let events: WorkItemEvent[] = [];
  if (eventsCsvText !== undefined) {
    if (mapping.events === undefined) {
      throw new ImportError(
        'An event-history file was provided but the mapping template has no "events" section.',
      );
    }
    if (duplicateIdCount > 0) {
      throw new ImportError(
        'Event history cannot be linked safely: the items file contains duplicate item ids, ' +
          'so event references are ambiguous. Fix the item ids or omit the history.',
      );
    }
    events = importEvents(eventsCsvText, mapping, items, diagnostics);
  }

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
    capability: buildCapability(items, events, {
      dueDates: mapping.columns.dueAt !== undefined,
      lastUpdated: mapping.columns.lastUpdatedAt !== undefined,
      actors: mapping.columns.actor !== undefined,
    }),
    evidence: [],
    // A file is one undifferentiated body of work: there is no provider scope
    // to record, and saying so is a fact rather than a gap.
    scopes: [],
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}

/**
 * Event-history import: CSV-specific extraction (header validation, column
 * mapping), then the shared strict validation + deterministic ordering in
 * canonical.ts (Slice 2 Part C semantics; file row = tie-break and `ref`).
 */
function importEvents(
  eventsCsvText: string,
  mapping: MappingTemplate,
  items: readonly WorkItem[],
  diagnostics: ImportDiagnostic[],
): WorkItemEvent[] {
  const eventsMapping = mapping.events;
  if (!eventsMapping) return [];
  const cols = eventsMapping.columns;

  const header = parseHeader(eventsCsvText, 'event-history CSV');
  const mappedColumns = Object.values(cols).filter((c): c is string => c !== undefined);
  validateHeader(header, mappedColumns, 'event-history CSV', diagnostics);

  const records = parse(eventsCsvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const rawEvents: CanonicalEventInput[] = records.map((row, index) => {
    const rowNum = index + 1;
    return {
      itemId: row[cols.itemId]?.trim() ?? '',
      fromStatus: cols.from ? (row[cols.from]?.trim() ?? '') : '',
      toStatus: row[cols.to]?.trim() ?? '',
      at: row[cols.at]?.trim() ?? '',
      ref: `row ${rowNum}`,
      order: rowNum,
    };
  });

  return orderAndValidateEvents(rawEvents, items, mapping.statusMap);
}
