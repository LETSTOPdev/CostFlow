import type {
  BatchScope,
  CapabilityProfile,
  EvidenceNote,
  ImportBatch,
  ImportDiagnostic,
  IsoDateString,
  WorkItem,
  WorkItemEvent,
} from '@costflow/domain';
import { sortScopes } from '@costflow/domain';
import { ImportError } from './errors';

/**
 * Merge one per-origin batch per selected scope into the single batch an
 * analysis runs on.
 *
 * A Monitoring Workspace that spans several Lists still produces ONE run: one
 * set of totals, one report, one comparable artifact. Fetching and transforming
 * stay per-origin — that is where per-origin failure, per-origin attribution
 * and (later) per-origin incremental import live — and this function is the
 * single place where the seam between "several origins" and "one analysis"
 * is crossed.
 *
 * Everything here is pure and order-independent: the same set of input batches
 * produces byte-identical output regardless of the order the connector happened
 * to fetch them in, because inputs are sorted by scope id before anything is
 * concatenated. Fetch order is a network accident; it must never reach a total.
 *
 * The three merge rules that carry real weight, and why:
 *
 *   ITEMS de-duplicate across origins. A ClickUp task can belong to several
 *   Lists at once. Counting it twice would inflate every total silently, which
 *   is the worst possible failure: plausible, invisible, and wrong. The first
 *   origin in scope-id order keeps the item; the duplicate is dropped with a
 *   diagnostic, and its events go with it (they are the same history).
 *
 *   CAPABILITY is the INTERSECTION, never the union. If one List has status
 *   history and another does not, a union would let the queue-wait detector run
 *   across the whole workspace while only ever seeing half of it — reporting a
 *   confident number for a population it did not observe. The intersection
 *   makes the detector skip, which the report already knows how to explain.
 *   Refusing beats half-measuring; that is the same posture as report mode
 *   declining to price vendor-suggested assumptions.
 *
 *   EVIDENCE is the union, and a capability that is not uniform ADDS a
 *   partial-coverage note naming the origins that lack it. Otherwise the
 *   customer sees a detector skip with no way to learn that two of their nine
 *   Lists are the reason, which is the difference between an explanation and a
 *   shrug.
 */
export interface MergeBatchesInput {
  /** One batch per selected origin. Each must declare exactly one scope. */
  readonly batches: readonly ImportBatch[];
  readonly batchId: string;
  readonly importedAt: IsoDateString;
}

/** The single scope a per-origin batch must declare, or a hard error. */
function scopeOf(batch: ImportBatch): BatchScope {
  const [scope] = batch.scopes;
  if (batch.scopes.length !== 1 || scope === undefined) {
    throw new ImportError(
      `A batch handed to mergeBatches must cover exactly one origin; "${batch.id}" covers ${batch.scopes.length}.`,
    );
  }
  return scope;
}

/** Every input must agree, or the merged batch would be describing two things. */
function agreedField<T extends string | null>(
  batches: readonly ImportBatch[],
  read: (batch: ImportBatch) => T,
  label: string,
): T {
  const first = read(batches[0] as ImportBatch);
  for (const batch of batches) {
    if (read(batch) !== first) {
      throw new ImportError(`Cannot merge imports with different ${label} in one analysis.`);
    }
  }
  return first;
}

const CAPABILITY_KEYS = [
  'hasEventHistory',
  'hasDueDates',
  'hasLastUpdated',
  'hasActors',
] as const satisfies readonly (keyof CapabilityProfile)[];

/**
 * What a missing capability means for the OBSERVATIONS, in the domain's own
 * vocabulary. Deliberately a total mapping over the capability keys, so adding
 * a capability forces a decision here rather than silently losing its note.
 */
const WEAKENED_SUBJECT: Record<keyof CapabilityProfile, EvidenceNote['subject']> = {
  hasEventHistory: 'events',
  hasDueDates: 'commitments',
  hasLastUpdated: 'items',
  hasActors: 'actors',
};

const CAPABILITY_PHRASE: Record<keyof CapabilityProfile, string> = {
  hasEventHistory: 'status history',
  hasDueDates: 'due dates',
  hasLastUpdated: 'last-updated timestamps',
  hasActors: 'assignees',
};

export function mergeBatches(input: MergeBatchesInput): ImportBatch {
  const { batchId, importedAt } = input;
  if (input.batches.length === 0) {
    throw new ImportError('mergeBatches received no batches.');
  }
  // Sorted by origin so the merge is independent of fetch order.
  const batches = [...input.batches].sort((a, b) => {
    const x = scopeOf(a).id;
    const y = scopeOf(b).id;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const multi = batches.length > 1;

  const provider = agreedField(batches, (b) => b.provider, 'connected platforms');
  const mappingTemplateId = agreedField(batches, (b) => b.mappingTemplateId, 'import templates');
  const mappingTemplateVersion = agreedField(
    batches,
    (b) => b.mappingTemplateVersion,
    'import template versions',
  );
  const pseudonymizationScope = agreedField(
    batches,
    (b) => b.pseudonymizationScope,
    'pseudonymization scopes',
  );

  // ── items, de-duplicated across origins ───────────────────────────────────
  const items: WorkItem[] = [];
  const seen = new Set<string>();
  const contributed = new Map<string, number>();
  const duplicatesByScope = new Map<string, number>();
  /** Per batch, the item ids it actually contributed — the events filter. */
  const ownedByBatch: Set<string>[] = [];
  for (const batch of batches) {
    const scope = scopeOf(batch);
    const owned = new Set<string>();
    for (const item of batch.items) {
      if (seen.has(item.id)) {
        duplicatesByScope.set(scope.id, (duplicatesByScope.get(scope.id) ?? 0) + 1);
        continue;
      }
      seen.add(item.id);
      owned.add(item.id);
      items.push(item);
    }
    ownedByBatch.push(owned);
    contributed.set(scope.id, owned.size);
  }

  // ── events ────────────────────────────────────────────────────────────────
  // A dropped duplicate takes its history with it: those events describe the
  // same task the surviving copy already carries. Each per-origin batch arrived
  // already ordered and validated, and the surviving items are disjoint across
  // origins, so grouping by item id is enough — the sort is stable, which keeps
  // every chain in the order its own transform established.
  const events: WorkItemEvent[] = batches
    .flatMap((batch, index) =>
      batch.events.filter((event) => (ownedByBatch[index] as Set<string>).has(event.workItemId)),
    )
    .sort((a, b) => (a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0));

  // ── diagnostics ───────────────────────────────────────────────────────────
  // `row` is a per-origin row number, so across several origins it stops
  // identifying anything on its own. The origin label restores that, and is
  // only added when there is more than one origin to tell apart.
  const diagnostics: ImportDiagnostic[] = batches.flatMap((batch) => {
    const scope = scopeOf(batch);
    return batch.diagnostics.map((d) =>
      multi ? { ...d, message: `${scope.label}: ${d.message}` } : d,
    );
  });
  for (const batch of batches) {
    const scope = scopeOf(batch);
    const duplicates = duplicatesByScope.get(scope.id) ?? 0;
    if (duplicates > 0) {
      diagnostics.push({
        row: 0,
        severity: 'warning',
        message: `${scope.label}: ${duplicates} item(s) also appear in another selected origin and were counted once, under the first origin that contained them.`,
      });
    }
  }

  // ── capability: the intersection ──────────────────────────────────────────
  const capability: CapabilityProfile = {
    hasEventHistory: batches.every((b) => b.capability.hasEventHistory),
    hasDueDates: batches.every((b) => b.capability.hasDueDates),
    hasLastUpdated: batches.every((b) => b.capability.hasLastUpdated),
    hasActors: batches.every((b) => b.capability.hasActors),
  };

  // ── evidence: the union, plus what the intersection cost ──────────────────
  const evidence: EvidenceNote[] = batches.flatMap((batch) => {
    const scope = scopeOf(batch);
    return batch.evidence.map((note) =>
      multi ? { ...note, detail: `${scope.label}: ${note.detail}` } : note,
    );
  });
  if (multi) {
    for (const key of CAPABILITY_KEYS) {
      const lacking = batches.filter((b) => !b.capability[key]);
      if (lacking.length === 0 || lacking.length === batches.length) continue;
      evidence.push({
        weakness: 'partial-coverage',
        subject: WEAKENED_SUBJECT[key],
        detail:
          `${lacking.length} of the ${batches.length} selected origins carry no ${CAPABILITY_PHRASE[key]} ` +
          `(${lacking.map((b) => scopeOf(b).label).join(', ')}), so this analysis treats the whole ` +
          'selection as lacking it rather than reporting a figure that covers only part of the work.',
      });
    }
  }
  const evidenceKey = (n: EvidenceNote): string => `${n.weakness} ${n.subject} ${n.detail}`;
  evidence.sort((a, b) => {
    const x = evidenceKey(a);
    const y = evidenceKey(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const scopes: BatchScope[] = sortScopes(
    batches.map((batch) => {
      const scope = scopeOf(batch);
      return { ...scope, itemCount: contributed.get(scope.id) ?? 0 };
    }),
  );

  const totalRows = batches.reduce((sum, b) => sum + b.counts.totalRows, 0);
  return {
    id: batchId,
    provider,
    mappingTemplateId,
    mappingTemplateVersion,
    importedAt,
    counts: { totalRows, imported: items.length, dropped: totalRows - items.length },
    diagnostics,
    capability,
    evidence,
    scopes,
    pseudonymizationScope,
    items,
    events,
  };
}
