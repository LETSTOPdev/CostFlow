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
        connectionParams: { site: 'https://a.example', email: 'a@y.example' },
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

    /**
     * The ordered run history of a Monitoring Workspace. This is the primitive
     * run comparison and trend series are built on, so the contract pins the
     * properties those features depend on: workspace-scoped, tenant-scoped,
     * newest first, and artifact-free.
     */
    it('lists a workspace run history newest first, scoped and without artifacts', async () => {
      const store = await makeStore();
      const a = (await store.createTenantWithUser('hist-a@y.example', 'sa')).tenant;
      const b = (await store.createTenantWithUser('hist-b@y.example', 'sb')).tenant;
      const params = {
        provider: 'jira' as const,
        connectionParams: { site: 'https://h.example', email: 'hist-a@y.example' },
        tokenCiphertext: 'tok',
      };
      const engineering = await store.createWorkspace(a.id, params);
      const marketing = await store.createWorkspace(a.id, params);
      const run = (id: string, workspaceId: string, createdAt: string): Promise<void> =>
        store.createRun({
          id,
          tenantId: a.id,
          workspaceId,
          createdAt,
          runJson: '{"runId":"x"}',
          reportMd: '# r',
          telemetryJsonl: '',
        });
      await run('h-1', engineering.id, '2026-01-01T00:00:00Z');
      await run('h-2', engineering.id, '2026-03-01T00:00:00Z');
      await run('h-3', engineering.id, '2026-02-01T00:00:00Z');
      await run('m-1', marketing.id, '2026-04-01T00:00:00Z');

      const history = await store.listWorkspaceRunHeaders(a.id, engineering.id);
      expect(history.map((r) => r.id)).toEqual(['h-2', 'h-3', 'h-1']);
      // Artifacts are excluded: the point of the header is that a trend series
      // over years of analyses does not drag every run.json along with it.
      expect(Object.keys(history[0]!).sort()).toEqual([
        'createdAt',
        'id',
        'viewedAt',
        'workspaceId',
      ]);
      // Scoped both ways: one workspace's history, and only within the tenant.
      expect((await store.listWorkspaceRunHeaders(a.id, marketing.id)).map((r) => r.id)).toEqual([
        'm-1',
      ]);
      expect(await store.listWorkspaceRunHeaders(b.id, engineering.id)).toEqual([]);

      await store.markRunViewed(a.id, 'h-2', '2026-03-02T00:00:00Z');
      const viewed = await store.listWorkspaceRunHeaders(a.id, engineering.id);
      expect(viewed[0]?.viewedAt).not.toBeNull();
      expect(viewed[1]?.viewedAt).toBeNull();
    });

    /**
     * The events table is the canonical analytics spine, so introducing a new
     * event type must never require a schema change. This asserts the property
     * an operator actually depends on: a type the code has never heard of is
     * stored, counted, listed, and filterable exactly like a known one.
     */
    it('accepts, counts, and filters an event type it has never seen before', async () => {
      const store = await makeStore();
      const { tenant, user } = await store.createTenantWithUser('spine@y.example', 's');
      await store.recordEvent({
        tenantId: tenant.id,
        userId: user.id,
        workspaceId: null,
        type: 'billing.subscription-created',
        fields: { plan: 'team', seats: 12 },
      });
      const page = await store.adminActivityFeed({
        limit: 50,
        offset: 0,
        tenantId: tenant.id,
        status: 'billing.subscription-created',
      });
      expect(page.total).toBe(1);
      expect(page.rows[0]).toMatchObject({
        type: 'billing.subscription-created',
        userEmail: 'spine@y.example',
        fields: { plan: 'team', seats: 12 },
      });
      // And it does not disturb the known vocabulary around it.
      const all = await store.adminActivityFeed({ limit: 50, offset: 0, tenantId: tenant.id });
      expect(all.rows.some((r) => r.type === 'org.created')).toBe(true);
      expect(all.total).toBeGreaterThan(1);
    });

    it('persists workspace configuration patches', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('c@y.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: 'https://c.example', email: 'c@y.example' },
        tokenCiphertext: 'tok',
      });
      const updated = await store.updateWorkspace(tenant.id, workspace.id, {
        scopeId: 'OPS',
        scopeName: 'Operations',
        observedStatuses: ['A', 'B'],
        statusMap: { A: 'queue', B: 'done' },
        onboarding: 'statuses-mapped',
      });
      expect(updated).toMatchObject({
        scopeId: 'OPS',
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
        connectionParams: { site: 'https://d.example', email: 'd@y.example' },
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
        connectionParams: { site: 'https://e.example', email: 'e@y.example' },
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

    // FR-22 / NFR-6 — deletion cascade (P4.3).

    async function seedWorkspaceWithRun(
      store: Store,
      email: string,
      runId: string,
    ): Promise<{ tenantId: string; workspaceId: string }> {
      const { tenant } = await store.createTenantWithUser(email, 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: `https://${runId}.example`, email },
        tokenCiphertext: 'tok',
      });
      const job = await store.createJob(tenant.id, workspace.id);
      await store.updateJob(tenant.id, job.id, {
        status: 'succeeded',
        runId,
        finishedAt: '2026-07-21T00:00:00Z',
      });
      await store.createRun({
        id: runId,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        createdAt: '2026-07-21T00:00:00Z',
        runJson: '{}',
        reportMd: '# r',
        telemetryJsonl: '',
      });
      return { tenantId: tenant.id, workspaceId: workspace.id };
    }

    it('deleteWorkspace cascades to its jobs and runs, tenant-scoped', async () => {
      const store = await makeStore();
      const { tenantId, workspaceId } = await seedWorkspaceWithRun(store, 'del@y.example', 'run-d');
      // A foreign tenant cannot delete it and nothing is removed.
      const other = (await store.createTenantWithUser('foreign@y.example', 's')).tenant;
      expect(await store.deleteWorkspace(other.id, workspaceId)).toBeNull();
      expect(await store.getWorkspace(tenantId, workspaceId)).not.toBeNull();

      const summary = await store.deleteWorkspace(tenantId, workspaceId);
      expect(summary).toEqual({ workspaces: 1, jobs: 1, runs: 1 });
      // Workspace, its jobs, and its runs are gone.
      expect(await store.getWorkspace(tenantId, workspaceId)).toBeNull();
      expect(await store.listJobsForWorkspace(tenantId, workspaceId)).toHaveLength(0);
      expect(await store.getRun(tenantId, 'run-d')).toBeNull();
      expect(await store.listRuns(tenantId)).toHaveLength(0);
      // The tenant and its user survive (workspace-scoped erasure only).
      expect(await store.getTenant(tenantId)).not.toBeNull();
      expect(await store.findUserByEmail('del@y.example')).not.toBeNull();
      // Idempotent: deleting again is a no-op null.
      expect(await store.deleteWorkspace(tenantId, workspaceId)).toBeNull();
    });

    it('deleteWorkspace does not touch a sibling workspace in the same tenant', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('multi@y.example', 's');
      const keep = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: 'https://keep.example', email: 'multi@y.example' },
        tokenCiphertext: 'tok',
      });
      const drop = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: 'https://drop.example', email: 'multi@y.example' },
        tokenCiphertext: 'tok',
      });
      await store.deleteWorkspace(tenant.id, drop.id);
      expect(await store.getWorkspace(tenant.id, keep.id)).not.toBeNull();
      expect(await store.getWorkspace(tenant.id, drop.id)).toBeNull();
    });

    it('deleteTenantData erases everything for the tenant and only that tenant', async () => {
      const store = await makeStore();
      const a = await seedWorkspaceWithRun(store, 'erase@y.example', 'run-a');
      const b = await seedWorkspaceWithRun(store, 'survivor@y.example', 'run-b');

      const summary = await store.deleteTenantData(a.tenantId);
      expect(summary).toEqual({ workspaces: 1, jobs: 1, runs: 1 });
      // Tenant A: tenant row, user, workspace, jobs, runs all gone.
      expect(await store.getTenant(a.tenantId)).toBeNull();
      expect(await store.findUserByEmail('erase@y.example')).toBeNull();
      expect(await store.getWorkspace(a.tenantId, a.workspaceId)).toBeNull();
      expect(await store.listRuns(a.tenantId)).toHaveLength(0);
      expect(await store.listJobsForWorkspace(a.tenantId, a.workspaceId)).toHaveLength(0);
      // Tenant B is untouched.
      expect(await store.getTenant(b.tenantId)).not.toBeNull();
      expect(await store.findUserByEmail('survivor@y.example')).not.toBeNull();
      expect(await store.getRun(b.tenantId, 'run-b')).not.toBeNull();
      // Idempotent: erasing an absent tenant yields zeros.
      expect(await store.deleteTenantData(a.tenantId)).toEqual({
        workspaces: 0,
        jobs: 0,
        runs: 0,
      });
    });

    // P4.4 — organization, roles, invitations, workspace membership.

    it('provisions the creator as owner and scopes users by tenant', async () => {
      const store = await makeStore();
      const { tenant, user } = await store.createTenantWithUser('boss@org.example', 's');
      expect(user.role).toBe('owner');
      expect(tenant.name).toBeNull();
      expect(await store.getUser(tenant.id, user.id)).toMatchObject({ role: 'owner' });
      // Foreign tenant cannot resolve the user.
      const other = (await store.createTenantWithUser('x@org.example', 's')).tenant;
      expect(await store.getUser(other.id, user.id)).toBeNull();
      expect((await store.listUsers(tenant.id)).map((u) => u.email)).toEqual(['boss@org.example']);
    });

    it('renames the organization', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('name@org.example', 's');
      expect(await store.updateTenantName(tenant.id, 'Acme Inc')).toMatchObject({
        name: 'Acme Inc',
      });
      expect((await store.getTenant(tenant.id))?.name).toBe('Acme Inc');
    });

    it('adds members with roles, changes roles, and removes members (dropping their workspace access)', async () => {
      const store = await makeStore();
      const { tenant } = await store.createTenantWithUser('owner@org.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: 'https://o.example', email: 'owner@org.example' },
        tokenCiphertext: 'tok',
      });
      const member = await store.createUserInTenant(tenant.id, 'member@org.example', 'member');
      expect(member.role).toBe('member');
      await store.addWorkspaceMember(tenant.id, workspace.id, member.id);
      expect(await store.listWorkspaceMemberIds(tenant.id, workspace.id)).toEqual([member.id]);
      expect(await store.listWorkspaceIdsForMember(tenant.id, member.id)).toEqual([workspace.id]);

      expect(await store.updateUserRole(tenant.id, member.id, 'admin')).toMatchObject({
        role: 'admin',
      });
      // Removing the member also drops their workspace membership.
      expect(await store.removeUser(tenant.id, member.id)).toBe(true);
      expect(await store.getUser(tenant.id, member.id)).toBeNull();
      expect(await store.listWorkspaceMemberIds(tenant.id, workspace.id)).toEqual([]);
      // Idempotent.
      expect(await store.removeUser(tenant.id, member.id)).toBe(false);
    });

    it('manages invitations by token, tenant-scoped for lifecycle updates', async () => {
      const store = await makeStore();
      const { tenant, user } = await store.createTenantWithUser('inv@org.example', 's');
      const invitation = await store.createInvitation(tenant.id, {
        email: 'new@org.example',
        role: 'member',
        token: 'tok-123',
        invitedBy: user.id,
      });
      expect(invitation.status).toBe('pending');
      expect(await store.getInvitationByToken('tok-123')).toMatchObject({
        email: 'new@org.example',
        role: 'member',
      });
      expect((await store.listInvitations(tenant.id)).length).toBe(1);
      // A foreign tenant cannot update this invitation's lifecycle.
      const other = (await store.createTenantWithUser('z@org.example', 's')).tenant;
      expect(
        await store.updateInvitationStatus(other.id, invitation.id, 'revoked', null),
      ).toBeNull();
      const accepted = await store.updateInvitationStatus(
        tenant.id,
        invitation.id,
        'accepted',
        '2026-07-22T00:00:00Z',
      );
      expect(accepted).toMatchObject({ status: 'accepted', acceptedAt: '2026-07-22T00:00:00Z' });
    });

    it('deletes org-management rows on workspace and tenant erasure', async () => {
      const store = await makeStore();
      const { tenant, user } = await store.createTenantWithUser('del2@org.example', 's');
      const workspace = await store.createWorkspace(tenant.id, {
        provider: 'jira',
        connectionParams: { site: 'https://d2.example', email: 'del2@org.example' },
        tokenCiphertext: 'tok',
      });
      const member = await store.createUserInTenant(tenant.id, 'm2@org.example', 'member');
      await store.addWorkspaceMember(tenant.id, workspace.id, member.id);
      await store.createInvitation(tenant.id, {
        email: 'p@org.example',
        role: 'member',
        token: 'tok-del',
        invitedBy: user.id,
      });

      // Workspace erasure clears its memberships.
      await store.deleteWorkspace(tenant.id, workspace.id);
      expect(await store.listWorkspaceMemberIds(tenant.id, workspace.id)).toEqual([]);
      expect(await store.listWorkspaceIdsForMember(tenant.id, member.id)).toEqual([]);

      // Tenant erasure clears invitations and users.
      await store.deleteTenantData(tenant.id);
      expect(await store.getInvitationByToken('tok-del')).toBeNull();
      expect(await store.getUser(tenant.id, member.id)).toBeNull();
      expect(await store.listInvitations(tenant.id)).toEqual([]);
    });

    it('reports aggregate activation-funnel counts by distinct org (v1)', async () => {
      const store = await makeStore();
      // Org 1: connects + runs + views.
      const one = (await store.createTenantWithUser('f1@z.example', 's')).tenant;
      const ws1 = await store.createWorkspace(one.id, {
        provider: 'jira',
        connectionParams: { site: 'https://f1.example', email: 'f1@z.example' },
        tokenCiphertext: 'tok',
      });
      await store.createRun({
        id: 'fr-1',
        tenantId: one.id,
        workspaceId: ws1.id,
        createdAt: '2026-07-20T00:00:00Z',
        runJson: '{}',
        reportMd: '# r',
        telemetryJsonl: '',
      });
      await store.markRunViewed(one.id, 'fr-1', '2026-07-20T01:00:00Z');
      // Org 2: connects only.
      const two = (await store.createTenantWithUser('f2@z.example', 's')).tenant;
      await store.createWorkspace(two.id, {
        provider: 'jira',
        connectionParams: { site: 'https://f2.example', email: 'f2@z.example' },
        tokenCiphertext: 'tok',
      });
      // Org 3: signs up only.
      await store.createTenantWithUser('f3@z.example', 's');

      expect(await store.funnelStats()).toEqual({
        organizations: 3,
        connectedWorkspaces: 2,
        analysesRun: 1,
        reportsViewed: 1,
      });
    });

    /**
     * The atomic double-submit guard behind POST /runs. It claims the "one
     * active job per workspace" slot so a second click, or a refresh re-POST,
     * lands on the SAME job instead of starting a duplicate fetch and analysis
     * against the customer's tracker.
     *
     * Both adapters must agree, and they claim atomicity by different means —
     * a partial unique index in Postgres, a synchronous map check in memory —
     * so this is exactly the kind of method the shared contract exists for.
     */
    describe('createJobIfNoneActive (atomic double-submit guard)', () => {
      const setup = async (store: Store) => {
        const tenant = (await store.createTenantWithUser('j@x.example', 's')).tenant;
        const workspace = await store.createWorkspace(tenant.id, {
          provider: 'jira',
          connectionParams: { site: 'https://a.example', email: 'j@x.example' },
          tokenCiphertext: 'tok',
        });
        return { tenantId: tenant.id, workspaceId: workspace.id };
      };

      it('creates on the first call and reports it as created', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const first = await store.createJobIfNoneActive(tenantId, workspaceId);
        expect(first.created).toBe(true);
        expect(first.job.status).toBe('queued');
        expect(first.job.workspaceId).toBe(workspaceId);
      });

      it('returns the SAME job, uncreated, while one is queued', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const first = await store.createJobIfNoneActive(tenantId, workspaceId);
        const second = await store.createJobIfNoneActive(tenantId, workspaceId);
        expect(second.created).toBe(false);
        expect(second.job.id).toBe(first.job.id);
        expect((await store.listJobsForWorkspace(tenantId, workspaceId)).length).toBe(1);
      });

      it('holds the slot while the job is running, not only while queued', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const first = await store.createJobIfNoneActive(tenantId, workspaceId);
        await store.updateJob(tenantId, first.job.id, { status: 'running' });
        const second = await store.createJobIfNoneActive(tenantId, workspaceId);
        expect(second.created).toBe(false);
        expect(second.job.id).toBe(first.job.id);
      });

      it('releases the slot once the job reaches a terminal status', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const first = await store.createJobIfNoneActive(tenantId, workspaceId);
        await store.updateJob(tenantId, first.job.id, { status: 'succeeded' });
        const second = await store.createJobIfNoneActive(tenantId, workspaceId);
        expect(second.created).toBe(true);
        expect(second.job.id).not.toBe(first.job.id);
        expect((await store.listJobsForWorkspace(tenantId, workspaceId)).length).toBe(2);
      });

      it('releases the slot when the job fails, not only when it succeeds', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const first = await store.createJobIfNoneActive(tenantId, workspaceId);
        await store.updateJob(tenantId, first.job.id, { status: 'failed' });
        expect((await store.createJobIfNoneActive(tenantId, workspaceId)).created).toBe(true);
      });

      /** The slot is per workspace: a busy workspace must not block a quiet one. */
      it('keys the claim on the workspace, so a second workspace is unaffected', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const other = await store.createWorkspace(tenantId, {
          provider: 'jira',
          connectionParams: { site: 'https://b.example', email: 'j@x.example' },
          tokenCiphertext: 'tok',
        });
        await store.createJobIfNoneActive(tenantId, workspaceId);
        const second = await store.createJobIfNoneActive(tenantId, other.id);
        expect(second.created).toBe(true);
        expect((await store.listJobsForWorkspace(tenantId, other.id)).length).toBe(1);
      });

      it('never hands back a job belonging to another tenant', async () => {
        const store = await makeStore();
        const { tenantId, workspaceId } = await setup(store);
        const intruder = (await store.createTenantWithUser('k@x.example', 's2')).tenant;
        const mine = await store.createJobIfNoneActive(tenantId, workspaceId);
        expect(await store.getJob(intruder.id, mine.job.id)).toBeNull();
        expect((await store.listJobsForWorkspace(intruder.id, workspaceId)).length).toBe(0);
      });
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
