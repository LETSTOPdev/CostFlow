import { formatWholeMoney } from '@costflow/cost-engine';
import type { ReportModel } from './report';

/**
 * Escapes customer-controlled strings before markdown interpolation (R-07):
 * a title containing `|`, backticks, or link syntax must not corrupt tables
 * or inject content into the flagship artifact. Traces and run artifacts keep
 * raw truth; only display escapes.
 */
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
  const { run, ranked } = model;
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
    `- Capability profile: event history ${capLabel(cap.hasEventHistory)} · last-updated dates ${capLabel(cap.hasLastUpdated)} · due dates ${capLabel(cap.hasDueDates)} · roles ${capLabel(cap.hasRoles)}`,
  );
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
    lines.push('No frictions detected above thresholds in this import.');
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

  for (const r of ranked) {
    lines.push(`## Drill-down #${r.rank}: stage "${esc(r.instance.location.stage.name)}"`);
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
    lines.push('| Item | Days beyond threshold | Attention h/day | Rate | Subtotal |');
    lines.push('|---|---|---|---|---|');
    for (const t of r.estimate.trace.terms) {
      const evidence = r.instance.evidence.find((e) => e.workItemId === t.workItemId);
      lines.push(
        `| ${esc(t.workItemId)} "${esc(evidence?.title ?? '')}" | ${t.excessDays} | ${t.attentionHoursPerDay.low}–${t.attentionHoursPerDay.high} | ${t.hourlyRate}/h (${esc(t.rateSource)}) | ${range(t.subtotal)} |`,
      );
    }
    lines.push('');
    lines.push('**What was assumed?**');
    lines.push('');
    for (const a of r.estimate.trace.assumptionsUsed) {
      lines.push(
        `- \`${esc(a.ref)}\` = ${esc(a.value)} — ${a.provenance === 'customer' ? 'set by customer' : '**unconfirmed default**'}`,
      );
    }
    lines.push('');
    lines.push(`**Confidence ${r.estimate.confidence.tier}**, limited by:`);
    lines.push('');
    for (const reason of r.estimate.confidence.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `Engine versions: analysis ${run.engineVersions.analysis} · signals ${Object.entries(
      run.engineVersions.signals,
    )
      .map(([id, v]) => `${id}@${v}`)
      .join(', ')} · cost models ${Object.entries(run.engineVersions.costModels)
      .map(([id, v]) => `${id}@${v}`)
      .join(', ')}`,
  );
  lines.push('');
  return lines.join('\n');
}
