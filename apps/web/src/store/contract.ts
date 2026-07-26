import type { AssumptionSet, StageKind } from '@costflow/domain';

/**
 * Persistence contract for the self-serve spine (doc 09 P4.1 plan §1).
 * Tenancy law: every method that touches tenant-owned rows takes tenantId
 * FIRST and scopes by it — a foreign id resolves to null/not-found, never to
 * another tenant's row. Runs are append-only. Two implementations: memory
 * (tests/dev) and Postgres (production; contract-tested when a database URL
 * is available).
 */

/**
 * Organization roles (P4.4). A tenant IS an organization; every user holds
 * exactly one role in exactly one organization. owner > admin > member.
 *  - owner: full control, incl. delete-org and managing admins;
 *  - admin: manage members/invitations/workspaces/org settings;
 *  - member: access only the workspaces they belong to; no org management.
 */
export type OrgRole = 'owner' | 'admin' | 'member';

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member'];

export interface TenantRecord {
  readonly id: string;
  /** Organization display name; null until the owner sets one. */
  readonly name: string | null;
  readonly saltCiphertext: string;
  readonly createdAt: string;
}

export interface UserRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly createdAt: string;
}

export interface InvitationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  /** Opaque capability token carried in the accept link (never logged). */
  readonly token: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly invitedBy: string | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}

export type OnboardingState =
  | 'connected'
  | 'scope-selected'
  | 'statuses-mapped'
  | 'actors-mapped'
  | 'assumptions-set'
  | 'ready';

export const ONBOARDING_ORDER: readonly OnboardingState[] = [
  'connected',
  'scope-selected',
  'statuses-mapped',
  'actors-mapped',
  'assumptions-set',
  'ready',
];

export function onboardingRank(state: OnboardingState): number {
  return ONBOARDING_ORDER.indexOf(state);
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly tenantId: string;
  /** Connector id ('jira', 'clickup', …) — resolved via the connector registry. */
  readonly provider: string;
  /**
   * Non-secret connection parameters whose shape belongs to the connector
   * (Jira: {site, email}; ClickUp: {}). The secret itself is only ever in
   * tokenCiphertext. Stored as `connection_params` (legacy Jira rows are
   * backfilled from the old site/email columns by the idempotent migration).
   */
  readonly connectionParams: Readonly<Record<string, string>>;
  readonly tokenCiphertext: string;
  /** Selected import scope (a Jira project key, a ClickUp List id). Stored in the legacy project_key/project_name columns. */
  readonly scopeId: string | null;
  readonly scopeName: string | null;
  readonly observedStatuses: readonly string[];
  readonly observedActors: readonly string[];
  /**
   * Connector-suggested status→stage defaults captured at scope time (e.g.
   * ClickUp status types). FORM DEFAULTS only — the user reviews and submits
   * every mapping (invariant 6); nothing prices off a hint.
   */
  readonly statusHints: Readonly<Record<string, StageKind>> | null;
  readonly statusMap: Readonly<Record<string, StageKind>> | null;
  readonly actorRoleMap: Readonly<Record<string, string>> | null;
  readonly assumptions: AssumptionSet | null;
  readonly onboarding: OnboardingState;
  readonly createdAt: string;
}

export type WorkspacePatch = Partial<
  Pick<
    WorkspaceRecord,
    | 'provider'
    | 'connectionParams'
    | 'scopeId'
    | 'scopeName'
    | 'observedStatuses'
    | 'observedActors'
    | 'statusHints'
    | 'statusMap'
    | 'actorRoleMap'
    | 'assumptions'
    | 'onboarding'
    | 'tokenCiphertext'
  >
>;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobErrorClass = 'auth-error' | 'fetch-error' | 'import-error' | 'unexpected';

export interface JobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly status: JobStatus;
  readonly errorClass: JobErrorClass | null;
  /** Sanitized at write time — never contains tokens or salts. */
  readonly errorMessage: string | null;
  readonly runId: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface RunRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly runJson: string;
  readonly reportMd: string;
  readonly telemetryJsonl: string;
}

/**
 * Cascade counts returned by a deletion (FR-22 / NFR-6). Counts only — never
 * identities — so a caller (and telemetry) can report the blast radius of an
 * erasure without touching customer data.
 */
export interface DeletionSummary {
  readonly workspaces: number;
  readonly jobs: number;
  readonly runs: number;
}

/**
 * Activation-funnel counts (v1 founder analytics). Aggregate counts of DISTINCT
 * organizations reaching each stage — no identities, emails, or customer
 * content. Derived from existing tables (no separate event log).
 */
export interface FunnelStats {
  readonly organizations: number;
  readonly connectedWorkspaces: number;
  readonly analysesRun: number;
  readonly reportsViewed: number;
}

/**
 * Admin operations console (COSTFLOW_ADMIN_EMAILS only). Everything below is
 * CROSS-TENANT by design — a deliberate, audited exception to the tenancy law,
 * unreachable without the admin allowlist. Every projection is trimmed to
 * exclude secrets (token/salt ciphertext) and raw financial run content
 * (run_json / report_md / telemetry); operational metadata only.
 */
export interface AdminListParams {
  readonly limit: number;
  readonly offset: number;
  /** Whitelisted sort column (per table); ignored if not recognized. */
  readonly sort?: string;
  readonly dir?: 'asc' | 'desc';
  /** Free-text search over that table's whitelisted text columns. */
  readonly q?: string;
  /** Restrict to one organization (drill-down). */
  readonly tenantId?: string;
  /** Per-table status filter (jobs, invitations). */
  readonly status?: string;
}

export interface AdminPage<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

export interface AdminCounts {
  readonly tenants: number;
  readonly users: number;
  readonly workspaces: number;
  readonly jobs: number;
  readonly runs: number;
  readonly invitations: number;
  readonly pendingInvitations: number;
  readonly failedJobs: number;
  readonly runningJobs: number;
}

export interface AdminTenantRow {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly users: number;
  readonly workspaces: number;
  readonly runs: number;
  readonly lastActivityAt: string | null;
}

export interface AdminUserRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly createdAt: string;
}

export interface AdminWorkspaceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly connectionParams: Readonly<Record<string, string>>;
  readonly scopeId: string | null;
  readonly scopeName: string | null;
  readonly onboarding: OnboardingState;
  /** Presence of a stored token — NEVER the token itself. */
  readonly hasToken: boolean;
  readonly createdAt: string;
}

export interface AdminJobRow {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly status: JobStatus;
  readonly errorClass: JobErrorClass | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface AdminRunRow {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly viewed: boolean;
}

export interface AdminInvitationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly status: InvitationRecord['status'];
  readonly invitedBy: string | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}

export interface AdminTimelineEvent {
  readonly at: string;
  readonly kind: 'tenant' | 'user' | 'workspace' | 'job' | 'run' | 'invitation';
  readonly summary: string;
}

export interface AdminSearchHit {
  readonly kind: 'tenant' | 'user' | 'workspace' | 'job' | 'run';
  readonly id: string;
  readonly tenantId: string;
  readonly label: string;
  readonly sub: string;
}

export interface AdminAuditRow {
  readonly id: string;
  readonly at: string;
  readonly adminEmail: string;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly targetTenantId: string | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

/** A console action to record. `at`/`id` are assigned by the store. */
export interface AdminAuditEntry {
  readonly adminUserId: string | null;
  readonly adminEmail: string;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly targetTenantId: string | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

export interface Store {
  createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;
  /** Organization display name (P4.4 org settings); returns null if renamed away. */
  updateTenantName(tenantId: string, name: string): Promise<TenantRecord | null>;

  // Membership & roles (P4.4). All tenant-scoped by the tenancy law.
  getUser(tenantId: string, userId: string): Promise<UserRecord | null>;
  listUsers(tenantId: string): Promise<UserRecord[]>;
  /** Provision a NEW email into an EXISTING org (invitation accept). */
  createUserInTenant(tenantId: string, email: string, role: OrgRole): Promise<UserRecord>;
  updateUserRole(tenantId: string, userId: string, role: OrgRole): Promise<UserRecord | null>;
  /** Remove a member from the org; also drops their workspace memberships. */
  removeUser(tenantId: string, userId: string): Promise<boolean>;

  // Invitations (P4.4).
  createInvitation(
    tenantId: string,
    data: { email: string; role: OrgRole; token: string; invitedBy: string | null },
  ): Promise<InvitationRecord>;
  /** By opaque token — NOT tenant-scoped; the token is the capability. */
  getInvitationByToken(token: string): Promise<InvitationRecord | null>;
  listInvitations(tenantId: string): Promise<InvitationRecord[]>;
  updateInvitationStatus(
    tenantId: string,
    invitationId: string,
    status: InvitationRecord['status'],
    acceptedAt: string | null,
  ): Promise<InvitationRecord | null>;

  // Workspace membership (P4.4 multi-workspace foundation). Members see only
  // the workspaces they belong to; owners/admins see all in the org.
  addWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void>;
  removeWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void>;
  listWorkspaceMemberIds(tenantId: string, workspaceId: string): Promise<string[]>;
  listWorkspaceIdsForMember(tenantId: string, userId: string): Promise<string[]>;

  createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'connectionParams' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord>;
  getWorkspace(tenantId: string, workspaceId: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(tenantId: string): Promise<WorkspaceRecord[]>;
  updateWorkspace(
    tenantId: string,
    workspaceId: string,
    patch: WorkspacePatch,
  ): Promise<WorkspaceRecord | null>;

  createJob(tenantId: string, workspaceId: string): Promise<JobRecord>;
  getJob(tenantId: string, jobId: string): Promise<JobRecord | null>;
  listJobsForWorkspace(tenantId: string, workspaceId: string): Promise<JobRecord[]>;
  updateJob(
    tenantId: string,
    jobId: string,
    patch: Partial<
      Pick<JobRecord, 'status' | 'errorClass' | 'errorMessage' | 'runId' | 'finishedAt'>
    >,
  ): Promise<JobRecord | null>;

  createRun(run: RunRecord): Promise<void>;
  getRun(tenantId: string, runId: string): Promise<RunRecord | null>;
  listRuns(tenantId: string): Promise<RunRecord[]>;
  /** Records a report view; resolves true iff this was the first view (funnel telemetry). */
  markRunViewed(tenantId: string, runId: string, nowIso: string): Promise<boolean>;

  /**
   * FR-22: permanently delete one workspace and everything derived from it
   * (its jobs and runs), in a single atomic step, tenant-scoped. Resolves the
   * cascade counts, or null if the workspace does not belong to the tenant —
   * a foreign id deletes nothing (tenancy law). Runs are append-only during
   * normal operation; explicit erasure is the ONLY path that removes them.
   */
  deleteWorkspace(tenantId: string, workspaceId: string): Promise<DeletionSummary | null>;

  /**
   * FR-22 / NFR-6 (GDPR erasure): permanently delete ALL of a tenant's data —
   * runs, jobs, workspaces, users, and the tenant row itself — atomically.
   * Resolves the cascade counts (idempotent: an already-absent tenant yields
   * zeros). Only ever the caller's own tenant, scoped by the session.
   */
  deleteTenantData(tenantId: string): Promise<DeletionSummary>;

  /** Startup recovery (plan §3): jobs left 'running' by a crash → failed/interrupted. */
  markInterruptedJobs(nowIso: string): Promise<number>;

  /** Aggregate activation-funnel counts (v1). Distinct orgs per stage; no identities. */
  funnelStats(): Promise<FunnelStats>;

  // --- Admin operations console (COSTFLOW_ADMIN_EMAILS only; cross-tenant). ---
  adminCounts(): Promise<AdminCounts>;
  adminListTenants(params: AdminListParams): Promise<AdminPage<AdminTenantRow>>;
  adminListUsers(params: AdminListParams): Promise<AdminPage<AdminUserRow>>;
  adminListWorkspaces(params: AdminListParams): Promise<AdminPage<AdminWorkspaceRow>>;
  adminListJobs(params: AdminListParams): Promise<AdminPage<AdminJobRow>>;
  adminListRuns(params: AdminListParams): Promise<AdminPage<AdminRunRow>>;
  adminListInvitations(params: AdminListParams): Promise<AdminPage<AdminInvitationRow>>;
  /** Merged, newest-first activity timeline for one organization. */
  adminTenantTimeline(tenantId: string, limit: number): Promise<AdminTimelineEvent[]>;
  /** Cross-tenant search over org names, user emails, workspace scopes, and ids. */
  adminSearch(q: string, limit: number): Promise<AdminSearchHit[]>;
  adminLogAction(entry: AdminAuditEntry): Promise<void>;
  adminListAudit(params: AdminListParams): Promise<AdminPage<AdminAuditRow>>;

  /** Readiness probe (P4.2 §4): resolves iff the backing store is reachable. */
  ping(): Promise<void>;
}
