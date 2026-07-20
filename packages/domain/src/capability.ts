/**
 * Machine-readable statement of what an import batch's data can support
 * (doc 02 §2.3). Detectors declare requirements against these keys; graceful
 * degradation (A7) is driven by this profile, never by runtime surprises.
 */
export interface CapabilityProfile {
  /** True when a validated event-history file accompanied the import. */
  readonly hasEventHistory: boolean;
  readonly hasDueDates: boolean;
  readonly hasLastUpdated: boolean;
  /** True when an actor column is mapped and at least one item has an actor. */
  readonly hasActors: boolean;
}

export type CapabilityKey = keyof CapabilityProfile;
