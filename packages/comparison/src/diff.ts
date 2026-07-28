/**
 * Structured run-over-run diff (doc 19 MW1).
 *
 * Computes WHAT moved; `verdict.ts` decides whether saying so would mean
 * anything. The two are separate on purpose: a diff is arithmetic and always
 * defined, while a trend is a claim and sometimes is not.
 *
 * No number is re-derived. Costs come from the stored estimates, and the only
 * arithmetic is summation and subtraction through the engine's own decimal
 * money, never a float.
 */
import type { AnalysisRun, CostEstimate, FrictionInstance } from '@costflow/analysis';
import type { DecimalString, RangeSpec } from '@costflow/domain';
import {
  ZERO_RANGE,
  addRanges,
  dec,
  decToString,
  rangeFromSpec,
  rangeToSpec,
} from '@costflow/cost-engine';

/** How an instance changed between the two runs. */
export type ChangeDirection = 'new' | 'resolved' | 'increased' | 'decreased' | 'unchanged';

export interface InstanceDelta {
  readonly instanceId: string;
  readonly signalId: string;
  /** Null when the instance was absent from that run. */
  readonly baselineCost: RangeSpec | null;
  readonly currentCost: RangeSpec | null;
  /** Current expected minus baseline expected; absent sides count as zero. */
  readonly expectedDelta: DecimalString;
  readonly direction: ChangeDirection;
}

export interface SignalDelta {
  readonly signalId: string;
  readonly baselineInstances: number;
  readonly currentInstances: number;
  readonly baselineCost: RangeSpec;
  readonly currentCost: RangeSpec;
  readonly expectedDelta: DecimalString;
}

export interface RunDiff {
  readonly instances: readonly InstanceDelta[];
  readonly signals: readonly SignalDelta[];
  readonly baselineTotal: RangeSpec;
  readonly currentTotal: RangeSpec;
  readonly expectedDelta: DecimalString;
}

interface Priced {
  readonly instance: FrictionInstance;
  readonly estimate: CostEstimate;
}

/** Priced instances only: an unpriced friction has no cost to compare. */
function pricedById(run: AnalysisRun): Map<string, Priced> {
  const estimates = new Map(
    (run.estimates as readonly CostEstimate[]).map((e) => [e.frictionInstanceId, e]),
  );
  const out = new Map<string, Priced>();
  for (const instance of run.frictions as readonly FrictionInstance[]) {
    const estimate = estimates.get(instance.id);
    if (estimate) out.set(instance.id, { instance, estimate });
  }
  return out;
}

const delta = (current: RangeSpec | null, baseline: RangeSpec | null): DecimalString =>
  decToString(dec(current?.expected ?? '0').minus(dec(baseline?.expected ?? '0')));

const directionOf = (current: RangeSpec | null, baseline: RangeSpec | null): ChangeDirection => {
  if (!baseline) return 'new';
  if (!current) return 'resolved';
  const d = dec(current.expected).comparedTo(dec(baseline.expected));
  return d > 0 ? 'increased' : d < 0 ? 'decreased' : 'unchanged';
};

const sumOf = (specs: readonly RangeSpec[]): RangeSpec =>
  rangeToSpec(specs.map(rangeFromSpec).reduce(addRanges, ZERO_RANGE));

export function diffRuns(baseline: AnalysisRun, current: AnalysisRun): RunDiff {
  const before = pricedById(baseline);
  const now = pricedById(current);

  // Deterministic: union of instance ids, sorted. Never insertion order.
  const ids = [...new Set([...before.keys(), ...now.keys()])].sort();
  const instances: InstanceDelta[] = ids.map((instanceId) => {
    const b = before.get(instanceId);
    const c = now.get(instanceId);
    const baselineCost = b?.estimate.cost ?? null;
    const currentCost = c?.estimate.cost ?? null;
    return {
      instanceId,
      signalId: (c ?? b)?.instance.signalId ?? '',
      baselineCost,
      currentCost,
      expectedDelta: delta(currentCost, baselineCost),
      direction: directionOf(currentCost, baselineCost),
    };
  });

  const signalIds = [
    ...new Set([...before.values(), ...now.values()].map((p) => p.instance.signalId)),
  ].sort();
  const signals: SignalDelta[] = signalIds.map((signalId) => {
    const b = [...before.values()].filter((p) => p.instance.signalId === signalId);
    const c = [...now.values()].filter((p) => p.instance.signalId === signalId);
    const baselineCost = sumOf(b.map((p) => p.estimate.cost));
    const currentCost = sumOf(c.map((p) => p.estimate.cost));
    return {
      signalId,
      baselineInstances: b.length,
      currentInstances: c.length,
      baselineCost,
      currentCost,
      expectedDelta: delta(currentCost, baselineCost),
    };
  });

  const baselineTotal = sumOf([...before.values()].map((p) => p.estimate.cost));
  const currentTotal = sumOf([...now.values()].map((p) => p.estimate.cost));

  return {
    instances,
    signals,
    baselineTotal,
    currentTotal,
    expectedDelta: delta(currentTotal, baselineTotal),
  };
}
