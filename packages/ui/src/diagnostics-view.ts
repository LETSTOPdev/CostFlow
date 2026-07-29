import type { AnalysisRun } from '@costflow/analysis';
import type { BatchScope } from '@costflow/domain';
import {
  CONCENTRATION_SIGNAL,
  GATEKEEPING_SIGNAL,
  OWNERSHIP_SIGNAL,
  detectConcentration,
  detectMissingOwnership,
  detectSerialGatekeeping,
  type DiagnosticSignalMeta,
} from '@costflow/diagnostics';
import { assessEvidence, inheritedCapsFor, type ConnectorEvidence } from './evidence';
import type { DiagnosticsView } from './oi-view';

/**
 * What the platform behind a run is able to expose. The application reads it
 * from the connector descriptor; the marketing site's sample reports declare it
 * for the platform their fixture imitates.
 */
export interface EvidenceSource {
  readonly name: string;
  readonly provides: ConnectorEvidence;
}

/**
 * Recommendations for one run (OI1, ADR-0006).
 *
 * The diagnostics layer is connector-blind: it reasons in evidence
 * capabilities, never in platform names. So the caller supplies what the
 * platform CAN expose, the artifact says what this import actually CONTAINED,
 * and `assessEvidence` reconciles the two into a profile plus a customer-facing
 * explanation for anything missing.
 *
 * Computed from the stored artifact at render time — no pure package changes
 * and no golden regenerates.
 */
export function buildDiagnosticsView(run: AnalysisRun, source: EvidenceSource): DiagnosticsView {
  const assessment = assessEvidence(source, run.batch);
  // Evidence-quality caps (doc 21) are handed to each diagnostic scoped to the
  // capabilities it actually draws on, so a weakness in the event stream does
  // not downgrade a finding computed purely from snapshots.
  const caps = (meta: DiagnosticSignalMeta) => inheritedCapsFor(run.batch, meta.requires);
  const results = [
    detectConcentration(run, assessment.profile, caps(CONCENTRATION_SIGNAL)),
    detectMissingOwnership(run, assessment.profile, caps(OWNERSHIP_SIGNAL)),
    detectSerialGatekeeping(run, assessment.profile, caps(GATEKEEPING_SIGNAL)),
  ];
  const scopes = (run.batch.scopes as readonly BatchScope[] | undefined) ?? [];
  return {
    findings: results.flatMap((r) => r.findings),
    unavailable: results.flatMap((r) => (r.unavailable ? [r.unavailable] : [])),
    assessment,
    originLabels: Object.fromEntries(scopes.map((sc) => [sc.id, sc.label])),
  };
}

/**
 * Claim nothing on behalf of a connection that no longer exists (a legacy or
 * CSV-era workspace). The artifact still says what it contained, so
 * snapshot-only diagnostics run and the rest report honestly as unavailable.
 */
export const UNKNOWN_SOURCE: EvidenceSource = {
  name: 'This connection',
  provides: { canProvide: [], planGated: [], planGateHint: {} },
};

/**
 * The source behind the public sample reports.
 *
 * `/demo` renders a snapshot of the Jira golden run and `/try` synthesizes a
 * Jira-shaped company, so both must be assessed against what Jira can actually
 * expose — otherwise the sample would claim capabilities a real Jira customer
 * will not get, which is exactly the kind of promise this product exists to
 * stop making. It is a copy of the Jira connector's declaration rather than an
 * import of it, because the connector lives in the application and the sample
 * reports are served by the marketing site; a test in the application pins the
 * two together so the copy cannot drift.
 */
export const JIRA_SAMPLE_SOURCE: EvidenceSource = {
  name: 'Jira',
  provides: {
    canProvide: ['stage-snapshots', 'status-history', 'transition-history', 'due-dates'],
    planGated: [],
    planGateHint: {},
  },
};
