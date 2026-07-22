import type { AnalysisRun } from '@costflow/analysis';
import {
  addRanges,
  compareDecimalStrings,
  dec,
  decToString,
  formatWholeMoney,
  rangeFromSpec,
  rangeToSpec,
  ZERO_RANGE,
  type CostEstimate,
  type TraceTerm,
} from '@costflow/cost-engine';
import type { RangeSpec } from '@costflow/domain';
import { buildReportModel, type RankedFriction } from '@costflow/reporting';
import { esc } from './html';

/**
 * P5 structured reporting view. Renders the IMMUTABLE run.json artifact as an
 * explorable executive dashboard — ranked frictions, confidence/provenance as
 * first-class UI, formula-trace drill-downs (the four E1 questions), coverage,
 * context, and run-over-run trend. Pure presentation: no number is re-derived.
 *
 * Ranking and priced/unpriced partitioning come from `buildReportModel` (the
 * same deterministic model the markdown report uses), so this view can never
 * diverge from the goldens. All money is formatted through the engine's single
 * sanctioned formatter; the only monetary arithmetic is range summation/delta
 * via the engine's own range algebra.
 */

const PROVENANCE_LABELS: Record<string, string> = {
  'vendor-suggested': 'vendor-suggested (unconfirmed)',
  'customer-accepted': 'accepted by customer',
  'customer-customized': 'customized by customer',
  'customer-measured': 'measured by customer',
};
const provLabel = (p: string): string => PROVENANCE_LABELS[p] ?? p;

const FRICTION_LABELS: Record<string, string> = {
  aging: 'Aging / stagnation',
  'queue-wait': 'Queue wait',
  overdue: 'Overdue exposure',
};
const frictionLabel = (t: string): string => FRICTION_LABELS[t] ?? t;

const money = (value: string, currency: string): string => esc(formatWholeMoney(value, currency));

const rangeText = (spec: RangeSpec, currency: string): string =>
  `${money(spec.low, currency)} – ${money(spec.high, currency)} (expected ~${money(spec.expected, currency)})`;

/** Sum priced estimate ranges via the engine's range algebra (never floats). */
function totalRange(ranked: readonly RankedFriction[]): RangeSpec {
  let acc = ZERO_RANGE;
  for (const r of ranked) acc = addRanges(acc, rangeFromSpec(r.estimate.cost));
  return rangeToSpec(acc);
}

function titleMap(run: AnalysisRun): Map<string, string> {
  return new Map(run.batch.items.map((i) => [i.id, i.title]));
}

const confidenceBadge = (tier: string): string =>
  `<span class="tier tier-${esc(tier)}" title="Confidence tier ${esc(tier)}">Confidence ${esc(tier)}</span>`;

function renderTerms(
  estimate: CostEstimate,
  titleOf: Map<string, string>,
  currency: string,
): string {
  const rate = (t: Extract<TraceTerm, { hourlyRate: string }>): string =>
    `${esc(t.hourlyRate)}/h <span class="note">(${esc(t.rateSource)})</span>`;
  const attn = (r: RangeSpec): string => `${esc(r.low)}–${esc(r.high)}`;
  const item = (id: string): string =>
    `${esc(titleOf.get(id) ?? id)} <span class="note">${esc(id)}</span>`;

  // A single friction can aggregate tens of thousands of work items (large Jira
  // projects). Rendering one <tr> per item produced multi-MB reports and browser
  // jank (QA: 27MB HTML at 100k issues). We show the top contributors — biggest
  // subtotal first, the ones a reader actually inspects — and count the rest.
  // The full itemized breakdown remains in the raw markdown / run.json export.
  const TRACE_ROW_CAP = 50;
  const ordered = [...estimate.trace.terms].sort((a, b) =>
    compareDecimalStrings(b.subtotal.expected, a.subtotal.expected),
  );
  const shown = ordered.slice(0, TRACE_ROW_CAP);
  const hidden = ordered.length - shown.length;

  const rows = shown
    .map((term) => {
      if (term.kind === 'aging-attention') {
        return `<tr><td>${item(term.workItemId)}</td><td>${term.excessDays}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
      }
      if (term.kind === 'overdue-attention') {
        return `<tr><td>${item(term.workItemId)}</td><td>${term.overdueDays}</td><td>${esc(term.dueAt)}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
      }
      // queue-wait-attention
      return `<tr><td>${item(term.workItemId)}</td><td>${esc(term.waitDays)}</td><td>${term.visits}</td><td>${term.openAtAnalysisTime ? 'yes' : 'no'}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
    })
    .join('');

  const kind = estimate.trace.terms[0]?.kind;
  const head =
    kind === 'aging-attention'
      ? '<tr><th>Item</th><th>Days beyond threshold</th><th>Attention h/day</th><th>Rate</th><th>Subtotal</th></tr>'
      : kind === 'overdue-attention'
        ? '<tr><th>Item</th><th>Days overdue</th><th>Due date</th><th>Attention h/day</th><th>Rate</th><th>Subtotal</th></tr>'
        : '<tr><th>Item</th><th>Wait (days)</th><th>Visits</th><th>Open now</th><th>Attention h/day</th><th>Rate</th><th>Subtotal</th></tr>';
  const cols = kind === 'aging-attention' ? 5 : kind === 'overdue-attention' ? 6 : 7;
  const more =
    hidden > 0
      ? `<tr><td colspan="${cols}" class="note">+ ${hidden.toLocaleString('en-US')} more item${hidden === 1 ? '' : 's'} contributing to this figure — the full itemized breakdown is in the <em>Raw markdown</em> export.</td></tr>`
      : '';
  return `<div class="table-wrap"><table>${head}${rows}${more}</table></div>`;
}

function renderRankedFriction(
  rf: RankedFriction,
  titleOf: Map<string, string>,
  currency: string,
  open: boolean,
  barPct: number,
): string {
  const { instance, estimate } = rf;
  const trace = estimate.trace;
  const assumptions = trace.assumptionsUsed
    .map(
      (a) =>
        `<li><code>${esc(a.ref)}</code> = ${esc(a.value)} — ${esc(provLabel(a.provenance))}</li>`,
    )
    .join('');
  const confidence =
    estimate.confidence.reasons.length === 0
      ? `<p>${confidenceBadge(estimate.confidence.tier)} — no binding constraints: fully observed data and customer-confirmed assumptions.</p>`
      : `<p>${confidenceBadge(estimate.confidence.tier)}, limited by:</p><ul>${estimate.confidence.reasons
          .map((r) => `<li>${esc(r)}</li>`)
          .join('')}</ul>`;
  return `<div class="friction">
    <h3>#${rf.rank} · ${esc(frictionLabel(instance.frictionType))} — stage “${esc(instance.location.stage.name)}”</h3>
    <p class="figure">${money(estimate.cost.expected, currency)} <span class="range-sub">· ${money(estimate.cost.low, currency)} – ${money(estimate.cost.high, currency)}</span> ${confidenceBadge(estimate.confidence.tier)}</p>
    <div class="fbar" aria-hidden="true"><i style="width:${barPct}%"></i></div>
    <p class="note">${instance.magnitude.value} ${esc(instance.magnitude.unit)}</p>
    <details${open ? ' open' : ''}>
      <summary>How this number was computed</summary>
      <p><strong>What is this?</strong> ${esc(trace.claim)}</p>
      <p><strong>How was it computed?</strong> <code>${esc(trace.formula)}</code></p>
      <p><strong>What data went in?</strong></p>
      ${renderTerms(estimate, titleOf, currency)}
      <p><strong>What was assumed?</strong></p>
      <ul>${assumptions}</ul>
      ${confidence}
    </details>
  </div>`;
}

function renderCoverage(run: AnalysisRun): string {
  const c = run.batch.counts;
  const cap = run.batch.capability;
  const capChips = [
    `<span class="chip">${c.imported} of ${c.totalRows} rows imported</span>`,
    c.dropped > 0 ? `<span class="chip">${c.dropped} dropped</span>` : '',
    `<span class="chip">event history ${cap.hasEventHistory ? '✓' : '—'}</span>`,
    `<span class="chip">due dates ${cap.hasDueDates ? '✓' : '—'}</span>`,
    `<span class="chip">last-updated ${cap.hasLastUpdated ? '✓' : '—'}</span>`,
    `<span class="chip">actors ${cap.hasActors ? '✓' : '—'}</span>`,
  ].join('');
  const detectors = run.detectors
    .map(
      (d) =>
        `<li>${esc(d.signalName)} — ${
          d.status === 'ran'
            ? `ran, ${d.instanceCount} finding(s)`
            : `<strong>skipped</strong>${d.reason ? `: ${esc(d.reason)}` : ''}`
        }</li>`,
    )
    .join('');
  const diagnostics =
    run.batch.diagnostics.length === 0
      ? ''
      : `<p class="note">Import diagnostics:</p><ul>${run.batch.diagnostics
          .map((d) => `<li>row ${d.row} — ${esc(d.severity)}: ${esc(d.message)}</li>`)
          .join('')}</ul>`;
  return `<section>
    <h2>Coverage &amp; confidence</h2>
    <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0 .9rem">${capChips}</div>
    <ul>${detectors}</ul>
    ${diagnostics}
  </section>`;
}

function renderContext(run: AnalysisRun): string {
  if (run.context.length === 0) return '';
  const rows = run.context
    .map((o) => {
      const facts = Object.entries(o.facts)
        .map(([k, v]) => `${esc(k)}: ${v}`)
        .join(' · ');
      return `<li>${esc(o.statement)}<br><span class="note">${facts}</span></li>`;
    })
    .join('');
  return `<section><h2>Context</h2>
    <p class="note">Context signals explain conditions behind frictions. They are never priced or ranked.</p>
    <ul>${rows}</ul></section>`;
}

function renderUnpriced(
  unpriced: readonly { instance: RankedFriction['instance']; reason: string }[],
): string {
  if (unpriced.length === 0) return '';
  const rows = unpriced
    .map(
      (u) =>
        `<li><strong>${esc(frictionLabel(u.instance.frictionType))}</strong> — stage “${esc(u.instance.location.stage.name)}” (${u.instance.magnitude.value} ${esc(u.instance.magnitude.unit)})<br><span class="note">${esc(u.reason)}</span></li>`,
    )
    .join('');
  return `<section><h2>Unpriced frictions</h2>
    <p class="note">Detected but not priced — the magnitude is real; the missing input is named. Confirm the assumption to price it.</p>
    <ul>${rows}</ul></section>`;
}

/** Run-over-run trend: match priced frictions by stable instance id. */
export function renderTrend(current: AnalysisRun, previous: AnalysisRun | null): string {
  if (!previous) return '';
  const currency = current.assumptions.currency;
  const cur = new Map(
    buildReportModel(current).ranked.map((r) => [r.instance.id, r.estimate.cost]),
  );
  const prev = new Map(
    buildReportModel(previous).ranked.map((r) => [r.instance.id, r.estimate.cost]),
  );
  const ids = [...new Set([...cur.keys(), ...prev.keys()])].sort();
  const rows = ids
    .map((id) => {
      const c = cur.get(id) ?? null;
      const p = prev.get(id) ?? null;
      // Delta of expected values via the engine's Money decimal (never a float);
      // range subtraction isn't offered because ranges are non-negative.
      const deltaExpected = decToString(dec(c?.expected ?? '0').minus(dec(p?.expected ?? '0')));
      const dir = !p ? 'new' : !c ? 'resolved' : compareDecimalStrings(c.expected, p.expected);
      const label =
        dir === 'new'
          ? '<span class="up">new</span>'
          : dir === 'resolved'
            ? '<span class="down">resolved</span>'
            : dir > 0
              ? '<span class="up">▲ increased</span>'
              : dir < 0
                ? '<span class="down">▼ decreased</span>'
                : 'unchanged';
      return `<tr><td>${esc(id)}</td><td>${p ? money(p.expected, currency) : '—'}</td><td>${c ? money(c.expected, currency) : '—'}</td><td>${money(deltaExpected, currency)}</td><td>${label}</td></tr>`;
    })
    .join('');
  return `<section><h2>Change since previous run</h2>
    <div class="table-wrap"><table><tr><th>Friction</th><th>Previous (expected)</th><th>Current (expected)</th><th>Δ expected</th><th>Change</th></tr>${rows}</table></div></section>`;
}

/** The report body (to be wrapped in the page shell). `previous` enables trend. */
export function renderReportBody(
  run: AnalysisRun,
  options: {
    runId: string;
    previous?: AnalysisRun | null;
    printLinks?: boolean;
    open?: boolean;
  } = { runId: '' },
): string {
  const model = buildReportModel(run);
  const currency = run.assumptions.currency;
  const titleOf = titleMap(run);
  const total = totalRange(model.ranked);
  const banner =
    run.pricingPolicy === 'simulation'
      ? `<p class="error"><strong>Simulation mode</strong> — this run prices vendor-suggested (unconfirmed) assumptions. Figures are conditional and not suitable for executive reporting.</p>`
      : '';
  // A business reader wants a readable date, not a raw ISO timestamp.
  const analysisDate = /^\d{4}-\d{2}-\d{2}/.test(run.now) ? run.now.slice(0, 10) : run.now;
  const summary = `<section class="report-hero">
    <p class="note" style="margin:0 0 .3rem;text-transform:uppercase;letter-spacing:.06em;font-size:.74rem;font-weight:640;color:var(--primary)">Total priced friction · expected</p>
    <p class="figure big" style="margin:0">${model.ranked.length === 0 ? 'No priced frictions above thresholds' : money(total.expected, currency)}</p>
    ${model.ranked.length === 0 ? '' : `<p class="note" style="margin:.3rem 0 0">Range ${money(total.low, currency)} – ${money(total.high, currency)}</p>`}
    <div class="meta">
      <span class="chip">${model.ranked.length} priced</span>
      <span class="chip">${model.unpriced.length} unpriced</span>
      <span class="chip">Analysis of ${esc(analysisDate)}</span>
      <span class="chip">Currency ${esc(currency)}</span>
    </div>
  </section>`;
  // Relative-magnitude bars: the width ratio is PURE PRESENTATION (a CSS
  // percentage, never rendered as a figure), so a float here cannot leak into
  // any displayed number — all money strings still come from the engine.
  const maxExpected = model.ranked.reduce(
    (acc, rf) => Math.max(acc, Number(rf.estimate.cost.expected) || 0),
    0,
  );
  const pctOf = (rf: RankedFriction): number =>
    maxExpected <= 0
      ? 0
      : Math.max(
          2,
          Math.min(100, Math.round((Number(rf.estimate.cost.expected) / maxExpected) * 100)),
        );
  const ranked =
    model.ranked.length === 0
      ? '<p class="note">No priced frictions detected above thresholds in this import.</p>'
      : model.ranked
          .map((rf) =>
            renderRankedFriction(rf, titleOf, currency, options.open === true, pctOf(rf)),
          )
          .join('');
  const links = options.printLinks
    ? `<p class="note"><a href="/reports/${esc(options.runId)}/print">Printable / export version</a> · <a href="/reports/${esc(options.runId)}/raw">Raw markdown</a></p>`
    : '';
  return `<p class="eyebrow">Friction report</p>
    <h1 style="margin-top:.6rem">What friction is costing this team</h1>
    <p class="note">Every figure is an estimate with stated assumptions and a traceable formula. <span title="Reference for support">Ref <code>${esc(run.runId)}</code></span></p>
    ${banner}
    ${summary}
    ${links}
    <section><h2>Ranked frictions</h2>${ranked}</section>
    ${renderTrend(run, options.previous ?? null)}
    ${renderUnpriced(model.unpriced)}
    ${renderContext(run)}
    ${renderCoverage(run)}`;
}

/** Parse a persisted run.json string into the typed artifact. */
export function parseRun(runJson: string): AnalysisRun {
  return JSON.parse(runJson) as AnalysisRun;
}

/**
 * Safe headline summary of a stored run for list rows (runs list, dashboard).
 * Same deterministic model + formatter the report uses; null on any parse
 * failure so callers fall back to a generic label.
 */
export function runSummary(runJson: string): { expectedText: string; priced: number } | null {
  try {
    const run = parseRun(runJson);
    const model = buildReportModel(run);
    const total = totalRange(model.ranked);
    return {
      priced: model.ranked.length,
      expectedText: formatWholeMoney(total.expected, run.assumptions.currency),
    };
  } catch {
    return null;
  }
}
