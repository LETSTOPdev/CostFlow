import { parse } from 'csv-parse/sync';
import type {
  ActorRef,
  ImportBatch,
  ImportDiagnostic,
  IsoDateString,
  PseudonymizationContext,
  WorkItem,
  WorkItemEvent,
} from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';
import type { MappingTemplate } from '../../mapping-template';

export const CSV_PROVIDER = 'csv';

/**
 * Structural problems with the file itself (not row-level data quality).
 * These fail the import loudly: proceeding would misread the file while
 * looking healthy (R-04/R-05), or silently repair an ambiguous history
 * (Slice 2 Part C).
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
    throw new CsvImportError(`${label} has no header row.`);
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
    throw new CsvImportError(
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
    throw new CsvImportError(
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
 * Pure: strings in, batch out.
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

  // R-20: raw actor values are resolved here and never stored. Mapped → role;
  // unmapped → deterministic pseudonym (never a guessed role); empty → missing.
  const resolveActor = (rawValue: string): ActorRef => {
    if (rawValue === '') return { kind: 'missing' };
    const roleRef = mapping.actorRoleMap?.[rawValue];
    if (roleRef !== undefined) return { kind: 'role', roleRef };
    if (!pseudonymization) {
      throw new CsvImportError(
        'The file contains actor values that are not in actorRoleMap, and no pseudonymization ' +
          'context was provided. Supply one (CLI: --org and --salt-file) or complete the mapping.',
      );
    }
    return { kind: 'unknown', pseudonym: pseudonymization.pseudonymFor(rawValue) };
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
    const rawActor = mapping.columns.actor ? (row[mapping.columns.actor]?.trim() ?? '') : '';
    items.push({
      id: canonicalId,
      sourceId,
      title: row[mapping.columns.title]?.trim() ?? '',
      stage: { name: status, kind: stageKind },
      actor: mapping.columns.actor ? resolveActor(rawActor) : { kind: 'missing' },
      createdAt: readDate(row, rowNum, mapping.columns.createdAt, 'createdAt'),
      dueAt: readDate(row, rowNum, mapping.columns.dueAt, 'dueAt'),
      lastUpdatedAt: readDate(row, rowNum, mapping.columns.lastUpdatedAt, 'lastUpdatedAt'),
    });
  });

  let events: WorkItemEvent[] = [];
  if (eventsCsvText !== undefined) {
    if (mapping.events === undefined) {
      throw new CsvImportError(
        'An event-history file was provided but the mapping template has no "events" section.',
      );
    }
    if (duplicateIdCount > 0) {
      throw new CsvImportError(
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
    capability: {
      hasEventHistory: events.length > 0,
      hasDueDates: mapping.columns.dueAt !== undefined && items.some((i) => i.dueAt !== null),
      hasLastUpdated:
        mapping.columns.lastUpdatedAt !== undefined && items.some((i) => i.lastUpdatedAt !== null),
      hasActors:
        mapping.columns.actor !== undefined && items.some((i) => i.actor.kind !== 'missing'),
    },
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}

/**
 * STRICT event-history validation (Slice 2 Part C req 3/5): unknown items,
 * bad timestamps, unmapped statuses, chain mismatches, and events before item
 * creation are hard errors. Ambiguous histories are rejected, never repaired.
 * Deterministic ordering: per item by (timestamp, file row) — file row breaks
 * exact timestamp ties, documented, not silent.
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

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const fail = (problems: string[], kind: string): never => {
    const shown = problems.slice(0, 5);
    const suffix = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    throw new CsvImportError(`Event history is invalid — ${kind}: ${shown.join('; ')}${suffix}.`);
  };

  interface RawEvent {
    readonly rowNum: number;
    readonly itemId: string;
    readonly fromStatus: string;
    readonly toStatus: string;
    readonly at: string;
    readonly atMs: number;
  }

  const unknownItems: string[] = [];
  const badTimestamps: string[] = [];
  const unmappedStatuses = new Set<string>();
  const beforeCreation: string[] = [];

  const rawEvents: RawEvent[] = records.map((row, index) => {
    const rowNum = index + 1;
    const itemId = row[cols.itemId]?.trim() ?? '';
    const fromStatus = cols.from ? (row[cols.from]?.trim() ?? '') : '';
    const toStatus = row[cols.to]?.trim() ?? '';
    const at = row[cols.at]?.trim() ?? '';
    const atMs = parseIsoUtc(at) ?? Number.NaN;

    if (!itemsById.has(itemId)) unknownItems.push(`row ${rowNum} references "${itemId}"`);
    if (Number.isNaN(atMs)) badTimestamps.push(`row ${rowNum} has timestamp "${at}"`);
    if (mapping.statusMap[toStatus] === undefined) unmappedStatuses.add(toStatus);
    if (fromStatus !== '' && mapping.statusMap[fromStatus] === undefined) {
      unmappedStatuses.add(fromStatus);
    }
    return { rowNum, itemId, fromStatus, toStatus, at, atMs };
  });

  if (unknownItems.length > 0) fail(unknownItems, 'unknown work item(s)');
  if (badTimestamps.length > 0) fail(badTimestamps, 'unparseable timestamp(s)');
  if (unmappedStatuses.size > 0) {
    fail(
      [...unmappedStatuses].sort().map((s) => `"${s}" is not in statusMap`),
      'unmapped status(es)',
    );
  }

  for (const event of rawEvents) {
    const item = itemsById.get(event.itemId);
    if (item?.createdAt) {
      const createdMs = parseIsoUtc(item.createdAt);
      if (createdMs !== null && event.atMs < createdMs) {
        beforeCreation.push(
          `row ${event.rowNum}: event at ${event.at} precedes item "${event.itemId}" creation (${item.createdAt})`,
        );
      }
    }
  }
  if (beforeCreation.length > 0) fail(beforeCreation, 'event(s) before item creation');

  // Deterministic per-item ordering, then from-chain consistency.
  const byItem = new Map<string, RawEvent[]>();
  for (const event of rawEvents) {
    const list = byItem.get(event.itemId) ?? [];
    list.push(event);
    byItem.set(event.itemId, list);
  }
  const chainErrors: string[] = [];
  const ordered: WorkItemEvent[] = [];
  const sortedItemIds = [...byItem.keys()].sort();
  for (const itemId of sortedItemIds) {
    const list = (byItem.get(itemId) as RawEvent[]).sort(
      (a, b) => a.atMs - b.atMs || a.rowNum - b.rowNum,
    );
    list.forEach((event, position) => {
      if (position > 0 && event.fromStatus !== '') {
        const previous = list[position - 1] as RawEvent;
        if (event.fromStatus !== previous.toStatus) {
          chainErrors.push(
            `item "${itemId}" row ${event.rowNum}: from "${event.fromStatus}" does not match previous stage "${previous.toStatus}"`,
          );
        }
      }
      const toKind = mapping.statusMap[event.toStatus];
      const fromKind = event.fromStatus === '' ? undefined : mapping.statusMap[event.fromStatus];
      if (toKind === undefined) return; // unreachable: validated above
      ordered.push({
        workItemId: itemId,
        from:
          event.fromStatus === '' || fromKind === undefined
            ? null
            : { name: event.fromStatus, kind: fromKind },
        to: { name: event.toStatus, kind: toKind },
        at: event.at,
      });
    });
  }
  if (chainErrors.length > 0) fail(chainErrors, 'inconsistent transition(s)');

  return ordered;
}
