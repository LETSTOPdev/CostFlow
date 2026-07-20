import type { AssumptionSet, ImportBatch, IsoDateString } from '@costflow/domain';
import {
  AGING_SIGNAL,
  checkRequirements,
  detectAging,
  type FrictionInstance,
} from '@costflow/friction';
import {
  AGING_ATTENTION_MODEL,
  priceAgingInstance,
  type CostEstimate,
} from '@costflow/cost-engine';

export const ANALYSIS_ENGINE_VERSION = '0.1.0';

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
  readonly estimates: readonly CostEstimate[];
}

export function runAnalysis(input: AnalysisRunInput): AnalysisRun {
  const { runId, now, batch, assumptions } = input;

  const detectors: DetectorOutcome[] = [];
  const frictions: FrictionInstance[] = [];

  const agingCheck = checkRequirements(AGING_SIGNAL, batch.capability);
  if (agingCheck.canRun) {
    const instances = detectAging(batch, {
      thresholdDays: assumptions.parameters.agingThresholdDays.value,
      now,
    });
    frictions.push(...instances);
    detectors.push({
      signalId: AGING_SIGNAL.id,
      signalVersion: AGING_SIGNAL.version,
      signalName: AGING_SIGNAL.name,
      status: 'ran',
      instanceCount: instances.length,
    });
  } else {
    detectors.push({
      signalId: AGING_SIGNAL.id,
      signalVersion: AGING_SIGNAL.version,
      signalName: AGING_SIGNAL.name,
      status: 'skipped',
      reason: agingCheck.reason,
      instanceCount: 0,
    });
  }

  const estimates: CostEstimate[] = frictions.map((instance) =>
    priceAgingInstance(instance, assumptions),
  );

  return {
    runId,
    engineVersions: {
      analysis: ANALYSIS_ENGINE_VERSION,
      signals: { [AGING_SIGNAL.id]: AGING_SIGNAL.version },
      costModels: { [AGING_ATTENTION_MODEL.id]: AGING_ATTENTION_MODEL.version },
    },
    now,
    batch,
    assumptions,
    detectors,
    frictions,
    estimates,
  };
}
