import { newId } from '../crypto';
import type {
  AdminAuditEntry,
  AdminAuditRow,
  AdminCounts,
  AdminInvitationRow,
  AdminJobRow,
  AdminListParams,
  AdminPage,
  AdminRunRow,
  AdminSearchHit,
  AdminTenantRow,
  AdminTimelineEvent,
  AdminUserRow,
  AdminWorkspaceRow,
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

/** Sort + paginate an already-filtered array by a whitelisted key extractor. */
function pageOf<T>(
  all: readonly T[],
  params: AdminListParams,
  keys: Record<string, (row: T) => string | number | boolean>,
  defaultSort: string,
): AdminPage<T> {
  const sortKey = params.sort && keys[params.sort] ? params.sort : defaultSort;
  const getKey = keys[sortKey] ?? keys[defaultSort]!;
  const dir = params.dir === 'asc' ? 1 : -1; // default newest/desc
  const sorted = [...all].sort((a, b) => {
    const ka = getKey(a);
    const kb = getKey(b);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return 0;
  });
  return { rows: sorted.slice(params.offset, params.offset + params.limit), total: all.length };
}

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
  private adminAudit: AdminAuditRow[] = [];

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
    data: Pick<WorkspaceRecord, 'provider' | 'connectionParams' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord> {
    const workspace: WorkspaceRecord = {
      id: newId(),
      tenantId,
      provider: data.provider,
      connectionParams: data.connectionParams,
      tokenCiphertext: data.tokenCiphertext,
      scopeId: null,
      scopeName: null,
      observedStatuses: [],
      observedActors: [],
      statusHints: null,
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

  // ---------------- Admin operations console (cross-tenant) ----------------

  private tenantIdsOf(tenantId?: string): (row: { tenantId: string }) => boolean {
    return (row) => tenantId === undefined || row.tenantId === tenantId;
  }

  async adminCounts(): Promise<AdminCounts> {
    const jobs = [...this.jobs.values()];
    const invitations = [...this.invitations.values()];
    return {
      tenants: this.tenants.size,
      users: this.users.size,
      workspaces: this.workspaces.size,
      jobs: this.jobs.size,
      runs: this.runs.size,
      invitations: this.invitations.size,
      pendingInvitations: invitations.filter((i) => i.status === 'pending').length,
      failedJobs: jobs.filter((j) => j.status === 'failed').length,
      runningJobs: jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
    };
  }

  async adminListTenants(params: AdminListParams): Promise<AdminPage<AdminTenantRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminTenantRow[] = [...this.tenants.values()]
      .filter((t) => t.id === (params.tenantId ?? t.id))
      .map((t) => {
        const wss = [...this.workspaces.values()].filter((w) => w.tenantId === t.id);
        const runs = [...this.runs.values()].filter((r) => r.tenantId === t.id);
        const jobs = [...this.jobs.values()].filter((j) => j.tenantId === t.id);
        const times = [
          t.createdAt,
          ...wss.map((w) => w.createdAt),
          ...runs.map((r) => r.createdAt),
          ...jobs.map((j) => j.finishedAt ?? j.createdAt),
        ].filter((v): v is string => v !== null);
        return {
          id: t.id,
          name: t.name,
          createdAt: t.createdAt,
          users: [...this.users.values()].filter((u) => u.tenantId === t.id).length,
          workspaces: wss.length,
          runs: runs.length,
          lastActivityAt: times.length ? times.sort().slice(-1)[0]! : null,
        };
      })
      .filter((r) => q === '' || (r.name ?? '').toLowerCase().includes(q) || r.id.includes(q));
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        name: (r) => (r.name ?? '').toLowerCase(),
        users: (r) => r.users,
        workspaces: (r) => r.workspaces,
        runs: (r) => r.runs,
        lastActivityAt: (r) => r.lastActivityAt ?? '',
      },
      'createdAt',
    );
  }

  async adminListUsers(params: AdminListParams): Promise<AdminPage<AdminUserRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminUserRow[] = [...this.users.values()]
      .filter(this.tenantIdsOf(params.tenantId))
      .filter((u) => q === '' || u.email.toLowerCase().includes(q) || u.id.includes(q))
      .map((u) => ({
        id: u.id,
        tenantId: u.tenantId,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt,
      }));
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        email: (r) => r.email.toLowerCase(),
        role: (r) => r.role,
      },
      'createdAt',
    );
  }

  async adminListWorkspaces(params: AdminListParams): Promise<AdminPage<AdminWorkspaceRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminWorkspaceRow[] = [...this.workspaces.values()]
      .filter(this.tenantIdsOf(params.tenantId))
      .filter((w) => params.status === undefined || w.onboarding === params.status)
      .filter(
        (w) =>
          q === '' ||
          (w.scopeName ?? '').toLowerCase().includes(q) ||
          w.provider.toLowerCase().includes(q) ||
          w.id.includes(q),
      )
      .map((w) => ({
        id: w.id,
        tenantId: w.tenantId,
        provider: w.provider,
        connectionParams: w.connectionParams,
        scopeId: w.scopeId,
        scopeName: w.scopeName,
        onboarding: w.onboarding,
        hasToken: w.tokenCiphertext !== '',
        createdAt: w.createdAt,
      }));
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        provider: (r) => r.provider,
        onboarding: (r) => r.onboarding,
      },
      'createdAt',
    );
  }

  async adminListJobs(params: AdminListParams): Promise<AdminPage<AdminJobRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminJobRow[] = [...this.jobs.values()]
      .filter(this.tenantIdsOf(params.tenantId))
      .filter((j) => params.status === undefined || j.status === params.status)
      .filter((j) => q === '' || j.id.includes(q) || j.workspaceId.includes(q))
      .map((j) => ({
        id: j.id,
        tenantId: j.tenantId,
        workspaceId: j.workspaceId,
        status: j.status,
        errorClass: j.errorClass,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
      }));
    return pageOf(
      rows,
      params,
      { createdAt: (r) => r.createdAt, status: (r) => r.status },
      'createdAt',
    );
  }

  async adminListRuns(params: AdminListParams): Promise<AdminPage<AdminRunRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminRunRow[] = [...this.runs.values()]
      .filter(this.tenantIdsOf(params.tenantId))
      .filter((r) => q === '' || r.id.toLowerCase().includes(q) || r.workspaceId.includes(q))
      .map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        workspaceId: r.workspaceId,
        createdAt: r.createdAt,
        viewed: this.runViews.has(`${r.tenantId}:${r.id}`),
      }));
    return pageOf(rows, params, { createdAt: (r) => r.createdAt }, 'createdAt');
  }

  async adminListInvitations(params: AdminListParams): Promise<AdminPage<AdminInvitationRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows: AdminInvitationRow[] = [...this.invitations.values()]
      .filter(this.tenantIdsOf(params.tenantId))
      .filter((i) => params.status === undefined || i.status === params.status)
      .filter((i) => q === '' || i.email.toLowerCase().includes(q) || i.id.includes(q))
      .map((i) => ({
        id: i.id,
        tenantId: i.tenantId,
        email: i.email,
        role: i.role,
        status: i.status,
        invitedBy: i.invitedBy,
        createdAt: i.createdAt,
        acceptedAt: i.acceptedAt,
      }));
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        status: (r) => r.status,
        email: (r) => r.email.toLowerCase(),
      },
      'createdAt',
    );
  }

  async adminTenantTimeline(tenantId: string, limit: number): Promise<AdminTimelineEvent[]> {
    const events: AdminTimelineEvent[] = [];
    const tenant = this.tenants.get(tenantId);
    if (tenant)
      events.push({ at: tenant.createdAt, kind: 'tenant', summary: 'Organization created' });
    for (const u of this.users.values())
      if (u.tenantId === tenantId)
        events.push({ at: u.createdAt, kind: 'user', summary: `Member joined (${u.role})` });
    for (const w of this.workspaces.values())
      if (w.tenantId === tenantId)
        events.push({
          at: w.createdAt,
          kind: 'workspace',
          summary: `Connected ${w.provider}${w.scopeName ? ` — ${w.scopeName}` : ''}`,
        });
    for (const j of this.jobs.values())
      if (j.tenantId === tenantId)
        events.push({
          at: j.finishedAt ?? j.createdAt,
          kind: 'job',
          summary: `Import ${j.status}${j.errorClass ? ` (${j.errorClass})` : ''}`,
        });
    for (const r of this.runs.values())
      if (r.tenantId === tenantId)
        events.push({ at: r.createdAt, kind: 'run', summary: 'Analysis run completed' });
    for (const i of this.invitations.values())
      if (i.tenantId === tenantId)
        events.push({
          at: i.createdAt,
          kind: 'invitation',
          summary: `Invited ${i.email} (${i.status})`,
        });
    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  }

  async adminSearch(q: string, limit: number): Promise<AdminSearchHit[]> {
    const needle = q.trim().toLowerCase();
    if (needle === '') return [];
    const hits: AdminSearchHit[] = [];
    for (const t of this.tenants.values())
      if ((t.name ?? '').toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle))
        hits.push({
          kind: 'tenant',
          id: t.id,
          tenantId: t.id,
          label: t.name ?? '(unnamed org)',
          sub: t.id,
        });
    for (const u of this.users.values())
      if (u.email.toLowerCase().includes(needle) || u.id.toLowerCase().includes(needle))
        hits.push({
          kind: 'user',
          id: u.id,
          tenantId: u.tenantId,
          label: u.email,
          sub: `${u.role} · ${u.id}`,
        });
    for (const w of this.workspaces.values())
      if (
        (w.scopeName ?? '').toLowerCase().includes(needle) ||
        w.id.toLowerCase().includes(needle) ||
        (w.scopeId ?? '').toLowerCase().includes(needle)
      )
        hits.push({
          kind: 'workspace',
          id: w.id,
          tenantId: w.tenantId,
          label: w.scopeName ?? w.provider,
          sub: `${w.provider} · ${w.id}`,
        });
    return hits.slice(0, limit);
  }

  async adminLogAction(entry: AdminAuditEntry): Promise<void> {
    this.adminAudit.push({
      id: newId(),
      at: this.now(),
      adminEmail: entry.adminEmail,
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      targetTenantId: entry.targetTenantId,
      detail: entry.detail,
    });
  }

  async adminListAudit(params: AdminListParams): Promise<AdminPage<AdminAuditRow>> {
    const q = (params.q ?? '').trim().toLowerCase();
    const rows = this.adminAudit.filter(
      (a) =>
        q === '' ||
        a.action.toLowerCase().includes(q) ||
        a.adminEmail.toLowerCase().includes(q) ||
        (a.targetId ?? '').toLowerCase().includes(q),
    );
    return pageOf(rows, params, { at: (r) => r.at, action: (r) => r.action }, 'at');
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
