import type { AssumptionSet, ImportBatch, IsoDateString } from '@costflow/domain';
import {
  AGING_SIGNAL,
  QUEUE_WAIT_SIGNAL,
  checkRequirements,
  detectAging,
  detectQueueWait,
  type FrictionInstance,
} from '@costflow/friction';
import { COST_MODEL_REGISTRY, type CostEstimate, type CostModelEntry } from '@costflow/cost-engine';

export const ANALYSIS_ENGINE_VERSION = '0.2.0';

export interface AnalysisRunInput {
  /** Caller-supplied — purity forbids generating ids inside the engine (D-6). */
  readonly runId: string;
  /** Explicit analysis time (doc 05 §3: time is always an input). */
  readonly now: IsoDateString;
  readonly batch: ImportBatch;
  readonly assumptions: AssumptionSet;
}

export interface DetectorOutcome {
  readonly signalId: string;
  readonly signalVersion: string;
  readonly signalName: string;
  readonly status: 'ran' | 'skipped';
  readonly reason?: string;
  readonly instanceCount: number;
}

/**
 * Every friction instance gets an explicit pricing outcome (R-11 req 5):
 * priced, or skipped with the reason. Silent omission is banned.
 */
export interface PricingOutcome {
  readonly frictionInstanceId: string;
  readonly status: 'priced' | 'skipped';
  readonly costModelId?: string;
  readonly costModelVersion?: string;
  readonly reason?: string;
}

/**
 * One immutable analysis pass (doc 02 §2.5): (batch × signal versions × model
 * versions × assumption set) → instances + estimates, every version pinned.
 * Self-contained: the artifact embeds its inputs so any number in it is
 * reconstructible without external state (NFR-2).
 */
export interface AnalysisRun {
  readonly runId: string;
  readonly engineVersions: {
    readonly analysis: string;
    readonly signals: Readonly<Record<string, string>>;
    readonly costModels: Readonly<Record<string, string>>;
  };
  readonly now: IsoDateString;
  readonly batch: ImportBatch;
  readonly assumptions: AssumptionSet;
  readonly detectors: readonly DetectorOutcome[];
  readonly frictions: readonly FrictionInstance[];
  readonly pricing: readonly PricingOutcome[];
  readonly estimates: readonly CostEstimate[];
}

/** The registry is injectable for tests only; production always uses the default. */
export function runAnalysis(
  input: AnalysisRunInput,
  registry: Readonly<Record<string, CostModelEntry>> = COST_MODEL_REGISTRY,
): AnalysisRun {
  const { runId, now, batch, assumptions } = input;

  const detectors: DetectorOutcome[] = [];
  const frictions: FrictionInstance[] = [];

  const signalRuns = [
    {
      meta: AGING_SIGNAL,
      detect: () =>
        detectAging(batch, { thresholdDays: assumptions.parameters.agingThresholdDays.value, now }),
    },
    { meta: QUEUE_WAIT_SIGNAL, detect: () => detectQueueWait(batch, { now }) },
  ] as const;

  for (const { meta, detect } of signalRuns) {
    const check = checkRequirements(meta, batch.capability);
    if (check.canRun) {
      const instances = detect();
      frictions.push(...instances);
      detectors.push({
        signalId: meta.id,
        signalVersion: meta.version,
        signalName: meta.name,
        status: 'ran',
        instanceCount: instances.length,
      });
    } else {
      detectors.push({
        signalId: meta.id,
        signalVersion: meta.version,
        signalName: meta.name,
        status: 'skipped',
        reason: check.reason,
        instanceCount: 0,
      });
    }
  }

  const pricing: PricingOutcome[] = [];
  const estimates: CostEstimate[] = [];
  for (const instance of frictions) {
    const entry = registry[instance.signalId];
    if (!entry) {
      pricing.push({
        frictionInstanceId: instance.id,
        status: 'skipped',
        reason: `No cost model registered for signal "${instance.signalId}".`,
      });
      continue;
    }
    const readiness = entry.canPrice(assumptions);
    if (!readiness.ok) {
      pricing.push({
        frictionInstanceId: instance.id,
        status: 'skipped',
        costModelId: entry.id,
        costModelVersion: entry.version,
        reason: readiness.reason,
      });
      continue;
    }
    estimates.push(entry.price(instance, assumptions, batch));
    pricing.push({
      frictionInstanceId: instance.id,
      status: 'priced',
      costModelId: entry.id,
      costModelVersion: entry.version,
    });
  }

  return {
    runId,
    engineVersions: {
      analysis: ANALYSIS_ENGINE_VERSION,
      signals: {
        [AGING_SIGNAL.id]: AGING_SIGNAL.version,
        [QUEUE_WAIT_SIGNAL.id]: QUEUE_WAIT_SIGNAL.version,
      },
      costModels: Object.fromEntries(
        Object.values(registry)
          .map((entry) => [entry.id, entry.version] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    now,
    batch,
    assumptions,
    detectors,
    frictions,
    pricing,
    estimates,
  };
}
