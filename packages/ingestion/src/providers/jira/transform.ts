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
 * Jira Cloud transform (doc 15 P1): pure — raw REST v3 search-page JSON
 * strings (+ optional supplementary changelog pages) → canonical ImportBatch
 * with items AND ordered, strictly-validated events.
 *
 * Derivation rules (documented, deterministic, never silent):
 *  J1 — Jira changelogs record TRANSITIONS only; the initial-status interval
 *       is derived from two facts: the issue's created timestamp and the
 *       from-status of its first transition (or its current status when no
 *       transitions exist). An arrival event {from: null, to: initial,
 *       at: created} is emitted per issue.
 *  J2 — history truncation is a HARD error: if changelog.total exceeds the
 *       histories provided (search embeds at most ~100) and no supplementary
 *       changelog page covers the issue, the transform refuses. No silent
 *       truncation of history.
 *  J3 — issues dropped for unmapped current status take their events with
 *       them; a TRANSITION referencing an unmapped status is a hard error
 *       (same asymmetry as the CSV provider, D-13).
 */
export interface JiraMapping {
  readonly id: string;
  readonly version: string;
  readonly statusMap: Readonly<Record<string, StageKind>>;
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
}

export interface JiraTransformInput {
  readonly batchId: string;
  /** Raw /rest/api/3/search page documents, verbatim, in fetch order. */
  readonly searchPages: readonly string[];
  /** Raw /rest/api/3/issue/{key}/changelog pages keyed by issue key (J2 top-ups). */
  readonly supplementaryChangelogs?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly mapping: JiraMapping;
  /** Which project or board these pages came from, when the caller knows it. */
  readonly scope?: TransformScope | undefined;
  readonly importedAt: IsoDateString;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}

interface JiraHistoryItem {
  readonly field?: string;
  readonly fromString?: string | null;
  readonly toString?: string | null;
}
interface JiraHistory {
  readonly created?: string;
  readonly items?: readonly JiraHistoryItem[];
}
interface JiraIssue {
  readonly key?: string;
  readonly fields?: {
    readonly summary?: string | null;
    readonly status?: { readonly name?: string | null } | null;
    readonly assignee?: { readonly displayName?: string | null } | null;
    readonly created?: string | null;
    readonly updated?: string | null;
    readonly duedate?: string | null;
  };
  readonly changelog?: {
    readonly total?: number;
    readonly histories?: readonly JiraHistory[];
  };
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ImportError(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

export function transformJira(input: JiraTransformInput): ImportBatch {
  const {
    batchId,
    searchPages,
    supplementaryChangelogs,
    mapping,
    scope,
    importedAt,
    pseudonymization,
  } = input;
  if (searchPages.length === 0) {
    throw new ImportError('Jira transform received no search pages.');
  }

  const issues: JiraIssue[] = [];
  searchPages.forEach((page, index) => {
    const doc = parseJson(page, `Jira search page ${index}`) as { issues?: JiraIssue[] };
    if (!Array.isArray(doc.issues)) {
      throw new ImportError(`Jira search page ${index} has no "issues" array.`);
    }
    issues.push(...doc.issues);
  });

  const diagnostics: ImportDiagnostic[] = [];
  const items: WorkItem[] = [];
  const rawEvents: CanonicalEventInput[] = [];
  let order = 0;

  const readDate = (
    value: string | null | undefined,
    key: string,
    field: string,
    row: number,
  ): IsoDateString | null => {
    if (value === null || value === undefined || value === '') return null;
    if (parseIsoUtc(value) === null) {
      diagnostics.push({
        row,
        severity: 'warning',
        message: `Unparseable ${field} "${value}" on ${key} — field ignored.`,
      });
      return null;
    }
    return value;
  };

  issues.forEach((issue, index) => {
    const row = index + 1;
    const key = issue.key ?? `issue-${row}`;
    const statusName = issue.fields?.status?.name ?? '';
    const stage = stageForStatus(statusName, mapping.statusMap);
    if (stage === null) {
      diagnostics.push({
        row,
        severity: 'dropped',
        message: `Status "${statusName}" is not mapped to a stage kind — row dropped.`,
      });
      return; // J3: its changelog goes with it.
    }

    const rawActor = issue.fields?.assignee?.displayName ?? '';
    const actor = resolveActorValue(rawActor.trim(), mapping.actorRoleMap, pseudonymization);

    const createdAt = readDate(issue.fields?.created, key, 'created', row);
    items.push({
      id: key,
      sourceId: key,
      title: (issue.fields?.summary ?? '').trim(),
      stage,
      actor,
      createdAt,
      dueAt: readDate(issue.fields?.duedate, key, 'duedate', row),
      lastUpdatedAt: readDate(issue.fields?.updated, key, 'updated', row),
    });

    // Collect status transitions (embedded + supplementary), J2-checked.
    const embedded = issue.changelog?.histories ?? [];
    const supplementary = (supplementaryChangelogs?.[key] ?? []).flatMap((page, pageIndex) => {
      const doc = parseJson(page, `Jira changelog page ${pageIndex} for ${key}`) as {
        values?: JiraHistory[];
      };
      return doc.values ?? [];
    });
    const histories: JiraHistory[] = supplementary.length > 0 ? supplementary : [...embedded];
    const total = issue.changelog?.total ?? embedded.length;
    if (total > histories.length) {
      throw new ImportError(
        `Jira changelog for ${key} is truncated (${histories.length} of ${total} histories). ` +
          'Fetch the full changelog (supplementary pages) — history is never silently truncated.',
      );
    }

    const transitions: { fromStatus: string; toStatus: string; at: string }[] = [];
    histories.forEach((history) => {
      for (const change of history.items ?? []) {
        if (change.field !== 'status') continue;
        transitions.push({
          fromStatus: (change.fromString ?? '').trim(),
          toStatus: (change.toString ?? '').trim(),
          at: history.created ?? '',
        });
      }
    });
    transitions.sort(
      (a, b) => (parseIsoUtc(a.at) ?? Number.NaN) - (parseIsoUtc(b.at) ?? Number.NaN),
    );

    // J1: derive the arrival event from created + initial status.
    if (createdAt !== null) {
      const initialStatus = transitions.length > 0 ? transitions[0]?.fromStatus : statusName;
      if (initialStatus && initialStatus !== '') {
        rawEvents.push({
          itemId: key,
          fromStatus: '',
          toStatus: initialStatus,
          at: createdAt,
          ref: `${key} arrival`,
          order: order++,
        });
      }
    }
    transitions.forEach((transition, transitionIndex) => {
      rawEvents.push({
        itemId: key,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        at: transition.at,
        ref: `${key} history ${transitionIndex + 1}`,
        order: order++,
      });
    });
  });

  const events = orderAndValidateEvents(rawEvents, items, mapping.statusMap);

  return {
    id: batchId,
    provider: 'jira',
    mappingTemplateId: mapping.id,
    mappingTemplateVersion: mapping.version,
    importedAt,
    counts: {
      totalRows: issues.length,
      imported: items.length,
      dropped: issues.length - items.length,
    },
    diagnostics,
    capability: buildCapability(items, events, { dueDates: true, lastUpdated: true, actors: true }),
    evidence: [],
    scopes: coverageFor(scope, items.length),
    pseudonymizationScope: pseudonymization?.scopeId ?? null,
    items,
    events,
  };
}
