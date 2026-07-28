import type {
  ImportBatch,
  ImportDiagnostic,
  IsoDateString,
  PseudonymizationContext,
  StageKind,
  WorkItem,
} from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';
import { ImportError } from '../../errors';
import {
  buildCapability,
  orderAndValidateEvents,
  resolveActorValue,
  stageForStatus,
  type CanonicalEventInput,
} from '../../canonical';

/**
 * monday.com transform (doc 15 P2): pure — raw GraphQL items_page response
 * documents (+ optional activity_logs pages) → canonical ImportBatch.
 *
 * Derivation rules (doc 09 P2, frozen before code):
 *  M1 — monday has no first-class status; mapping.statusColumnId designates
 *       the status column and statusMap keys are its labels.
 *  M2 — activity_logs timestamps are UNIX time in 100-nanosecond units
 *       (17 digits); converted deterministically: ms = floor(n / 10^4).
 *  M3 — people columns hold many persons; the item's actor is the FIRST
 *       person listed (source order). Deterministic, documented pressure on
 *       the domain model's single-actor assumption (PP-2).
 *  M4 — monday's API cannot attest history completeness (no Jira-style
 *       changelog.total); the CUSTOMER attests via
 *       mapping.activityLogsComplete. Not attested → items only, a file
 *       diagnostic, and no events (F1 honestly skipped) — never a possibly-
 *       truncated history presented as complete.
 *  M6 — the activity log is board-scoped, so entries can reference items
 *       absent from the snapshot (deleted/archived): excluded with a counted
 *       file diagnostic. Entries for dropped items go with their items (J3).
 *  J1 applies unchanged: arrival at created_at into the previous label of
 *       the first status transition, else the current status.
 */
export interface MondayMapping {
  readonly id: string;
  readonly version: string;
  /** M1: which column is the status column. */
  readonly statusColumnId: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  readonly peopleColumnId?: string | undefined;
  readonly dueDateColumnId?: string | undefined;
  /** M4: customer attestation that the activity log covers full board history. */
  readonly activityLogsComplete: boolean;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
}

export interface MondayTransformInput {
  readonly batchId: string;
  /** Raw GraphQL items_page response documents, verbatim, in fetch order. */
  readonly itemsPages: readonly string[];
  /** Raw GraphQL activity_logs response documents, verbatim, in fetch order. */
  readonly activityPages?: readonly string[] | undefined;
  readonly mapping: MondayMapping;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

interface MondayColumnValue {
  readonly id?: string;
  readonly text?: string | null;
}
interface MondayItem {
  readonly id?: string | number;
  readonly name?: string | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
  readonly column_values?: readonly MondayColumnValue[];
}
interface MondayActivityEntry {
  readonly event?: string;
  readonly created_at?: string | number;
  /** JSON-encoded string per monday's API. */
  readonly data?: string;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ImportError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

/** M2: 17-digit 100ns-unit UNIX time → ISO-8601; unparseable input surfaces verbatim. */
export function mondayActivityTimestampToIso(value: string | number | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? Number.NaN);
  if (!Number.isFinite(n) || n <= 0) return String(value ?? '');
  return new Date(Math.floor(n / 10_000)).toISOString();
}

/** M3: first person listed in a people column's text ("A, B" → "A"). */
function firstPerson(text: string): string {
  const first = text.split(',')[0] ?? '';
  return first.trim();
}

export function transformMonday(input: MondayTransformInput): ImportBatch {
  const { batchId, itemsPages, activityPages, mapping, importedAt, pseudonymization } = input;
  if (itemsPages.length === 0) {
    throw new ImportError('monday transform received no items pages.');
  }

  const rawItems: MondayItem[] = [];
  itemsPages.forEach((page, index) => {
    const doc = parseJson(page, `monday items page ${index}`) as {
      data?: {
        boards?: { items_page?: { items?: MondayItem[] } }[];
        /** Continuation pages arrive via the root-level next_items_page query. */
        next_items_page?: { items?: MondayItem[] };
      };
    };
    const boards = doc.data?.boards;
    if (Array.isArray(boards)) {
      for (const board of boards) {
        rawItems.push(...(board.items_page?.items ?? []));
      }
    } else if (doc.data?.next_items_page !== undefined) {
      rawItems.push(...(doc.data.next_items_page.items ?? []));
    } else {
      throw new ImportError(
        `monday items page ${index} has neither "data.boards" nor "data.next_items_page".`,
      );
    }
  });

  const diagnostics: ImportDiagnostic[] = [];
  const items: WorkItem[] = [];
  const droppedIds = new Set<string>();

  const readDate = (
    value: string | null | undefined,
    id: string,
    field: string,
    row: number,
  ): IsoDateString | null => {
    if (value === null || value === undefined || value === '') return null;
    if (parseIsoUtc(value) === null) {
      diagnostics.push({
        row,
        severity: 'warning',
        message: `Unparseable ${field} "${value}" on item ${id} — field ignored.`,
      });
      return null;
    }
    return value;
  };

  rawItems.forEach((raw, index) => {
    const row = index + 1;
    const id = String(raw.id ?? `item-${row}`);
    const columns = raw.column_values ?? [];
    const columnText = (columnId: string | undefined): string =>
      columnId === undefined ? '' : (columns.find((c) => c.id === columnId)?.text ?? '').trim();

    const statusLabel = columnText(mapping.statusColumnId);
    const stage = stageForStatus(statusLabel, mapping.statusMap);
    if (stage === null) {
      droppedIds.add(id);
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Status "${statusLabel}" is not mapped to a stage kind — row dropped.`,
      });
      return; // M6/J3: its activity entries go with it.
    }

    const rawActor = firstPerson(columnText(mapping.peopleColumnId));
    items.push({
      id,
      sourceId: id,
      title: (raw.name ?? '').trim(),
      stage,
      actor:
        mapping.peopleColumnId === undefined
          ? { kind: 'missing' }
          : resolveActorValue(rawActor, mapping.actorRoleMap, pseudonymization),
      createdAt: readDate(raw.created_at, id, 'created_at', row),
      dueAt: readDate(columnText(mapping.dueDateColumnId) || null, id, 'due date', row),
      lastUpdatedAt: readDate(raw.updated_at, id, 'updated_at', row),
    });
  });

  const rawEvents: CanonicalEventInput[] = [];
  if ((activityPages?.length ?? 0) > 0 && !mapping.activityLogsComplete) {
    // M4: unattested history is items-only, never a maybe-truncated timeline.
    diagnostics.push({
      row: 0,
      severity: 'warning',
      message:
        'Activity logs are not attested complete (activityLogsComplete: false) — event history ' +
        'omitted; detectors that need events will be skipped rather than run on partial history.',
    });
  } else if ((activityPages?.length ?? 0) > 0) {
    const itemIds = new Set(items.map((i) => i.id));
    const transitionsByItem = new Map<
      string,
      { fromStatus: string; toStatus: string; at: string }[]
    >();
    let outsideSnapshot = 0;

    (activityPages ?? []).forEach((page, index) => {
      const doc = parseJson(page, `monday activity page ${index}`) as {
        data?: { boards?: { activity_logs?: MondayActivityEntry[] }[] };
      };
      const boards = doc.data?.boards;
      if (!Array.isArray(boards)) {
        throw new ImportError(`monday activity page ${index} has no "data.boards" array.`);
      }
      for (const board of boards) {
        for (const entry of board.activity_logs ?? []) {
          if (entry.event !== 'update_column_value') continue;
          const data = parseJson(
            entry.data ?? '{}',
            `monday activity entry data (page ${index})`,
          ) as {
            pulse_id?: number | string;
            column_id?: string;
            value?: { label?: { text?: string | null } | null } | null;
            previous_value?: { label?: { text?: string | null } | null } | null;
          };
          if (data.column_id !== mapping.statusColumnId) continue;
          const itemId = String(data.pulse_id ?? '');
          if (droppedIds.has(itemId)) continue; // J3: dropped items take their events.
          if (!itemIds.has(itemId)) {
            outsideSnapshot += 1; // M6: deleted/archived items' history is out of scope.
            continue;
          }
          const list = transitionsByItem.get(itemId) ?? [];
          list.push({
            fromStatus: (data.previous_value?.label?.text ?? '').trim(),
            toStatus: (data.value?.label?.text ?? '').trim(),
            at: mondayActivityTimestampToIso(entry.created_at),
          });
          transitionsByItem.set(itemId, list);
        }
      }
    });

    if (outsideSnapshot > 0) {
      diagnostics.push({
        row: 0,
        severity: 'warning',
        message: `${outsideSnapshot} activity entr${outsideSnapshot === 1 ? 'y' : 'ies'} reference item(s) outside the snapshot — excluded (deleted or archived items).`,
      });
    }

    let order = 0;
    for (const item of items) {
      const transitions = (transitionsByItem.get(item.id) ?? []).sort(
        (a, b) => (parseIsoUtc(a.at) ?? Number.NaN) - (parseIsoUtc(b.at) ?? Number.NaN),
      );
      // J1: arrival from created_at + the initial status (first transition's
      // previous label, else current). An empty previous label means the
      // status was unset before the first transition — no arrival is derived
      // and the time before the first event stays unattributed (honest).
      if (item.createdAt !== null) {
        const initialStatus = transitions.length > 0 ? transitions[0]?.fromStatus : item.stage.name;
        if (initialStatus && initialStatus !== '') {
          rawEvents.push({
            itemId: item.id,
            fromStatus: '',
            toStatus: initialStatus,
            at: item.createdAt,
            ref: `item ${item.id} arrival`,
            order: order++,
          });
        }
      }
      transitions.forEach((transition, transitionIndex) => {
        rawEvents.push({
          itemId: item.id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          at: transition.at,
          ref: `item ${item.id} activity ${transitionIndex + 1}`,
          order: order++,
        });
      });
    }
  }

  const events = orderAndValidateEvents(rawEvents, items, mapping.statusMap);

  return {
    id: batchId,
    provider: 'monday',
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: rawItems.length,
      imported: items.length,
      dropped: rawItems.length - items.length,
    },
    diagnostics,
    capability: buildCapability(items, events, {
      dueDates: mapping.dueDateColumnId !== undefined,
      lastUpdated: true,
      actors: mapping.peopleColumnId !== undefined,
    }),
    evidence: [],
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}
