import { newId } from '../crypto';
import type {
  DeletionSummary,
  JobRecord,
  RunRecord,
  Store,
  TenantRecord,
  UserRecord,
  WorkspacePatch,
  WorkspaceRecord,
} from './contract';

/**
 * In-memory Store for tests and local demo. Implements the same contract
 * (and passes the same contract test suite) as the Postgres adapter; the
 * tenancy law lives in the method signatures and is honored identically.
 */
export class MemoryStore implements Store {
  private tenants = new Map<string, TenantRecord>();
  private users = new Map<string, UserRecord>();
  private workspaces = new Map<string, WorkspaceRecord>();
  private jobs = new Map<string, JobRecord>();
  private runs = new Map<string, RunRecord>();
  private runViews = new Map<string, string>();

  private now(): string {
    return new Date(Date.now()).toISOString();
  }

  async createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }> {
    const tenant: TenantRecord = { id: newId(), saltCiphertext, createdAt: this.now() };
    const user: UserRecord = { id: newId(), tenantId: tenant.id, email, createdAt: this.now() };
    this.tenants.set(tenant.id, tenant);
    this.users.set(user.id, user);
    return { tenant, user };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    return this.tenants.get(tenantId) ?? null;
  }

  async createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'site' | 'email' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord> {
    const workspace: WorkspaceRecord = {
      id: newId(),
      tenantId,
      provider: data.provider,
      site: data.site,
      email: data.email,
      tokenCiphertext: data.tokenCiphertext,
      projectKey: null,
      projectName: null,
      observedStatuses: [],
      observedActors: [],
      statusMap: null,
      actorRoleMap: null,
      assumptions: null,
      onboarding: 'connected',
      createdAt: this.now(),
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async getWorkspace(tenantId: string, workspaceId: string): Promise<WorkspaceRecord | null> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace && workspace.tenantId === tenantId ? workspace : null;
  }

  async listWorkspaces(tenantId: string): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].filter((w) => w.tenantId === tenantId);
  }

  async updateWorkspace(
    tenantId: string,
    workspaceId: string,
    patch: WorkspacePatch,
  ): Promise<WorkspaceRecord | null> {
    const existing = await this.getWorkspace(tenantId, workspaceId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.workspaces.set(workspaceId, updated);
    return updated;
  }

  async createJob(tenantId: string, workspaceId: string): Promise<JobRecord> {
    const job: JobRecord = {
      id: newId(),
      tenantId,
      workspaceId,
      status: 'queued',
      errorClass: null,
      errorMessage: null,
      runId: null,
      createdAt: this.now(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    return job && job.tenantId === tenantId ? job : null;
  }

  async listJobsForWorkspace(tenantId: string, workspaceId: string): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => j.tenantId === tenantId && j.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async updateJob(
    tenantId: string,
    jobId: string,
    patch: Partial<
      Pick<JobRecord, 'status' | 'errorClass' | 'errorMessage' | 'runId' | 'finishedAt'>
    >,
  ): Promise<JobRecord | null> {
    const existing = await this.getJob(tenantId, jobId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async createRun(run: RunRecord): Promise<void> {
    this.runs.set(`${run.tenantId}:${run.id}`, run);
  }

  async getRun(tenantId: string, runId: string): Promise<RunRecord | null> {
    return this.runs.get(`${tenantId}:${runId}`) ?? null;
  }

  async listRuns(tenantId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async markRunViewed(tenantId: string, runId: string, nowIso: string): Promise<boolean> {
    const key = `${tenantId}:${runId}`;
    if (!this.runs.has(key) || this.runViews.has(key)) return false;
    this.runViews.set(key, nowIso);
    return true;
  }

  async deleteWorkspace(tenantId: string, workspaceId: string): Promise<DeletionSummary | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.tenantId !== tenantId) return null;
    let jobs = 0;
    for (const [id, job] of this.jobs) {
      if (job.tenantId === tenantId && job.workspaceId === workspaceId) {
        this.jobs.delete(id);
        jobs += 1;
      }
    }
    let runs = 0;
    for (const [key, run] of this.runs) {
      if (run.tenantId === tenantId && run.workspaceId === workspaceId) {
        this.runs.delete(key);
        this.runViews.delete(key);
        runs += 1;
      }
    }
    this.workspaces.delete(workspaceId);
    return { workspaces: 1, jobs, runs };
  }

  async deleteTenantData(tenantId: string): Promise<DeletionSummary> {
    let workspaces = 0;
    for (const [id, workspace] of this.workspaces) {
      if (workspace.tenantId === tenantId) {
        this.workspaces.delete(id);
        workspaces += 1;
      }
    }
    let jobs = 0;
    for (const [id, job] of this.jobs) {
      if (job.tenantId === tenantId) {
        this.jobs.delete(id);
        jobs += 1;
      }
    }
    let runs = 0;
    for (const [key, run] of this.runs) {
      if (run.tenantId === tenantId) {
        this.runs.delete(key);
        this.runViews.delete(key);
        runs += 1;
      }
    }
    for (const [id, user] of this.users) {
      if (user.tenantId === tenantId) this.users.delete(id);
    }
    this.tenants.delete(tenantId);
    return { workspaces, jobs, runs };
  }

  async ping(): Promise<void> {
    // In-memory store is always reachable.
  }

  async markInterruptedJobs(nowIso: string): Promise<number> {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === 'running') {
        this.jobs.set(id, {
          ...job,
          status: 'failed',
          errorClass: 'unexpected',
          errorMessage: 'Interrupted by server restart.',
          finishedAt: nowIso,
        });
        count += 1;
      }
    }
    return count;
  }
}
