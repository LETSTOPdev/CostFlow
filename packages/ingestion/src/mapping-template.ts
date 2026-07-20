import type { StageKind } from '@costflow/domain';

/**
 * The reusable recipe turning a provider's shape into canonical entities
 * (doc 02 §2.3). Where provider vocabulary dies and canonical vocabulary begins.
 */
export interface MappingTemplate {
  readonly id: string;
  readonly version: string;
  readonly columns: {
    /** Optional: absent means source ids are derived from row position. */
    readonly itemId?: string | undefined;
    readonly title: string;
    readonly status: string;
    readonly role?: string | undefined;
    readonly createdAt?: string | undefined;
    readonly dueAt?: string | undefined;
    readonly lastUpdatedAt?: string | undefined;
  };
  /** Source status value → canonical stage kind. Unmapped statuses drop the row with a diagnostic. */
  readonly statusMap: Readonly<Record<string, StageKind>>;
}
