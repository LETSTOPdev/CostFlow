import type { AnalysisRun } from '@costflow/analysis';
import {
  addRanges,
  compareDecimalStrings,
  formatWholeMoney,
  rangeFromSpec,
  rangeToSpec,
  ZERO_RANGE,
  type CostEstimate,
  type TraceTerm,
} from '@costflow/cost-engine';
import type { BatchScope, RangeSpec } from '@costflow/domain';
import { buildReportModel, type RankedFriction } from '@costflow/reporting';
import { compareRuns, type ChangeDirection } from '@costflow/comparison';
import { esc } from './html';
import { renderDiagnostics, type DiagnosticsView } from './oi-view';

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

const DETAIL_LABEL =
  'margin:0 0 .3rem;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;font-weight:640;color:var(--faint)';

const FRICTION_LABELS: Record<string, string> = {
  aging: 'Aging / stagnation',
  'queue-wait': 'Queue wait',
  overdue: 'Overdue exposure',
};
const frictionLabel = (t: string): string => FRICTION_LABELS[t] ?? t;

const money = (value: string, currency: string): string => esc(formatWholeMoney(value, currency));

/**
 * Display-layer punctuation normalizer for engine-authored artifact strings
 * (assumption values, confidence reasons, unpriced reasons). The engine is
 * frozen under golden byte-identity, so its artifacts keep their original
 * punctuation; the web view renders numeric en-dash ranges as "a to b" and
 * em-dash clauses as separate sentences. Never applied to money strings.
 */
const displayText = (s: string): string =>
  s
    .replace(/(\d)\s?–\s?(\d)/g, '$1 to $2')
    .replace(/\s+—\s+(\p{L})/gu, (_, c: string) => `. ${c.toUpperCase()}`);

/**
 * A duration a person can read. The engine's decimal strings carry full
 * precision because the trace has to reproduce the arithmetic exactly; a
 * 1,388-hour wait divided by 24 is 57.83333333333333333333333333333333, and
 * printing that in an executive's evidence table is how a report loses its
 * reader. One decimal, trailing zero trimmed, so a whole number of days still
 * reads as a whole number.
 *
 * Display only: the artifact and the formula keep every digit.
 */
const days = (value: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return esc(value);
  return esc(String(Math.round(n * 10) / 10));
};

const rangeText = (spec: RangeSpec, currency: string): string =>
  `${money(spec.low, currency)} to ${money(spec.high, currency)} (expected ~${money(spec.expected, currency)})`;

/** Sum priced estimate ranges via the engine's range algebra (never floats). */
export function totalRange(ranked: readonly RankedFriction[]): RangeSpec {
  let acc = ZERO_RANGE;
  for (const r of ranked) acc = addRanges(acc, rangeFromSpec(r.estimate.cost));
  return rangeToSpec(acc);
}

function titleMap(run: AnalysisRun): Map<string, string> {
  return new Map(run.batch.items.map((i) => [i.id, i.title]));
}

export const confidenceBadge = (tier: string): string =>
  `<span class="tier tier-${esc(tier)}" title="Confidence tier ${esc(tier)}">Confidence ${esc(tier)}</span>`;

// Plain-language equivalents of the engine's magnitude units (buyers do not
// speak "item-hours-waiting"). Purely a label — the number is unchanged and
// still traces to the drill-down.
export const humanizeMagnitude = (value: number | string, unit: string): string => {
  const v = typeof value === 'number' ? value.toLocaleString('en-US') : esc(String(value));
  switch (unit) {
    case 'item-hours-waiting':
      return `${v} item-hours spent waiting in this queue`;
    case 'item-days-overdue':
      return `${v} item-days past their due date`;
    case 'item-days-beyond-threshold':
    case 'item-days-aging':
      return `${v} item-days sitting beyond the aging threshold`;
    default:
      return `${v} ${esc(unit)}`;
  }
};

// A deterministic, DATA-DERIVED interpretation of each friction — what it is in
// business terms and where the leverage is. Derived only from the friction type
// and the stage name (never a fabricated number, never AI-written per-report):
// this is the "so what do I do?" a buyer looks for, kept honest.
export const frictionInsight = (type: string, stage: string, agingDays: number): string => {
  const s = `“${esc(stage)}”`;
  switch (type) {
    case 'queue-wait':
      return `Work is <strong>sitting in the ${s} queue</strong> before anyone acts on it. This cost is pure wait, not effort. Cutting time in queue here, with WIP limits, faster pickup, or removing the hand-off, is usually the fastest win.`;
    case 'aging':
      return `Items in ${s} have gone <strong>untouched past your ${agingDays}-day mark</strong>, quietly accruing carrying cost. Clearing or closing the oldest items first recovers the most.`;
    case 'overdue':
      return `Commitments in ${s} are <strong>past their due date and still open</strong>. The cost is the chasing, re-planning, and stakeholder churn they create. Re-scoping or renegotiating these dates stops the bleed.`;
    default:
      return `Friction concentrated in ${s}. Open the breakdown to see the contributing work items.`;
  }
};

function renderTerms(
  estimate: CostEstimate,
  titleOf: Map<string, string>,
  currency: string,
): string {
  const rate = (t: Extract<TraceTerm, { hourlyRate: string }>): string =>
    `${esc(t.hourlyRate)}/h <span class="note">(${esc(t.rateSource)})</span>`;
  const attn = (r: RangeSpec): string => `${esc(r.low)} to ${esc(r.high)}`;
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
        return `<tr><td>${item(term.workItemId)}</td><td>${days(String(term.excessDays))}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
      }
      if (term.kind === 'overdue-attention') {
        return `<tr><td>${item(term.workItemId)}</td><td>${days(String(term.overdueDays))}</td><td>${esc(term.dueAt)}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
      }
      // queue-wait-attention
      return `<tr><td>${item(term.workItemId)}</td><td>${days(term.waitDays)}</td><td>${term.visits}</td><td>${term.openAtAnalysisTime ? 'yes' : 'no'}</td><td>${attn(term.attentionHoursPerDay)}</td><td>${rate(term)}</td><td>${rangeText(term.subtotal, currency)}</td></tr>`;
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
      ? `<tr><td colspan="${cols}" class="note">+ ${hidden.toLocaleString('en-US')} more item${hidden === 1 ? '' : 's'} contributing to this figure. The full itemized breakdown is in the <em>Raw markdown</em> export.</td></tr>`
      : '';
  return `<div class="table-wrap"><table>${head}${rows}${more}</table></div>`;
}

function renderRankedFriction(
  rf: RankedFriction,
  titleOf: Map<string, string>,
  currency: string,
  open: boolean,
  barPct: number,
  agingDays: number,
  originLabel: (originScopeId: string | null) => string | null,
): string {
  const { instance, estimate } = rf;
  const trace = estimate.trace;
  const assumptions = trace.assumptionsUsed
    .map(
      (a) =>
        `<li><code>${esc(a.ref)}</code> = ${esc(displayText(a.value))} (${esc(provLabel(a.provenance))})</li>`,
    )
    .join('');
  const confidence =
    estimate.confidence.reasons.length === 0
      ? `<p>${confidenceBadge(estimate.confidence.tier)} No binding constraints: fully observed data and customer-confirmed assumptions.</p>`
      : `<p>${confidenceBadge(estimate.confidence.tier)}, limited by:</p><ul>${estimate.confidence.reasons
          .map((r) => `<li>${esc(displayText(r))}</li>`)
          .join('')}</ul>`;
  return `<div class="friction">
    <h3>#${rf.rank} ${esc(frictionLabel(instance.frictionType))} in stage “${esc(instance.location.stage.name)}”${
      // Whose queue this is. Omitted entirely for an import with no scope
      // structure, where the qualifier would be noise.
      originLabel(instance.location.originScopeId) === null
        ? ''
        : ` <span class="note">— ${esc(originLabel(instance.location.originScopeId) as string)}</span>`
    }</h3>
    <p class="figure">${money(estimate.cost.expected, currency)} <span class="range-sub">${money(estimate.cost.low, currency)} to ${money(estimate.cost.high, currency)}</span> ${confidenceBadge(estimate.confidence.tier)}</p>
    <div class="fbar" aria-hidden="true"><i style="width:${barPct}%"></i></div>
    <p class="note">${humanizeMagnitude(instance.magnitude.value, instance.magnitude.unit)}</p>
    <p>${frictionInsight(instance.frictionType, instance.location.stage.name, agingDays)}</p>
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
    `<span class="chip">event history ${cap.hasEventHistory ? '✓' : '✕'}</span>`,
    `<span class="chip">due dates ${cap.hasDueDates ? '✓' : '✕'}</span>`,
    `<span class="chip">last-updated ${cap.hasLastUpdated ? '✓' : '✕'}</span>`,
    `<span class="chip">actors ${cap.hasActors ? '✓' : '✕'}</span>`,
  ].join('');
  const detectors = run.detectors
    .map(
      (d) =>
        `<li>${esc(d.signalName)}: ${
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
          .map((d) => `<li>row ${d.row}, ${esc(d.severity)}: ${esc(d.message)}</li>`)
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
        .join(', ');
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
        `<li><strong>${esc(frictionLabel(u.instance.frictionType))}</strong> in stage “${esc(u.instance.location.stage.name)}” (${u.instance.magnitude.value} ${esc(u.instance.magnitude.unit)})<br><span class="note">${esc(displayText(u.reason))}</span></li>`,
    )
    .join('');
  return `<section><h2>Unpriced frictions</h2>
    <p class="note">Detected but not priced. The magnitude is real and the missing input is named. Confirm the assumption to price it.</p>
    <ul>${rows}</ul></section>`;
}

const CHANGE_LABEL: Record<ChangeDirection, string> = {
  new: '<span class="up">new</span>',
  resolved: '<span class="down">resolved</span>',
  increased: '<span class="up">▲ increased</span>',
  decreased: '<span class="down">▼ decreased</span>',
  unchanged: 'unchanged',
};

/**
 * Run-over-run trend, gated on the comparability verdict (doc 19 MW1).
 *
 * A trend is a CLAIM — that a number moved because the work changed. When the
 * verdict says the two runs are not measuring the same thing, no trend is
 * rendered at all: a wrong trend is worse than no trend, and a caveat above a
 * table of arrows does not stop anyone reading the arrows. What replaces it is
 * an explanation of what differs and, where there is one, what to do about it.
 *
 * Until MW1 this rendered unconditionally, so a salary edit between two runs
 * showed up as the team improving.
 */
export function renderTrend(current: AnalysisRun, previous: AnalysisRun | null): string {
  if (!previous) return '';
  const currency = current.assumptions.currency;
  const { verdict, findings, diff } = compareRuns(previous, current);

  if (verdict === 'not-comparable') {
    const blocking = findings.filter((f) => f.severity === 'blocking');
    const items = blocking
      .map(
        (f) =>
          `<li>${esc(f.detail)}${f.remedy ? ` <span class="note">${esc(f.remedy)}</span>` : ''}</li>`,
      )
      .join('');
    return `<section><h2>Change since previous run</h2>
      <p class="note" style="margin:0 0 .5rem">No comparison is shown, because these two runs are not measuring the same thing. Putting a number on the difference would be misleading rather than incomplete.</p>
      <ul style="margin:0;padding-left:1.1rem">${items}</ul></section>`;
  }

  const notes = findings
    .filter((f) => f.severity === 'note')
    .map((f) => `<li>${esc(f.detail)}</li>`)
    .join('');
  const caveat =
    notes === ''
      ? ''
      : `<p class="note" style="margin:0 0 .5rem">Read this alongside:</p><ul class="note" style="margin:0 0 .6rem;padding-left:1.1rem">${notes}</ul>`;

  const rows = diff.instances
    .map(
      (i) =>
        `<tr><td>${esc(i.instanceId)}</td><td>${i.baselineCost ? money(i.baselineCost.expected, currency) : 'n/a'}</td><td>${i.currentCost ? money(i.currentCost.expected, currency) : 'n/a'}</td><td>${money(i.expectedDelta, currency)}</td><td>${CHANGE_LABEL[i.direction]}</td></tr>`,
    )
    .join('');
  return `<section><h2>Change since previous run</h2>${caveat}
    <div class="table-wrap"><table><tr><th>Friction</th><th>Previous (expected)</th><th>Current (expected)</th><th>Δ expected</th><th>Change</th></tr>${rows}</table></div></section>`;
}

/** The report body (to be wrapped in the page shell). `previous` enables trend. */
/**
 * The report an executive reads.
 *
 * The order is the argument. A CEO with two minutes needs, in this sequence:
 * what the biggest operational problem is, why it is happening, what to do
 * first, what that action is worth, and what evidence stands behind it. The
 * recommendations answer all five, so they come SECOND — immediately after the
 * one number that says whether to keep reading — and everything else on the
 * page is explicitly marked as supporting detail.
 *
 * Until 2026-07-28 they came last, after the methodology. A reader who stopped
 * at the total never saw the part of the product that tells them what to do.
 */
export function renderReportBody(
  run: AnalysisRun,
  options: {
    runId: string;
    previous?: AnalysisRun | null;
    printLinks?: boolean;
    open?: boolean;
    /** Recommendations. Absent only where none could be computed. */
    diagnostics?: DiagnosticsView | null;
    /** Marks the recommendations as computed from generated data. */
    demo?: boolean;
  } = { runId: '' },
): string {
  const model = buildReportModel(run);
  const currency = run.assumptions.currency;
  const titleOf = titleMap(run);
  const total = totalRange(model.ranked);
  const banner =
    run.pricingPolicy === 'simulation'
      ? `<p class="error"><strong>Simulation mode.</strong> This run prices vendor-suggested, unconfirmed assumptions. Figures are conditional and not suitable for executive reporting.</p>`
      : '';
  // A business reader wants a readable date, not a raw ISO timestamp.
  const analysisDate = /^\d{4}-\d{2}-\d{2}/.test(run.now) ? run.now.slice(0, 10) : run.now;
  const scopes = run.batch.scopes as readonly BatchScope[] | undefined;
  const originLabel = (originScopeId: string | null): string | null =>
    originScopeId === null ? null : (scopes?.find((sc) => sc.id === originScopeId)?.label ?? null);
  const covers =
    scopes === undefined || scopes.length === 0
      ? ''
      : `<span class="chip">Covering ${scopes.map((sc) => esc(sc.label)).join(', ')}</span>`;
  const summary = `<section class="report-hero">
    <p class="note" style="margin:0 0 .3rem;text-transform:uppercase;letter-spacing:.06em;font-size:.74rem;font-weight:640;color:var(--primary)">Total priced friction (expected)</p>
    <p class="figure big" style="margin:0">${model.ranked.length === 0 ? 'No priced frictions above thresholds' : money(total.expected, currency)}</p>
    ${model.ranked.length === 0 ? '' : `<p class="note" style="margin:.3rem 0 0">Range ${money(total.low, currency)} to ${money(total.high, currency)}</p>`}
    <div class="meta">
      <span class="chip">${model.ranked.length} priced</span>
      <span class="chip">${model.unpriced.length} unpriced</span>
      <span class="chip">Analysis of ${esc(analysisDate)}</span>
      <span class="chip">Currency ${esc(currency)}</span>
      ${covers}
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
  const agingDays = run.assumptions.parameters.agingThresholdDays.value;
  const ranked =
    model.ranked.length === 0
      ? `<div class="info">No priced friction crossed your thresholds in this import. That's a genuinely healthy sign for the work analyzed. If you expected findings, your aging and queue thresholds may be set conservatively. Lower them and run again to surface smaller effects.</div>`
      : model.ranked
          .map((rf) =>
            renderRankedFriction(
              rf,
              titleOf,
              currency,
              options.open === true,
              pctOf(rf),
              agingDays,
              originLabel,
            ),
          )
          .join('');
  const links = options.printLinks
    ? `<p class="note"><a href="/reports/${esc(options.runId)}/print">Printable / export version</a> &nbsp; <a href="/reports/${esc(options.runId)}/raw">Raw markdown</a></p>`
    : '';
  const lead =
    model.ranked.length === 0
      ? ''
      : `<p class="lead" style="margin-top:.6rem">This is the ongoing cost of workflow friction your team is currently carrying: time lost to waiting, chasing, and stalled work. It's <strong>recoverable</strong>, and the section below says where to start.</p>`;
  // Methodology used to sit between the headline and the number, which is the
  // wrong place for it: it is what a reader consults after deciding to trust
  // the report, not before deciding to read it.
  const methodology = `<p class="note">Every figure is an <strong>estimate shown as a range</strong>, computed from your own work items and the rates you confirmed, and traceable to its formula (open “How this number was computed”). <strong>Confidence A/B/C</strong> reflects how much we observed versus inferred. Where a required input isn't confirmed, we leave the item <strong>unpriced</strong> rather than guess. <span title="Reference for support">Ref <code>${esc(run.runId)}</code></span></p>`;
  /**
   * What the top of the report says when no diagnostic cleared its evidence
   * gate. A small workspace routinely produces real priced friction and no
   * pattern strong enough to recommend against — and telling an executive
   * "nothing to recommend" directly above thousands of dollars is the worst
   * possible reading of a correct result.
   *
   * This names the largest MEASURED cost and says so. The diagnostic stays
   * suppressed, nothing is fitted, no number is invented: every figure here is
   * already rendered further down the same page.
   */
  const largest = model.ranked[0];
  const largestMeasured =
    largest === undefined
      ? undefined
      : `<p style="margin:0 0 .5rem">No pattern in this run cleared the evidence threshold, so CostFlow is not recommending a specific intervention. The largest <strong>measured</strong> cost is:</p>
         <p style="margin:0 0 .3rem"><strong>${money(largest.estimate.cost.expected, currency)}</strong> — ${esc(frictionLabel(largest.instance.frictionType).toLowerCase())} in stage “${esc(largest.instance.location.stage.name)}”${
           originLabel(largest.instance.location.originScopeId) === null
             ? ''
             : `, ${esc(originLabel(largest.instance.location.originScopeId) as string)}`
         }.</p>
         <p style="margin:0 0 .5rem">${frictionInsight(largest.instance.frictionType, largest.instance.location.stage.name, agingDays)}</p>
         <p class="note" style="margin:0">This is arithmetic over your own work items, not a fitted recommendation. A workspace with more history behind each stage gives the diagnostics enough evidence to name an intervention as well.</p>`;
  const recommendations = options.diagnostics
    ? renderDiagnostics(options.diagnostics, {
        ...(options.demo === true ? { demo: true } : {}),
        ...(largestMeasured === undefined ? {} : { largestMeasured }),
      })
    : '';
  const detailDivider = `<hr style="margin:2.2rem 0 1.4rem">
     <p class="note" style="${DETAIL_LABEL}">Supporting detail</p>
     <p class="note" style="margin:0 0 1.2rem">Everything above is the decision. Everything below is the working behind it: each priced friction with its formula, what moved since last time, what could not be priced, and how much of your data the analysis could see.</p>`;
  return `<p class="eyebrow">Friction report</p>
    <h1 style="margin-top:.6rem">What friction is costing this team</h1>
    ${lead}
    ${banner}
    ${summary}
    ${recommendations}
    ${detailDivider}
    <section><h2>Ranked frictions</h2>
    ${
      model.ranked.length === 0
        ? ''
        : `<p class="note" style="margin-top:-.3rem">Ranked by expected cost, biggest first. ${
            options.diagnostics && options.diagnostics.findings.length > 0
              ? // Two orders on one page is a credibility problem unless the page says
                // why. The most expensive finding and the best-evidenced one are
                // genuinely different questions, and a reader who spots the
                // difference without an explanation loses confidence in both.
                'This is a different order from <em>Where to act first</em> above, which leads with the strongest evidence rather than the largest figure. The biggest number and the surest finding are not always the same one.'
              : ''
          }</p>`
    }
    ${ranked}</section>
    ${renderTrend(run, options.previous ?? null)}
    ${renderUnpriced(model.unpriced)}
    ${renderContext(run)}
    ${renderCoverage(run)}
    ${methodology}
    ${links}`;
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
