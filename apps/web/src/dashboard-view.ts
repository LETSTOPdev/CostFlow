import { describeSelection, selectionNames } from './scopes';
import type { WorkspaceScope } from './store/contract';
import { compareDecimalStrings, dec, decToString, formatWholeMoney } from '@costflow/cost-engine';
import type { BatchScope, RangeSpec } from '@costflow/domain';
import { buildReportModel, type RankedFriction } from '@costflow/reporting';
import { assessComparability } from '@costflow/comparison';
import type { AnalysisRun } from '@costflow/analysis';

import { esc, frictionInsight, frictionSubject, parseRun, totalRange } from '@costflow/ui';

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
  /** Already in the customer's language — the caller owns the class-to-label map. */
  readonly errorLabel: string;
  readonly errorMessage: string | null;
}

export interface DashboardInput {
  /** The workspace's scope selection, in stored order. */
  readonly scopes: readonly WorkspaceScope[];
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

/** Same deterministic timestamp format the run list uses (ISO-parsed, never TZ-dependent). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtWhen = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return esc(iso);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}, ${m[4]}:${m[5]} UTC`;
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

/**
 * Money delta vs the previous analysis, via the engine's decimal (never a float).
 *
 * Gated on the comparability verdict, exactly as the report's trend is (D10).
 * A total can move because the work changed, or because the scope, the
 * assumptions, the engine or the set of detectors that ran changed — and only
 * the first of those is the customer improving. This line used to compare the
 * two totals unconditionally, so a first run that priced nothing (because its
 * assumptions were still unconfirmed) followed by a run that priced everything
 * rendered as "▲ 5,565 USD more than the previous analysis": a fabricated
 * regression, on the first screen a returning customer sees, while the report
 * one click away correctly refused to compare them at all.
 *
 * On `not-comparable` the dashboard says nothing rather than guessing; the
 * report is where the reasons are enumerated, and the link is already there.
 */
const trendLine = (current: RunDigest, previous: RunDigest | null): string => {
  if (!previous) return '';
  if (assessComparability(previous.run, current.run).verdict === 'not-comparable') return '';
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
  `Read-only. Never changes anything in ${esc(providerName)}.`;

/**
 * Which team's queue this is, when saying so distinguishes anything. Shared by
 * the hero and the insight cards so they never disagree.
 */
const whoseIn = (
  latest: RunDigest,
  location: { readonly originScopeId: string | null },
): string => {
  const scopes = (latest.run.batch.scopes as readonly BatchScope[] | undefined) ?? [];
  if (scopes.length < 2 || location.originScopeId === null) return '';
  const label = scopes.find((sc) => sc.id === location.originScopeId)?.label;
  return label === undefined ? '' : ` in ${esc(label)}`;
};

// ---------- hero ----------

const heroWithFindings = (
  input: DashboardInput,
  latest: RunDigest,
  previous: RunDigest | null,
): string => {
  const { total, currency, ranked, unpricedCount } = latest;
  const selection = describeSelection(input.scopes);
  const scope = selection ? ` for “${esc(selection)}”` : '';
  const sub = `${money(total.expected, currency)} of priced friction, ${money(total.low, currency)} to ${money(total.high, currency)}. ${ranked.length} priced finding${ranked.length === 1 ? '' : 's'}${unpricedCount > 0 ? `, ${unpricedCount} unpriced` : ''}.`;
  /**
   * The dashboard leads with the same thing the report does: the action. The
   * total moved from the headline to the line beneath it, where it is the
   * evidence that the action is worth taking (D22). A returning executive
   * should get the same answer here as in the report, in the same order — two
   * surfaces with two different headlines is two products.
   */
  const top = ranked[0];
  const headline =
    top === undefined
      ? 'Your latest analysis'
      : `${frictionSubject(top.instance.frictionType, top.instance.location.stage.name).subject}${whoseIn(latest, top.instance.location)}`;
  return `<section class="dash-hero">
    <p class="hero-eyebrow">Start here</p>
    <p class="figure-hero quiet">${headline}</p>
    <p class="hero-sub">${sub}</p>
    <p class="hero-sub">Analysis of ${fmtWhen(input.runs[0]?.createdAt ?? '')}${scope}</p>
    ${trendLine(latest, previous)}
    ${runForm(input.csrfField, 'Analyze again', safetyNote(input.providerName))}
  </section>`;
};

/**
 * Nothing priced. Whether that is good news depends entirely on whether
 * anything was FOUND, and the two must never read the same: telling an
 * executive their process is healthy when the analysis found problems and
 * declined to price them is the worst thing either surface can say.
 */
const heroNothingPriced = (input: DashboardInput, latest: RunDigest): string =>
  latest.unpricedCount > 0
    ? `<section class="dash-hero">
        <p class="hero-eyebrow">Start here</p>
        <p class="figure-hero quiet">Confirm your assumptions to price ${latest.unpricedCount} finding${latest.unpricedCount === 1 ? '' : 's'}</p>
        <p class="hero-sub">The frictions are real and measured. Nothing is priced on a value you have not confirmed, so the cost is all that is missing. <a href="/assumptions">Review assumptions →</a></p>
        <p class="hero-sub">Analysis of ${fmtWhen(input.runs[0]?.createdAt ?? '')}</p>
        ${runForm(input.csrfField, 'Analyze again', safetyNote(input.providerName))}
      </section>`
    : `<section class="dash-hero">
        <p class="hero-eyebrow">Latest analysis</p>
        <p class="figure-hero quiet">No friction crossed your thresholds</p>
        <p class="hero-sub">Analysis of ${fmtWhen(input.runs[0]?.createdAt ?? '')}. Nothing was left unpriced either, so this is a clean result rather than a missing one.</p>
        ${runForm(input.csrfField, 'Analyze again', safetyNote(input.providerName))}
      </section>`;

const heroUnreadable = (input: DashboardInput): string =>
  `<section class="dash-hero">
    <p class="hero-eyebrow">Latest analysis</p>
    <p class="figure-hero quiet">Your report is ready</p>
    <p class="hero-sub"><a href="/reports/${esc(input.runs[0]?.id ?? '')}">Open the full report →</a></p>
    ${runForm(input.csrfField, 'Analyze again', safetyNote(input.providerName))}
  </section>`;

/**
 * The last screen before a customer's first run, so it sets the expectation the
 * report then has to meet. It used to promise the pre-D22 product — "one
 * recoverable-cost total" — and to say "your List is connected" in the singular
 * however many the customer had selected. Both were wrong in the same
 * direction: the report leads with an action, and a workspace is a set.
 */
const heroFirstRun = (input: DashboardInput): string => {
  const selection = describeSelection(input.scopes);
  // "Connected:" rather than "X is connected", because the selection is a set
  // and "Delivery and 1 more is connected" has to agree with a count nobody
  // knows at authoring time.
  const what =
    selection === null
      ? `Your ${esc(input.providerName)} ${esc(input.scopeNounSingular)} is connected.`
      : `Connected: ${esc(selection)}.`;
  return `<section class="dash-hero">
    <p class="hero-eyebrow">CostFlow is ready</p>
    <h1 class="hero-title">${what}<br>Find out where to act first.</h1>
    ${runForm(input.csrfField, 'Run first analysis', `Read-only, takes about a minute, and never changes anything in ${esc(input.providerName)}.`)}
  </section>
  <div class="dash-cards">
    <div class="insight"><p class="k">You'll see</p><p class="lede">One place to start, with the cost of not starting there.</p></div>
    <div class="insight"><p class="k">Ranked by cost</p><p class="lede">Every friction priced and ordered by expected business impact.</p></div>
    <div class="insight"><p class="k">Graded evidence</p><p class="lede">Each figure carries an A/B/C confidence grade and its full formula.</p></div>
  </div>`;
};

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
        <p class="lede">Strongest evidence: ${lowerFirst(frictionSubject(strongest.instance.frictionType, strongest.instance.location.stage.name).subject)}${whoseIn(latest, strongest.instance.location)} at about <strong>${money(strongest.estimate.cost.expected, currency)}</strong>, grade&nbsp;${esc(strongest.estimate.confidence.tier)}.</p>
        <p class="note">${tierPills(ranked)}</p>
      </div>`
    : '';
  const agingDays = latest.run.assumptions.parameters.agingThresholdDays.value;
  return `<div class="dash-cards">
    <div class="insight">
      <p class="k">Where it's going</p>
      <p class="lede">${topSubject.subject}${whoseIn(latest, top.instance.location)} ${topSubject.verb} costing about <strong>${money(top.estimate.cost.expected, currency)}</strong>.</p>
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
    <span class="sub">${ranked.length} priced, ${when}</span>
    <span class="go">View report →</span>
  </a>`;
};

const failureBanner = (failures: readonly DashboardFailure[]): string =>
  failures.length === 0
    ? ''
    : `<div class="danger"><h3>Recent failures</h3><ul style="margin:0">${failures
        .map(
          (j) =>
            `<li><span class="note">${fmtWhen(j.createdAt)}</span> <strong>${esc(j.errorLabel)}</strong>${j.errorMessage ? `: ${esc(j.errorMessage)}` : ''}</li>`,
        )
        .join('')}</ul></div>`;

// ---------- page ----------

export function renderDashboard(input: DashboardInput): string {
  // The foot names every selected scope rather than summarising: this is the
  // one place with room for it, and a manager reading a total needs to be able
  // to check what it covers without leaving the page.
  const names = selectionNames(input.scopes);
  const covers = names.length === 0 ? 'Your workspace' : names.join(', ');
  const foot = `<p class="dash-foot">${esc(covers)}. ${esc(input.connectionText)}. Credentials encrypted at rest. <a href="/settings">Settings</a></p>`;

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
