import type { CapabilityProfile } from './capability';
import type { WorkItemEvent } from './events';
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
  /** Scope label under which unmapped actors were pseudonymized; null if none. */
  readonly pseudonymizationScope: string | null;
  readonly items: readonly WorkItem[];
  /** Canonical lifecycle events, present only when history was imported. */
  readonly events: readonly WorkItemEvent[];
}
