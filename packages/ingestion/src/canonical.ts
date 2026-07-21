import type {
  ActorRef,
  CapabilityProfile,
  ImportDiagnostic,
  PseudonymizationContext,
  StageKind,
  StageRef,
  WorkItem,
  WorkItemEvent,
} from '@costflow/domain';
import { parseIsoUtc } from '@costflow/domain';
import { CsvImportError } from './providers/csv/provider';

/**
 * Shared canonical assembly for API providers (doc 15 P1). Semantics are
 * intentionally identical to the CSV provider's; the CSV implementation
 * stays untouched in P1 to keep goldens byte-stable (debt D-16 — consolidate
 * in P2 when Monday becomes the second consumer).
 */

/** R-20: mapped → role; unmapped → pseudonym (context required); empty → missing. */
export function resolveActorValue(
  rawValue: string,
  actorRoleMap: Readonly<Record<string, string>> | undefined,
  pseudonymization: PseudonymizationContext | undefined,
): ActorRef {
  if (rawValue === '') return { kind: 'missing' };
  const roleRef = actorRoleMap?.[rawValue];
  if (roleRef !== undefined) return { kind: 'role', roleRef };
  if (!pseudonymization) {
    throw new CsvImportError(
      'The data contains actor values that are not in actorRoleMap, and no pseudonymization ' +
        'context was provided. Supply one (CLI: --org and --salt-file) or complete the mapping.',
    );
  }
  return { kind: 'unknown', pseudonym: pseudonymization.pseudonymFor(rawValue) };
}

export interface CanonicalEventInput {
  readonly itemId: string;
  /** Empty string when the source records arrivals without a from-status. */
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly at: string;
  /** Provider-specific reference label for error messages ("row 3", "OPS-1 history 2"). */
  readonly ref: string;
  /** Deterministic tie-break for equal timestamps (source order). */
  readonly order: number;
}

/**
 * Strict event validation + deterministic ordering — same rules as the CSV
 * events path (Slice 2 Part C): unknown items, bad timestamps, unmapped
 * statuses, chain mismatches, and pre-creation events are hard errors; equal
 * timestamps keep source order; items ordered by id.
 */
export function orderAndValidateEvents(
  rawEvents: readonly CanonicalEventInput[],
  items: readonly WorkItem[],
  statusMap: Readonly<Record<string, StageKind>>,
): WorkItemEvent[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const fail = (problems: string[], kind: string): never => {
    const shown = problems.slice(0, 5);
    const suffix = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    throw new CsvImportError(`Event history is invalid — ${kind}: ${shown.join('; ')}${suffix}.`);
  };

  const unknownItems: string[] = [];
  const badTimestamps: string[] = [];
  const unmappedStatuses = new Set<string>();
  const beforeCreation: string[] = [];

  const parsed = rawEvents.map((event) => {
    const atMs = parseIsoUtc(event.at) ?? Number.NaN;
    if (!itemsById.has(event.itemId))
      unknownItems.push(`${event.ref} references "${event.itemId}"`);
    if (Number.isNaN(atMs)) badTimestamps.push(`${event.ref} has timestamp "${event.at}"`);
    if (statusMap[event.toStatus] === undefined) unmappedStatuses.add(event.toStatus);
    if (event.fromStatus !== '' && statusMap[event.fromStatus] === undefined) {
      unmappedStatuses.add(event.fromStatus);
    }
    return { ...event, atMs };
  });

  if (unknownItems.length > 0) fail(unknownItems, 'unknown work item(s)');
  if (badTimestamps.length > 0) fail(badTimestamps, 'unparseable timestamp(s)');
  if (unmappedStatuses.size > 0) {
    fail(
      [...unmappedStatuses].sort().map((s) => `"${s}" is not in statusMap`),
      'unmapped status(es)',
    );
  }

  for (const event of parsed) {
    const item = itemsById.get(event.itemId);
    if (item?.createdAt) {
      const createdMs = parseIsoUtc(item.createdAt);
      if (createdMs !== null && event.atMs < createdMs) {
        beforeCreation.push(
          `${event.ref}: event at ${event.at} precedes item "${event.itemId}" creation (${item.createdAt})`,
        );
      }
    }
  }
  if (beforeCreation.length > 0) fail(beforeCreation, 'event(s) before item creation');

  const byItem = new Map<string, typeof parsed>();
  for (const event of parsed) {
    const list = byItem.get(event.itemId) ?? [];
    list.push(event);
    byItem.set(event.itemId, list);
  }
  const chainErrors: string[] = [];
  const ordered: WorkItemEvent[] = [];
  for (const itemId of [...byItem.keys()].sort()) {
    const list = (byItem.get(itemId) as typeof parsed).sort(
      (a, b) => a.atMs - b.atMs || a.order - b.order,
    );
    list.forEach((event, position) => {
      if (position > 0 && event.fromStatus !== '') {
        const previous = list[position - 1] as (typeof parsed)[number];
        if (event.fromStatus !== previous.toStatus) {
          chainErrors.push(
            `item "${itemId}" ${event.ref}: from "${event.fromStatus}" does not match previous stage "${previous.toStatus}"`,
          );
        }
      }
      const toKind = statusMap[event.toStatus];
      const fromKind = event.fromStatus === '' ? undefined : statusMap[event.fromStatus];
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

export function buildCapability(
  items: readonly WorkItem[],
  events: readonly WorkItemEvent[],
  mapped: { readonly dueDates: boolean; readonly lastUpdated: boolean; readonly actors: boolean },
): CapabilityProfile {
  return {
    hasEventHistory: events.length > 0,
    hasDueDates: mapped.dueDates && items.some((i) => i.dueAt !== null),
    hasLastUpdated: mapped.lastUpdated && items.some((i) => i.lastUpdatedAt !== null),
    hasActors: mapped.actors && items.some((i) => i.actor.kind !== 'missing'),
  };
}

/** Stage resolution with the standard dropped-row diagnostic semantics. */
export function stageForStatus(
  status: string,
  statusMap: Readonly<Record<string, StageKind>>,
): StageRef | null {
  const kind = statusMap[status];
  return kind === undefined ? null : { name: status, kind };
}

export type { ImportDiagnostic };
