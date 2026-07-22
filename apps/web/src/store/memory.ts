import { newId } from '../crypto';
import type {
  DeletionSummary,
  FunnelStats,
  InvitationRecord,
  JobRecord,
  OrgRole,
  RunRecord,
  Store,
  TenantRecord,
  UserRecord,
  WorkspacePatch,
  WorkspaceRecord,
} from './contract';

interface WorkspaceMember {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly createdAt: string;
}

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
  private invitations = new Map<string, InvitationRecord>();
  private workspaceMembers = new Map<string, WorkspaceMember>();

  private now(): string {
    return new Date(Date.now()).toISOString();
  }

  private memberKey(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  async createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }> {
    const tenant: TenantRecord = {
      id: newId(),
      name: null,
      saltCiphertext,
      createdAt: this.now(),
    };
    const user: UserRecord = {
      id: newId(),
      tenantId: tenant.id,
      email,
      role: 'owner',
      createdAt: this.now(),
    };
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

  async updateTenantName(tenantId: string, name: string): Promise<TenantRecord | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    const updated: TenantRecord = { ...tenant, name };
    this.tenants.set(tenantId, updated);
    return updated;
  }

  async getUser(tenantId: string, userId: string): Promise<UserRecord | null> {
    const user = this.users.get(userId);
    return user && user.tenantId === tenantId ? user : null;
  }

  async listUsers(tenantId: string): Promise<UserRecord[]> {
    return [...this.users.values()]
      .filter((u) => u.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async createUserInTenant(tenantId: string, email: string, role: OrgRole): Promise<UserRecord> {
    const user: UserRecord = {
      id: newId(),
      tenantId,
      email,
      role,
      createdAt: this.now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    role: OrgRole,
  ): Promise<UserRecord | null> {
    const existing = await this.getUser(tenantId, userId);
    if (!existing) return null;
    const updated: UserRecord = { ...existing, role };
    this.users.set(userId, updated);
    return updated;
  }

  async removeUser(tenantId: string, userId: string): Promise<boolean> {
    const existing = await this.getUser(tenantId, userId);
    if (!existing) return false;
    for (const [key, member] of this.workspaceMembers) {
      if (member.tenantId === tenantId && member.userId === userId) {
        this.workspaceMembers.delete(key);
      }
    }
    this.users.delete(userId);
    return true;
  }

  async createInvitation(
    tenantId: string,
    data: { email: string; role: OrgRole; token: string; invitedBy: string | null },
  ): Promise<InvitationRecord> {
    const invitation: InvitationRecord = {
      id: newId(),
      tenantId,
      email: data.email,
      role: data.role,
      token: data.token,
      status: 'pending',
      invitedBy: data.invitedBy,
      createdAt: this.now(),
      acceptedAt: null,
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async getInvitationByToken(token: string): Promise<InvitationRecord | null> {
    return [...this.invitations.values()].find((i) => i.token === token) ?? null;
  }

  async listInvitations(tenantId: string): Promise<InvitationRecord[]> {
    return [...this.invitations.values()]
      .filter((i) => i.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async updateInvitationStatus(
    tenantId: string,
    invitationId: string,
    status: InvitationRecord['status'],
    acceptedAt: string | null,
  ): Promise<InvitationRecord | null> {
    const existing = this.invitations.get(invitationId);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: InvitationRecord = { ...existing, status, acceptedAt };
    this.invitations.set(invitationId, updated);
    return updated;
  }

  async addWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void> {
    this.workspaceMembers.set(this.memberKey(workspaceId, userId), {
      tenantId,
      workspaceId,
      userId,
      createdAt: this.now(),
    });
  }

  async removeWorkspaceMember(
    _tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    this.workspaceMembers.delete(this.memberKey(workspaceId, userId));
  }

  async listWorkspaceMemberIds(tenantId: string, workspaceId: string): Promise<string[]> {
    return [...this.workspaceMembers.values()]
      .filter((m) => m.tenantId === tenantId && m.workspaceId === workspaceId)
      .map((m) => m.userId)
      .sort();
  }

  async listWorkspaceIdsForMember(tenantId: string, userId: string): Promise<string[]> {
    return [...this.workspaceMembers.values()]
      .filter((m) => m.tenantId === tenantId && m.userId === userId)
      .map((m) => m.workspaceId)
      .sort();
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
    for (const [key, member] of this.workspaceMembers) {
      if (member.tenantId === tenantId && member.workspaceId === workspaceId) {
        this.workspaceMembers.delete(key);
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
    for (const [key, member] of this.workspaceMembers) {
      if (member.tenantId === tenantId) this.workspaceMembers.delete(key);
    }
    for (const [id, invitation] of this.invitations) {
      if (invitation.tenantId === tenantId) this.invitations.delete(id);
    }
    for (const [id, user] of this.users) {
      if (user.tenantId === tenantId) this.users.delete(id);
    }
    this.tenants.delete(tenantId);
    return { workspaces, jobs, runs };
  }

  async funnelStats(): Promise<FunnelStats> {
    const distinct = (tenantIds: Iterable<string>): number => new Set(tenantIds).size;
    return {
      organizations: this.tenants.size,
      connectedWorkspaces: distinct([...this.workspaces.values()].map((w) => w.tenantId)),
      analysesRun: distinct([...this.runs.values()].map((r) => r.tenantId)),
      reportsViewed: distinct(
        [...this.runs.values()]
          .filter((r) => this.runViews.has(`${r.tenantId}:${r.id}`))
          .map((r) => r.tenantId),
      ),
    };
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
