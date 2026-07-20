import type { AnalysisRun, CostEstimate, FrictionInstance } from '@costflow/analysis';
import { compareDecimalStrings } from '@costflow/cost-engine';

export interface RankedFriction {
  readonly rank: number;
  readonly instance: FrictionInstance;
  readonly estimate: CostEstimate;
}

export interface UnpricedFriction {
  readonly instance: FrictionInstance;
  readonly reason: string;
}

export interface ReportModel {
  readonly run: AnalysisRun;
  readonly ranked: readonly RankedFriction[];
  /** Detected but unpriced (FR-13): shown with magnitude and reason, never hidden. */
  readonly unpriced: readonly UnpricedFriction[];
}

/**
 * Ranking is deterministic and conservative-friendly: expected cost descending,
 * ties broken by low bound then instance id, never by insertion order (NFR-1).
 */
export function buildReportModel(run: AnalysisRun): ReportModel {
  const estimatesByInstance = new Map(run.estimates.map((e) => [e.frictionInstanceId, e]));
  const outcomesByInstance = new Map(run.pricing.map((p) => [p.frictionInstanceId, p]));

  const ranked: Omit<RankedFriction, 'rank'>[] = [];
  const unpriced: UnpricedFriction[] = [];

  for (const instance of run.frictions) {
    const outcome = outcomesByInstance.get(instance.id);
    if (!outcome) {
      throw new Error(
        `No pricing outcome for friction instance ${instance.id} — run is incoherent.`,
      );
    }
    if (outcome.status === 'priced') {
      const estimate = estimatesByInstance.get(instance.id);
      if (!estimate) {
        throw new Error(`Pricing outcome says priced but no estimate exists for ${instance.id}.`);
      }
      ranked.push({ instance, estimate });
    } else {
      unpriced.push({ instance, reason: outcome.reason ?? 'No reason recorded.' });
    }
  }

  return {
    run,
    ranked: ranked
      .sort(
        (a, b) =>
          compareDecimalStrings(b.estimate.cost.expected, a.estimate.cost.expected) ||
          compareDecimalStrings(b.estimate.cost.low, a.estimate.cost.low) ||
          a.instance.id.localeCompare(b.instance.id),
      )
      .map((entry, index) => ({ rank: index + 1, ...entry })),
    unpriced: [...unpriced].sort(
      (a, b) =>
        b.instance.magnitude.value - a.instance.magnitude.value ||
        a.instance.id.localeCompare(b.instance.id),
    ),
  };
}
