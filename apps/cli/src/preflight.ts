import { parse } from 'csv-parse/sync';
import type { AssumptionSet, ImportBatch, PseudonymizationContext } from '@costflow/domain';
import { ImportError, importCsv } from '@costflow/ingestion';
import type { MappingTemplate } from '@costflow/ingestion';

/**
 * Pass-1 structural preflight (M1 intake checklist): composes the EXISTING
 * import validation — importCsv performs every structural check — and reports
 * structure only. No detectors, no cost engine, no artifacts written, no
 * financial output. Prints counts and business vocabulary (column names,
 * status values, role refs); never raw actor values.
 */
export interface PreflightResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export function preflight(input: {
  readonly csvText: string;
  readonly eventsCsvText?: string | undefined;
  readonly mapping: MappingTemplate;
  readonly assumptions?: AssumptionSet | undefined;
  readonly pseudonymization?: PseudonymizationContext | undefined;
}): PreflightResult {
  const lines: string[] = [];
  const { csvText, eventsCsvText, mapping, assumptions, pseudonymization } = input;

  let batch: ImportBatch;
  try {
    batch = importCsv({
      batchId: 'preflight',
      csvText,
      eventsCsvText,
      mapping,
      importedAt: '1970-01-01T00:00:00Z',
      pseudonymization,
    });
  } catch (error) {
    if (error instanceof ImportError) {
      lines.push(`STRUCTURAL ERROR: ${error.message}`);
      lines.push('');
      lines.push('Preflight verdict: FAILED — fix the input before any analysis run.');
      return { ok: false, lines };
    }
    throw error;
  }

  lines.push('== Rows ==');
  lines.push(
    `total ${batch.counts.totalRows} · imported ${batch.counts.imported} · dropped ${batch.counts.dropped}`,
  );

  const dropped = batch.diagnostics.filter((d) => d.severity === 'dropped');
  const warnings = batch.diagnostics.filter((d) => d.severity === 'warning');
  if (dropped.length > 0) {
    lines.push('');
    lines.push('== Dropped rows ==');
    for (const [message, count] of groupCounts(dropped.map((d) => d.message))) {
      lines.push(`${count}× ${message}`);
    }
  }
  if (warnings.length > 0) {
    lines.push('');
    lines.push('== Warnings ==');
    for (const [message, count] of groupCounts(warnings.map((d) => d.message))) {
      lines.push(`${count}× ${message}`);
    }
  }

  lines.push('');
  lines.push('== Capability profile ==');
  const cap = batch.capability;
  const flag = (b: boolean) => (b ? 'yes' : 'no');
  lines.push(
    `event history ${flag(cap.hasEventHistory)} · last-updated ${flag(cap.hasLastUpdated)} · due dates ${flag(cap.hasDueDates)} · actors ${flag(cap.hasActors)}`,
  );

  lines.push('');
  lines.push('== Actor coverage (counts only; raw values never shown) ==');
  const actorCounts = { role: 0, unknown: 0, missing: 0 };
  const rolesInUse = new Set<string>();
  for (const item of batch.items) {
    actorCounts[item.actor.kind] += 1;
    if (item.actor.kind === 'role') rolesInUse.add(item.actor.roleRef);
  }
  lines.push(
    `mapped to roles ${actorCounts.role} · unmapped (would pseudonymize) ${actorCounts.unknown} · missing ${actorCounts.missing}`,
  );
  if (rolesInUse.size > 0) {
    lines.push(`roles in use: ${[...rolesInUse].sort().join(', ')}`);
  }

  if (assumptions) {
    const ratedRoles = new Set(assumptions.rates.map((r) => r.roleRef));
    const unrated = [...rolesInUse].filter((role) => !ratedRoles.has(role)).sort();
    lines.push('');
    lines.push('== Rate-card coverage ==');
    lines.push(
      unrated.length === 0
        ? 'every mapped role has a rate-card entry'
        : `roles WITHOUT a rate entry (will price at default rate, confidence C): ${unrated.join(', ')}`,
    );
    if (!assumptions.parameters.queueWaitAttentionHoursPerDay) {
      lines.push(
        'note: queueWaitAttentionHoursPerDay is absent — queue-wait frictions would be reported unpriced',
      );
    }
    if (!assumptions.parameters.overdueAttentionHoursPerDay) {
      lines.push(
        'note: overdueAttentionHoursPerDay is absent — overdue frictions would be reported unpriced',
      );
    }
  }

  const header = (parse(csvText, { to_line: 1, trim: true, bom: true }) as string[][])[0] ?? [];
  const mappedColumns = new Set(
    Object.values(mapping.columns).filter((c): c is string => c !== undefined),
  );
  const unmappedColumns = header.filter((c) => !mappedColumns.has(c));
  if (unmappedColumns.length > 0) {
    lines.push('');
    lines.push('== Columns present but not mapped (ignored by the canonical model) ==');
    lines.push(unmappedColumns.join(', '));
  }

  if (eventsCsvText !== undefined) {
    lines.push('');
    lines.push('== Event history ==');
    lines.push(
      `${batch.events.length} events imported · strict validation PASSED (items, timestamps, statuses, chains, creation order)`,
    );
    const itemsWithEvents = new Set(batch.events.map((e) => e.workItemId)).size;
    lines.push(`items with history: ${itemsWithEvents} of ${batch.items.length}`);
  }

  lines.push('');
  lines.push('Preflight verdict: PASSED — structure is sufficient for analysis.');
  return { ok: true, lines };
}

function groupCounts(messages: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
