import { compareDecimalStrings, dec, decToString, formatWholeMoney } from '@costflow/cost-engine';
import type { RangeSpec } from '@costflow/domain';
import { buildReportModel, type RankedFriction } from '@costflow/reporting';
import type { AnalysisRun } from '@costflow/analysis';
import { esc } from './html';
import { frictionInsight, parseRun, totalRange } from './report-view';

/**
 * Executive dashboard. One dominant number, three plain-English decisions,
 * history below the fold. Pure presentation over the immutable run.json
 * artifact — every figure comes from `buildReportModel` + the engine's own
 * range/decimal algebra, so this page can never diverge from the report or
 * the goldens. No number is re-derived; the only float is a CSS bar width
 * (the same sanctioned pattern as the report's magnitude bars).
 *
 * Copy rules: platform vocabulary comes exclusively from the connector
 * descriptor (provider-aware invariant); no internal terminology — the cards
 * speak in money and stage names, never in engine units.
 */

export interface DashboardRun {
  readonly id: string;
  readonly createdAt: string;
  readonly runJson: string;
}

export interface DashboardFailure {
  readonly createdAt: string;
  readonly errorClass: string | null;
  readonly errorMessage: string | null;
}

export interface DashboardInput {
  readonly scopeName: string | null;
  readonly scopeId: string | null;
  /** Connector's describeConnection() line — provider-correct by construction. */
  readonly connectionText: string;
  /** Connector display name (e.g. "Jira", "ClickUp"). */
  readonly providerName: string;
  /** Descriptor scope noun ("project", "List", …) for provider-neutral copy. */
  readonly scopeNounSingular: string;
  /** Pre-rendered CSRF hidden input for the run form. */
  readonly csrfField: string;
  /** Newest first. */
  readonly runs: readonly DashboardRun[];
  /** Most recent failed jobs (already limited by the caller). */
  readonly failures: readonly DashboardFailure[];
}

interface RunDigest {
  readonly run: AnalysisRun;
  readonly ranked: readonly RankedFriction[];
  readonly unpricedCount: number;
  readonly total: RangeSpec;
  readonly currency: string;
}

const money = (value: string, currency: string): string => esc(formatWholeMoney(value, currency));

/**
 * Hero variant of the same sanctioned money string: when the formatter ends
 * with a 3-letter currency code, demote the code typographically so the
 * number dominates. The text content is byte-identical to formatWholeMoney.
 */
const heroMoney = (value: string, currency: string): string => {
  const text = formatWholeMoney(value, currency);
  const m = /^(.*) ([A-Z]{3})$/.exec(text);
  return m ? `${esc(m[1] as string)} <span class="cur">${esc(m[2] as string)}</span>` : esc(text);
};

/** Same deterministic timestamp format the run list uses (ISO-parsed, never TZ-dependent). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtWhen = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return esc(iso);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]} · ${m[4]}:${m[5]} UTC`;
};

/** Summarize a stored artifact; null when the blob cannot be read (mirrors runSummary). */
const digestOf = (runJson: string): RunDigest | null => {
  try {
    const run = parseRun(runJson);
    const model = buildReportModel(run);
    return {
      run,
      ranked: model.ranked,
      unpricedCount: model.unpriced.length,
      total: totalRange(model.ranked),
      currency: run.assumptions.currency,
    };
  } catch {
    return null;
  }
};

/**
 * A friction as an executive subject ("Work waiting in the “Review” queue"),
 * with its verb — so cards read as sentences about money, not as categories.
 */
const frictionSubject = (type: string, stage: string): { subject: string; verb: string } => {
  const s = `“${esc(stage)}”`;
  switch (type) {
    case 'queue-wait':
      return { subject: `Work waiting in the ${s} queue`, verb: 'is' };
    case 'aging':
      return { subject: `Items sitting untouched in ${s}`, verb: 'are' };
    case 'overdue':
      return { subject: `Missed due dates in ${s}`, verb: 'are' };
    default:
      return { subject: `Friction concentrated in ${s}`, verb: 'is' };
  }
};

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

/** Best-evidence finding: strongest tier first, then the deterministic rank order. */
const strongestFinding = (ranked: readonly RankedFriction[]): RankedFriction | null =>
  [...ranked].sort(
    (a, b) =>
      (TIER_ORDER[a.estimate.confidence.tier] ?? 9) -
        (TIER_ORDER[b.estimate.confidence.tier] ?? 9) || a.rank - b.rank,
  )[0] ?? null;

const tierPills = (ranked: readonly RankedFriction[]): string => {
  const counts = new Map<string, number>();
  for (const r of ranked) {
    counts.set(r.estimate.confidence.tier, (counts.get(r.estimate.confidence.tier) ?? 0) + 1);
  }
  return ['A', 'B', 'C']
    .filter((t) => (counts.get(t) ?? 0) > 0)
    .map((t) => `<span class="tier tier-${t}">${t} × ${counts.get(t)}</span>`)
    .join(' ');
};

/** Money delta vs the previous analysis, via the engine's decimal (never a float). */
const trendLine = (current: RunDigest, previous: RunDigest | null): string => {
  if (!previous) return '';
  const cmp = compareDecimalStrings(current.total.expected, previous.total.expected);
  if (cmp === 0) return `<p class="hero-trend note">Unchanged vs the previous analysis</p>`;
  const abs =
    cmp > 0
      ? decToString(dec(current.total.expected).minus(dec(previous.total.expected)))
      : decToString(dec(previous.total.expected).minus(dec(current.total.expected)));
  const amount = money(abs, current.currency);
  return cmp > 0
    ? `<p class="hero-trend"><span class="up">▲ ${amount} more</span> than the previous analysis</p>`
    : `<p class="hero-trend"><span class="down">▼ ${amount} less</span> than the previous analysis</p>`;
};

const runForm = (csrfField: string, label: string, note: string): string =>
  `<form method="post" action="/runs">${csrfField}<button type="submit" class="btn-lg">${esc(label)}</button></form>
   <p class="hero-note">${note}</p>`;

const safetyNote = (providerName: string): string =>
  `Read-only · never changes anything in ${esc(providerName)}`;

// ---------- hero ----------

const heroWithFindings = (
  input: DashboardInput,
  latest: RunDigest,
  previous: RunDigest | null,
): string => {
  const { total, currency, ranked, unpricedCount } = latest;
  const scope = input.scopeName ? ` · “${esc(input.scopeName)}”` : '';
  const sub = [
    `${money(total.low, currency)} – ${money(total.high, currency)} range`,
    `${ranked.length} priced finding${ranked.length === 1 ? '' : 's'}${unpricedCount > 0 ? ` · ${unpricedCount} unpriced` : ''}`,
  ].join(' · ');
  return `<section class="dash-hero">
    <p class="hero-eyebrow">Potential recoverable cost</p>
    <p class="figure-hero">${heroMoney(total.expected, currency)}</p>
    <p class="hero-sub">${sub}</p>
    <p class="hero-sub">Analysis of ${fmtWhen(input.runs[0]?.createdAt ?? '')}${scope}</p>
    ${trendLine(latest, previous)}
    ${runForm(input.csrfField, 'Analyze Again', safetyNote(input.providerName))}
  </section>`;
};

const heroNothingPriced = (input: DashboardInput, latest: RunDigest): string =>
  `<section class="dash-hero">
    <p class="hero-eyebrow">Potential recoverable cost</p>
    <p class="figure-hero quiet">No priced friction above your thresholds</p>
    <p class="hero-sub">Analysis of ${fmtWhen(input.runs[0]?.createdAt ?? '')}${latest.unpricedCount > 0 ? ` · ${latest.unpricedCount} unpriced finding${latest.unpricedCount === 1 ? '' : 's'} awaiting a confirmed assumption` : ''}</p>
    ${runForm(input.csrfField, 'Analyze Again', safetyNote(input.providerName))}
  </section>`;

const heroUnreadable = (input: DashboardInput): string =>
  `<section class="dash-hero">
    <p class="hero-eyebrow">Latest analysis</p>
    <p class="figure-hero quiet">Your report is ready</p>
    <p class="hero-sub"><a href="/reports/${esc(input.runs[0]?.id ?? '')}">Open the full report →</a></p>
    ${runForm(input.csrfField, 'Analyze Again', safetyNote(input.providerName))}
  </section>`;

const heroFirstRun = (input: DashboardInput): string =>
  `<section class="dash-hero">
    <p class="hero-eyebrow">CostFlow is ready</p>
    <h1 class="hero-title">Your ${esc(input.providerName)} ${esc(input.scopeNounSingular)} is connected.<br>See what its friction costs.</h1>
    ${runForm(input.csrfField, 'Run First Analysis', `Read-only · about a minute · never changes anything in ${esc(input.providerName)}`)}
  </section>
  <div class="dash-cards">
    <div class="insight"><p class="k">You'll see</p><p class="lede">One recoverable-cost total for the whole ${esc(input.scopeNounSingular)}.</p></div>
    <div class="insight"><p class="k">Ranked by cost</p><p class="lede">Every friction priced and ordered by expected business impact.</p></div>
    <div class="insight"><p class="k">Graded evidence</p><p class="lede">Each figure carries an A/B/C confidence grade and its full formula.</p></div>
  </div>`;

// ---------- insight cards ----------

const insightCards = (latest: RunDigest, latestRunId: string): string => {
  const { ranked, total, currency } = latest;
  const top = ranked[0];
  if (!top) return '';
  const topStage = top.instance.location.stage.name;
  const topSubject = frictionSubject(top.instance.frictionType, topStage);
  // Share of total: CSS-only presentation float (same sanctioned pattern as
  // the report's magnitude bars) — never rendered as a standalone figure
  // without its % suffix, never fed back into any money string.
  const totalNum = Number(total.expected) || 0;
  const pct =
    totalNum > 0
      ? Math.min(
          100,
          Math.max(1, Math.round(((Number(top.estimate.cost.expected) || 0) / totalNum) * 100)),
        )
      : 0;
  const share =
    ranked.length > 1 && pct > 0
      ? `<div class="fbar" aria-hidden="true"><i style="width:${pct}%"></i></div><p class="note">${pct}% of the total</p>`
      : '';
  const strongest = strongestFinding(ranked);
  const strongestCard = strongest
    ? `<div class="insight">
        <p class="k">How solid is this</p>
        <p class="lede">Strongest evidence: ${lowerFirst(frictionSubject(strongest.instance.frictionType, strongest.instance.location.stage.name).subject)} — about <strong>${money(strongest.estimate.cost.expected, currency)}</strong>, grade&nbsp;${esc(strongest.estimate.confidence.tier)}.</p>
        <p class="note">${tierPills(ranked)}</p>
      </div>`
    : '';
  const agingDays = latest.run.assumptions.parameters.agingThresholdDays.value;
  return `<div class="dash-cards">
    <div class="insight">
      <p class="k">Where it's going</p>
      <p class="lede">${topSubject.subject} ${topSubject.verb} costing about <strong>${money(top.estimate.cost.expected, currency)}</strong>.</p>
      ${share}
      <a class="go" href="/reports/${esc(latestRunId)}">See the evidence →</a>
    </div>
    ${strongestCard}
    <div class="insight">
      <p class="k">What to do today</p>
      <p class="lede-sm">${frictionInsight(top.instance.frictionType, topStage, agingDays)}</p>
      <a class="go" href="/reports/${esc(latestRunId)}">Open the full report →</a>
    </div>
  </div>`;
};

// ---------- reports ----------

const reportCard = (run: DashboardRun): string => {
  const digest = digestOf(run.runJson);
  const when = fmtWhen(run.createdAt);
  if (!digest) {
    return `<a class="report-card" href="/reports/${esc(run.id)}">
      <span class="amt">Friction analysis</span>
      <span class="sub">${when}</span>
      <span class="go">View report →</span>
    </a>`;
  }
  const { ranked, total, currency } = digest;
  const top = ranked[0];
  const amt =
    ranked.length === 0
      ? `<span class="amt">Nothing above thresholds</span>`
      : `<span class="amt">${money(total.expected, currency)} <span class="tier tier-${esc(top?.estimate.confidence.tier ?? '')}">${esc(top?.estimate.confidence.tier ?? '')}</span></span>`;
  const topLine = top
    ? `<span class="sub">Top: ${lowerFirst(frictionSubject(top.instance.frictionType, top.instance.location.stage.name).subject)}</span>`
    : '';
  return `<a class="report-card" href="/reports/${esc(run.id)}">
    ${amt}
    ${topLine}
    <span class="sub">${ranked.length} priced · ${when}</span>
    <span class="go">View report →</span>
  </a>`;
};

const failureBanner = (failures: readonly DashboardFailure[]): string =>
  failures.length === 0
    ? ''
    : `<div class="danger"><h3>Recent failures</h3><ul style="margin:0">${failures
        .map(
          (j) =>
            `<li><span class="note">${fmtWhen(j.createdAt)}</span> — <strong>${esc(j.errorClass ?? 'unexpected')}</strong>${j.errorMessage ? `: ${esc(j.errorMessage)}` : ''}</li>`,
        )
        .join('')}</ul></div>`;

// ---------- page ----------

export function renderDashboard(input: DashboardInput): string {
  const foot = `<p class="dash-foot">${esc(input.scopeName ?? 'Your workspace')}${input.scopeId ? ` (${esc(input.scopeId)})` : ''} · ${esc(input.connectionText)} · credentials encrypted at rest · <a href="/settings">Settings</a></p>`;

  if (input.runs.length === 0) {
    return heroFirstRun(input) + failureBanner(input.failures) + foot;
  }

  const latestRun = input.runs[0] as DashboardRun;
  const latest = digestOf(latestRun.runJson);
  const previous = input.runs.length > 1 ? digestOf((input.runs[1] as DashboardRun).runJson) : null;

  const hero =
    latest === null
      ? heroUnreadable(input)
      : latest.ranked.length === 0
        ? heroNothingPriced(input, latest)
        : heroWithFindings(input, latest, previous);
  const cards = latest === null ? '' : insightCards(latest, latestRun.id);

  const reports = `<div class="dash-section-head"><h2>Past analyses</h2><a href="/runs">All runs →</a></div>
    <div class="report-cards">${input.runs.slice(0, 6).map(reportCard).join('')}</div>`;

  return hero + cards + failureBanner(input.failures) + reports + foot;
}
