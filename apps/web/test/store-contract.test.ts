import { describe, expect, it } from 'vitest';
import type { Store } from '../src/store/contract';
import { MemoryStore } from '../src/store/memory';
import { PgStore } from '../src/store/pg';

/**
 * Shared store contract (doc 09 P4.1 plan §1): both adapters must satisfy
 * these behaviors, tenancy law included. Runs against MemoryStore always;
 * against Postgres when COSTFLOW_TEST_DATABASE_URL is set (this machine has
 * none — the Pg run is a pending live validation, recorded in the log).
 */
function describeStoreContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`store contract: ${name}`, () => {
    it('provisions tenant + user and finds the user by email', async () => {
      const store = await makeStore();
      const { tenant, user } = await store.createTenantWithUser('a@x.example', 'ct');
      expect(user.tenantId).toBe(tenant.id);
      expect(await store.findUserByEmail('a@x.example')).toMatchObject({ id: user.id });
      expect(await store.findUserByEmail('other@x.example')).toBeNull();
      expect(await store.getTenant(tenant.id)).toMatchObject({ saltCiphertext: 'ct' });
    });

    it('scopes workspaces, jobs, and runs by tenant (foreign ids → null)', async () => {
      const store = await makeStore();
      const a = (await store.createTenantWithUser('a@y.example', 'sa')).tenant;
      const b = (await store.createTenantWithUser('b@y.example', 'sb')).tenant;
      const workspace = await store.createWorkspace(a.id, {
        provider: 'jira',
        site: 'https://a.example',
        email: 'a@y.example',
        tokenCiphertext: 'tok',
      });
      expect(await store.getWorkspace(b.id, workspace.id)).toBeNull();
      expect(await store.updateWorkspace(b.id, workspace.id, { onboarding: 'ready' })).toBeNull();
      expect((await store.listWorkspaces(b.id)).length).toBe(0);

      const job = await store.createJob(a.id, workspace.id);
      expect(await store.getJob(b.id, job.id)).toBeNull();
      expect(await store.updateJob(b.id, job.id, { status: 'running' })).toBeNull();

      await store.createRun({
        id: 'run-1',
        tenantId: a.id,
        workspaceId: workspace.id,
        createdAt: '2026-07-21T00:00:00Z',
        runJson: '{}',
        reportMd: '# r',
        telemetryJsonl: '',
      });
      expect(await store.getRun(b.id, 'run-1')).toBeNull();
      expect((await store.listRuns(b.id)).length).toBe(0);
      expect(await store.getRun(a.id, 'run-1')).not.toBeNull();
    });

    it('persists workspace configuration patches', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('c@y.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        site: 'https://c.example',
        email: 'c@y.example',
        tokenCiphertext: 'tok',
      });
      const updated = await store.updateWorkspace(tenant.id, workspace.id, {
        projectKey: 'OPS',
        projectName: 'Operations',
        observedStatuses: ['A', 'B'],
        statusMap: { A: 'queue', B: 'done' },
        onboarding: 'statuses-mapped',
      });
      expect(updated).toMatchObject({
        projectKey: 'OPS',
        observedStatuses: ['A', 'B'],
        statusMap: { A: 'queue', B: 'done' },
        onboarding: 'statuses-mapped',
      });
    });

    it('job lifecycle transitions persist; interrupted recovery targets only running jobs', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('d@y.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        site: 'https://d.example',
        email: 'd@y.example',
        tokenCiphertext: 'tok',
      });
      const running = await store.createJob(tenant.id, workspace.id);
      const finished = await store.createJob(tenant.id, workspace.id);
      await store.updateJob(tenant.id, running.id, { status: 'running' });
      await store.updateJob(tenant.id, finished.id, {
        status: 'succeeded',
        runId: 'r',
        finishedAt: '2026-07-21T00:00:00Z',
      });
      expect(await store.markInterruptedJobs('2026-07-21T01:00:00Z')).toBe(1);
      expect((await store.getJob(tenant.id, running.id))?.status).toBe('failed');
      expect((await store.getJob(tenant.id, finished.id))?.status).toBe('succeeded');
    });

    it('marks the first report view exactly once', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('e@y.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        site: 'https://e.example',
        email: 'e@y.example',
        tokenCiphertext: 'tok',
      });
      await store.createRun({
        id: 'run-v',
        tenantId: tenant.id,
        workspaceId: workspace.id,
        createdAt: '2026-07-21T00:00:00Z',
        runJson: '{}',
        reportMd: '# r',
        telemetryJsonl: '',
      });
      expect(await store.markRunViewed(tenant.id, 'run-v', '2026-07-21T02:00:00Z')).toBe(true);
      expect(await store.markRunViewed(tenant.id, 'run-v', '2026-07-21T03:00:00Z')).toBe(false);
      expect(await store.markRunViewed(tenant.id, 'missing', '2026-07-21T03:00:00Z')).toBe(false);
    });
  });
}

describeStoreContract('memory', async () => new MemoryStore());

const pgUrl = process.env['COSTFLOW_TEST_DATABASE_URL'];
if (pgUrl) {
  describeStoreContract('postgres', async () => {
    const store = new PgStore(pgUrl);
    await store.migrate();
    return store;
  });
} else {
  describe.skip('store contract: postgres (COSTFLOW_TEST_DATABASE_URL not set)', () => {
    it('pending live validation', () => undefined);
  });
}
