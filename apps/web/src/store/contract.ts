import type { AssumptionSet, StageKind } from '@costflow/domain';

/**
 * Persistence contract for the self-serve spine (doc 09 P4.1 plan §1).
 * Tenancy law: every method that touches tenant-owned rows takes tenantId
 * FIRST and scopes by it — a foreign id resolves to null/not-found, never to
 * another tenant's row. Runs are append-only. Two implementations: memory
 * (tests/dev) and Postgres (production; contract-tested when a database URL
 * is available).
 */

export interface TenantRecord {
  readonly id: string;
  readonly saltCiphertext: string;
  readonly createdAt: string;
}

export interface UserRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly createdAt: string;
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
  readonly provider: 'jira';
  readonly site: string;
  readonly email: string;
  readonly tokenCiphertext: string;
  readonly projectKey: string | null;
  readonly projectName: string | null;
  readonly observedStatuses: readonly string[];
  readonly observedActors: readonly string[];
  readonly statusMap: Readonly<Record<string, StageKind>> | null;
  readonly actorRoleMap: Readonly<Record<string, string>> | null;
  readonly assumptions: AssumptionSet | null;
  readonly onboarding: OnboardingState;
  readonly createdAt: string;
}

export type WorkspacePatch = Partial<
  Pick<
    WorkspaceRecord,
    | 'projectKey'
    | 'projectName'
    | 'observedStatuses'
    | 'observedActors'
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

export interface Store {
  createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;

  createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'site' | 'email' | 'tokenCiphertext'>,
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

  /** Readiness probe (P4.2 §4): resolves iff the backing store is reachable. */
  ping(): Promise<void>;
}
