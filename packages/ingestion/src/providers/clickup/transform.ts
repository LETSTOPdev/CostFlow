import type {
  EvidenceNote,
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
  coverageFor,
  orderAndValidateEvents,
  resolveActorValue,
  stageForStatus,
  type CanonicalEventInput,
  type TransformScope,
} from '../../canonical';

/**
 * ClickUp transform (ADR-0005): pure — raw GET /list/{id}/task pages +
 * bulk_time_in_status pages → canonical ImportBatch.
 *
 * Derivation rules (documented, deterministic, never silent):
 *  CU1 — ClickUp exposes per-status residency (time-in-status: each status a
 *        task has held, with the epoch-ms instant it entered it), not a
 *        from→to transition log. The event chain is RECONSTRUCTED: status
 *        entries (status_history + current_status) are ordered by their
 *        `since` instant, the arrival event is {from: null, to: first entry,
 *        at: date_created} (J1 analog — a task exists in some status from
 *        creation), and each later entry becomes a transition from its
 *        predecessor at its own `since`. Every emitted timestamp is a real
 *        observed entry instant. Known documented limitation: a status
 *        revisited N times keeps only its latest entry instant, so bounce
 *        sequences collapse — total residency time is conserved, but time
 *        before the last revisit is attributed to the chain's earlier
 *        statuses. CostFlow therefore never overstates TOTAL wait, though a
 *        bounce can shift hours between adjacent statuses.
 *  CU2 — a task with no time-in-status data gets the J1 minimal derivation:
 *        a single arrival event {from: null, to: current status, at:
 *        date_created}. Nothing is invented.
 *  CU3 — ClickUp tasks are multi-assignee; the canonical model prices one
 *        actor per item. The FIRST listed assignee (ClickUp's primary) is
 *        the actor; additional assignees are counted in a diagnostic, never
 *        silently ignored.
 *  CU4 — a task whose current status is unmapped is dropped with a
 *        diagnostic and takes its history with it; a status-history entry
 *        referencing an unmapped status is a hard error (same asymmetry as
 *        J3/D-13).
 *  CU5 — a page whose `last_page` is false (or which is full) with no
 *        following page provided is a hard error (J2 analog): history is
 *        never silently truncated.
 *
 * Timestamps: ClickUp serializes instants as epoch-millisecond strings; they
 * are converted to canonical ISO-8601 UTC (deterministic, timezone-free).
 * Fields ClickUp offers but no detector consumes (priority, time_estimate,
 * points, custom fields, parent/subtask links, comments) are deliberately
 * NOT canonicalized: the canonical model carries exactly what the engine
 * prices, and widening it is an engine-versioned decision, not a connector
 * decision. The raw pages retain everything for a future re-import.
 */
export interface ClickUpMapping {
  readonly id: string;
  readonly version: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
}

export interface ClickUpTransformInput {
  readonly batchId: string;
  /** Raw GET /api/v2/list/{id}/task pages, verbatim, in fetch order. */
  readonly taskPages: readonly string[];
  /** Raw GET /api/v2/task/bulk_time_in_status pages, verbatim, in fetch order. */
  readonly timeInStatusPages?: readonly string[] | undefined;
  /**
   * Raw single-task GET /api/v2/task/{id}/time_in_status documents keyed by
   * task id (the bulk endpoint requires two or more ids, so a lone task is
   * fetched singly — same external-keying precedent as Jira's supplementary
   * changelogs).
   */
  readonly singleTimeInStatusByTask?: Readonly<Record<string, string>> | undefined;
  readonly mapping: ClickUpMapping;
  /** Which List these pages came from, when the caller knows (multi-scope runs). */
  readonly scope?: TransformScope | undefined;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

interface ClickUpStatusRef {
  readonly status?: string | null;
  readonly type?: string | null;
}
interface ClickUpAssignee {
  readonly username?: string | null;
  readonly email?: string | null;
}
/** ClickUp serializes epochs and order indexes as strings OR numbers. */
type StringOrNumber = string | number;
interface ClickUpTask {
  readonly id?: string;
  readonly name?: string | null;
  readonly status?: ClickUpStatusRef | null;
  readonly date_created?: StringOrNumber | null;
  readonly date_updated?: StringOrNumber | null;
  readonly due_date?: StringOrNumber | null;
  readonly assignees?: readonly ClickUpAssignee[];
}
interface ClickUpTimeTotal {
  readonly since?: StringOrNumber | null;
}
interface ClickUpStatusEntry {
  readonly status?: string | null;
  readonly orderindex?: StringOrNumber;
  readonly total_time?: ClickUpTimeTotal | null;
}
interface ClickUpTimeInStatus {
  readonly current_status?: ClickUpStatusEntry | null;
  readonly status_history?: readonly ClickUpStatusEntry[];
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ImportError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Epoch-ms value (string or number) → canonical ISO instant; garbage → null. */
function epochMsToIso(value: StringOrNumber | null | undefined): IsoDateString | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : /^-?\d+$/.test(value) ? Number(value) : NaN;
  // Beyond ±8.64e15 ms, Date.toISOString throws (RangeError) — a corrupt
  // raw value must degrade to a diagnostic, never crash the transform.
  if (!Number.isSafeInteger(ms) || Math.abs(ms) > 8.64e15) return null;
  return new Date(ms).toISOString();
}

const orderIndexOf = (value: StringOrNumber | undefined): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function transformClickUp(input: ClickUpTransformInput): ImportBatch {
  const {
    batchId,
    taskPages,
    timeInStatusPages,
    singleTimeInStatusByTask,
    mapping,
    scope,
    importedAt,
    pseudonymization,
  } = input;
  if (taskPages.length === 0) {
    throw new ImportError('ClickUp transform received no task pages.');
  }

  const tasks: ClickUpTask[] = [];
  taskPages.forEach((pageText, index) => {
    const doc = parseJson(pageText, `ClickUp task page ${index}`) as {
      tasks?: ClickUpTask[];
      last_page?: boolean;
    };
    if (!Array.isArray(doc.tasks)) {
      throw new ImportError(`ClickUp task page ${index} has no "tasks" array.`);
    }
    // CU5: a non-final page must be followed by another page.
    if (doc.last_page === false && index === taskPages.length - 1) {
      throw new ImportError(
        `ClickUp task page ${index} is not the last page but no following page was provided — ` +
          'the import is never silently truncated.',
      );
    }
    tasks.push(...doc.tasks);
  });

  // Merge residency documents: bulk pages (keyed by task id in the body) and
  // single-task documents (keyed externally).
  const historyByTask = new Map<string, ClickUpTimeInStatus>();
  (timeInStatusPages ?? []).forEach((pageText, index) => {
    const doc = parseJson(pageText, `ClickUp time-in-status page ${index}`) as Record<
      string,
      ClickUpTimeInStatus
    >;
    for (const [taskId, entry] of Object.entries(doc)) {
      if (entry && typeof entry === 'object') historyByTask.set(taskId, entry);
    }
  });
  for (const [taskId, pageText] of Object.entries(singleTimeInStatusByTask ?? {})) {
    const doc = parseJson(pageText, `ClickUp time-in-status for ${taskId}`) as ClickUpTimeInStatus;
    if (doc && typeof doc === 'object') historyByTask.set(taskId, doc);
  }

  const diagnostics: ImportDiagnostic[] = [];
  const items: WorkItem[] = [];
  const rawEvents: CanonicalEventInput[] = [];
  const seenIds = new Set<string>();
  let order = 0;
  let extraAssignees = 0;
  // Evidence-quality bookkeeping (doc 21): how many imported items had their
  // transition chain reconstructed from residency data (CU1) versus none at all
  // (CU2). Counted here because this is the only place the distinction exists.
  let itemsWithResidency = 0;
  let itemsWithoutResidency = 0;

  const readEpoch = (
    value: StringOrNumber | null | undefined,
    id: string,
    field: string,
    row: number,
  ): IsoDateString | null => {
    if (value === null || value === undefined || value === '') return null;
    const iso = epochMsToIso(value);
    if (iso === null || parseIsoUtc(iso) === null) {
      diagnostics.push({
        row,
        severity: 'warning',
        message: `Unparseable ${field} "${value}" on ${id} — field ignored.`,
      });
      return null;
    }
    return iso;
  };

  tasks.forEach((task, index) => {
    const row = index + 1;
    const id = task.id ?? `task-${row}`;
    // Defensive: ClickUp can surface a task in more than one list
    // (tasks-in-multiple-lists); a duplicate id would break canonical
    // uniqueness, so later occurrences are dropped visibly.
    if (seenIds.has(id)) {
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Duplicate task id "${id}" — row dropped (already imported).`,
      });
      return;
    }
    seenIds.add(id);

    const statusName = (task.status?.status ?? '').trim();
    const stage = stageForStatus(statusName, mapping.statusMap);
    if (stage === null) {
      // CU4: the drop takes the task's residency history with it.
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Status "${statusName}" is not mapped to a stage kind — row dropped.`,
      });
      return;
    }

    const assignees = task.assignees ?? [];
    if (assignees.length > 1) extraAssignees += assignees.length - 1;
    const rawActor = (assignees[0]?.username ?? assignees[0]?.email ?? '').trim();
    const actor = resolveActorValue(rawActor, mapping.actorRoleMap, pseudonymization);

    const createdAt = readEpoch(task.date_created, id, 'date_created', row);
    items.push({
      id,
      sourceId: id,
      title: (task.name ?? '').trim(),
      stage,
      actor,
      createdAt,
      dueAt: readEpoch(task.due_date, id, 'due_date', row),
      lastUpdatedAt: readEpoch(task.date_updated, id, 'date_updated', row),
    });

    if (createdAt === null) return; // no anchor instant — no derivable events

    // CU1/CU2: reconstruct the entry chain from residency data.
    const residency = historyByTask.get(id);
    if (residency) itemsWithResidency += 1;
    else itemsWithoutResidency += 1;
    const collected: { status: string; atMs: number; at: string; orderindex: number }[] = [];
    if (residency) {
      const push = (entry: ClickUpStatusEntry | null | undefined): void => {
        const status = (entry?.status ?? '').trim();
        const iso = epochMsToIso(entry?.total_time?.since ?? null);
        if (status === '' || iso === null) return;
        const atMs = parseIsoUtc(iso);
        if (atMs === null) return;
        collected.push({ status, atMs, at: iso, orderindex: orderIndexOf(entry?.orderindex) });
      };
      for (const entry of residency.status_history ?? []) push(entry);
      push(residency.current_status);
      collected.sort((a, b) => a.atMs - b.atMs || a.orderindex - b.orderindex);
    }
    // A status can appear in both history and current (or twice after a
    // bounce); consecutive duplicates carry no transition.
    const entries: typeof collected = [];
    for (const entry of collected) {
      if (entries[entries.length - 1]?.status !== entry.status) entries.push(entry);
    }

    const firstStatus = entries[0]?.status ?? statusName;
    if (firstStatus !== '') {
      rawEvents.push({
        itemId: id,
        fromStatus: '',
        toStatus: firstStatus,
        at: createdAt,
        ref: `${id} arrival`,
        order: order++,
      });
    }
    for (let i = 1; i < entries.length; i += 1) {
      const previous = entries[i - 1] as (typeof entries)[number];
      const entry = entries[i] as (typeof entries)[number];
      rawEvents.push({
        itemId: id,
        fromStatus: previous.status,
        toStatus: entry.status,
        at: entry.at,
        ref: `${id} entry ${i}`,
        order: order++,
      });
    }
  });

  if (extraAssignees > 0) {
    diagnostics.push({
      row: 0,
      severity: 'warning',
      message: `${extraAssignees} additional assignee(s) beyond the primary were not imported (CU3: one actor per item).`,
    });
  }

  const events = orderAndValidateEvents(rawEvents, items, mapping.statusMap);

  /**
   * Evidence quality (doc 21). Both notes describe the same subject — the event
   * stream — and both are `derived`/`partial` rather than a new vocabulary
   * member, because the platform quirk is the MECHANISM, not the problem.
   *
   * Ordering is fixed rather than data-dependent, so the artifact stays
   * byte-deterministic for identical inputs.
   */
  const evidence: EvidenceNote[] = [];
  if (itemsWithResidency > 0) {
    evidence.push({
      weakness: 'derived-not-observed',
      subject: 'events',
      detail:
        'Repeated visits to the same status are collapsed by the source platform, so ' +
        'individual transitions cannot be reconstructed exactly. Total time is conserved; ' +
        'time can shift between adjacent statuses.',
    });
  }
  if (itemsWithoutResidency > 0) {
    evidence.push({
      weakness: 'partial-coverage',
      subject: 'events',
      detail:
        `${itemsWithoutResidency} of ${items.length} imported item(s) had no status history, ` +
        'so their only event is creation and time spent in individual statuses was not observed.',
    });
  }

  return {
    id: batchId,
    provider: 'clickup',
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: tasks.length,
      imported: items.length,
      dropped: tasks.length - items.length,
    },
    diagnostics,
    capability: buildCapability(items, events, { dueDates: true, lastUpdated: true, actors: true }),
    evidence,
    scopes: coverageFor(scope, items.length),
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}

/**
 * Observed vocabulary for the mapping UI (pure; shared by web gateway + CLI):
 * every status name a run could encounter — current task statuses plus every
 * residency entry (CU4 makes an unmapped HISTORY status a hard error, so the
 * mapping form must present all of them) — every primary assignee, per-status
 * stage hints from ClickUp's own status `type` metadata (open → queue,
 * done/closed → done; custom carries no signal), and the task count.
 */
export function observeClickUpPages(
  taskPages: readonly string[],
  timeInStatusPages: readonly string[],
): {
  statuses: string[];
  actors: string[];
  statusHints: Record<string, StageKind>;
  itemCount: number;
} {
  const statuses = new Set<string>();
  const actors = new Set<string>();
  const hints: Record<string, StageKind> = {};
  let itemCount = 0;
  const hintFor = (type: string | null | undefined): StageKind | null => {
    if (type === 'open') return 'queue';
    if (type === 'done' || type === 'closed') return 'done';
    return null;
  };
  for (const pageText of taskPages) {
    const doc = JSON.parse(pageText) as { tasks?: ClickUpTask[] };
    for (const task of doc.tasks ?? []) {
      itemCount += 1;
      const status = (task.status?.status ?? '').trim();
      if (status !== '') {
        statuses.add(status);
        const hint = hintFor(task.status?.type);
        if (hint !== null) hints[status] = hint;
      }
      const assignee = (task.assignees?.[0]?.username ?? '').trim();
      if (assignee !== '') actors.add(assignee);
    }
  }
  const collectResidency = (entry: ClickUpTimeInStatus | null | undefined): void => {
    if (!entry || typeof entry !== 'object') return;
    const all = [...(entry.status_history ?? []), entry.current_status];
    for (const statusEntry of all) {
      const status = (statusEntry?.status ?? '').trim();
      if (status !== '') statuses.add(status);
    }
  };
  for (const pageText of timeInStatusPages) {
    const doc = JSON.parse(pageText) as
      | (Record<string, ClickUpTimeInStatus> & {
          status_history?: unknown;
          current_status?: unknown;
        })
      | null;
    if (!doc || typeof doc !== 'object') continue;
    // A single-task document has the residency keys at top level; a bulk page
    // is a map keyed by task id.
    if (doc.status_history !== undefined || doc.current_status !== undefined) {
      collectResidency(doc as ClickUpTimeInStatus);
    } else {
      for (const entry of Object.values(doc)) collectResidency(entry as ClickUpTimeInStatus);
    }
  }
  return {
    statuses: [...statuses].sort(),
    actors: [...actors].sort(),
    statusHints: hints,
    itemCount,
  };
}
