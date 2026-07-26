import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
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

/**
 * node-postgres parses `timestamptz`/`timestamp` columns into JS Date objects,
 * but the Store contract (and MemoryStore) use ISO strings — an unconverted
 * Date reaching the string-typed fields crashed the rendering layer in
 * production (`value.replaceAll is not a function` on GET /runs, P4.2
 * defect 2). Coerce every timestamp read to an ISO string at this boundary so
 * the contract holds regardless of the driver's parser. Pass-through for
 * values already strings keeps old rows rendering unchanged.
 */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * PostgreSQL Store (doc 09 P4.1 plan §1). Same contract and tenancy law as
 * MemoryStore; the shared contract test suite runs against this adapter
 * whenever COSTFLOW_TEST_DATABASE_URL is set (this machine has no Postgres —
 * live validation pending, same honesty posture as provider HTTP paths).
 */
/**
 * Production pool hardening (P4.2 incident: authenticated routes intermittently
 * "did nothing" or returned an edge 503, while public routes stayed up).
 *
 * Root cause: `new pg.Pool({ connectionString })` uses `connectionTimeoutMillis:
 * 0` (wait forever) with no TCP keepalive. The web service and Postgres are
 * SEPARATE Railway services joined over the internal network; an idle pooled
 * connection can be silently dropped by that hop. Without keepalive the dead
 * socket is never detected, and with an infinite connection timeout the next
 * query HANGS instead of failing — the request never completes, so the browser
 * spins and Railway's edge eventually returns a 503 the app never logged. Only
 * authenticated routes hit the DB, so only they broke; the dependency-free
 * `/healthz` kept the replica marked healthy, so Railway kept routing to it.
 *
 * The fix makes every wait bounded and recycles dead connections, converting an
 * indefinite hang into either a fast retry on a fresh connection or a clean,
 * logged error the global boundary renders as a 500. It changes no behavior on
 * a healthy connection.
 */
export const POOL_CONFIG: pg.PoolConfig = {
  max: 10,
  // Fail fast if no connection is available instead of hanging forever.
  connectionTimeoutMillis: 10_000,
  // Recycle idle connections so a silently-dropped socket cannot linger.
  idleTimeoutMillis: 30_000,
  // TCP keepalive detects a dead connection across the Railway network hop.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Cap runaway queries server-side (statement_timeout) and client-side
  // (query_timeout) so one stuck query cannot pin a request open indefinitely.
  statement_timeout: 15_000,
  query_timeout: 15_000,
};

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, ...POOL_CONFIG });
  }

  async migrate(): Promise<void> {
    const schema = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
      'utf8',
    );
    await this.pool.query(schema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private now(): string {
    return new Date(Date.now()).toISOString();
  }

  private userFromRow(row: Record<string, unknown>): UserRecord {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      email: row['email'] as string,
      role: row['role'] as OrgRole,
      createdAt: toIso(row['created_at']) as string,
    };
  }

  private tenantFromRow(row: Record<string, unknown>): TenantRecord {
    return {
      id: row['id'] as string,
      name: (row['name'] as string | null) ?? null,
      saltCiphertext: row['salt_ciphertext'] as string,
      createdAt: toIso(row['created_at']) as string,
    };
  }

  private invitationFromRow(row: Record<string, unknown>): InvitationRecord {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      email: row['email'] as string,
      role: row['role'] as OrgRole,
      token: row['token'] as string,
      status: row['status'] as InvitationRecord['status'],
      invitedBy: (row['invited_by'] as string | null) ?? null,
      createdAt: toIso(row['created_at']) as string,
      acceptedAt: toIso(row['accepted_at']),
    };
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
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into tenants (id, salt_ciphertext, created_at) values ($1, $2, $3)',
        [tenant.id, tenant.saltCiphertext, tenant.createdAt],
      );
      await client.query(
        'insert into users (id, tenant_id, email, role, created_at) values ($1, $2, $3, $4, $5)',
        [user.id, user.tenantId, user.email, user.role, user.createdAt],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return { tenant, user };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'select id, tenant_id, email, role, created_at from users where email = $1',
      [email],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.userFromRow(row) : null;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    const result = await this.pool.query(
      'select id, name, salt_ciphertext, created_at from tenants where id = $1',
      [tenantId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.tenantFromRow(row) : null;
  }

  async updateTenantName(tenantId: string, name: string): Promise<TenantRecord | null> {
    await this.pool.query('update tenants set name = $2 where id = $1', [tenantId, name]);
    return this.getTenant(tenantId);
  }

  async getUser(tenantId: string, userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'select id, tenant_id, email, role, created_at from users where tenant_id = $1 and id = $2',
      [tenantId, userId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.userFromRow(row) : null;
  }

  async listUsers(tenantId: string): Promise<UserRecord[]> {
    const result = await this.pool.query(
      'select id, tenant_id, email, role, created_at from users where tenant_id = $1 order by created_at, id',
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.userFromRow(row));
  }

  async createUserInTenant(tenantId: string, email: string, role: OrgRole): Promise<UserRecord> {
    const user: UserRecord = {
      id: newId(),
      tenantId,
      email,
      role,
      createdAt: this.now(),
    };
    await this.pool.query(
      'insert into users (id, tenant_id, email, role, created_at) values ($1, $2, $3, $4, $5)',
      [user.id, user.tenantId, user.email, user.role, user.createdAt],
    );
    return user;
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    role: OrgRole,
  ): Promise<UserRecord | null> {
    await this.pool.query('update users set role = $3 where tenant_id = $1 and id = $2', [
      tenantId,
      userId,
      role,
    ]);
    return this.getUser(tenantId, userId);
  }

  async removeUser(tenantId: string, userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const exists = await client.query('select 1 from users where tenant_id = $1 and id = $2', [
        tenantId,
        userId,
      ]);
      if (exists.rowCount === 0) {
        await client.query('rollback');
        return false;
      }
      await client.query('delete from workspace_members where tenant_id = $1 and user_id = $2', [
        tenantId,
        userId,
      ]);
      await client.query('delete from users where tenant_id = $1 and id = $2', [tenantId, userId]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvitation(
    tenantId: string,
    data: { email: string; role: OrgRole; token: string; invitedBy: string | null },
  ): Promise<InvitationRecord> {
    const id = newId();
    const createdAt = this.now();
    await this.pool.query(
      `insert into invitations (id, tenant_id, email, role, token, status, invited_by, created_at)
       values ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
      [id, tenantId, data.email, data.role, data.token, data.invitedBy, createdAt],
    );
    return (await this.getInvitationByToken(data.token)) as InvitationRecord;
  }

  async getInvitationByToken(token: string): Promise<InvitationRecord | null> {
    const result = await this.pool.query('select * from invitations where token = $1', [token]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.invitationFromRow(row) : null;
  }

  async listInvitations(tenantId: string): Promise<InvitationRecord[]> {
    const result = await this.pool.query(
      'select * from invitations where tenant_id = $1 order by created_at, id',
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.invitationFromRow(row));
  }

  async updateInvitationStatus(
    tenantId: string,
    invitationId: string,
    status: InvitationRecord['status'],
    acceptedAt: string | null,
  ): Promise<InvitationRecord | null> {
    const result = await this.pool.query(
      'update invitations set status = $3, accepted_at = $4 where tenant_id = $1 and id = $2 returning *',
      [tenantId, invitationId, status, acceptedAt],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.invitationFromRow(row) : null;
  }

  async addWorkspaceMember(tenantId: string, workspaceId: string, userId: string): Promise<void> {
    await this.pool.query(
      `insert into workspace_members (tenant_id, workspace_id, user_id, created_at)
       values ($1, $2, $3, $4)
       on conflict (workspace_id, user_id) do nothing`,
      [tenantId, workspaceId, userId, this.now()],
    );
  }

  async removeWorkspaceMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.pool.query(
      'delete from workspace_members where tenant_id = $1 and workspace_id = $2 and user_id = $3',
      [tenantId, workspaceId, userId],
    );
  }

  async listWorkspaceMemberIds(tenantId: string, workspaceId: string): Promise<string[]> {
    const result = await this.pool.query(
      'select user_id from workspace_members where tenant_id = $1 and workspace_id = $2 order by user_id',
      [tenantId, workspaceId],
    );
    return (result.rows as { user_id: string }[]).map((r) => r.user_id);
  }

  async listWorkspaceIdsForMember(tenantId: string, userId: string): Promise<string[]> {
    const result = await this.pool.query(
      'select workspace_id from workspace_members where tenant_id = $1 and user_id = $2 order by workspace_id',
      [tenantId, userId],
    );
    return (result.rows as { workspace_id: string }[]).map((r) => r.workspace_id);
  }

  private workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
    // connection_params is the source of truth; rows written before the
    // ADR-0005 migration reconstruct it from the legacy site/email columns.
    const legacyParams: Record<string, string> = {
      site: (row['site'] as string | null) ?? '',
      email: (row['email'] as string | null) ?? '',
    };
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      provider: row['provider'] as string,
      connectionParams: (row['connection_params'] as Record<string, string> | null) ?? legacyParams,
      tokenCiphertext: row['token_ciphertext'] as string,
      scopeId: (row['project_key'] as string | null) ?? null,
      scopeName: (row['project_name'] as string | null) ?? null,
      observedStatuses: (row['observed_statuses'] as string[] | null) ?? [],
      observedActors: (row['observed_actors'] as string[] | null) ?? [],
      statusHints: (row['status_hints'] as WorkspaceRecord['statusHints']) ?? null,
      statusMap: (row['status_map'] as WorkspaceRecord['statusMap']) ?? null,
      actorRoleMap: (row['actor_role_map'] as WorkspaceRecord['actorRoleMap']) ?? null,
      assumptions: (row['assumptions'] as WorkspaceRecord['assumptions']) ?? null,
      onboarding: row['onboarding'] as WorkspaceRecord['onboarding'],
      createdAt: toIso(row['created_at']) as string,
    };
  }

  async createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'connectionParams' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord> {
    const id = newId();
    const createdAt = this.now();
    // Rollback safety: `site`/`email` params are ALSO mirrored into the
    // legacy columns (generic on param keys, not on provider), so a rollback
    // to a pre-ADR-0005 build keeps working against rows written by this one.
    await this.pool.query(
      `insert into workspaces (id, tenant_id, provider, connection_params, site, email, token_ciphertext, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        tenantId,
        data.provider,
        JSON.stringify(data.connectionParams),
        data.connectionParams['site'] ?? null,
        data.connectionParams['email'] ?? null,
        data.tokenCiphertext,
        createdAt,
      ],
    );
    return (await this.getWorkspace(tenantId, id)) as WorkspaceRecord;
  }

  async getWorkspace(tenantId: string, workspaceId: string): Promise<WorkspaceRecord | null> {
    const result = await this.pool.query(
      'select * from workspaces where tenant_id = $1 and id = $2',
      [tenantId, workspaceId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.workspaceFromRow(row) : null;
  }

  async listWorkspaces(tenantId: string): Promise<WorkspaceRecord[]> {
    const result = await this.pool.query(
      'select * from workspaces where tenant_id = $1 order by created_at',
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.workspaceFromRow(row));
  }

  async updateWorkspace(
    tenantId: string,
    workspaceId: string,
    patch: WorkspacePatch,
  ): Promise<WorkspaceRecord | null> {
    const columns: Record<string, unknown> = {};
    if (patch.provider !== undefined) columns['provider'] = patch.provider;
    if (patch.connectionParams !== undefined) {
      columns['connection_params'] = JSON.stringify(patch.connectionParams);
      // Keep the legacy mirror in sync (see createWorkspace rollback note).
      columns['site'] = patch.connectionParams['site'] ?? null;
      columns['email'] = patch.connectionParams['email'] ?? null;
    }
    if (patch.scopeId !== undefined) columns['project_key'] = patch.scopeId;
    if (patch.scopeName !== undefined) columns['project_name'] = patch.scopeName;
    if (patch.observedStatuses !== undefined)
      columns['observed_statuses'] = JSON.stringify(patch.observedStatuses);
    if (patch.observedActors !== undefined)
      columns['observed_actors'] = JSON.stringify(patch.observedActors);
    if (patch.statusHints !== undefined)
      columns['status_hints'] = JSON.stringify(patch.statusHints);
    if (patch.statusMap !== undefined) columns['status_map'] = JSON.stringify(patch.statusMap);
    if (patch.actorRoleMap !== undefined)
      columns['actor_role_map'] = JSON.stringify(patch.actorRoleMap);
    if (patch.assumptions !== undefined) columns['assumptions'] = JSON.stringify(patch.assumptions);
    if (patch.onboarding !== undefined) columns['onboarding'] = patch.onboarding;
    if (patch.tokenCiphertext !== undefined) columns['token_ciphertext'] = patch.tokenCiphertext;
    const names = Object.keys(columns);
    if (names.length === 0) return this.getWorkspace(tenantId, workspaceId);
    const sets = names.map((name, index) => `${name} = $${index + 3}`).join(', ');
    await this.pool.query(`update workspaces set ${sets} where tenant_id = $1 and id = $2`, [
      tenantId,
      workspaceId,
      ...names.map((name) => columns[name]),
    ]);
    return this.getWorkspace(tenantId, workspaceId);
  }

  private jobFromRow(row: Record<string, unknown>): JobRecord {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      workspaceId: row['workspace_id'] as string,
      status: row['status'] as JobRecord['status'],
      errorClass: (row['error_class'] as JobRecord['errorClass']) ?? null,
      errorMessage: (row['error_message'] as string | null) ?? null,
      runId: (row['run_id'] as string | null) ?? null,
      createdAt: toIso(row['created_at']) as string,
      finishedAt: toIso(row['finished_at']),
    };
  }

  async createJob(tenantId: string, workspaceId: string): Promise<JobRecord> {
    const id = newId();
    const createdAt = this.now();
    await this.pool.query(
      `insert into jobs (id, tenant_id, workspace_id, status, created_at)
       values ($1, $2, $3, 'queued', $4)`,
      [id, tenantId, workspaceId, createdAt],
    );
    return (await this.getJob(tenantId, id)) as JobRecord;
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const result = await this.pool.query('select * from jobs where tenant_id = $1 and id = $2', [
      tenantId,
      jobId,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.jobFromRow(row) : null;
  }

  async listJobsForWorkspace(tenantId: string, workspaceId: string): Promise<JobRecord[]> {
    const result = await this.pool.query(
      'select * from jobs where tenant_id = $1 and workspace_id = $2 order by created_at, id',
      [tenantId, workspaceId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.jobFromRow(row));
  }

  async updateJob(
    tenantId: string,
    jobId: string,
    patch: Partial<
      Pick<JobRecord, 'status' | 'errorClass' | 'errorMessage' | 'runId' | 'finishedAt'>
    >,
  ): Promise<JobRecord | null> {
    const columns: Record<string, unknown> = {};
    if (patch.status !== undefined) columns['status'] = patch.status;
    if (patch.errorClass !== undefined) columns['error_class'] = patch.errorClass;
    if (patch.errorMessage !== undefined) columns['error_message'] = patch.errorMessage;
    if (patch.runId !== undefined) columns['run_id'] = patch.runId;
    if (patch.finishedAt !== undefined) columns['finished_at'] = patch.finishedAt;
    const names = Object.keys(columns);
    if (names.length === 0) return this.getJob(tenantId, jobId);
    const sets = names.map((name, index) => `${name} = $${index + 3}`).join(', ');
    await this.pool.query(`update jobs set ${sets} where tenant_id = $1 and id = $2`, [
      tenantId,
      jobId,
      ...names.map((name) => columns[name]),
    ]);
    return this.getJob(tenantId, jobId);
  }

  async createRun(run: RunRecord): Promise<void> {
    await this.pool.query(
      `insert into runs (id, tenant_id, workspace_id, created_at, run_json, report_md, telemetry_jsonl)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run.id,
        run.tenantId,
        run.workspaceId,
        run.createdAt,
        run.runJson,
        run.reportMd,
        run.telemetryJsonl,
      ],
    );
  }

  private runFromRow(row: Record<string, unknown>): RunRecord {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      workspaceId: row['workspace_id'] as string,
      createdAt: toIso(row['created_at']) as string,
      runJson: row['run_json'] as string,
      reportMd: row['report_md'] as string,
      telemetryJsonl: row['telemetry_jsonl'] as string,
    };
  }

  async getRun(tenantId: string, runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query('select * from runs where tenant_id = $1 and id = $2', [
      tenantId,
      runId,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.runFromRow(row) : null;
  }

  async listRuns(tenantId: string): Promise<RunRecord[]> {
    const result = await this.pool.query(
      'select * from runs where tenant_id = $1 order by created_at desc, id',
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.runFromRow(row));
  }

  async markRunViewed(tenantId: string, runId: string, nowIso: string): Promise<boolean> {
    const result = await this.pool.query(
      'update runs set viewed_at = $3 where tenant_id = $1 and id = $2 and viewed_at is null',
      [tenantId, runId, nowIso],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteWorkspace(tenantId: string, workspaceId: string): Promise<DeletionSummary | null> {
    // One transaction; explicit ordered deletes (child rows first) so the
    // cascade holds regardless of the FK on-delete rule on an already-deployed
    // database. Tenant-scoped throughout; a foreign id deletes nothing.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const exists = await client.query(
        'select 1 from workspaces where tenant_id = $1 and id = $2',
        [tenantId, workspaceId],
      );
      if (exists.rowCount === 0) {
        await client.query('rollback');
        return null;
      }
      const runs = await client.query(
        'delete from runs where tenant_id = $1 and workspace_id = $2',
        [tenantId, workspaceId],
      );
      const jobs = await client.query(
        'delete from jobs where tenant_id = $1 and workspace_id = $2',
        [tenantId, workspaceId],
      );
      await client.query(
        'delete from workspace_members where tenant_id = $1 and workspace_id = $2',
        [tenantId, workspaceId],
      );
      await client.query('delete from workspaces where tenant_id = $1 and id = $2', [
        tenantId,
        workspaceId,
      ]);
      await client.query('commit');
      return { workspaces: 1, jobs: jobs.rowCount ?? 0, runs: runs.rowCount ?? 0 };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteTenantData(tenantId: string): Promise<DeletionSummary> {
    // GDPR erasure: every tenant-owned row plus the tenant itself, atomically,
    // child tables before parents. Idempotent — an absent tenant yields zeros.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const runs = await client.query('delete from runs where tenant_id = $1', [tenantId]);
      const jobs = await client.query('delete from jobs where tenant_id = $1', [tenantId]);
      await client.query('delete from workspace_members where tenant_id = $1', [tenantId]);
      const workspaces = await client.query('delete from workspaces where tenant_id = $1', [
        tenantId,
      ]);
      await client.query('delete from invitations where tenant_id = $1', [tenantId]);
      await client.query('delete from users where tenant_id = $1', [tenantId]);
      await client.query('delete from tenants where id = $1', [tenantId]);
      await client.query('commit');
      return {
        workspaces: workspaces.rowCount ?? 0,
        jobs: jobs.rowCount ?? 0,
        runs: runs.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async funnelStats(): Promise<FunnelStats> {
    const count = async (sql: string): Promise<number> => {
      const result = await this.pool.query<{ n: string }>(sql);
      return Number(result.rows[0]?.n ?? 0);
    };
    return {
      organizations: await count('select count(*) as n from tenants'),
      connectedWorkspaces: await count('select count(distinct tenant_id) as n from workspaces'),
      analysesRun: await count('select count(distinct tenant_id) as n from runs'),
      reportsViewed: await count(
        'select count(distinct tenant_id) as n from runs where viewed_at is not null',
      ),
    };
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async markInterruptedJobs(nowIso: string): Promise<number> {
    const result = await this.pool.query(
      `update jobs set status = 'failed', error_class = 'unexpected',
              error_message = 'Interrupted by server restart.', finished_at = $1
       where status = 'running'`,
      [nowIso],
    );
    return result.rowCount ?? 0;
  }
}
