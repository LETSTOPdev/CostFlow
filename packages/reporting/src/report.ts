import type { AnalysisRun, CostEstimate, FrictionInstance } from '@costflow/analysis';
import { compareDecimalStrings } from '@costflow/cost-engine';

export interface RankedFriction {
  readonly rank: number;
  readonly instance: FrictionInstance;
  readonly estimate: CostEstimate;
}

export interface ReportModel {
  readonly run: AnalysisRun;
  readonly ranked: readonly RankedFriction[];
}

/**
 * Ranking is deterministic and conservative-friendly: expected cost descending,
 * ties broken by low bound then instance id, never by insertion order (NFR-1).
 */
export function buildReportModel(run: AnalysisRun): ReportModel {
  const byInstance = new Map(run.estimates.map((e) => [e.frictionInstanceId, e]));
  const ranked = run.frictions
    .map((instance) => {
      const estimate = byInstance.get(instance.id);
      if (!estimate) {
        throw new Error(`No estimate for friction instance ${instance.id} — run is incoherent.`);
      }
      return { instance, estimate };
    })
    .sort(
      (a, b) =>
        compareDecimalStrings(b.estimate.cost.expected, a.estimate.cost.expected) ||
        compareDecimalStrings(b.estimate.cost.low, a.estimate.cost.low) ||
        a.instance.id.localeCompare(b.instance.id),
    )
    .map((entry, index) => ({ rank: index + 1, ...entry }));
  return { run, ranked };
}
