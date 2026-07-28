import { newId } from '../crypto';
import { describeSelection } from '../scopes';
import { buildFunnel, type TenantFunnelRow } from '../funnel';
import { lastActivityOf, matchesCustomerFilter, scoreCustomer } from '../health';
import { onboardingRank, UNKNOWN_IDENTITY } from './contract';
import type {
  AdminActivityRow,
  AdminAuditEntry,
  AdminAuditRow,
  AdminCounts,
  AdminCustomerParams,
  AdminCustomerRow,
  AdminDashboard,
  AdminMonitoringWorkspaceRow,
  AdminOrgDetail,
  AdminInvitationRow,
  AdminJobRow,
  AdminListParams,
  AdminPage,
  AdminRunRow,
  AdminSearchHit,
  AdminTenantRow,
  AdminUserRow,
  AdminWorkspaceRow,
  CustomerSignals,
  DeletionSummary,
  EventInput,
  EventRecord,
  FunnelReport,
  FunnelStats,
  IdentityObservation,
  InvitationRecord,
  JobRecord,
  OrgRole,
  RunHeader,
  RunRecord,
  Store,
  SubscriptionRecord,
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
  private events: EventRecord[] = [];
  private subscriptions = new Map<string, SubscriptionRecord>();

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
    const createdAt = this.now();
    const user: UserRecord = {
      id: newId(),
      tenantId: tenant.id,
      email,
      role: 'owner',
      createdAt,
      identity: UNKNOWN_IDENTITY,
    };
    this.tenants.set(tenant.id, tenant);
    this.users.set(user.id, user);
    this.subscriptions.set(tenant.id, this.newSubscription(tenant.id, tenant.createdAt));
    this.events.push(
      {
        id: newId(),
        tenantId: tenant.id,
        userId: null,
        workspaceId: null,
        type: 'org.created',
        at: tenant.createdAt,
        fields: {},
      },
      {
        id: newId(),
        tenantId: tenant.id,
        userId: user.id,
        workspaceId: null,
        type: 'user.created',
        at: createdAt,
        fields: { role: user.role },
      },
    );
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
    const createdAt = this.now();
    const user: UserRecord = {
      id: newId(),
      tenantId,
      email,
      role,
      createdAt,
      identity: UNKNOWN_IDENTITY,
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
      name: null,
      provider: data.provider,
      connectionParams: data.connectionParams,
      tokenCiphertext: data.tokenCiphertext,
      scopes: [],
      observedStatuses: [],
      observedActors: [],
      statusHints: null,
      statusMap: null,
      actorRoleMap: null,
      rateInput: null,
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

  async createJobIfNoneActive(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ job: JobRecord; created: boolean }> {
    // No `await` between the check and the set, so nothing else can run on
    // this single-threaded map in between — the check-and-claim is atomic.
    const active = [...this.jobs.values()].find(
      (j) =>
        j.tenantId === tenantId &&
        j.workspaceId === workspaceId &&
        (j.status === 'queued' || j.status === 'running'),
    );
    if (active) return { job: active, created: false };
    return { job: await this.createJob(tenantId, workspaceId), created: true };
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

  async listWorkspaceRunHeaders(tenantId: string, workspaceId: string): Promise<RunHeader[]> {
    return (await this.listRuns(tenantId))
      .filter((r) => r.workspaceId === workspaceId)
      .map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        createdAt: r.createdAt,
        viewedAt: this.runViews.get(`${r.tenantId}:${r.id}`) ?? null,
      }));
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
    // Erasure reaches the activity spine and billing state too (FR-22): an
    // event log that outlived the tenant it describes would defeat the point.
    this.events = this.events.filter((e) => e.tenantId !== tenantId);
    this.subscriptions.delete(tenantId);
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
          w.scopes.some((s) => s.name.toLowerCase().includes(q)) ||
          w.provider.toLowerCase().includes(q) ||
          w.id.includes(q),
      )
      .map((w) => ({
        id: w.id,
        tenantId: w.tenantId,
        provider: w.provider,
        connectionParams: w.connectionParams,
        scopes: w.scopes,
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
        w.scopes.some((s) => s.name.toLowerCase().includes(needle)) ||
        w.id.toLowerCase().includes(needle) ||
        w.scopes.some((s) => s.id.toLowerCase().includes(needle))
      )
        hits.push({
          kind: 'workspace',
          id: w.id,
          tenantId: w.tenantId,
          label: describeSelection(w.scopes) ?? w.provider,
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

  // -------- Customer database & activity spine (P4.5; cross-tenant) --------

  private newSubscription(tenantId: string, at: string): SubscriptionRecord {
    return {
      tenantId,
      plan: 'beta',
      billingStatus: 'free_beta',
      provider: 'none',
      providerCustomerId: null,
      providerSubscriptionId: null,
      providerVariantId: null,
      trialEndsAt: null,
      renewsAt: null,
      currentPeriodEnd: null,
      cancelledAt: null,
      endsAt: null,
      createdAt: at,
      updatedAt: at,
    };
  }

  async recordEvent(event: EventInput): Promise<void> {
    this.events.push({ ...event, id: newId(), at: this.now() });
  }

  async recordSignIn(
    userId: string,
    observation: IdentityObservation,
    nowIso: string,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    this.users.set(userId, {
      ...user,
      identity: {
        // An omitted claim means "not reported this time", never "changed".
        emailVerified: observation.emailVerified ?? user.identity.emailVerified,
        authProvider: observation.authProvider ?? user.identity.authProvider,
        displayName: observation.displayName ?? user.identity.displayName,
        firstSeenAt: user.identity.firstSeenAt ?? nowIso,
        lastSeenAt: nowIso,
        signInCount: user.identity.signInCount + 1,
      },
    });
  }

  async touchLastSeen(userId: string, nowIso: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    this.users.set(userId, { ...user, identity: { ...user.identity, lastSeenAt: nowIso } });
  }

  async getSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    return this.subscriptions.get(tenantId) ?? null;
  }

  async ensureSubscription(tenantId: string, nowIso: string): Promise<SubscriptionRecord> {
    const existing = this.subscriptions.get(tenantId);
    if (existing) return existing;
    const created = this.newSubscription(tenantId, nowIso);
    this.subscriptions.set(tenantId, created);
    return created;
  }

  /** Organization-level usage signals, measured the same way as PgStore. */
  private orgSignals(
    tenantId: string,
    nowIso: string,
  ): Omit<CustomerSignals, 'createdAt' | 'lastSeenAt' | 'signInCount'> {
    const since30d = new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString();
    const workspaces = [...this.workspaces.values()].filter((w) => w.tenantId === tenantId);
    const runs = [...this.runs.values()].filter((r) => r.tenantId === tenantId);
    const ranks = workspaces.map((w) => onboardingRank(w.onboarding));
    return {
      nowIso,
      workspaces: workspaces.length,
      readyWorkspaces: workspaces.filter((w) => w.onboarding === 'ready').length,
      analyses: runs.length,
      analyses30d: runs.filter((r) => r.createdAt >= since30d).length,
      lastAnalysisAt: runs.reduce<string | null>(
        (best, r) => (best === null || r.createdAt > best ? r.createdAt : best),
        null,
      ),
      reportsViewed: runs.filter((r) => this.runViews.has(`${r.tenantId}:${r.id}`)).length,
      onboardingRank: ranks.length > 0 ? Math.max(...ranks) : -1,
      returned: false,
    };
  }

  private customerOf(user: UserRecord, nowIso: string): AdminCustomerRow {
    const org = this.orgSignals(user.tenantId, nowIso);
    const first = user.identity.firstSeenAt;
    const returned =
      first !== null &&
      this.events.some(
        (e) =>
          e.userId === user.id &&
          e.type === 'session.started' &&
          Date.parse(e.at) > Date.parse(first) + 86_400_000,
      );
    const signals: CustomerSignals = {
      ...org,
      createdAt: user.createdAt,
      lastSeenAt: user.identity.lastSeenAt,
      signInCount: user.identity.signInCount,
      returned,
    };
    const health = scoreCustomer(signals);
    const subscription = this.subscriptions.get(user.tenantId);
    const providers = [
      ...new Set(
        [...this.workspaces.values()]
          .filter((w) => w.tenantId === user.tenantId)
          .map((w) => w.provider),
      ),
    ].sort();
    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.identity.displayName,
      orgName: this.tenants.get(user.tenantId)?.name ?? null,
      role: user.role,
      createdAt: user.createdAt,
      identity: user.identity,
      workspaces: signals.workspaces,
      readyWorkspaces: signals.readyWorkspaces,
      providers,
      analyses: signals.analyses,
      analyses30d: signals.analyses30d,
      lastAnalysisAt: signals.lastAnalysisAt,
      reportsViewed: signals.reportsViewed,
      lastActivityAt: lastActivityOf(signals),
      plan: subscription?.plan ?? 'beta',
      billingStatus: subscription?.billingStatus ?? 'free_beta',
      status: health.status,
      health: health.band,
      healthScore: health.score,
      signals,
    };
  }

  async adminListCustomers(params: AdminCustomerParams): Promise<AdminPage<AdminCustomerRow>> {
    const nowIso = this.now();
    const needle = (params.q ?? '').trim().toLowerCase();
    let rows = [...this.users.values()]
      .filter((u) => !params.tenantId || u.tenantId === params.tenantId)
      .map((u) => this.customerOf(u, nowIso));
    if (needle !== '')
      rows = rows.filter(
        (r) =>
          r.email.toLowerCase().includes(needle) ||
          (r.displayName ?? '').toLowerCase().includes(needle) ||
          (r.orgName ?? '').toLowerCase().includes(needle) ||
          r.userId.toLowerCase().includes(needle),
      );
    if (params.signedUpFrom) rows = rows.filter((r) => r.createdAt >= params.signedUpFrom!);
    if (params.signedUpTo) rows = rows.filter((r) => r.createdAt <= params.signedUpTo!);
    if (params.activeSince)
      rows = rows.filter(
        (r) => r.identity.lastSeenAt !== null && r.identity.lastSeenAt >= params.activeSince!,
      );
    if (params.plan) rows = rows.filter((r) => r.plan === params.plan);
    if (params.provider) rows = rows.filter((r) => r.providers.includes(params.provider!));
    if (params.customerStatus) rows = rows.filter(matchesCustomerFilter(params.customerStatus));
    if (params.health) rows = rows.filter((r) => r.health === params.health);
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        email: (r) => r.email.toLowerCase(),
        lastSeenAt: (r) => r.identity.lastSeenAt ?? '',
        lastActivityAt: (r) => r.lastActivityAt ?? '',
        analyses: (r) => r.analyses,
        healthScore: (r) => r.healthScore,
        signInCount: (r) => r.identity.signInCount,
        orgName: (r) => (r.orgName ?? '').toLowerCase(),
      },
      'createdAt',
    );
  }

  async adminGetCustomer(userId: string): Promise<AdminCustomerRow | null> {
    const user = this.users.get(userId);
    return user ? this.customerOf(user, this.now()) : null;
  }

  private activityOf(event: EventRecord): AdminActivityRow {
    const workspace = event.workspaceId ? this.workspaces.get(event.workspaceId) : undefined;
    return {
      id: event.id,
      at: event.at,
      type: event.type,
      tenantId: event.tenantId,
      orgName: this.tenants.get(event.tenantId)?.name ?? null,
      userId: event.userId,
      userEmail: event.userId ? (this.users.get(event.userId)?.email ?? null) : null,
      workspaceId: event.workspaceId,
      workspaceName: workspace ? (workspace.name ?? describeSelection(workspace.scopes)) : null,
      fields: event.fields,
    };
  }

  async adminUserTimeline(userId: string, limit: number): Promise<AdminActivityRow[]> {
    return this.events
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((e) => this.activityOf(e));
  }

  async adminActivityFeed(params: AdminListParams): Promise<AdminPage<AdminActivityRow>> {
    const needle = (params.q ?? '').trim().toLowerCase();
    let rows = this.events.map((e) => this.activityOf(e));
    if (params.tenantId) rows = rows.filter((r) => r.tenantId === params.tenantId);
    if (params.status) rows = rows.filter((r) => r.type === params.status);
    if (needle !== '')
      rows = rows.filter(
        (r) =>
          (r.orgName ?? '').toLowerCase().includes(needle) ||
          (r.userEmail ?? '').toLowerCase().includes(needle) ||
          r.type.toLowerCase().includes(needle),
      );
    return pageOf(rows, params, { at: (r) => r.at }, 'at');
  }

  async adminListMonitoringWorkspaces(
    params: AdminListParams,
  ): Promise<AdminPage<AdminMonitoringWorkspaceRow>> {
    const needle = (params.q ?? '').trim().toLowerCase();
    let rows = [...this.workspaces.values()]
      .filter((w) => !params.tenantId || w.tenantId === params.tenantId)
      .filter((w) => !params.status || w.onboarding === params.status)
      .map((w) => {
        const runs = [...this.runs.values()].filter((r) => r.workspaceId === w.id);
        const syncs = [...this.jobs.values()].filter(
          (j) => j.workspaceId === w.id && j.status === 'succeeded',
        );
        return {
          id: w.id,
          tenantId: w.tenantId,
          name: w.name ?? describeSelection(w.scopes),
          provider: w.provider,
          scopes: w.scopes,
          onboarding: w.onboarding,
          members: [...this.workspaceMembers.values()].filter((m) => m.workspaceId === w.id).length,
          analyses: runs.length,
          lastAnalysisAt: runs.reduce<string | null>(
            (best, r) => (best === null || r.createdAt > best ? r.createdAt : best),
            null,
          ),
          lastSyncAt: syncs.reduce<string | null>((best, j) => {
            const at = j.finishedAt ?? j.createdAt;
            return best === null || at > best ? at : best;
          }, null),
          createdAt: w.createdAt,
        };
      });
    if (needle !== '')
      rows = rows.filter(
        (r) =>
          (r.name ?? '').toLowerCase().includes(needle) ||
          r.provider.toLowerCase().includes(needle) ||
          r.id.toLowerCase().includes(needle),
      );
    return pageOf(
      rows,
      params,
      {
        createdAt: (r) => r.createdAt,
        name: (r) => (r.name ?? '').toLowerCase(),
        provider: (r) => r.provider,
        analyses: (r) => r.analyses,
        lastAnalysisAt: (r) => r.lastAnalysisAt ?? '',
      },
      'createdAt',
    );
  }

  async adminOrgDetail(
    tenantId: string,
    nowIso: string,
    trendDays: number,
  ): Promise<AdminOrgDetail | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    const members = [...this.users.values()].filter((u) => u.tenantId === tenantId);
    const org = this.orgSignals(tenantId, nowIso);
    const lastSeenAt = members.reduce<string | null>((best, u) => {
      const seen = u.identity.lastSeenAt;
      return seen !== null && (best === null || seen > best) ? seen : best;
    }, null);
    const signals: CustomerSignals = {
      ...org,
      createdAt: tenant.createdAt,
      lastSeenAt,
      signInCount: members.reduce((sum, u) => sum + u.identity.signInCount, 0),
      returned: members.some((u) => {
        const first = u.identity.firstSeenAt;
        return (
          first !== null &&
          this.events.some(
            (e) =>
              e.userId === u.id &&
              e.type === 'session.started' &&
              Date.parse(e.at) > Date.parse(first) + 86_400_000,
          )
        );
      }),
    };
    const trendSince = new Date(Date.parse(nowIso) - trendDays * 86_400_000).toISOString();
    const byDay = new Map<string, number>();
    for (const run of this.runs.values())
      if (run.tenantId === tenantId && run.createdAt >= trendSince) {
        const day = run.createdAt.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }
    const lastEventAt = this.events
      .filter((e) => e.tenantId === tenantId)
      .reduce<string | null>((best, e) => (best === null || e.at > best ? e.at : best), null);
    const activity = [lastActivityOf(signals), lastEventAt].filter(
      (v): v is string => typeof v === 'string',
    );
    return {
      tenantId,
      name: tenant.name,
      createdAt: tenant.createdAt,
      members: members.length,
      workspaces: signals.workspaces,
      readyWorkspaces: signals.readyWorkspaces,
      providers: [
        ...new Set(
          [...this.workspaces.values()]
            .filter((w) => w.tenantId === tenantId)
            .map((w) => w.provider),
        ),
      ].sort(),
      analyses: signals.analyses,
      analyses30d: signals.analyses30d,
      reportsViewed: signals.reportsViewed,
      lastActivityAt: activity.reduce((a, b) => (b > a ? b : a)),
      lastAnalysisAt: signals.lastAnalysisAt,
      subscription: this.subscriptions.get(tenantId) ?? null,
      signals,
      trend: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, analyses]) => ({ date, analyses })),
    };
  }

  async adminFunnel(from: string | null, to: string | null, nowIso: string): Promise<FunnelReport> {
    void nowIso;
    const rows: TenantFunnelRow[] = [...this.tenants.values()]
      .filter((t) => (!from || t.createdAt >= from) && (!to || t.createdAt <= to))
      .map((tenant) => {
        const members = [...this.users.values()].filter((u) => u.tenantId === tenant.id);
        const workspaces = [...this.workspaces.values()].filter((w) => w.tenantId === tenant.id);
        const runs = [...this.runs.values()].filter((r) => r.tenantId === tenant.id);
        const rank = workspaces.length
          ? Math.max(...workspaces.map((w) => onboardingRank(w.onboarding)))
          : -1;
        const eventAt = (type: string): string | null =>
          this.events
            .filter((e) => e.tenantId === tenant.id && e.type === type)
            .reduce<string | null>((best, e) => (best === null || e.at < best ? e.at : best), null);
        const min = (values: readonly (string | null)[]): string | null =>
          values.reduce<string | null>(
            (best, v) => (v !== null && (best === null || v < best) ? v : best),
            null,
          );
        const connectedAt = min(workspaces.map((w) => w.createdAt));
        const firstAnalysisAt = min(runs.map((r) => r.createdAt));
        const firstViewAt = min(
          runs.map((r) => this.runViews.get(`${r.tenantId}:${r.id}`) ?? null),
        );
        const loggedInAt = min(members.map((u) => u.identity.firstSeenAt ?? u.createdAt));
        const created = Date.parse(tenant.createdAt);
        const returnedAt = this.events
          .filter(
            (e) =>
              e.tenantId === tenant.id &&
              e.type === 'session.started' &&
              Date.parse(e.at) > created + 86_400_000 &&
              Date.parse(e.at) <= created + 7 * 86_400_000,
          )
          .reduce<string | null>((best, e) => (best === null || e.at < best ? e.at : best), null);
        return {
          tenantId: tenant.id,
          reached: [
            true,
            members.some((u) => u.identity.emailVerified === true),
            members.some((u) => u.identity.signInCount >= 1),
            connectedAt !== null,
            rank >= 1,
            rank >= 4,
            firstAnalysisAt !== null,
            firstViewAt !== null,
            workspaces.some((w) => w.onboarding === 'ready'),
            returnedAt !== null,
          ],
          at: [
            tenant.createdAt,
            null,
            loggedInAt,
            connectedAt,
            eventAt('scope.selected'),
            eventAt('assumptions.set'),
            firstAnalysisAt,
            firstViewAt,
            eventAt('workspace.ready'),
            returnedAt,
          ],
        };
      });
    return buildFunnel(rows, from, to);
  }

  async adminDashboard(nowIso: string, days: number): Promise<AdminDashboard> {
    const now = Date.parse(nowIso);
    const startOfDay = `${new Date(nowIso).toISOString().slice(0, 10)}T00:00:00.000Z`;
    const since7d = new Date(now - 7 * 86_400_000).toISOString();
    const since30d = new Date(now - 30 * 86_400_000).toISOString();
    const sinceTrend = new Date(now - days * 86_400_000).toISOString();
    const users = [...this.users.values()];
    const runs = [...this.runs.values()];
    const byProvider = new Map<string, Set<string>>();
    for (const workspace of this.workspaces.values()) {
      const set = byProvider.get(workspace.provider) ?? new Set<string>();
      set.add(workspace.tenantId);
      byProvider.set(workspace.provider, set);
    }
    const bucket = (
      items: readonly { readonly at: string }[],
    ): { date: string; count: number }[] => {
      const map = new Map<string, number>();
      for (const item of items)
        if (item.at >= sinceTrend) {
          const day = item.at.slice(0, 10);
          map.set(day, (map.get(day) ?? 0) + 1);
        }
      return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));
    };
    let churnRiskOrgs = 0;
    for (const tenant of this.tenants.values()) {
      const org = this.orgSignals(tenant.id, nowIso);
      const members = users.filter((u) => u.tenantId === tenant.id);
      const signals: CustomerSignals = {
        ...org,
        createdAt: tenant.createdAt,
        lastSeenAt: members.reduce<string | null>((best, u) => {
          const seen = u.identity.lastSeenAt;
          return seen !== null && (best === null || seen > best) ? seen : best;
        }, null),
        signInCount: members.reduce((sum, u) => sum + u.identity.signInCount, 0),
        returned: false,
      };
      if (scoreCustomer(signals).band === 'churn-risk') churnRiskOrgs += 1;
    }
    return {
      users: users.length,
      organizations: this.tenants.size,
      newUsersToday: users.filter((u) => u.createdAt >= startOfDay).length,
      newUsersWeek: users.filter((u) => u.createdAt >= since7d).length,
      newOrgsWeek: [...this.tenants.values()].filter((t) => t.createdAt >= since7d).length,
      activeUsers30d: users.filter(
        (u) => u.identity.lastSeenAt !== null && u.identity.lastSeenAt >= since30d,
      ).length,
      activeUsers7d: users.filter(
        (u) => u.identity.lastSeenAt !== null && u.identity.lastSeenAt >= since7d,
      ).length,
      returningUsers: users.filter((u) => u.identity.signInCount >= 2).length,
      churnRiskOrgs,
      connectedByProvider: [...byProvider.entries()]
        .map(([provider, orgs]) => ({ provider, orgs: orgs.size }))
        .sort((a, b) => b.orgs - a.orgs),
      analysesToday: runs.filter((r) => r.createdAt >= startOfDay).length,
      reportsViewedToday: [...this.runViews.values()].filter((at) => at >= startOfDay).length,
      monitoringWorkspaces: this.workspaces.size,
      activeTrials: [...this.subscriptions.values()].filter((s) => s.billingStatus === 'on_trial')
        .length,
      signupsByDay: bucket(users.map((u) => ({ at: u.createdAt }))).map((b) => ({
        date: b.date,
        users: b.count,
      })),
      analysesByDay: bucket(runs.map((r) => ({ at: r.createdAt }))).map((b) => ({
        date: b.date,
        analyses: b.count,
      })),
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
