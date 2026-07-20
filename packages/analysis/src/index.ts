export { runAnalysis, ANALYSIS_ENGINE_VERSION } from './run';
export type { AnalysisRun, AnalysisRunInput, DetectorOutcome, PricingOutcome } from './run';

// Type re-exports describing the AnalysisRun artifact surface. Functions are
// NOT re-exported: consumers import behavior from the package that owns it
// (D-7 reversed by D-10 — see docs/09 and doc 05 §3 as amended).
export type {
  CostEstimate,
  FormulaTrace,
  TraceTerm,
  AgingTraceTerm,
  QueueWaitTraceTerm,
  OverdueTraceTerm,
  Confidence,
} from '@costflow/cost-engine';
export type {
  FrictionInstance,
  AgingInstance,
  AgingEvidence,
  QueueWaitInstance,
  QueueWaitEvidence,
  OverdueInstance,
  OverdueEvidence,
  ContextObservation,
} from '@costflow/friction';
