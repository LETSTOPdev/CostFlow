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
  coverageFor,
  orderAndValidateEvents,
  resolveActorValue,
  stageForStatus,
  type CanonicalEventInput,
  type TransformScope,
} from '../../canonical';

/**
 * Asana transform (doc 15 P2): pure — raw project-task pages + per-task
 * stories pages + the project's sections document → canonical ImportBatch.
 *
 * Derivation rules (doc 09 P2, frozen before code):
 *  A1 — tasks are multi-homed; mapping.projectGid scopes the import. The
 *       membership whose project matches supplies the current section; the
 *       sections document is the authoritative set of in-scope section gids.
 *  A2 — completion is orthogonal to section: completed tasks land in
 *       mapping.completedStatus (must be a statusMap key), with a derived
 *       completion event {from: current section, to: completedStatus,
 *       at: completed_at}. completed without completed_at is a hard error.
 *  A3 — section_changed stories whose sections are both outside the scoped
 *       set are foreign-project moves: excluded with a counted diagnostic.
 *       A story mixing an in-scope and an out-of-scope section is a hard
 *       error. (Sections missing entirely are treated as out-of-scope.)
 *  A4 — arrival (J1 analog): at task created_at into the old_section of the
 *       first in-scope story, else the current section. Known documented
 *       limitation: a task added to the scoped project long after creation
 *       overstates its first-section wait.
 *  A5 — pagination completeness IS attestable (J2 analog): any provided
 *       document whose next_page is non-null without a continuation page is
 *       a hard error. The fetcher paginates to exhaustion.
 */
export interface AsanaMapping {
  readonly id: string;
  readonly version: string;
  /** A1: the scoped project. */
  readonly projectGid: string;
  /** Keys are section names of the scoped project, plus completedStatus. */
  readonly statusMap: Readonly<Record<string, StageKind>>;
  /** A2: the stage completed tasks land in (must be a statusMap key). */
  readonly completedStatus: string;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
}

export interface AsanaTransformInput {
  readonly batchId: string;
  /** Raw GET /projects/{gid}/tasks pages, verbatim, in fetch order. */
  readonly taskPages: readonly string[];
  /** Raw GET /tasks/{gid}/stories pages keyed by task gid, in fetch order. */
  readonly storiesByTask?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Raw GET /projects/{gid}/sections document (A1 authoritative scope). */
  readonly sectionsDoc: string;
  readonly mapping: AsanaMapping;
  /** Which project or board these pages came from, when the caller knows it. */
  readonly scope?: TransformScope | undefined;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

interface AsanaSectionRef {
  readonly gid?: string;
  readonly name?: string | null;
}
interface AsanaTask {
  readonly gid?: string;
  readonly name?: string | null;
  readonly created_at?: string | null;
  readonly modified_at?: string | null;
  readonly due_on?: string | null;
  readonly completed?: boolean;
  readonly completed_at?: string | null;
  readonly assignee?: { readonly name?: string | null } | null;
  readonly memberships?: readonly {
    readonly project?: { readonly gid?: string } | null;
    readonly section?: AsanaSectionRef | null;
  }[];
}
interface AsanaStory {
  readonly created_at?: string | null;
  readonly resource_subtype?: string;
  readonly old_section?: AsanaSectionRef | null;
  readonly new_section?: AsanaSectionRef | null;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ImportError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

/** A5: a document claiming a continuation that was not supplied refuses import. */
function requireComplete(doc: { next_page?: unknown }, label: string): void {
  if (doc.next_page !== null && doc.next_page !== undefined) {
    throw new ImportError(
      `${label} has a non-null next_page but no continuation page was provided — ` +
        'history is never silently truncated.',
    );
  }
}

export function transformAsana(input: AsanaTransformInput): ImportBatch {
  const {
    batchId,
    taskPages,
    storiesByTask,
    sectionsDoc,
    mapping,
    scope,
    importedAt,
    pseudonymization,
  } = input;
  if (taskPages.length === 0) {
    throw new ImportError('Asana transform received no task pages.');
  }
  const completedKind: StageKind | undefined = mapping.statusMap[mapping.completedStatus];
  if (completedKind === undefined) {
    throw new ImportError(
      `completedStatus "${mapping.completedStatus}" is not a statusMap key — map it to a stage kind.`,
    );
  }

  const sections = parseJson(sectionsDoc, 'Asana sections document') as {
    data?: AsanaSectionRef[];
    next_page?: unknown;
  };
  if (!Array.isArray(sections.data)) {
    throw new ImportError('Asana sections document has no "data" array.');
  }
  requireComplete(sections, 'Asana sections document');
  const scopedSectionGids = new Set(
    sections.data.map((s) => s.gid ?? '').filter((gid) => gid !== ''),
  );

  const rawTasks: AsanaTask[] = [];
  taskPages.forEach((page, index) => {
    const doc = parseJson(page, `Asana task page ${index}`) as {
      data?: AsanaTask[];
      next_page?: unknown;
    };
    if (!Array.isArray(doc.data)) {
      throw new ImportError(`Asana task page ${index} has no "data" array.`);
    }
    if (index === taskPages.length - 1) requireComplete(doc, `Asana task page ${index}`);
    rawTasks.push(...doc.data);
  });

  const diagnostics: ImportDiagnostic[] = [];
  const items: WorkItem[] = [];
  const currentSectionByTask = new Map<string, string>();

  const readDate = (
    value: string | null | undefined,
    gid: string,
    field: string,
    row: number,
  ): IsoDateString | null => {
    if (value === null || value === undefined || value === '') return null;
    if (parseIsoUtc(value) === null) {
      diagnostics.push({
        row,
        severity: 'warning',
        message: `Unparseable ${field} "${value}" on task ${gid} — field ignored.`,
      });
      return null;
    }
    return value;
  };

  rawTasks.forEach((task, index) => {
    const row = index + 1;
    const gid = task.gid ?? `task-${row}`;
    const membership = (task.memberships ?? []).find((m) => m.project?.gid === mapping.projectGid);
    if (!membership) {
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Task is not a member of project "${mapping.projectGid}" — row dropped.`,
      });
      return;
    }
    const sectionName = (membership.section?.name ?? '').trim();
    // A1/A2: the section must be mapped even for completed tasks — the
    // current section is a fact the completion event references.
    const sectionStage = stageForStatus(sectionName, mapping.statusMap);
    if (sectionStage === null) {
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Status "${sectionName}" is not mapped to a stage kind — row dropped.`,
      });
      return;
    }
    if (task.completed === true && !task.completed_at) {
      throw new ImportError(
        `Task ${gid} is completed but has no completed_at timestamp — the document is malformed.`,
      );
    }

    currentSectionByTask.set(gid, sectionName);
    items.push({
      id: gid,
      sourceId: gid,
      title: (task.name ?? '').trim(),
      stage:
        task.completed === true
          ? { name: mapping.completedStatus, kind: completedKind }
          : sectionStage,
      actor: resolveActorValue(
        (task.assignee?.name ?? '').trim(),
        mapping.actorRoleMap,
        pseudonymization,
      ),
      createdAt: readDate(task.created_at, gid, 'created_at', row),
      dueAt: readDate(task.due_on, gid, 'due_on', row),
      lastUpdatedAt: readDate(task.modified_at, gid, 'modified_at', row),
    });
  });

  const rawEvents: CanonicalEventInput[] = [];
  let order = 0;
  const tasksByGid = new Map(
    rawTasks.map((t, i) => [t.gid ?? `task-${i + 1}`, { task: t, row: i + 1 }]),
  );

  for (const item of items) {
    const entry = tasksByGid.get(item.id);
    const currentSection = currentSectionByTask.get(item.id) ?? '';

    const transitions: { fromStatus: string; toStatus: string; at: string }[] = [];
    let foreignMoves = 0;
    const storyPages = storiesByTask?.[item.id] ?? [];
    storyPages.forEach((page, pageIndex) => {
      const doc = parseJson(page, `Asana stories page ${pageIndex} for ${item.id}`) as {
        data?: AsanaStory[];
        next_page?: unknown;
      };
      if (!Array.isArray(doc.data)) {
        throw new ImportError(
          `Asana stories page ${pageIndex} for ${item.id} has no "data" array.`,
        );
      }
      if (pageIndex === storyPages.length - 1) {
        requireComplete(doc, `Asana stories page ${pageIndex} for ${item.id}`);
      }
      for (const story of doc.data) {
        if (story.resource_subtype !== 'section_changed') continue;
        const oldGid = story.old_section?.gid ?? '';
        const newGid = story.new_section?.gid ?? '';
        const oldInScope = scopedSectionGids.has(oldGid);
        const newInScope = scopedSectionGids.has(newGid);
        if (!oldInScope && !newInScope) {
          foreignMoves += 1; // A3: a move inside another project.
          continue;
        }
        if (oldInScope !== newInScope) {
          throw new ImportError(
            `Task ${item.id} has a section move mixing in-scope and out-of-scope sections — ` +
              'the document contradicts the project scoping and cannot be imported safely.',
          );
        }
        transitions.push({
          fromStatus: (story.old_section?.name ?? '').trim(),
          toStatus: (story.new_section?.name ?? '').trim(),
          at: story.created_at ?? '',
        });
      }
    });
    if (foreignMoves > 0) {
      diagnostics.push({
        row: entry?.row ?? 0,
        severity: 'warning',
        message: `${foreignMoves} section move(s) in other projects ignored (outside scoped project "${mapping.projectGid}").`,
      });
    }
    transitions.sort(
      (a, b) => (parseIsoUtc(a.at) ?? Number.NaN) - (parseIsoUtc(b.at) ?? Number.NaN),
    );

    // A4 (J1 analog): arrival at created_at into the first known section.
    if (item.createdAt !== null) {
      const initialSection = transitions.length > 0 ? transitions[0]?.fromStatus : currentSection;
      if (initialSection && initialSection !== '') {
        rawEvents.push({
          itemId: item.id,
          fromStatus: '',
          toStatus: initialSection,
          at: item.createdAt,
          ref: `task ${item.id} arrival`,
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
        ref: `task ${item.id} story ${transitionIndex + 1}`,
        order: order++,
      });
    });

    // A2: the completion event closes the current section's interval.
    if (entry?.task.completed === true && entry.task.completed_at) {
      rawEvents.push({
        itemId: item.id,
        fromStatus: currentSection,
        toStatus: mapping.completedStatus,
        at: entry.task.completed_at,
        ref: `task ${item.id} completion`,
        order: order++,
      });
    }
  }

  const events = orderAndValidateEvents(rawEvents, items, mapping.statusMap);

  return {
    id: batchId,
    provider: 'asana',
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: rawTasks.length,
      imported: items.length,
      dropped: rawTasks.length - items.length,
    },
    diagnostics,
    capability: buildCapability(items, events, {
      dueDates: true,
      lastUpdated: true,
      actors: true,
    }),
    evidence: [],
    scopes: coverageFor(scope, items.length),
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}
