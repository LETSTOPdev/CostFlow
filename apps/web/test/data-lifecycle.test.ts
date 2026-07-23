import { describe, expect, it } from 'vitest';
import { csrfOf, form, get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * P4.3 acceptance (FR-22 / NFR-6): permanent deletion through the web edge.
 * Every deletion is CSRF-protected, requires an explicit typed confirmation,
 * is tenant-scoped, and cascades to derived runs/jobs. Telemetry records the
 * scope + cascade count only. Nothing here touches the engine or goldens.
 */

async function seedTenantWithRun(
  t: TestApp,
  email: string,
): Promise<{ cookie: string; tenantId: string; workspaceId: string }> {
  const cookie = await signIn(t, email);
  const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
  const workspace = await t.store.createWorkspace(tenantId, {
    provider: 'jira',
    connectionParams: { site: 'https://x.example', email },
    tokenCiphertext: 'tok',
  });
  await t.store.updateWorkspace(tenantId, workspace.id, {
    scopeId: 'OPS',
    scopeName: 'Operations',
  });
  const job = await t.store.createJob(tenantId, workspace.id);
  await t.store.updateJob(tenantId, job.id, {
    status: 'succeeded',
    runId: 'run-1',
    finishedAt: '2026-07-20T00:00:00Z',
  });
  await t.store.createRun({
    id: 'run-1',
    tenantId,
    workspaceId: workspace.id,
    createdAt: '2026-07-20T00:00:00Z',
    runJson: '{}',
    reportMd: '# r',
    telemetryJsonl: '',
  });
  return { cookie, tenantId, workspaceId: workspace.id };
}

describe('P4.3 workspace deletion (FR-22)', () => {
  it('cascades to the workspace runs and jobs, then reports 404; tenant survives', async () => {
    const t = makeApp();
    const { cookie, tenantId, workspaceId } = await seedTenantWithRun(t, 'owner@acme.example');

    // Settings surfaces the workspace and the typed-confirmation control.
    const settings = await get(t, cookie, '/settings');
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain(`/workspaces/${workspaceId}/delete`);
    expect(settings.body).toContain('name="confirm"');

    const res = await post(t, cookie, `/workspaces/${workspaceId}/delete`, { confirm: 'DELETE' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/settings?done=workspace');

    // Workspace + its derived run/jobs are gone; the report 404s.
    expect(await t.store.getWorkspace(tenantId, workspaceId)).toBeNull();
    expect(await t.store.listRuns(tenantId)).toHaveLength(0);
    expect((await get(t, cookie, '/reports/run-1')).statusCode).toBe(404);
    // The account itself is untouched.
    expect(await t.store.findUserByEmail('owner@acme.example')).not.toBeNull();

    // Telemetry: scope + cascade count only, no identity/name.
    const deleted = t.events.find((e) => e.event === 'tm-web-data-deleted')!;
    expect(deleted.fields).toEqual({ scope: 'workspace', cascadedRuns: 1 });
    const serialized = JSON.stringify(t.events);
    for (const secret of ['Operations', 'OPS', workspaceId, 'x.example']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('refuses without the exact typed confirmation — nothing deleted', async () => {
    const t = makeApp();
    const { cookie, tenantId, workspaceId } = await seedTenantWithRun(t, 'careful@acme.example');
    const res = await post(t, cookie, `/workspaces/${workspaceId}/delete`, { confirm: 'delete' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('nothing was deleted');
    expect(await t.store.getWorkspace(tenantId, workspaceId)).not.toBeNull();
    expect(t.events.some((e) => e.event === 'tm-web-data-deleted')).toBe(false);
  });

  it('requires a valid CSRF token — nothing deleted', async () => {
    const t = makeApp();
    const { cookie, tenantId, workspaceId } = await seedTenantWithRun(t, 'csrf@acme.example');
    const res = await t.app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/delete`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: form({ csrf: 'wrong-token', confirm: 'DELETE' }),
    });
    expect(res.statusCode).toBe(403);
    expect(await t.store.getWorkspace(tenantId, workspaceId)).not.toBeNull();
  });

  it('is tenant-scoped: another tenant cannot delete a foreign workspace', async () => {
    const t = makeApp();
    const victim = await seedTenantWithRun(t, 'victim@acme.example');
    const attackerCookie = await signIn(t, 'attacker@evil.example');
    // Attacker submits their own valid CSRF against the victim's workspace id.
    const res = await t.app.inject({
      method: 'POST',
      url: `/workspaces/${victim.workspaceId}/delete`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: attackerCookie },
      payload: form({ csrf: csrfOf(attackerCookie), confirm: 'DELETE' }),
    });
    expect(res.statusCode).toBe(404);
    // Victim's data is fully intact.
    expect(await t.store.getWorkspace(victim.tenantId, victim.workspaceId)).not.toBeNull();
    expect(await t.store.getRun(victim.tenantId, 'run-1')).not.toBeNull();
  });
});

describe('P4.3 organization erasure (FR-22 / NFR-6, GDPR)', () => {
  it('erases every tenant row, signs the user out, and records org scope', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await seedTenantWithRun(t, 'founder@acme.example');

    const res = await post(t, cookie, '/account/delete', { confirm: 'DELETE ALL DATA' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/logged-out');
    // Session cookie cleared on the way out.
    const cleared = res.headers['set-cookie'];
    expect(JSON.stringify(cleared)).toContain('cf_session=;');

    // Tenant, user, workspaces, and runs are all gone.
    expect(await t.store.getTenant(tenantId)).toBeNull();
    expect(await t.store.findUserByEmail('founder@acme.example')).toBeNull();
    expect(await t.store.listWorkspaces(tenantId)).toHaveLength(0);
    expect(await t.store.listRuns(tenantId)).toHaveLength(0);

    // A replayed old cookie sees no data (nothing to restore).
    const runsPage = await get(t, cookie, '/runs');
    expect(runsPage.body).toContain('No reports yet');

    const deleted = t.events.find((e) => e.event === 'tm-web-data-deleted')!;
    expect(deleted.fields).toEqual({ scope: 'org', cascadedRuns: 1 });
  });

  it('refuses without the exact confirmation phrase — nothing erased', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await seedTenantWithRun(t, 'hesitant@acme.example');
    const res = await post(t, cookie, '/account/delete', { confirm: 'DELETE' });
    expect(res.statusCode).toBe(400);
    expect(await t.store.getTenant(tenantId)).not.toBeNull();
    expect(await t.store.findUserByEmail('hesitant@acme.example')).not.toBeNull();
    expect(t.events.some((e) => e.event === 'tm-web-data-deleted')).toBe(false);
  });
});
