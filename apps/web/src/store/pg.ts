import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newId } from '../crypto';
import type {
  JobRecord,
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
export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
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

  async createTenantWithUser(
    email: string,
    saltCiphertext: string,
  ): Promise<{ tenant: TenantRecord; user: UserRecord }> {
    const tenant: TenantRecord = { id: newId(), saltCiphertext, createdAt: this.now() };
    const user: UserRecord = { id: newId(), tenantId: tenant.id, email, createdAt: this.now() };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into tenants (id, salt_ciphertext, created_at) values ($1, $2, $3)',
        [tenant.id, tenant.saltCiphertext, tenant.createdAt],
      );
      await client.query(
        'insert into users (id, tenant_id, email, created_at) values ($1, $2, $3, $4)',
        [user.id, user.tenantId, user.email, user.createdAt],
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
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      email: string;
      created_at: string;
    }>('select id, tenant_id, email, created_at from users where email = $1', [email]);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          email: row.email,
          createdAt: toIso(row.created_at) as string,
        }
      : null;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    const result = await this.pool.query<{
      id: string;
      salt_ciphertext: string;
      created_at: string;
    }>('select id, salt_ciphertext, created_at from tenants where id = $1', [tenantId]);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          saltCiphertext: row.salt_ciphertext,
          createdAt: toIso(row.created_at) as string,
        }
      : null;
  }

  private workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      provider: row['provider'] as 'jira',
      site: row['site'] as string,
      email: row['email'] as string,
      tokenCiphertext: row['token_ciphertext'] as string,
      projectKey: (row['project_key'] as string | null) ?? null,
      projectName: (row['project_name'] as string | null) ?? null,
      observedStatuses: (row['observed_statuses'] as string[] | null) ?? [],
      observedActors: (row['observed_actors'] as string[] | null) ?? [],
      statusMap: (row['status_map'] as WorkspaceRecord['statusMap']) ?? null,
      actorRoleMap: (row['actor_role_map'] as WorkspaceRecord['actorRoleMap']) ?? null,
      assumptions: (row['assumptions'] as WorkspaceRecord['assumptions']) ?? null,
      onboarding: row['onboarding'] as WorkspaceRecord['onboarding'],
      createdAt: toIso(row['created_at']) as string,
    };
  }

  async createWorkspace(
    tenantId: string,
    data: Pick<WorkspaceRecord, 'provider' | 'site' | 'email' | 'tokenCiphertext'>,
  ): Promise<WorkspaceRecord> {
    const id = newId();
    const createdAt = this.now();
    await this.pool.query(
      `insert into workspaces (id, tenant_id, provider, site, email, token_ciphertext, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, data.provider, data.site, data.email, data.tokenCiphertext, createdAt],
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
    if (patch.projectKey !== undefined) columns['project_key'] = patch.projectKey;
    if (patch.projectName !== undefined) columns['project_name'] = patch.projectName;
    if (patch.observedStatuses !== undefined)
      columns['observed_statuses'] = JSON.stringify(patch.observedStatuses);
    if (patch.observedActors !== undefined)
      columns['observed_actors'] = JSON.stringify(patch.observedActors);
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
