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
import { buildCapability, resolveActorValue, stageForStatus } from '../../canonical';

/**
 * ClickUp transform (doc 18 §5): pure — raw REST v2 task-page JSON strings
 * (grouped by list) → canonical ImportBatch. Grounded in the cu01 partner run
 * (doc 09 M1): a real production workspace established what ClickUp actually
 * delivers, and these rules encode it.
 *
 * Derivation rules (documented, deterministic, never silent):
 *  CU1 — ClickUp timestamps are millisecond-epoch STRINGS; they are converted
 *        to ISO-8601 UTC deterministically. An unparseable value is a warning
 *        diagnostic and the field is ignored (same posture as Jira dates).
 *  CU2 — pagination completeness is verified: each list's final page must
 *        declare `last_page: true`, else the transform refuses (J2 analog —
 *        history and items are never silently truncated).
 *  CU3 — multi-assignee tasks (14% of tasks in cu01): the primary actor is
 *        the assignee with the LOWEST user id (deterministic), with a
 *        diagnostic counting the unattributed assignees. Single-actor is the
 *        known PP-2 domain simplification (doc 09 P2).
 *  CU4 — ClickUp's standard API exposes NO ordered status transitions
 *        (Time-in-Status is plan-gated and aggregate-only — M1 finding), so
 *        the batch carries zero events, structurally. Event-history detectors
 *        skip visibly; nothing is invented from missing data.
 *  CU5 — a task whose current status is unmapped is dropped with a diagnostic
 *        (the same current-status semantics as Jira J3).
 *  CU6 — subtasks are first-class work items (own id, status, dates); the
 *        parent link stays in the raw documents, unmapped (no canonical field).
 *  CU7 — closed/done tasks are imported as terminal-stage items so counts stay
 *        honest and future completed-at work has its raw data.
 *  CU8 — a task appearing in more than one list (ClickUp "tasks in multiple
 *        lists") is imported once — first occurrence in deterministic list
 *        order — with a warning diagnostic; it is counted once in totalRows.
 */
export interface ClickUpMapping {
  readonly id: string;
  readonly version: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  /** Keys are ClickUp usernames (the value shown in the mapping step). */
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
}

export interface ClickUpTransformInput {
  readonly batchId: string;
  /** Raw /list/{id}/task page documents, verbatim, keyed by list id, in page order. */
  readonly taskPagesByList: Readonly<Record<string, readonly string[]>>;
  readonly mapping: ClickUpMapping;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

interface ClickUpAssignee {
  readonly id?: string | number;
  readonly username?: string | null;
}
interface ClickUpTask {
  readonly id?: string | number;
  readonly name?: string | null;
  readonly status?: { readonly status?: string | null } | null;
  readonly assignees?: readonly ClickUpAssignee[];
  readonly date_created?: string | number | null;
  readonly date_updated?: string | number | null;
  readonly due_date?: string | number | null;
}
interface ClickUpTasksDoc {
  readonly tasks?: readonly ClickUpTask[];
  readonly last_page?: boolean;
}

function parsePage(text: string, label: string): ClickUpTasksDoc {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new ImportError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray((doc as ClickUpTasksDoc).tasks)) {
    throw new ImportError(`${label} has no "tasks" array.`);
  }
  return doc as ClickUpTasksDoc;
}

/** CU3: deterministic primary assignee — lowest user id (numeric when possible). */
function primaryAssignee(assignees: readonly ClickUpAssignee[]): ClickUpAssignee | undefined {
  return [...assignees].sort((a, b) => {
    const an = Number(a.id);
    const bn = Number(b.id);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  })[0];
}

export function transformClickUp(input: ClickUpTransformInput): ImportBatch {
  const { batchId, taskPagesByList, mapping, importedAt, pseudonymization } = input;
  const listIds = Object.keys(taskPagesByList).sort();
  if (listIds.length === 0 || listIds.every((id) => taskPagesByList[id]?.length === 0)) {
    throw new ImportError('ClickUp transform received no task pages.');
  }

  const diagnostics: ImportDiagnostic[] = [];
  const items: WorkItem[] = [];
  const seenTaskIds = new Set<string>();
  let row = 0;

  // CU1: millisecond-epoch string/number → ISO-8601 UTC; bad values warn + null.
  const readEpoch = (
    value: string | number | null | undefined,
    key: string,
    field: string,
    taskRow: number,
  ): IsoDateString | null => {
    if (value === null || value === undefined || value === '') return null;
    const ms = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : Number.NaN;
    // Beyond ±8.64e15 ms, Date.toISOString throws (Invalid Date) — a corrupt
    // raw value must degrade to a diagnostic, never crash the transform.
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
      diagnostics.push({
        row: taskRow,
        severity: 'warning',
        message: `Unparseable ${field} "${String(value)}" on ${key} — field ignored.`,
      });
      return null;
    }
    const iso = new Date(ms).toISOString();
    return parseIsoUtc(iso) === null ? null : iso;
  };

  for (const listId of listIds) {
    const pages = taskPagesByList[listId] ?? [];
    pages.forEach((page, pageIndex) => {
      const doc = parsePage(page, `ClickUp task page ${pageIndex} for list ${listId}`);
      // CU2: the final page must declare itself final — refuse truncation.
      if (pageIndex === pages.length - 1 && doc.last_page !== true) {
        throw new ImportError(
          `ClickUp task pages for list ${listId} are truncated (final page lacks ` +
            '"last_page": true). Fetch every page — items are never silently truncated.',
        );
      }

      for (const task of doc.tasks ?? []) {
        const key = task.id !== undefined && task.id !== null ? String(task.id) : '';
        if (key === '') {
          row += 1;
          diagnostics.push({
            row,
            severity: 'dropped',
            message: `A task on page ${pageIndex} of list ${listId} has no id — row dropped.`,
          });
          continue;
        }
        // CU8: multi-list duplicates are imported once, counted once.
        if (seenTaskIds.has(key)) {
          diagnostics.push({
            row: row + 1,
            severity: 'warning',
            message: `Task "${key}" appears in more than one list — imported once.`,
          });
          continue;
        }
        seenTaskIds.add(key);
        row += 1;

        const statusName = (task.status?.status ?? '').trim();
        const stage = stageForStatus(statusName, mapping.statusMap);
        if (stage === null) {
          // CU5: unmapped current status drops the row, visibly.
          diagnostics.push({
            row,
            severity: 'dropped',
            message: `Status "${statusName}" is not mapped to a stage kind — row dropped.`,
          });
          continue;
        }

        const assignees = task.assignees ?? [];
        if (assignees.length > 1) {
          diagnostics.push({
            row,
            severity: 'warning',
            message:
              `Task "${key}" has ${assignees.length} assignees — attributed to the ` +
              `deterministic primary (lowest user id); ${assignees.length - 1} not attributed.`,
          });
        }
        const rawActor = (primaryAssignee(assignees)?.username ?? '').trim();
        const actor = resolveActorValue(rawActor, mapping.actorRoleMap, pseudonymization);

        items.push({
          id: key,
          sourceId: key,
          title: (task.name ?? '').trim(),
          stage,
          actor,
          createdAt: readEpoch(task.date_created, key, 'date_created', row),
          dueAt: readEpoch(task.due_date, key, 'due_date', row),
          lastUpdatedAt: readEpoch(task.date_updated, key, 'date_updated', row),
        });
      }
    });
  }

  return {
    id: batchId,
    provider: 'clickup',
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: row,
      imported: items.length,
      dropped: row - items.length,
    },
    diagnostics,
    // CU4: no events, structurally — hasEventHistory is false by construction.
    capability: buildCapability(items, [], { dueDates: true, lastUpdated: true, actors: true }),
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events: [],
  };
}
