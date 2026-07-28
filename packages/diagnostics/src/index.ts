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
} from './signals/concentration';

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
