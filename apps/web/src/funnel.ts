import type { FunnelReport, FunnelStep } from './store/contract';

/**
 * Onboarding funnel (P4.5). Pure aggregation over one row per organization, so
 * the arithmetic is unit-testable and identical in both Store adapters.
 *
 * The funnel counts ORGANIZATIONS at every step, never a mixture of users and
 * organizations. Some of these steps are things a person does (verifying an
 * email) and others are things an organization reaches (connecting an
 * integration); counting each in its own natural unit and stacking them in one
 * chart is how a funnel ends up reporting conversion above 100%. One unit, one
 * denominator, comparable numbers.
 *
 * Timing is reported only where it is known. The middle setup milestones had no
 * stored history before the activity spine existed, so for organizations that
 * predate it the step is measured from current workspace state (membership is
 * correct) with no timestamp (timing is unavailable). Those cells read as
 * unavailable rather than being estimated, and they fill in on their own as the
 * spine accumulates.
 */

export interface FunnelStepDef {
  readonly key: string;
  readonly label: string;
}

export const FUNNEL_STEPS: readonly FunnelStepDef[] = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'verified_email', label: 'Verified email' },
  { key: 'logged_in', label: 'Logged in' },
  { key: 'connected', label: 'Connected integration' },
  { key: 'scope_selected', label: 'Selected scope' },
  { key: 'salaries_set', label: 'Configured salaries' },
  { key: 'first_analysis', label: 'First analysis' },
  { key: 'report_viewed', label: 'First report viewed' },
  { key: 'workspace_ready', label: 'Monitoring workspace ready' },
  { key: 'returned_7d', label: 'Returned within 7 days' },
];

/**
 * One organization's progress. `reached[i]` is whether it got to step i;
 * `at[i]` is when, or null when the step is known to be reached but the moment
 * is not recorded.
 */
export interface TenantFunnelRow {
  readonly tenantId: string;
  readonly reached: readonly boolean[];
  readonly at: readonly (string | null)[];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Aggregate per-organization progress into the reported funnel.
 *
 * `avgToNextMs` averages only over organizations that reached BOTH the step and
 * the next one AND have a timestamp for each. A negative delta would mean the
 * recorded order contradicts the funnel order (possible for an organization
 * whose history is partly backfilled), so those pairs are excluded rather than
 * dragging the average below zero.
 */
export function buildFunnel(
  rows: readonly TenantFunnelRow[],
  from: string | null,
  to: string | null,
): FunnelReport {
  const steps: FunnelStep[] = FUNNEL_STEPS.map((def, i) => {
    const reached = rows.filter((r) => r.reached[i] === true).length;
    const deltas: number[] = [];
    let timedRows = 0;
    for (const row of rows) {
      if (row.reached[i] !== true) continue;
      const here = row.at[i];
      if (typeof here === 'string') timedRows += 1;
      const next = i + 1 < FUNNEL_STEPS.length ? row.at[i + 1] : undefined;
      if (row.reached[i + 1] !== true) continue;
      if (typeof here !== 'string' || typeof next !== 'string') continue;
      const delta = Date.parse(next) - Date.parse(here);
      if (Number.isFinite(delta) && delta >= 0) deltas.push(delta);
    }
    return {
      key: def.key,
      label: def.label,
      reached,
      avgToNextMs: i + 1 < FUNNEL_STEPS.length ? mean(deltas) : null,
      // No timestamped evidence at all means membership came from current state.
      fromState: reached > 0 && timedRows === 0,
    };
  });
  return { steps, from, to };
}

/** Conversion from the first step, as a percentage rounded to one decimal. */
export function conversionPct(step: FunnelStep, first: FunnelStep): number | null {
  if (first.reached === 0) return null;
  return Math.round((step.reached / first.reached) * 1000) / 10;
}

/** Drop-off from the PREVIOUS step, as a percentage rounded to one decimal. */
export function dropOffPct(step: FunnelStep, previous: FunnelStep | undefined): number | null {
  if (!previous || previous.reached === 0) return null;
  const lost = previous.reached - step.reached;
  return Math.round((lost / previous.reached) * 1000) / 10;
}

/** Compact human duration for the console: '3d 4h', '18m', '—'. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
