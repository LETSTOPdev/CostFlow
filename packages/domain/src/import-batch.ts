import type { CapabilityProfile } from './capability';
import type { EvidenceNote } from './evidence';
import type { WorkItemEvent } from './events';
import type { BatchScope } from './scope';
import type { IsoDateString, WorkItem } from './work-item';

export interface ImportDiagnostic {
  /** 1-based data-row number (header excluded); 0 means file-level. */
  readonly row: number;
  readonly severity: 'warning' | 'dropped';
  readonly message: string;
}

/**
 * One immutable ingestion run (doc 02 §2.3). Corrections create new batches;
 * nothing here is ever mutated.
 */
export interface ImportBatch {
  readonly id: string;
  readonly provider: string;
  readonly mappingTemplateId: string;
  readonly mappingTemplateVersion: string;
  /** Explicit input from the effectful edge; the core never reads a clock. */
  readonly importedAt: IsoDateString;
  readonly counts: {
    readonly totalRows: number;
    readonly imported: number;
    readonly dropped: number;
  };
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly capability: CapabilityProfile;
  /**
   * What is weak about these observations (doc 21). Empty means "we looked and
   * found nothing weak" — which is a different statement from an artifact
   * written before this field existed, where it is absent entirely. Readers of
   * persisted run.json must distinguish the two and must never default the
   * second to the first, since that would retroactively claim a clean bill of
   * health for every historical run.
   */
  readonly evidence: readonly EvidenceNote[];
  /**
   * The origins this batch covers, sorted by id (see `scope.ts`). One entry per
   * fetchable scope that actually contributed, which is what makes the artifact
   * self-describing: a reader can tell from the run alone which Lists, projects
   * or Spaces the totals were computed over.
   *
   * Empty means "this import has no scope structure" — a CSV file is one
   * undifferentiated body of work, and saying so is a fact, not a gap. Absent
   * at runtime, despite the type, means the artifact predates this field and
   * coverage is UNKNOWN. The two must never be conflated: treating an old
   * single-scope run as empty coverage would let a comparison conclude the
   * scope set was unchanged when nothing is known about it. Same discipline as
   * `evidence` above, for the same reason.
   */
  readonly scopes: readonly BatchScope[];
  /** Scope label under which unmapped actors were pseudonymized; null if none. */
  readonly pseudonymizationScope: string | null;
  readonly items: readonly WorkItem[];
  /** Canonical lifecycle events, present only when history was imported. */
  readonly events: readonly WorkItemEvent[];
}
