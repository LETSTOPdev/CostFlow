import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newId } from '../crypto';
import { describeSelection } from '../scopes';
import { buildFunnel, type TenantFunnelRow } from '../funnel';
import { lastActivityOf, matchesCustomerFilter, scoreCustomer } from '../health';
import { ONBOARDING_ORDER, UNKNOWN_IDENTITY } from './contract';
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
  BillingProvider,
  BillingStatus,
  CustomerSignals,
  DeletionSummary,
  EventInput,
  EventType,
  FunnelReport,
  FunnelStats,
  IdentityObservation,
  InvitationRecord,
  JobRecord,
  OnboardingState,
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
 * Every column a UserRecord needs, including the P4.5 identity attributes.
 * Named once so a projection can never silently drop one and hand back a
 * half-populated identity.
 */
const USER_COLS =
  'id, tenant_id, email, role, created_at, email_verified, auth_provider, display_name, first_seen_at, last_seen_at, sign_in_count';

/**
 * How many candidate rows the customer database scans before computing health
 * scores in application code. The score is a deterministic function of measured
 * signals (health.ts), not a stored column, so filtering or sorting by it
 * cannot be pushed into SQL without duplicating that logic in two places and
 * letting them drift. Scanning a bounded candidate set keeps one source of
 * truth; when the cap is reached the console SAYS the view is partial rather
 * than implying full coverage. Materializing the score behind a periodic job is
 * the upgrade path if the customer base ever outgrows this.
 */
export const CUSTOMER_SCAN_CAP = 2000;

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
      identity: {
        emailVerified: (row['email_verified'] as boolean | null) ?? null,
        authProvider: (row['auth_provider'] as string | null) ?? null,
        displayName: (row['display_name'] as string | null) ?? null,
        firstSeenAt: toIso(row['first_seen_at']),
        lastSeenAt: toIso(row['last_seen_at']),
        signInCount: Number(row['sign_in_count'] ?? 0),
      },
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
    const createdAt = this.now();
    const user: UserRecord = {
      id: newId(),
      tenantId: tenant.id,
      email,
      role: 'owner',
      createdAt,
      // Zero observed sign-ins. Every creation path is immediately followed by
      // recordSignIn, which is what counts the sign-in that created this row —
      // seeding 1 here would count that same sign-in twice.
      identity: UNKNOWN_IDENTITY,
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
      // Billing state and the first two activity events belong to the same
      // atomic act as the signup itself: an organization that exists without a
      // subscription row, or without its own creation recorded, is a gap the
      // console would have to paper over later.
      await client.query(
        'insert into subscriptions (tenant_id, created_at, updated_at) values ($1, $2, $2)',
        [tenant.id, tenant.createdAt],
      );
      await client.query(
        `insert into events (id, tenant_id, user_id, workspace_id, type, at, fields)
         values ($1, $2, null, null, 'org.created', $3, '{}'::jsonb),
                ($4, $2, $5, null, 'user.created', $6, $7::jsonb)`,
        [
          newId(),
          tenant.id,
          tenant.createdAt,
          newId(),
          user.id,
          user.createdAt,
          JSON.stringify({ role: user.role }),
        ],
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
    const result = await this.pool.query(`select ${USER_COLS} from users where email = $1`, [
      email,
    ]);
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
      `select ${USER_COLS} from users where tenant_id = $1 and id = $2`,
      [tenantId, userId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.userFromRow(row) : null;
  }

  async listUsers(tenantId: string): Promise<UserRecord[]> {
    const result = await this.pool.query(
      `select ${USER_COLS} from users where tenant_id = $1 order by created_at, id`,
      [tenantId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.userFromRow(row));
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
      name: (row['name'] as string | null) ?? null,
      provider: row['provider'] as string,
      connectionParams: (row['connection_params'] as Record<string, string> | null) ?? legacyParams,
      tokenCiphertext: row['token_ciphertext'] as string,
      scopes: (row['scopes'] as WorkspaceRecord['scopes'] | null) ?? [],
      observedStatuses: (row['observed_statuses'] as string[] | null) ?? [],
      observedActors: (row['observed_actors'] as string[] | null) ?? [],
      statusHints: (row['status_hints'] as WorkspaceRecord['statusHints']) ?? null,
      statusMap: (row['status_map'] as WorkspaceRecord['statusMap']) ?? null,
      actorRoleMap: (row['actor_role_map'] as WorkspaceRecord['actorRoleMap']) ?? null,
      assumptions: (row['assumptions'] as WorkspaceRecord['assumptions']) ?? null,
      rateInput: (row['rate_input'] as WorkspaceRecord['rateInput']) ?? null,
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
    if (patch.name !== undefined) columns['name'] = patch.name;
    if (patch.provider !== undefined) columns['provider'] = patch.provider;
    if (patch.connectionParams !== undefined) {
      columns['connection_params'] = JSON.stringify(patch.connectionParams);
      // Keep the legacy mirror in sync (see createWorkspace rollback note).
      columns['site'] = patch.connectionParams['site'] ?? null;
      columns['email'] = patch.connectionParams['email'] ?? null;
    }
    if (patch.scopes !== undefined) columns['scopes'] = JSON.stringify(patch.scopes);
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
    if (patch.rateInput !== undefined) columns['rate_input'] = JSON.stringify(patch.rateInput);
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

  async createJobIfNoneActive(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ job: JobRecord; created: boolean }> {
    // Bounded retry, because losing the slot and then finding it empty is
    // PROGRESS, not contention: it means the holder finished in the window
    // between our insert conflicting and our recovery read. Returning nothing
    // there would hand the caller `undefined` typed as a JobRecord, and
    // POST /runs dereferences `job.id` immediately — a 500 in precisely the
    // concurrent case this guard exists to survive. Verified against real
    // PostgreSQL before this loop existed.
    //
    // Three attempts is far beyond anything a real workload produces; the
    // bound exists only so pathological churn cannot spin forever.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = newId();
      const createdAt = this.now();
      try {
        await this.pool.query(
          `insert into jobs (id, tenant_id, workspace_id, status, created_at)
           values ($1, $2, $3, 'queued', $4)`,
          [id, tenantId, workspaceId, createdAt],
        );
        return { job: (await this.getJob(tenantId, id)) as JobRecord, created: true };
      } catch (error) {
        // 23505 = unique_violation on jobs_one_active_per_workspace: another
        // request already holds the active-job slot for this workspace.
        if ((error as { code?: string }).code !== '23505') throw error;
        const active = (await this.listJobsForWorkspace(tenantId, workspaceId)).find(
          (j) => j.status === 'queued' || j.status === 'running',
        );
        if (active) return { job: active, created: false };
        // Slot released while we were looking; go round and claim it.
      }
    }
    throw new Error('Could not claim the analysis slot for this workspace.');
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

  /**
   * Ordered run history for one workspace, without the artifacts. Served by
   * `runs_workspace_at`, so it stays an index scan as a workspace accumulates
   * years of analyses. Same ordering as listRuns.
   */
  async listWorkspaceRunHeaders(tenantId: string, workspaceId: string): Promise<RunHeader[]> {
    const result = await this.pool.query(
      `select id, workspace_id, created_at, viewed_at from runs
         where tenant_id = $1 and workspace_id = $2
         order by created_at desc, id`,
      [tenantId, workspaceId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => ({
      id: row['id'] as string,
      workspaceId: row['workspace_id'] as string,
      createdAt: toIso(row['created_at']) as string,
      viewedAt: toIso(row['viewed_at']),
    }));
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
      await client.query('delete from events where tenant_id = $1', [tenantId]);
      await client.query('delete from subscriptions where tenant_id = $1', [tenantId]);
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

  // ---------------- Admin operations console (cross-tenant) ----------------
  //
  // A deliberate, audited exception to the tenancy law, reachable only behind
  // the COSTFLOW_ADMIN_EMAILS allowlist. `order by` cannot be parameterized, so
  // the sort column is always chosen from a per-method WHITELIST of literal SQL
  // (never interpolated from user input); direction is validated; limit/offset
  // and every filter are bound parameters. Projections never select a secret
  // (token/salt ciphertext) or raw run content (run_json/report_md/telemetry).

  private adminFilters(
    params: AdminListParams,
    opts: { tenantCol?: string; statusCol?: string; searchCols?: readonly string[] },
  ): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const bound: unknown[] = [];
    if (opts.tenantCol && params.tenantId) {
      bound.push(params.tenantId);
      clauses.push(`${opts.tenantCol} = $${bound.length}`);
    }
    if (opts.statusCol && params.status) {
      bound.push(params.status);
      clauses.push(`${opts.statusCol} = $${bound.length}`);
    }
    const q = (params.q ?? '').trim();
    if (opts.searchCols && opts.searchCols.length > 0 && q !== '') {
      bound.push(`%${q}%`);
      const idx = bound.length;
      clauses.push(`(${opts.searchCols.map((c) => `${c} ilike $${idx}`).join(' or ')})`);
    }
    return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params: bound };
  }

  private async adminPage<T>(
    table: string,
    selectCols: string,
    filters: { sql: string; params: unknown[] },
    sortMap: Record<string, string>,
    defSort: string,
    params: AdminListParams,
    map: (row: Record<string, unknown>) => T,
  ): Promise<AdminPage<T>> {
    const countRes = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from ${table} ${filters.sql}`,
      filters.params,
    );
    const total = Number(countRes.rows[0]?.n ?? 0);
    const col =
      params.sort && sortMap[params.sort] ? sortMap[params.sort] : (sortMap[defSort] as string);
    const dir = params.dir === 'asc' ? 'asc' : 'desc';
    const n = filters.params.length;
    const res = await this.pool.query(
      `select ${selectCols} from ${table} ${filters.sql} order by ${col} ${dir} limit $${n + 1} offset $${n + 2}`,
      [...filters.params, params.limit, params.offset],
    );
    return { rows: (res.rows as Record<string, unknown>[]).map(map), total };
  }

  async adminCounts(): Promise<AdminCounts> {
    const r = await this.pool.query<Record<string, string>>(
      `select
         (select count(*) from tenants) as tenants,
         (select count(*) from users) as users,
         (select count(*) from workspaces) as workspaces,
         (select count(*) from jobs) as jobs,
         (select count(*) from runs) as runs,
         (select count(*) from invitations) as invitations,
         (select count(*) from invitations where status = 'pending') as pending_invitations,
         (select count(*) from jobs where status = 'failed') as failed_jobs,
         (select count(*) from jobs where status in ('running','queued')) as running_jobs`,
    );
    const row = r.rows[0] ?? {};
    const n = (k: string): number => Number(row[k] ?? 0);
    return {
      tenants: n('tenants'),
      users: n('users'),
      workspaces: n('workspaces'),
      jobs: n('jobs'),
      runs: n('runs'),
      invitations: n('invitations'),
      pendingInvitations: n('pending_invitations'),
      failedJobs: n('failed_jobs'),
      runningJobs: n('running_jobs'),
    };
  }

  async adminListTenants(params: AdminListParams): Promise<AdminPage<AdminTenantRow>> {
    const clauses: string[] = [];
    const bound: unknown[] = [];
    if (params.tenantId) {
      bound.push(params.tenantId);
      clauses.push(`t.id = $${bound.length}`);
    }
    const q = (params.q ?? '').trim();
    if (q !== '') {
      bound.push(`%${q}%`);
      clauses.push(`(t.name ilike $${bound.length} or t.id::text ilike $${bound.length})`);
    }
    const whereSql = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const sortMap: Record<string, string> = {
      createdAt: 't.created_at',
      name: 't.name',
      users: 'users',
      workspaces: 'workspaces',
      runs: 'runs',
      lastActivityAt: 'last_activity_at',
    };
    const col = params.sort && sortMap[params.sort] ? sortMap[params.sort] : sortMap['createdAt']!;
    const dir = params.dir === 'asc' ? 'asc' : 'desc';
    const countRes = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from tenants t ${whereSql}`,
      bound,
    );
    const total = Number(countRes.rows[0]?.n ?? 0);
    const p = bound.length;
    const res = await this.pool.query(
      `select t.id, t.name, t.created_at,
         (select count(*) from users u where u.tenant_id = t.id) as users,
         (select count(*) from workspaces w where w.tenant_id = t.id) as workspaces,
         (select count(*) from runs r where r.tenant_id = t.id) as runs,
         greatest(
           t.created_at,
           coalesce((select max(created_at) from workspaces w where w.tenant_id = t.id), t.created_at),
           coalesce((select max(created_at) from runs r where r.tenant_id = t.id), t.created_at),
           coalesce((select max(coalesce(finished_at, created_at)) from jobs j where j.tenant_id = t.id), t.created_at)
         ) as last_activity_at
       from tenants t ${whereSql}
       order by ${col} ${dir} limit $${p + 1} offset $${p + 2}`,
      [...bound, params.limit, params.offset],
    );
    const rows: AdminTenantRow[] = (res.rows as Record<string, unknown>[]).map((row) => ({
      id: row['id'] as string,
      name: (row['name'] as string | null) ?? null,
      createdAt: toIso(row['created_at']) as string,
      users: Number(row['users'] ?? 0),
      workspaces: Number(row['workspaces'] ?? 0),
      runs: Number(row['runs'] ?? 0),
      lastActivityAt: toIso(row['last_activity_at']),
    }));
    return { rows, total };
  }

  async adminListUsers(params: AdminListParams): Promise<AdminPage<AdminUserRow>> {
    return this.adminPage(
      'users',
      'id, tenant_id, email, role, created_at',
      this.adminFilters(params, { tenantCol: 'tenant_id', searchCols: ['email', 'id::text'] }),
      { createdAt: 'created_at', email: 'email', role: 'role' },
      'createdAt',
      params,
      (row) => ({
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        email: row['email'] as string,
        role: row['role'] as OrgRole,
        createdAt: toIso(row['created_at']) as string,
      }),
    );
  }

  async adminListWorkspaces(params: AdminListParams): Promise<AdminPage<AdminWorkspaceRow>> {
    return this.adminPage(
      'workspaces',
      `id, tenant_id, provider, connection_params, site, email, scopes,
       onboarding, created_at, (token_ciphertext <> '') as has_token`,
      this.adminFilters(params, {
        tenantCol: 'tenant_id',
        statusCol: 'onboarding',
        searchCols: ['provider', "coalesce(scopes::text,'')", 'id::text'],
      }),
      { createdAt: 'created_at', provider: 'provider', onboarding: 'onboarding' },
      'createdAt',
      params,
      (row) => ({
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        provider: row['provider'] as string,
        connectionParams: (row['connection_params'] as Record<string, string> | null) ?? {
          site: (row['site'] as string | null) ?? '',
          email: (row['email'] as string | null) ?? '',
        },
        scopes: (row['scopes'] as AdminWorkspaceRow['scopes'] | null) ?? [],
        onboarding: row['onboarding'] as AdminWorkspaceRow['onboarding'],
        hasToken: row['has_token'] === true,
        createdAt: toIso(row['created_at']) as string,
      }),
    );
  }

  async adminListJobs(params: AdminListParams): Promise<AdminPage<AdminJobRow>> {
    return this.adminPage(
      'jobs',
      'id, tenant_id, workspace_id, status, error_class, created_at, finished_at',
      this.adminFilters(params, {
        tenantCol: 'tenant_id',
        statusCol: 'status',
        searchCols: ['id::text', 'workspace_id::text'],
      }),
      { createdAt: 'created_at', status: 'status' },
      'createdAt',
      params,
      (row) => ({
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        workspaceId: row['workspace_id'] as string,
        status: row['status'] as AdminJobRow['status'],
        errorClass: (row['error_class'] as AdminJobRow['errorClass']) ?? null,
        createdAt: toIso(row['created_at']) as string,
        finishedAt: toIso(row['finished_at']),
      }),
    );
  }

  async adminListRuns(params: AdminListParams): Promise<AdminPage<AdminRunRow>> {
    return this.adminPage(
      'runs',
      'id, tenant_id, workspace_id, created_at, viewed_at',
      this.adminFilters(params, {
        tenantCol: 'tenant_id',
        searchCols: ['id', 'workspace_id::text'],
      }),
      { createdAt: 'created_at' },
      'createdAt',
      params,
      (row) => ({
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        workspaceId: row['workspace_id'] as string,
        createdAt: toIso(row['created_at']) as string,
        viewed: row['viewed_at'] !== null && row['viewed_at'] !== undefined,
      }),
    );
  }

  async adminListInvitations(params: AdminListParams): Promise<AdminPage<AdminInvitationRow>> {
    return this.adminPage(
      'invitations',
      'id, tenant_id, email, role, status, invited_by, created_at, accepted_at',
      this.adminFilters(params, {
        tenantCol: 'tenant_id',
        statusCol: 'status',
        searchCols: ['email', 'id::text'],
      }),
      { createdAt: 'created_at', status: 'status', email: 'email' },
      'createdAt',
      params,
      (row) => ({
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        email: row['email'] as string,
        role: row['role'] as OrgRole,
        status: row['status'] as AdminInvitationRow['status'],
        invitedBy: (row['invited_by'] as string | null) ?? null,
        createdAt: toIso(row['created_at']) as string,
        acceptedAt: toIso(row['accepted_at']),
      }),
    );
  }

  async adminSearch(q: string, limit: number): Promise<AdminSearchHit[]> {
    const needle = q.trim();
    if (needle === '') return [];
    const like = `%${needle}%`;
    const hits: AdminSearchHit[] = [];
    const tenants = await this.pool.query(
      `select id, name from tenants where name ilike $1 or id::text ilike $1 limit $2`,
      [like, limit],
    );
    for (const row of tenants.rows as Record<string, unknown>[])
      hits.push({
        kind: 'tenant',
        id: row['id'] as string,
        tenantId: row['id'] as string,
        label: (row['name'] as string | null) ?? '(unnamed org)',
        sub: row['id'] as string,
      });
    const users = await this.pool.query(
      `select id, tenant_id, email, role from users where email ilike $1 or id::text ilike $1 limit $2`,
      [like, limit],
    );
    for (const row of users.rows as Record<string, unknown>[])
      hits.push({
        kind: 'user',
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        label: row['email'] as string,
        sub: `${row['role'] as string} · ${row['id'] as string}`,
      });
    const workspaces = await this.pool.query(
      `select id, tenant_id, provider, scopes from workspaces
       where coalesce(scopes::text,'') ilike $1 or id::text ilike $1
       limit $2`,
      [like, limit],
    );
    for (const row of workspaces.rows as Record<string, unknown>[])
      hits.push({
        kind: 'workspace',
        id: row['id'] as string,
        tenantId: row['tenant_id'] as string,
        label:
          describeSelection((row['scopes'] as WorkspaceRecord['scopes'] | null) ?? []) ??
          (row['provider'] as string),
        sub: `${row['provider'] as string} · ${row['id'] as string}`,
      });
    return hits.slice(0, limit);
  }

  async adminLogAction(entry: AdminAuditEntry): Promise<void> {
    await this.pool.query(
      `insert into admin_audit
         (id, at, admin_user_id, admin_email, action, target_kind, target_id, target_tenant_id, detail)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        newId(),
        new Date().toISOString(),
        entry.adminUserId,
        entry.adminEmail,
        entry.action,
        entry.targetKind,
        entry.targetId,
        entry.targetTenantId,
        entry.detail === null ? null : JSON.stringify(entry.detail),
      ],
    );
  }

  async adminListAudit(params: AdminListParams): Promise<AdminPage<AdminAuditRow>> {
    return this.adminPage(
      'admin_audit',
      'id, at, admin_email, action, target_kind, target_id, target_tenant_id, detail',
      this.adminFilters(params, { searchCols: ['action', 'admin_email', 'target_id'] }),
      { at: 'at', action: 'action' },
      'at',
      params,
      (row) => ({
        id: row['id'] as string,
        at: toIso(row['at']) as string,
        adminEmail: row['admin_email'] as string,
        action: row['action'] as string,
        targetKind: (row['target_kind'] as string | null) ?? null,
        targetId: (row['target_id'] as string | null) ?? null,
        targetTenantId: (row['target_tenant_id'] as string | null) ?? null,
        detail: (row['detail'] as Record<string, unknown> | null) ?? null,
      }),
    );
  }

  // -------- Customer database & activity spine (P4.5; cross-tenant) --------

  async recordEvent(event: EventInput): Promise<void> {
    await this.pool.query(
      `insert into events (id, tenant_id, user_id, workspace_id, type, at, fields)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        newId(),
        event.tenantId,
        event.userId,
        event.workspaceId,
        event.type,
        this.now(),
        JSON.stringify(event.fields ?? {}),
      ],
    );
  }

  async recordSignIn(
    userId: string,
    observation: IdentityObservation,
    nowIso: string,
  ): Promise<void> {
    // coalesce($n, col) keeps a previously-observed claim when this sign-in did
    // not carry it: the IdP omitting a claim is not evidence that it changed.
    await this.pool.query(
      `update users set
         sign_in_count = sign_in_count + 1,
         first_seen_at = coalesce(first_seen_at, $2),
         last_seen_at = $2,
         email_verified = coalesce($3, email_verified),
         auth_provider = coalesce($4, auth_provider),
         display_name = coalesce($5, display_name)
       where id = $1`,
      [
        userId,
        nowIso,
        observation.emailVerified ?? null,
        observation.authProvider ?? null,
        observation.displayName ?? null,
      ],
    );
  }

  async touchLastSeen(userId: string, nowIso: string): Promise<void> {
    await this.pool.query('update users set last_seen_at = $2 where id = $1', [userId, nowIso]);
  }

  private subscriptionFromRow(row: Record<string, unknown>): SubscriptionRecord {
    return {
      tenantId: row['tenant_id'] as string,
      plan: row['plan'] as string,
      billingStatus: row['billing_status'] as BillingStatus,
      provider: row['provider'] as BillingProvider,
      providerCustomerId: (row['provider_customer_id'] as string | null) ?? null,
      providerSubscriptionId: (row['provider_subscription_id'] as string | null) ?? null,
      providerVariantId: (row['provider_variant_id'] as string | null) ?? null,
      trialEndsAt: toIso(row['trial_ends_at']),
      renewsAt: toIso(row['renews_at']),
      currentPeriodEnd: toIso(row['current_period_end']),
      cancelledAt: toIso(row['cancelled_at']),
      endsAt: toIso(row['ends_at']),
      createdAt: toIso(row['created_at']) as string,
      updatedAt: toIso(row['updated_at']) as string,
    };
  }

  async getSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const res = await this.pool.query('select * from subscriptions where tenant_id = $1', [
      tenantId,
    ]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? this.subscriptionFromRow(row) : null;
  }

  async ensureSubscription(tenantId: string, nowIso: string): Promise<SubscriptionRecord> {
    await this.pool.query(
      `insert into subscriptions (tenant_id, created_at, updated_at) values ($1, $2, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, nowIso],
    );
    const existing = await this.getSubscription(tenantId);
    if (existing) return existing;
    // Only reachable if the tenant row is gone (FK), in which case there is no
    // subscription to speak of; report the default rather than throwing.
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
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  /**
   * One row per candidate customer, carrying the raw signals the health scorer
   * reads. Identity and sign-in activity are per-user; product usage is
   * organization-level, because runs/jobs/workspaces record no actor for
   * anything that predates the activity spine. The console labels the
   * distinction; it never presents org usage as one person's.
   */
  private async customerRows(
    where: string,
    bound: readonly unknown[],
    nowIso: string,
    limit: number,
  ): Promise<{ rows: AdminCustomerRow[]; truncated: boolean }> {
    const since30d = new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString();
    const params = [...bound, ONBOARDING_ORDER as readonly string[], since30d, limit];
    const rankIdx = bound.length + 1;
    const sinceIdx = bound.length + 2;
    const limitIdx = bound.length + 3;
    const res = await this.pool.query(
      `select ${USER_COLS.split(', ')
        .map((c) => `u.${c}`)
        .join(', ')},
         t.name as org_name,
         coalesce(s.plan, 'beta') as plan,
         coalesce(s.billing_status, 'free_beta') as billing_status,
         ws.workspaces, ws.ready_workspaces, ws.onboarding_rank, ws.providers,
         rs.analyses, rs.analyses_30d, rs.last_analysis_at, rs.reports_viewed,
         exists (
           select 1 from events e
           where e.user_id = u.id and e.type = 'session.started'
             and u.first_seen_at is not null
             and e.at > u.first_seen_at + interval '24 hours'
         ) as returned
       from users u
       join tenants t on t.id = u.tenant_id
       left join subscriptions s on s.tenant_id = u.tenant_id
       left join lateral (
         select count(*)::int as workspaces,
                count(*) filter (where w.onboarding = 'ready')::int as ready_workspaces,
                coalesce(max(array_position($${rankIdx}::text[], w.onboarding)) - 1, -1) as onboarding_rank,
                coalesce(array_agg(distinct w.provider), '{}'::text[]) as providers
           from workspaces w where w.tenant_id = u.tenant_id
       ) ws on true
       left join lateral (
         select count(*)::int as analyses,
                count(*) filter (where r.created_at >= $${sinceIdx})::int as analyses_30d,
                max(r.created_at) as last_analysis_at,
                count(*) filter (where r.viewed_at is not null)::int as reports_viewed
           from runs r where r.tenant_id = u.tenant_id
       ) rs on true
       ${where}
       order by u.created_at desc
       limit $${limitIdx}`,
      params,
    );
    const raw = res.rows as Record<string, unknown>[];
    const rows = raw.slice(0, limit).map((row) => {
      const user = this.userFromRow(row);
      const lastAnalysisAt = toIso(row['last_analysis_at']);
      const signals: CustomerSignals = {
        nowIso,
        createdAt: user.createdAt,
        lastSeenAt: user.identity.lastSeenAt,
        signInCount: user.identity.signInCount,
        workspaces: Number(row['workspaces'] ?? 0),
        readyWorkspaces: Number(row['ready_workspaces'] ?? 0),
        analyses: Number(row['analyses'] ?? 0),
        analyses30d: Number(row['analyses_30d'] ?? 0),
        lastAnalysisAt,
        reportsViewed: Number(row['reports_viewed'] ?? 0),
        onboardingRank: Number(row['onboarding_rank'] ?? -1),
        returned: row['returned'] === true,
      };
      const health = scoreCustomer(signals);
      return {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.identity.displayName,
        orgName: (row['org_name'] as string | null) ?? null,
        role: user.role,
        createdAt: user.createdAt,
        identity: user.identity,
        workspaces: signals.workspaces,
        readyWorkspaces: signals.readyWorkspaces,
        providers: ((row['providers'] as string[] | null) ?? []).filter((p) => p !== null),
        analyses: signals.analyses,
        analyses30d: signals.analyses30d,
        lastAnalysisAt,
        reportsViewed: signals.reportsViewed,
        lastActivityAt: lastActivityOf(signals),
        plan: row['plan'] as string,
        billingStatus: row['billing_status'] as BillingStatus,
        status: health.status,
        health: health.band,
        healthScore: health.score,
        signals,
      } satisfies AdminCustomerRow;
    });
    return { rows, truncated: raw.length >= limit };
  }

  async adminListCustomers(params: AdminCustomerParams): Promise<AdminPage<AdminCustomerRow>> {
    const clauses: string[] = [];
    const bound: unknown[] = [];
    const add = (sql: (i: number) => string, value: unknown): void => {
      bound.push(value);
      clauses.push(sql(bound.length));
    };
    if (params.tenantId) add((i) => `u.tenant_id = $${i}`, params.tenantId);
    const q = (params.q ?? '').trim();
    if (q !== '')
      add(
        (i) =>
          `(u.email ilike $${i} or coalesce(u.display_name,'') ilike $${i} or coalesce(t.name,'') ilike $${i} or u.id::text ilike $${i})`,
        `%${q}%`,
      );
    if (params.signedUpFrom) add((i) => `u.created_at >= $${i}`, params.signedUpFrom);
    if (params.signedUpTo) add((i) => `u.created_at <= $${i}`, params.signedUpTo);
    if (params.activeSince) add((i) => `u.last_seen_at >= $${i}`, params.activeSince);
    if (params.plan) add((i) => `coalesce(s.plan,'beta') = $${i}`, params.plan);
    if (params.provider)
      add(
        (i) =>
          `exists (select 1 from workspaces w2 where w2.tenant_id = u.tenant_id and w2.provider = $${i})`,
        params.provider,
      );
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const nowIso = this.now();
    const scanned = await this.customerRows(where, bound, nowIso, CUSTOMER_SCAN_CAP);

    // Derived filters and sorts run here rather than in SQL: the health score is
    // a function of measured signals (health.ts), and duplicating that rule set
    // in SQL is how two definitions of "at risk" start disagreeing.
    let rows = scanned.rows;
    if (params.customerStatus) rows = rows.filter(matchesCustomerFilter(params.customerStatus));
    if (params.health) rows = rows.filter((r) => r.health === params.health);
    const dir = params.dir === 'asc' ? 1 : -1;
    const sorters: Record<string, (r: AdminCustomerRow) => string | number> = {
      createdAt: (r) => Date.parse(r.createdAt),
      email: (r) => r.email.toLowerCase(),
      lastSeenAt: (r) => (r.identity.lastSeenAt ? Date.parse(r.identity.lastSeenAt) : 0),
      lastActivityAt: (r) => (r.lastActivityAt ? Date.parse(r.lastActivityAt) : 0),
      analyses: (r) => r.analyses,
      healthScore: (r) => r.healthScore,
      signInCount: (r) => r.identity.signInCount,
      orgName: (r) => (r.orgName ?? '').toLowerCase(),
    };
    const key = sorters[params.sort ?? 'createdAt'] ?? sorters['createdAt']!;
    const sorted = [...rows].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av === bv) return a.userId < b.userId ? -1 : 1;
      return (av < bv ? -1 : 1) * dir;
    });
    return {
      rows: sorted.slice(params.offset, params.offset + params.limit),
      total: sorted.length,
      truncated: scanned.truncated,
    };
  }

  async adminGetCustomer(userId: string): Promise<AdminCustomerRow | null> {
    const scanned = await this.customerRows('where u.id = $1', [userId], this.now(), 1);
    return scanned.rows[0] ?? null;
  }

  private activityFromRow(row: Record<string, unknown>): AdminActivityRow {
    return {
      id: row['id'] as string,
      at: toIso(row['at']) as string,
      type: row['type'] as EventType,
      tenantId: row['tenant_id'] as string,
      orgName: (row['org_name'] as string | null) ?? null,
      userId: (row['user_id'] as string | null) ?? null,
      userEmail: (row['user_email'] as string | null) ?? null,
      workspaceId: (row['workspace_id'] as string | null) ?? null,
      workspaceName: (row['workspace_name'] as string | null) ?? null,
      fields: (row['fields'] as Record<string, unknown> | null) ?? {},
    };
  }

  private readonly ACTIVITY_SELECT = `select e.id, e.at, e.type, e.tenant_id, e.user_id, e.workspace_id, e.fields,
           t.name as org_name, u.email as user_email,
           coalesce(w.name, w.scopes->0->>'name') as workspace_name
      from events e
      left join tenants t on t.id = e.tenant_id
      left join users u on u.id = e.user_id
      left join workspaces w on w.id = e.workspace_id`;

  async adminUserTimeline(userId: string, limit: number): Promise<AdminActivityRow[]> {
    const res = await this.pool.query(
      `${this.ACTIVITY_SELECT} where e.user_id = $1 order by e.at desc limit $2`,
      [userId, limit],
    );
    return (res.rows as Record<string, unknown>[]).map((row) => this.activityFromRow(row));
  }

  async adminActivityFeed(params: AdminListParams): Promise<AdminPage<AdminActivityRow>> {
    const clauses: string[] = [];
    const bound: unknown[] = [];
    if (params.tenantId) {
      bound.push(params.tenantId);
      clauses.push(`e.tenant_id = $${bound.length}`);
    }
    if (params.status) {
      bound.push(params.status);
      clauses.push(`e.type = $${bound.length}`);
    }
    const q = (params.q ?? '').trim();
    if (q !== '') {
      bound.push(`%${q}%`);
      clauses.push(
        `(coalesce(t.name,'') ilike $${bound.length} or coalesce(u.email,'') ilike $${bound.length} or e.type ilike $${bound.length})`,
      );
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const countRes = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from events e
         left join tenants t on t.id = e.tenant_id
         left join users u on u.id = e.user_id
       ${where}`,
      bound,
    );
    const n = bound.length;
    const res = await this.pool.query(
      `${this.ACTIVITY_SELECT} ${where} order by e.at desc limit $${n + 1} offset $${n + 2}`,
      [...bound, params.limit, params.offset],
    );
    return {
      rows: (res.rows as Record<string, unknown>[]).map((row) => this.activityFromRow(row)),
      total: Number(countRes.rows[0]?.n ?? 0),
    };
  }

  async adminListMonitoringWorkspaces(
    params: AdminListParams,
  ): Promise<AdminPage<AdminMonitoringWorkspaceRow>> {
    const clauses: string[] = [];
    const bound: unknown[] = [];
    if (params.tenantId) {
      bound.push(params.tenantId);
      clauses.push(`w.tenant_id = $${bound.length}`);
    }
    if (params.status) {
      bound.push(params.status);
      clauses.push(`w.onboarding = $${bound.length}`);
    }
    const q = (params.q ?? '').trim();
    if (q !== '') {
      bound.push(`%${q}%`);
      clauses.push(
        `(coalesce(w.name,'') ilike $${bound.length} or coalesce(w.scopes::text,'') ilike $${bound.length} or w.provider ilike $${bound.length} or w.id::text ilike $${bound.length})`,
      );
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const sortMap: Record<string, string> = {
      createdAt: 'w.created_at',
      name: 'name',
      provider: 'w.provider',
      analyses: 'analyses',
      lastAnalysisAt: 'last_analysis_at',
    };
    const col = params.sort && sortMap[params.sort] ? sortMap[params.sort] : sortMap['createdAt']!;
    const dir = params.dir === 'asc' ? 'asc' : 'desc';
    const countRes = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from workspaces w ${where}`,
      bound,
    );
    const n = bound.length;
    const res = await this.pool.query(
      `select w.id, w.tenant_id, coalesce(w.name, w.scopes->0->>'name') as name, w.provider,
              w.scopes, w.onboarding, w.created_at,
              (select count(*) from workspace_members m where m.workspace_id = w.id)::int as members,
              (select count(*) from runs r where r.workspace_id = w.id)::int as analyses,
              (select max(created_at) from runs r where r.workspace_id = w.id) as last_analysis_at,
              (select max(coalesce(finished_at, created_at)) from jobs j
                 where j.workspace_id = w.id and j.status = 'succeeded') as last_sync_at
         from workspaces w ${where}
         order by ${col} ${dir} limit $${n + 1} offset $${n + 2}`,
      [...bound, params.limit, params.offset],
    );
    const rows = (res.rows as Record<string, unknown>[]).map((row) => ({
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      name: (row['name'] as string | null) ?? null,
      provider: row['provider'] as string,
      scopes: (row['scopes'] as WorkspaceRecord['scopes'] | null) ?? [],
      onboarding: row['onboarding'] as OnboardingState,
      members: Number(row['members'] ?? 0),
      analyses: Number(row['analyses'] ?? 0),
      lastAnalysisAt: toIso(row['last_analysis_at']),
      lastSyncAt: toIso(row['last_sync_at']),
      createdAt: toIso(row['created_at']) as string,
    }));
    return { rows, total: Number(countRes.rows[0]?.n ?? 0) };
  }

  async adminOrgDetail(
    tenantId: string,
    nowIso: string,
    trendDays: number,
  ): Promise<AdminOrgDetail | null> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return null;
    const since30d = new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString();
    const trendSince = new Date(Date.parse(nowIso) - trendDays * 86_400_000).toISOString();
    const res = await this.pool.query(
      `select
         (select count(*) from users u where u.tenant_id = $1)::int as members,
         (select count(*) from workspaces w where w.tenant_id = $1)::int as workspaces,
         (select count(*) from workspaces w where w.tenant_id = $1 and w.onboarding = 'ready')::int as ready_workspaces,
         (select coalesce(array_agg(distinct w.provider), '{}'::text[]) from workspaces w where w.tenant_id = $1) as providers,
         (select coalesce(max(array_position($2::text[], w.onboarding)) - 1, -1) from workspaces w where w.tenant_id = $1) as onboarding_rank,
         (select count(*) from runs r where r.tenant_id = $1)::int as analyses,
         (select count(*) from runs r where r.tenant_id = $1 and r.created_at >= $3)::int as analyses_30d,
         (select max(created_at) from runs r where r.tenant_id = $1) as last_analysis_at,
         (select count(*) from runs r where r.tenant_id = $1 and r.viewed_at is not null)::int as reports_viewed,
         (select max(last_seen_at) from users u where u.tenant_id = $1) as last_seen_at,
         (select coalesce(sum(sign_in_count), 0) from users u where u.tenant_id = $1)::int as sign_ins,
         (select max(at) from events e where e.tenant_id = $1) as last_event_at,
         exists (
           select 1 from events e join users u on u.id = e.user_id
           where e.tenant_id = $1 and e.type = 'session.started'
             and u.first_seen_at is not null and e.at > u.first_seen_at + interval '24 hours'
         ) as returned`,
      [tenantId, ONBOARDING_ORDER as readonly string[], since30d],
    );
    const row = (res.rows[0] ?? {}) as Record<string, unknown>;
    const trendRes = await this.pool.query(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as date, count(*)::int as analyses
         from runs where tenant_id = $1 and created_at >= $2
         group by 1 order by 1`,
      [tenantId, trendSince],
    );
    const lastAnalysisAt = toIso(row['last_analysis_at']);
    const signals: CustomerSignals = {
      nowIso,
      createdAt: tenant.createdAt,
      lastSeenAt: toIso(row['last_seen_at']),
      signInCount: Number(row['sign_ins'] ?? 0),
      workspaces: Number(row['workspaces'] ?? 0),
      readyWorkspaces: Number(row['ready_workspaces'] ?? 0),
      analyses: Number(row['analyses'] ?? 0),
      analyses30d: Number(row['analyses_30d'] ?? 0),
      lastAnalysisAt,
      reportsViewed: Number(row['reports_viewed'] ?? 0),
      onboardingRank: Number(row['onboarding_rank'] ?? -1),
      returned: row['returned'] === true,
    };
    const lastEventAt = toIso(row['last_event_at']);
    const candidates = [lastActivityOf(signals), lastEventAt].filter(
      (v): v is string => typeof v === 'string',
    );
    return {
      tenantId,
      name: tenant.name,
      createdAt: tenant.createdAt,
      members: Number(row['members'] ?? 0),
      workspaces: signals.workspaces,
      readyWorkspaces: signals.readyWorkspaces,
      providers: ((row['providers'] as string[] | null) ?? []).filter((p) => p !== null),
      analyses: signals.analyses,
      analyses30d: signals.analyses30d,
      reportsViewed: signals.reportsViewed,
      lastActivityAt: candidates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
      lastAnalysisAt,
      subscription: await this.getSubscription(tenantId),
      signals,
      trend: (trendRes.rows as Record<string, unknown>[]).map((r) => ({
        date: r['date'] as string,
        analyses: Number(r['analyses'] ?? 0),
      })),
    };
  }

  async adminFunnel(from: string | null, to: string | null, nowIso: string): Promise<FunnelReport> {
    const clauses: string[] = [];
    const bound: unknown[] = [ONBOARDING_ORDER as readonly string[]];
    if (from) {
      bound.push(from);
      clauses.push(`t.created_at >= $${bound.length}`);
    }
    if (to) {
      bound.push(to);
      clauses.push(`t.created_at <= $${bound.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    bound.push(CUSTOMER_SCAN_CAP);
    // One row per organization in the cohort: for each step, whether it was
    // reached and (where recorded) when. Preferring the event timestamp and
    // falling back to the source table means timing is exact for organizations
    // that came after the activity spine and simply absent, never guessed, for
    // the ones that came before.
    const res = await this.pool.query(
      `select t.id as tenant_id, t.created_at,
         (select bool_or(coalesce(u.email_verified, false)) from users u where u.tenant_id = t.id) as verified,
         (select min(coalesce(u.first_seen_at, u.created_at)) from users u where u.tenant_id = t.id) as logged_in_at,
         (select coalesce(sum(u.sign_in_count), 0) from users u where u.tenant_id = t.id)::int as sign_ins,
         (select min(w.created_at) from workspaces w where w.tenant_id = t.id) as connected_at,
         (select coalesce(max(array_position($1::text[], w.onboarding)) - 1, -1)
            from workspaces w where w.tenant_id = t.id)::int as onboarding_rank,
         (select min(e.at) from events e where e.tenant_id = t.id and e.type = 'scope.selected') as scope_at,
         (select min(e.at) from events e where e.tenant_id = t.id and e.type = 'assumptions.set') as salaries_at,
         (select min(e.at) from events e where e.tenant_id = t.id and e.type = 'workspace.ready') as ready_at,
         (select count(*) from workspaces w where w.tenant_id = t.id and w.onboarding = 'ready')::int as ready_count,
         (select min(r.created_at) from runs r where r.tenant_id = t.id) as first_analysis_at,
         (select min(r.viewed_at) from runs r where r.tenant_id = t.id and r.viewed_at is not null) as first_view_at,
         (select min(e.at) from events e
            where e.tenant_id = t.id and e.type = 'session.started'
              and e.at > t.created_at + interval '24 hours'
              and e.at <= t.created_at + interval '7 days') as returned_at
       from tenants t ${where}
       order by t.created_at desc
       limit $${bound.length}`,
      bound,
    );
    const rows: TenantFunnelRow[] = (res.rows as Record<string, unknown>[]).map((row) => {
      const createdAt = toIso(row['created_at']);
      const rank = Number(row['onboarding_rank'] ?? -1);
      const connectedAt = toIso(row['connected_at']);
      const firstAnalysisAt = toIso(row['first_analysis_at']);
      const firstViewAt = toIso(row['first_view_at']);
      const readyAt = toIso(row['ready_at']);
      const returnedAt = toIso(row['returned_at']);
      const loggedInAt = toIso(row['logged_in_at']);
      const reached = [
        true,
        row['verified'] === true,
        Number(row['sign_ins'] ?? 0) >= 1,
        connectedAt !== null,
        rank >= 1,
        rank >= 4,
        firstAnalysisAt !== null,
        firstViewAt !== null,
        Number(row['ready_count'] ?? 0) >= 1,
        returnedAt !== null,
      ];
      const at = [
        createdAt,
        // The IdP reports verification as a claim, not an instant.
        null,
        loggedInAt,
        connectedAt,
        toIso(row['scope_at']),
        toIso(row['salaries_at']),
        firstAnalysisAt,
        firstViewAt,
        readyAt,
        returnedAt,
      ];
      return { tenantId: row['tenant_id'] as string, reached, at };
    });
    void nowIso;
    return buildFunnel(rows, from, to);
  }

  async adminDashboard(nowIso: string, days: number): Promise<AdminDashboard> {
    const now = Date.parse(nowIso);
    const dayStart = new Date(nowIso).toISOString().slice(0, 10);
    const since7d = new Date(now - 7 * 86_400_000).toISOString();
    const since30d = new Date(now - 30 * 86_400_000).toISOString();
    const sinceTrend = new Date(now - days * 86_400_000).toISOString();
    const res = await this.pool.query(
      `select
         (select count(*) from users)::int as users,
         (select count(*) from tenants)::int as organizations,
         (select count(*) from users where created_at >= $1)::int as new_users_today,
         (select count(*) from users where created_at >= $2)::int as new_users_week,
         (select count(*) from tenants where created_at >= $2)::int as new_orgs_week,
         (select count(*) from users where last_seen_at >= $3)::int as active_users_30d,
         (select count(*) from users where last_seen_at >= $2)::int as active_users_7d,
         (select count(*) from users where sign_in_count >= 2)::int as returning_users,
         (select count(*) from runs where created_at >= $1)::int as analyses_today,
         (select count(*) from runs where viewed_at >= $1)::int as reports_viewed_today,
         (select count(*) from workspaces)::int as monitoring_workspaces,
         (select count(*) from subscriptions where billing_status = 'on_trial'
            and (trial_ends_at is null or trial_ends_at > $4))::int as active_trials`,
      [`${dayStart}T00:00:00.000Z`, since7d, since30d, nowIso],
    );
    const row = (res.rows[0] ?? {}) as Record<string, unknown>;
    const n = (k: string): number => Number(row[k] ?? 0);
    const providerRes = await this.pool.query(
      `select provider, count(distinct tenant_id)::int as orgs from workspaces group by provider order by orgs desc`,
    );
    const signupsRes = await this.pool.query(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as date, count(*)::int as users
         from users where created_at >= $1 group by 1 order by 1`,
      [sinceTrend],
    );
    const analysesRes = await this.pool.query(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as date, count(*)::int as analyses
         from runs where created_at >= $1 group by 1 order by 1`,
      [sinceTrend],
    );
    // Churn risk is the health rule (health.ts), evaluated over organizations
    // rather than reimplemented as a second SQL definition of "at risk".
    const orgRes = await this.pool.query(
      `select t.id, t.created_at,
         (select count(*) from workspaces w where w.tenant_id = t.id and w.onboarding = 'ready')::int as ready,
         (select count(*) from runs r where r.tenant_id = t.id)::int as analyses,
         (select count(*) from runs r where r.tenant_id = t.id and r.created_at >= $1)::int as analyses_30d,
         (select max(created_at) from runs r where r.tenant_id = t.id) as last_analysis_at,
         (select max(last_seen_at) from users u where u.tenant_id = t.id) as last_seen_at
       from tenants t limit $2`,
      [since30d, CUSTOMER_SCAN_CAP],
    );
    let churnRiskOrgs = 0;
    for (const org of orgRes.rows as Record<string, unknown>[]) {
      const signals: CustomerSignals = {
        nowIso,
        createdAt: toIso(org['created_at']) as string,
        lastSeenAt: toIso(org['last_seen_at']),
        signInCount: 0,
        workspaces: 0,
        readyWorkspaces: Number(org['ready'] ?? 0),
        analyses: Number(org['analyses'] ?? 0),
        analyses30d: Number(org['analyses_30d'] ?? 0),
        lastAnalysisAt: toIso(org['last_analysis_at']),
        reportsViewed: 0,
        onboardingRank: -1,
        returned: false,
      };
      if (scoreCustomer(signals).band === 'churn-risk') churnRiskOrgs += 1;
    }
    return {
      users: n('users'),
      organizations: n('organizations'),
      newUsersToday: n('new_users_today'),
      newUsersWeek: n('new_users_week'),
      newOrgsWeek: n('new_orgs_week'),
      activeUsers30d: n('active_users_30d'),
      activeUsers7d: n('active_users_7d'),
      returningUsers: n('returning_users'),
      churnRiskOrgs,
      connectedByProvider: (providerRes.rows as Record<string, unknown>[]).map((r) => ({
        provider: r['provider'] as string,
        orgs: Number(r['orgs'] ?? 0),
      })),
      analysesToday: n('analyses_today'),
      reportsViewedToday: n('reports_viewed_today'),
      monitoringWorkspaces: n('monitoring_workspaces'),
      activeTrials: n('active_trials'),
      signupsByDay: (signupsRes.rows as Record<string, unknown>[]).map((r) => ({
        date: r['date'] as string,
        users: Number(r['users'] ?? 0),
      })),
      analysesByDay: (analysesRes.rows as Record<string, unknown>[]).map((r) => ({
        date: r['date'] as string,
        analyses: Number(r['analyses'] ?? 0),
      })),
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
