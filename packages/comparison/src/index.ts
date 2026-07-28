/**
 * Run-over-run comparison (doc 19 MW1).
 *
 * `compareRuns` is the single entry point: it answers whether a comparison
 * means anything, and what moved if it does. A caller that renders a trend
 * without consulting the verdict has re-created the problem this package
 * exists to solve.
 */
import type { AnalysisRun } from '@costflow/analysis';
import { diffRuns, type RunDiff } from './diff';
import { assessComparability, type ComparabilityVerdict } from './verdict';

export interface RunComparison extends ComparabilityVerdict {
  /**
   * Always computed, because a diff is arithmetic and always defined. It is the
   * VERDICT that decides whether showing it would be honest — and on
   * `not-comparable` the product shows the findings instead.
   */
  readonly diff: RunDiff;
}

export function compareRuns(baseline: AnalysisRun, current: AnalysisRun): RunComparison {
  return { ...assessComparability(baseline, current), diff: diffRuns(baseline, current) };
}

export {
  COMPARABILITY_ASPECTS,
  assessComparability,
  type Comparability,
  type ComparabilityAspect,
  type ComparabilityFinding,
  type ComparabilityVerdict,
} from './verdict';

export {
  diffRuns,
  type ChangeDirection,
  type InstanceDelta,
  type RunDiff,
  type SignalDelta,
} from './diff';
