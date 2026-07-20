/**
 * Machine-readable statement of what an import batch's data can support
 * (doc 02 §2.3). Detectors declare requirements against these keys; graceful
 * degradation (A7) is driven by this profile, never by runtime surprises.
 */
export interface CapabilityProfile {
  /** CSV snapshot exports carry no status-change history. */
  readonly hasEventHistory: boolean;
  readonly hasDueDates: boolean;
  readonly hasLastUpdated: boolean;
  readonly hasRoles: boolean;
}

export type CapabilityKey = keyof CapabilityProfile;
