import { formatWholeMoney } from '@costflow/cost-engine';
import { isTerminal } from '@costflow/domain';
import type { BatchScope } from '@costflow/domain';
import type { AgingTraceTerm, OverdueTraceTerm, QueueWaitTraceTerm } from '@costflow/analysis';
import type { RankedFriction, ReportModel } from './report';

/**
 * Escapes customer-controlled strings before markdown interpolation (R-07):
 * a title containing `|`, backticks, or link syntax must not corrupt tables
 * or inject content into the flagship artifact. Traces and run artifacts keep
 * raw truth; only display escapes.
 */
const PROVENANCE_LABELS: Record<string, string> = {
  'vendor-suggested': '**vendor-suggested (unconfirmed)**',
  'customer-accepted': 'accepted by customer',
  'customer-customized': 'customized by customer',
  'customer-measured': 'measured by customer',
};

function provenanceLabel(provenance: string): string {
  return PROVENANCE_LABELS[provenance] ?? provenance;
}

function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');
}

/**
 * Human-readable report. Every number here is rendered FROM a trace, never
 * invented beside one (doc 03 E3); each drill-down answers the four questions
 * of doc 03 E1: what is this, how computed, what data, what assumed.
 * Money display is delegated entirely to the cost engine's formatter (R-02):
 * reporting performs no monetary arithmetic or formatting of its own.
 */
export function renderMarkdown(model: ReportModel): string {
  const { run, ranked, unpriced } = model;
  const lines: string[] = [];
  const money = (value: string) => formatWholeMoney(value, run.assumptions.currency);
  const range = (cost: { low: string; expected: string; high: string }) =>
    `${money(cost.low)} – ${money(cost.high)} (expected ~${money(cost.expected)})`;

  lines.push('# CostFlow Friction Report');
  lines.push('');
  lines.push(
    `Run \`${esc(run.runId)}\` · analysis time ${esc(run.now)} · currency ${esc(run.assumptions.currency)}`,
  );
  lines.push('');
  lines.push('All figures are estimates with stated assumptions; every number below is');
  lines.push('traceable to its formula, inputs, and assumption provenance.');
  lines.push('');
  if (run.pricingPolicy === 'simulation') {
    lines.push('> **SIMULATION MODE** — this run prices vendor-suggested (unconfirmed)');
    lines.push('> assumptions. Figures are conditional estimates for exploration and are');
    lines.push('> NOT suitable for executive reporting.');
    lines.push('');
  }

  lines.push('## Data');
  lines.push('');
  lines.push(
    `Import batch \`${esc(run.batch.id)}\` (provider: ${esc(run.batch.provider)}, mapping \`${esc(run.batch.mappingTemplateId)}\` v${esc(run.batch.mappingTemplateVersion)}, imported ${esc(run.batch.importedAt)})`,
  );
  lines.push('');
  lines.push(
    `- Rows: ${run.batch.counts.totalRows} total, ${run.batch.counts.imported} imported, ${run.batch.counts.dropped} dropped`,
  );
  const cap = run.batch.capability;
  const capLabel = (flag: boolean) => (flag ? 'yes' : 'no');
  lines.push(
    `- Capability profile: event history ${capLabel(cap.hasEventHistory)} · last-updated dates ${capLabel(cap.hasLastUpdated)} · due dates ${capLabel(cap.hasDueDates)} · actors ${capLabel(cap.hasActors)}`,
  );
  // What the totals were computed over. A reader looking at one number for a
  // whole department has to be able to see which parts of it are in there,
  // without opening run.json — and an origin that contributed nothing is worth
  // seeing precisely because it is the surprising one.
  const scopes = run.batch.scopes as readonly BatchScope[] | undefined;
  if (scopes !== undefined && scopes.length > 0) {
    lines.push(
      `- Covered ${scopes.length} ${scopes.length === 1 ? 'source' : 'sources'}: ` +
        scopes.map((s) => `${esc(s.label)} (${s.itemCount})`).join(', '),
    );
  }
  const inFlight = run.batch.items.filter((item) => !isTerminal(item.stage));
  if (inFlight.length > 0) {
    const withDue = inFlight.filter((item) => item.dueAt !== null).length;
    lines.push(
      `- Due-date coverage: ${withDue} of ${inFlight.length} in-flight items carry due dates`,
    );
  }
  if (run.batch.events.length > 0) {
    lines.push(`- Lifecycle events imported: ${run.batch.events.length}`);
  }
  if (run.batch.pseudonymizationScope !== null) {
    lines.push(
      `- Unmapped actors pseudonymized (scope \`${esc(run.batch.pseudonymizationScope)}\`); raw identities are not retained`,
    );
  }
  if (run.batch.diagnostics.length > 0) {
    lines.push('');
    lines.push('### Import diagnostics');
    lines.push('');
    for (const d of run.batch.diagnostics) {
      lines.push(`- ${d.row === 0 ? 'File' : `Row ${d.row}`} \\[${d.severity}]: ${esc(d.message)}`);
    }
  }
  lines.push('');

  lines.push('## Detectors');
  lines.push('');
  for (const d of run.detectors) {
    if (d.status === 'ran') {
      lines.push(
        `- ${d.signalName} (\`${d.signalId}@${d.signalVersion}\`): ran — ${d.instanceCount} finding(s)`,
      );
    } else {
      lines.push(
        `- ${d.signalName} (\`${d.signalId}@${d.signalVersion}\`): **skipped** — ${d.reason ?? ''}`,
      );
    }
  }
  lines.push('');

  lines.push('## Ranked frictions');
  lines.push('');
  if (ranked.length === 0) {
    lines.push('No priced frictions detected above thresholds in this import.');
  } else {
    lines.push('| # | Friction | Where | Magnitude | Estimated cost | Confidence |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of ranked) {
      lines.push(
        `| ${r.rank} | ${r.instance.frictionType} | stage "${esc(r.instance.location.stage.name)}" (${r.instance.location.stage.kind}) | ${r.instance.magnitude.value} ${r.instance.magnitude.unit} | ${range(r.estimate.cost)} | ${r.estimate.confidence.tier} |`,
      );
    }
  }
  lines.push('');

  if (unpriced.length > 0) {
    lines.push('## Unpriced frictions');
    lines.push('');
    lines.push('Detected but not priced — the magnitude is real; the missing input is named.');
    lines.push('');
    for (const u of unpriced) {
      lines.push(
        `- ${u.instance.frictionType} at stage "${esc(u.instance.location.stage.name)}" — ${u.instance.magnitude.value} ${u.instance.magnitude.unit}. Not priced: ${esc(u.reason)}`,
      );
    }
    lines.push('');
  }

  if (run.context.length > 0) {
    lines.push('## Context');
    lines.push('');
    lines.push(
      'Context signals describe conditions that explain frictions. They are not priced, graded, or ranked.',
    );
    lines.push('');
    for (const c of run.context) {
      lines.push(`- ${c.signalName} (\`${c.signalId}@${c.signalVersion}\`): ${esc(c.statement)}`);
    }
    lines.push('');
  }

  for (const r of ranked) {
    renderDrilldown(lines, r, range);
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `Engine versions: analysis ${run.engineVersions.analysis} · signals ${Object.entries(
      run.engineVersions.signals,
    )
      .map(([id, v]) => `${id}@${v}`)
      .join(', ')} · context ${Object.entries(run.engineVersions.contextSignals)
      .map(([id, v]) => `${id}@${v}`)
      .join(', ')} · cost models ${Object.entries(run.engineVersions.costModels)
      .map(([id, v]) => `${id}@${v}`)
      .join(', ')}`,
  );
  lines.push('');
  return lines.join('\n');
}

function renderDrilldown(
  lines: string[],
  r: RankedFriction,
  range: (cost: { low: string; expected: string; high: string }) => string,
): void {
  lines.push(
    `## Drill-down #${r.rank}: ${r.instance.frictionType} at stage "${esc(r.instance.location.stage.name)}"`,
  );
  lines.push('');
  lines.push(`**What is this?** ${esc(r.estimate.trace.claim)}`);
  lines.push('');
  lines.push(`**How was it computed?** \`${r.estimate.trace.formula}\``);
  lines.push(
    `(cost model \`${r.estimate.costModelId}@${r.estimate.costModelVersion}\`, assumption set \`${esc(r.estimate.assumptionSetId)}\` v${esc(r.estimate.assumptionSetVersion)})`,
  );
  lines.push('');
  lines.push('**What data went in?**');
  lines.push('');

  if (r.instance.frictionType === 'overdue') {
    lines.push('| Item | Days overdue | Due date | Attention h/day | Rate | Subtotal |');
    lines.push('|---|---|---|---|---|---|');
    for (const term of r.estimate.trace.terms) {
      if (term.kind !== 'overdue-attention') continue;
      const t: OverdueTraceTerm = term;
      const evidence = r.instance.evidence.find((e) => e.workItemId === t.workItemId);
      lines.push(
        `| ${esc(t.workItemId)} "${esc(evidence?.title ?? '')}" | ${t.overdueDays} | ${esc(t.dueAt)} | ${t.attentionHoursPerDay.low}–${t.attentionHoursPerDay.high} | ${t.hourlyRate}/h (${esc(t.rateSource)}) | ${range(t.subtotal)} |`,
      );
    }
  } else if (r.instance.frictionType === 'aging') {
    lines.push('| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |');
    lines.push('|---|---|---|---|---|');
    for (const term of r.estimate.trace.terms) {
      if (term.kind !== 'aging-attention') continue;
      const t: AgingTraceTerm = term;
      const evidence = r.instance.evidence.find((e) => e.workItemId === t.workItemId);
      lines.push(
        `| ${esc(t.workItemId)} "${esc(evidence?.title ?? '')}" | ${t.excessDays} | ${t.attentionHoursPerDay.low}–${t.attentionHoursPerDay.high} | ${t.hourlyRate}/h (${esc(t.rateSource)}) | ${range(t.subtotal)} |`,
      );
    }
  } else {
    lines.push(
      '| Item | Wait (days) | Visits | Open at analysis time | Attention h/day | Rate | Subtotal |',
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const term of r.estimate.trace.terms) {
      if (term.kind !== 'queue-wait-attention') continue;
      const t: QueueWaitTraceTerm = term;
      const evidence = r.instance.evidence.find((e) => e.workItemId === t.workItemId);
      lines.push(
        `| ${esc(t.workItemId)} "${esc(evidence?.title ?? '')}" | ${t.waitDays} | ${t.visits} | ${t.openAtAnalysisTime ? 'yes' : 'no'} | ${t.attentionHoursPerDay.low}–${t.attentionHoursPerDay.high} | ${t.hourlyRate}/h (${esc(t.rateSource)}) | ${range(t.subtotal)} |`,
      );
    }
  }

  lines.push('');
  lines.push('**What was assumed?**');
  lines.push('');
  for (const a of r.estimate.trace.assumptionsUsed) {
    lines.push(`- \`${esc(a.ref)}\` = ${esc(a.value)} — ${provenanceLabel(a.provenance)}`);
  }
  lines.push('');
  if (r.estimate.confidence.reasons.length === 0) {
    lines.push(
      `**Confidence ${r.estimate.confidence.tier}** — no binding constraints: fully observed data and customer-confirmed assumptions.`,
    );
  } else {
    lines.push(`**Confidence ${r.estimate.confidence.tier}**, limited by:`);
    lines.push('');
    for (const reason of r.estimate.confidence.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push('');
}
