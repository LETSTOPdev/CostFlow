import type { AnalysisRun } from '@costflow/analysis';
import type { Provenance } from '@costflow/domain';
import { isTerminal } from '@costflow/domain';
import type { TelemetryEvent } from './taxonomy';

/**
 * Derived telemetry (doc 15 P3): pure function of the immutable AnalysisRun
 * artifact. No clock, no randomness, no I/O — two calls on the same run are
 * byte-identical after serialization, which is what makes these events
 * reproducible and auditable by construction.
 *
 * Structurally incapable of affecting analysis: this package is imported by
 * nothing except apps/* (dependency-cruiser enforced), and this function
 * only reads its input.
 */

const PROVENANCE_KEYS: Readonly<Record<Provenance, keyof ProvenanceMix>> = {
  'vendor-suggested': 'vendorSuggested',
  'customer-accepted': 'customerAccepted',
  'customer-customized': 'customerCustomized',
  'customer-measured': 'customerMeasured',
};

interface ProvenanceMix {
  vendorSuggested: number;
  customerAccepted: number;
  customerCustomized: number;
  customerMeasured: number;
}

/** Deterministic prefix map over engine-owned skip-reason strings (doc 09 P3). */
export function classifySkipReason(
  reason: string | undefined,
): 'vendorSuggestedGate' | 'missingAssumption' | 'noCostModel' | 'other' {
  if (reason === undefined) return 'other';
  if (reason.startsWith('Rests on vendor-suggested')) return 'vendorSuggestedGate';
  if (reason.startsWith('Missing assumption')) return 'missingAssumption';
  if (reason.startsWith('No cost model')) return 'noCostModel';
  return 'other';
}

export function deriveRunTelemetry(run: AnalysisRun): TelemetryEvent[] {
  const batch = run.batch;

  const inFlight = batch.items.filter((item) => !isTerminal(item.stage));
  const withDue = inFlight.filter((item) => item.dueAt !== null).length;

  const tiers = { A: 0, B: 0, C: 0 };
  for (const estimate of run.estimates) {
    tiers[estimate.confidence.tier] += 1;
  }

  const skipReasons = {
    vendorSuggestedGate: 0,
    missingAssumption: 0,
    noCostModel: 0,
    other: 0,
  };
  let priced = 0;
  let skipped = 0;
  for (const outcome of run.pricing) {
    if (outcome.status === 'priced') {
      priced += 1;
    } else {
      skipped += 1;
      skipReasons[classifySkipReason(outcome.reason)] += 1;
    }
  }

  const provenanceMix: ProvenanceMix = {
    vendorSuggested: 0,
    customerAccepted: 0,
    customerCustomized: 0,
    customerMeasured: 0,
  };
  const countProvenance = (provenance: Provenance): void => {
    provenanceMix[PROVENANCE_KEYS[provenance]] += 1;
  };
  for (const rate of run.assumptions.rates) countProvenance(rate.provenance);
  countProvenance(run.assumptions.defaultRate.provenance);
  const parameters = run.assumptions.parameters;
  countProvenance(parameters.agingThresholdDays.provenance);
  countProvenance(parameters.attentionHoursPerDay.provenance);
  if (parameters.queueWaitAttentionHoursPerDay) {
    countProvenance(parameters.queueWaitAttentionHoursPerDay.provenance);
  }
  if (parameters.overdueAttentionHoursPerDay) {
    countProvenance(parameters.overdueAttentionHoursPerDay.provenance);
  }

  const warnings = batch.diagnostics.filter((d) => d.severity === 'warning').length;
  const droppedDiagnostics = batch.diagnostics.filter((d) => d.severity === 'dropped').length;

  const events: TelemetryEvent[] = [
    {
      event: 'tm-run',
      version: '1.0.0',
      kind: 'derived',
      at: run.now,
      runId: run.runId,
      fields: {
        pricingPolicy: run.pricingPolicy,
        provider: batch.provider,
        engineAnalysisVersion: run.engineVersions.analysis,
        items: {
          total: batch.counts.totalRows,
          imported: batch.counts.imported,
          dropped: batch.counts.dropped,
        },
        events: batch.events.length,
        diagnostics: { warnings, dropped: droppedDiagnostics },
        capability: {
          hasEventHistory: batch.capability.hasEventHistory,
          hasDueDates: batch.capability.hasDueDates,
          hasLastUpdated: batch.capability.hasLastUpdated,
          hasActors: batch.capability.hasActors,
        },
        dueDates: { inFlight: inFlight.length, withDue },
        contextObservations: run.context.length,
        estimates: { count: run.estimates.length, tiers },
        pricing: { priced, skipped, skipReasons },
        provenanceMix,
      },
    },
  ];

  for (const detector of run.detectors) {
    events.push({
      event: 'tm-detector',
      version: '1.0.0',
      kind: 'derived',
      at: run.now,
      runId: run.runId,
      fields: {
        signalId: detector.signalId,
        signalVersion: detector.signalVersion,
        status: detector.status,
        instanceCount: detector.instanceCount,
        skipReasonClass: detector.status === 'skipped' ? 'missing-capability' : null,
      },
    });
  }

  return events;
}
