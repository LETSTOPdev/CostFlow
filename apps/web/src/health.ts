import type { CustomerSignals, CustomerStatus, HealthBand } from './store/contract';

/**
 * Deterministic customer health scoring (P4.5).
 *
 * Pure: the same signals always produce the same score, the same band, and the
 * same explanation. There is no model, no randomness, and no hidden state — the
 * console renders the factor table below verbatim, so every number an operator
 * sees can be traced to the rule that produced it. That is the same posture the
 * cost engine takes with its formulas, applied to customer analytics.
 *
 * Scoring is over ORGANIZATION-level product usage (analyses, workspaces,
 * reports) plus PER-USER sign-in activity, because that is the granularity the
 * data honestly supports: runs and workspaces carry no actor for anything that
 * happened before the activity spine existed.
 */

/** One scoring rule's contribution, rendered as-is in the console. */
export interface HealthFactor {
  readonly label: string;
  readonly points: number;
  readonly max: number;
  readonly detail: string;
}

export interface HealthResult {
  /** 0..100. The sum of the factors below, which always total 100 at maximum. */
  readonly score: number;
  readonly band: HealthBand;
  readonly status: CustomerStatus;
  readonly factors: readonly HealthFactor[];
  /** Days since the most recent observed activity of any kind. */
  readonly daysSinceActivity: number;
  readonly ageDays: number;
}

const DAY_MS = 86_400_000;

/** Whole days between two instants, floored at 0. */
function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / DAY_MS)) : 0;
}

/** The most recent instant we have any evidence of, never earlier than signup. */
export function lastActivityOf(signals: CustomerSignals): string {
  const candidates = [signals.createdAt, signals.lastSeenAt, signals.lastAnalysisAt].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  return candidates.reduce((best, v) => (Date.parse(v) > Date.parse(best) ? v : best));
}

/**
 * A customer counts as meaningfully engaged once they have either run repeat
 * analyses or finished configuring a Monitoring Workspace. The distinction
 * matters for churn: going quiet is only churn if there was something to churn
 * FROM. A signup that never got started is not a churn risk, it is a stalled
 * onboarding, and conflating the two sends you chasing the wrong customers.
 */
function isEngaged(signals: CustomerSignals): boolean {
  return signals.analyses >= 2 || signals.readyWorkspaces >= 1;
}

/** Recency of any observed activity. The strongest single churn signal. */
function recencyFactor(days: number): HealthFactor {
  const max = 30;
  const points =
    days <= 3 ? 30 : days <= 7 ? 24 : days <= 14 ? 16 : days <= 30 ? 8 : days <= 60 ? 3 : 0;
  return { label: 'Recent activity', points, max, detail: `Last seen ${days}d ago` };
}

/** Analysis cadence over the trailing 30 days: the core product action. */
function cadenceFactor(analyses30d: number): HealthFactor {
  const max = 25;
  const points =
    analyses30d === 0
      ? 0
      : analyses30d === 1
        ? 10
        : analyses30d <= 3
          ? 17
          : analyses30d <= 7
            ? 22
            : 25;
  return {
    label: 'Analysis cadence',
    points,
    max,
    detail: `${analyses30d} analys${analyses30d === 1 ? 'is' : 'es'} in 30d`,
  };
}

/**
 * How far through setup the org got. Rank is the highest onboarding stage
 * reached across its workspaces (0 connected … 5 ready); -1 means nothing is
 * connected at all.
 */
function onboardingFactor(rank: number): HealthFactor {
  const max = 20;
  const points = rank < 0 ? 0 : Math.round(((rank + 1) / 6) * max);
  const detail = rank < 0 ? 'No integration connected' : `Stage ${rank + 1} of 6`;
  return { label: 'Onboarding completion', points, max, detail };
}

/** Configured Monitoring Workspaces: persistent operational views, not one-offs. */
function workspaceFactor(ready: number): HealthFactor {
  const max = 15;
  const points = ready === 0 ? 0 : ready === 1 ? 10 : ready === 2 ? 13 : 15;
  return {
    label: 'Monitoring workspaces',
    points,
    max,
    detail: `${ready} configured`,
  };
}

/** Coming back, and reading what the product produced. */
function engagementFactor(signals: CustomerSignals): HealthFactor {
  const max = 10;
  const returned = signals.returned ? 5 : 0;
  const read = signals.reportsViewed > 0 ? 3 : 0;
  const habitual = signals.signInCount >= 5 ? 2 : 0;
  const parts = [
    signals.returned ? 'returned' : 'no return visit',
    `${signals.reportsViewed} report${signals.reportsViewed === 1 ? '' : 's'} viewed`,
    `${signals.signInCount} sign-in${signals.signInCount === 1 ? '' : 's'}`,
  ];
  return {
    label: 'Return engagement',
    points: returned + read + habitual,
    max,
    detail: parts.join(', '),
  };
}

/**
 * Lifecycle status. Evaluated in order, so the outcomes are mutually exclusive
 * and a given set of signals always lands in exactly one bucket.
 */
function statusOf(
  signals: CustomerSignals,
  daysSinceActivity: number,
  ageDays: number,
): CustomerStatus {
  // 1. Churn risk: was engaged, then went quiet for three weeks.
  if (isEngaged(signals) && daysSinceActivity >= 21) return 'churn-risk';
  // 2. Active: running analyses now, or ran them and is still around.
  if (signals.analyses30d > 0 || (signals.analyses > 0 && daysSinceActivity <= 30)) return 'active';
  // 3. New: just signed up and has not connected anything yet.
  if (ageDays <= 7 && signals.workspaces === 0) return 'new';
  // 4. Onboarding: connected, still setting up, still present.
  if (signals.workspaces > 0 && signals.analyses === 0 && daysSinceActivity <= 30)
    return 'onboarding';
  // 5. Everything else has gone quiet without ever getting going.
  return 'inactive';
}

function bandOf(score: number, signals: CustomerSignals, daysSinceActivity: number): HealthBand {
  if (isEngaged(signals) && daysSinceActivity >= 21) return 'churn-risk';
  if (daysSinceActivity >= 30) return 'inactive';
  if (score >= 65) return 'healthy';
  return 'needs-attention';
}

export function scoreCustomer(signals: CustomerSignals): HealthResult {
  const lastActivity = lastActivityOf(signals);
  const daysSinceActivity = daysBetween(lastActivity, signals.nowIso);
  const ageDays = daysBetween(signals.createdAt, signals.nowIso);
  const factors: HealthFactor[] = [
    recencyFactor(daysSinceActivity),
    cadenceFactor(signals.analyses30d),
    onboardingFactor(signals.onboardingRank),
    workspaceFactor(signals.readyWorkspaces),
    engagementFactor(signals),
  ];
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return {
    score,
    band: bandOf(score, signals, daysSinceActivity),
    status: statusOf(signals, daysSinceActivity, ageDays),
    factors,
    daysSinceActivity,
    ageDays,
  };
}

/** Maximum attainable score. Asserted by a test so the factor weights stay coherent. */
export const HEALTH_MAX_SCORE = 100;

/**
 * Shape a customer-table row must have for a status filter to be applied to it.
 * Structural rather than the full AdminCustomerRow so the predicate stays
 * usable from both Store adapters without either importing the other.
 */
interface FilterableCustomer {
  readonly status: CustomerStatus;
  readonly analyses: number;
  readonly workspaces: number;
  readonly readyWorkspaces: number;
}

/**
 * Filter values offered by the customer table. These are the five lifecycle
 * statuses plus 'abandoned', which is not a status but a QUESTION an operator
 * actually asks: who connected an integration, never finished setting it up,
 * and then went quiet. It is derived rather than stored so it cannot drift out
 * of step with the status rules above.
 */
export const CUSTOMER_FILTERS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churn-risk', label: 'Churn risk' },
  { value: 'abandoned', label: 'Abandoned onboarding' },
];

export function matchesCustomerFilter(filter: string): (row: FilterableCustomer) => boolean {
  if (filter === 'abandoned') {
    return (row) =>
      row.workspaces > 0 &&
      row.analyses === 0 &&
      row.readyWorkspaces === 0 &&
      (row.status === 'inactive' || row.status === 'churn-risk');
  }
  return (row) => row.status === filter;
}

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  new: 'New',
  onboarding: 'Onboarding',
  active: 'Active',
  inactive: 'Inactive',
  'churn-risk': 'Churn risk',
};

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  healthy: 'Healthy',
  'needs-attention': 'Needs attention',
  inactive: 'Inactive',
  'churn-risk': 'Churn risk',
};
