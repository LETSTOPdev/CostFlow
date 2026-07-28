/**
 * Evidence capabilities — the vocabulary this package reasons in, and the only
 * thing it is allowed to know about where data came from (ADR-0006; founder
 * directive 2026-07-28).
 *
 * A diagnostic asks "do I have transition history?", never "which platform is
 * this?". No provider name appears anywhere in this package, and a test fails
 * the build if one ever does — including in a comment, because a named platform
 * in a comment is where the first special-case branch eventually gets written.
 * The translation from a connector, that platform's limits, the workspace's
 * configuration, and what a given import actually contained into an
 * `EvidenceProfile` happens OUTSIDE this package, at the app edge. That is what
 * keeps the diagnostic layer portable as connectors are added: a new platform
 * is a new translation, never a new branch in here.
 *
 * This mirrors, one layer up, what `FrictionSignalMeta.requires` +
 * `checkRequirements` already do for detectors against `CapabilityProfile`
 * (FR-11 / A7: degradation is visible, with the reason, never silent).
 */

/**
 * Closed on purpose. A new capability is a deliberate review — it changes what
 * every connector must answer for and what every diagnostic may ask — unlike
 * `EventType`, which is deliberately open so new analytics never need a
 * migration. The two choices point in opposite directions for the same reason:
 * cost of being wrong.
 */
export const EVIDENCE_CAPABILITIES = [
  /** Where each work item sits right now. Every supported platform has this. */
  'stage-snapshots',
  /** How long items spent in each status, as aggregate durations without order. */
  'status-history',
  /** Ordered lifecycle transitions (from → to → at). Strictly stronger than status-history. */
  'transition-history',
  /** Who held an item over time, not merely who holds it now. */
  'assignment-history',
  /** The customer's own delivery commitments. */
  'due-dates',
  /** Which items block which other items. */
  'dependency-graph',
  /** Which stages are approval gates, and their order. */
  'approval-chain',
  /** Declared or observed capacity for a stage or role. */
  'capacity-signals',
] as const;

export type EvidenceCapability = (typeof EVIDENCE_CAPABILITIES)[number];

/**
 * What a workspace's evidence can support. Total by construction: every
 * capability is answered true or false, so a diagnostic can never read an
 * `undefined` and treat it as permission.
 */
export type EvidenceProfile = Readonly<Record<EvidenceCapability, boolean>>;

/** Every capability false — the honest starting point for a translation. */
export const NO_EVIDENCE: EvidenceProfile = Object.freeze(
  Object.fromEntries(EVIDENCE_CAPABILITIES.map((c) => [c, false])) as Record<
    EvidenceCapability,
    boolean
  >,
);

/**
 * Versioned definition of one causal-factor test (doc 07 §1.3). Declared
 * capability requirements are the mechanism behind per-diagnostic degradation:
 * a diagnostic whose requirements the evidence cannot meet is skipped visibly,
 * naming exactly what is missing, never silently.
 */
export interface DiagnosticSignalMeta {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly requires: readonly EvidenceCapability[];
}

export type CapabilityCheck =
  | { readonly canRun: true }
  | {
      readonly canRun: false;
      readonly missing: readonly EvidenceCapability[];
      /** Names the missing capabilities. The app layer explains WHY they are missing. */
      readonly reason: string;
    };

/**
 * Deliberately reports only WHAT is missing, not why. "The platform cannot
 * expose this" versus "your plan gates it" versus "this import did not include
 * it" are facts about the connector and the workspace, which this package
 * cannot see and must not guess at. Only one of those three is actionable by
 * the customer, so getting it right matters — and the app edge owns it.
 */
export function checkCapabilities(
  meta: DiagnosticSignalMeta,
  profile: EvidenceProfile,
): CapabilityCheck {
  const missing = meta.requires.filter((key) => !profile[key]);
  if (missing.length === 0) return { canRun: true };
  return {
    canRun: false,
    missing,
    reason: `Requires ${missing.join(', ')}.`,
  };
}
