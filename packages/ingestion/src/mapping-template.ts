import type { StageKind } from '@costflow/domain';

/**
 * The reusable recipe turning a provider's shape into canonical entities
 * (doc 02 §2.3). Where provider vocabulary dies and canonical vocabulary
 * begins — including actor identities: actorRoleMap is the explicit,
 * versioned, reproducible bridge from customer actor values (names, emails,
 * team aliases) to the business roles rate cards understand (R-20).
 */
export interface MappingTemplate {
  readonly id: string;
  readonly version: string;
  readonly columns: {
    /** Optional: absent means source ids are derived from row position. */
    readonly itemId?: string | undefined;
    readonly title: string;
    readonly status: string;
    /** Column holding the actor value (owner/assignee). */
    readonly actor?: string | undefined;
    readonly createdAt?: string | undefined;
    readonly dueAt?: string | undefined;
    readonly lastUpdatedAt?: string | undefined;
  };
  /** Source status value → canonical stage kind. Unmapped statuses drop the row with a diagnostic. */
  readonly statusMap: Readonly<Record<string, StageKind>>;
  /**
   * Raw actor value → business roleRef (exact match after trim). Values not
   * listed here are pseudonymized, never guessed into a role.
   */
  readonly actorRoleMap?: Readonly<Record<string, string>> | undefined;
  /** Optional event-history file shape; statuses resolve via statusMap. */
  readonly events?:
    | {
        readonly columns: {
          readonly itemId: string;
          /** Stage before the transition; optional in many exports. */
          readonly from?: string | undefined;
          readonly to: string;
          readonly at: string;
        };
      }
    | undefined;
}
