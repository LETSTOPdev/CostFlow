export {
  EVIDENCE_CAPABILITIES,
  NO_EVIDENCE,
  checkCapabilities,
  type CapabilityCheck,
  type DiagnosticSignalMeta,
  type EvidenceCapability,
  type EvidenceProfile,
} from './capability';

export {
  INTERVENTIONS,
  INTERVENTION_PRIMITIVES,
  type Complexity,
  type EffortClass,
  type InterventionPrimitive,
  type InterventionSpec,
  type InterventionTarget,
} from './intervention';

export type {
  DiagnosticFinding,
  DiagnosticOutcome,
  DiagnosticUnavailable,
  EvidenceFacts,
} from './finding';

export {
  CONCENTRATION_SIGNAL,
  CONCENTRATION_THRESHOLDS,
  detectConcentration,
  interventionForUnit,
} from './signals/concentration';

/**
 * Exported for the render layer's fall-through only. `humanizeMagnitude` in
 * `@costflow/ui` carries the richer per-unit phrasing an executive reads; when
 * it meets a unit it has no phrase for, deferring to this label is what keeps a
 * raw identifier off the page. Additive: no diagnostic behaviour depends on it.
 */
export { unitLabel } from './signals/magnitude';

export {
  OWNERSHIP_SIGNAL,
  OWNERSHIP_THRESHOLDS,
  detectMissingOwnership,
} from './signals/ownership';

export {
  GATEKEEPING_SIGNAL,
  GATEKEEPING_THRESHOLDS,
  detectSerialGatekeeping,
} from './signals/gatekeeping';
