/**
 * DiagnosticFinding — one concrete, evidence-backed result (doc 07 §1.3).
 *
 * Immutable, produced from a stored `AnalysisRun` artifact. Zero, one, or
 * several findings per run are all legal; zero is an honest outcome ("the data
 * does not support a diagnosis") and must be displayed as such, never padded.
 */
import type { StageRef } from '@costflow/domain';
import type { Confidence } from '@costflow/analysis';
import type { EvidenceCapability } from './capability';
import type { InterventionSpec, InterventionTarget } from './intervention';

/**
 * Machine-readable evidence backing a finding: the counts the claim was
 * computed from. The diagnostic sibling of the cost engine's `FormulaTrace`.
 * Prose is rendered FROM this, never written freehand (doc 03 E3).
 *
 * Numbers only. A finding carries no titles, no identities, no free text from
 * the customer's data — which is also why a finding can never become the vector
 * that trips the reporting-layer attribution guard.
 */
export type EvidenceFacts = Readonly<Record<string, number>>;

export interface DiagnosticFinding {
  readonly signalId: string;
  readonly signalVersion: string;
  readonly signalName: string;
  /** Structural attribution: a stage, never a person (ADR-0006 §2). */
  readonly subject: { readonly stage: StageRef };
  /**
   * How much of the measured whole this factor accounts for (doc 07 §1.4
   * "explanatory share"), 0–100. The primary magnitude an operator reads.
   */
  readonly sharePercent: number;
  /** What `sharePercent` is a share OF, so the number is never ambiguous. */
  readonly shareOf: string;
  readonly facts: EvidenceFacts;
  /** Rendered from `facts`. Values-safe: customer stage names and numbers only. */
  readonly statement: string;
  /** Graded by evidence class, composed by minimum, binding constraint named. */
  readonly confidence: Confidence;
  readonly intervention: InterventionSpec & InterventionTarget;
}

/**
 * A diagnostic that could not run, and exactly which capabilities it lacked.
 * Carried alongside findings rather than dropped, because "we cannot tell you
 * this, and here is what would unlock it" is the product surface (FR-11 / A7
 * applied one layer up).
 *
 * Deliberately no `why` field: whether a capability is absent because the
 * platform cannot expose it, because the customer's plan gates it, or because
 * this particular import lacked it is a fact about the connector and workspace
 * that the app edge owns. This package reports only what was missing.
 */
export interface DiagnosticUnavailable {
  readonly signalId: string;
  readonly signalVersion: string;
  readonly signalName: string;
  readonly missing: readonly EvidenceCapability[];
  readonly reason: string;
}

export interface DiagnosticOutcome {
  readonly findings: readonly DiagnosticFinding[];
  readonly unavailable: readonly DiagnosticUnavailable[];
}
