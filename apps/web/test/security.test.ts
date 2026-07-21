import { describe, expect, it } from 'vitest';
import { GatewayError } from '../src/jira-gateway';
import { TOKEN, get, makeApp, post, signIn } from './helpers';

describe('tenancy, sessions, CSRF, and step gating (doc 09 P4.1 plan §1/§4)', () => {
  it('unauthenticated requests are redirected to sign-in', async () => {
    const t = makeApp();
    for (const url of ['/', '/connect', '/assumptions', '/runs', '/dashboard']) {
      const response = await t.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(302);
      expect(response.headers['location']).toBe('/login');
    }
  });

  it('cross-tenant ids resolve to not-found, never to another tenant’s rows', async () => {
    const t = makeApp();
    const alice = await signIn(t, 'alice@one.example');
    await post(t, alice, '/connect', {
      site: 'https://one.atlassian.net',
      email: 'alice@one.example',
      token: TOKEN,
    });
    await post(t, alice, '/scope', { project: '0' });
    await post(t, alice, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
    await post(t, alice, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
    await post(t, alice, '/assumptions', {
      rate0: '120',
      rate1: '90',
      defaultRate: '30',
      agingThresholdDays: '14',
      accept_agingThresholdDays: 'on',
      attention_low: '0.15',
      attention_expected: '0.3',
      attention_high: '0.6',
      accept_attention: 'on',
      queueWait_low: '0.1',
      queueWait_expected: '0.2',
      queueWait_high: '0.4',
      accept_queueWait: 'on',
      overdue_low: '0.1',
      overdue_expected: '0.2',
      overdue_high: '0.4',
      accept_overdue: 'on',
    });
    const runResponse = await post(t, alice, '/runs', {});
    const jobUrl = runResponse.headers['location'] as string;
    const aliceTenant = (await t.store.findUserByEmail('alice@one.example'))!.tenantId;
    const run = (await t.store.listRuns(aliceTenant))[0]!;

    const mallory = await signIn(t, 'mallory@two.example');
    expect((await get(t, mallory, jobUrl)).statusCode).toBe(404);
    expect((await get(t, mallory, `/reports/${run.id}`)).statusCode).toBe(404);
    const malloryRuns = await get(t, mallory, '/runs');
    expect(malloryRuns.body).not.toContain(run.id);
    // and the store itself scopes: foreign tenant id sees nothing
    const malloryTenant = (await t.store.findUserByEmail('mallory@two.example'))!.tenantId;
    expect(await t.store.getRun(malloryTenant, run.id)).toBeNull();
  });

  it('POSTs without the session CSRF token are refused', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'a@b.example');
    const response = await t.app.inject({
      method: 'POST',
      url: '/connect',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: 'site=https%3A%2F%2Fx.atlassian.net&email=a%40b.example&token=tttttttttt',
    });
    expect(response.statusCode).toBe(403);
    expect(
      await t.store.listWorkspaces((await t.store.findUserByEmail('a@b.example'))!.tenantId),
    ).toHaveLength(0);
  });

  it('gating: no run before assumptions are set; steps guard their prerequisites', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'g@b.example');
    // No workspace yet → everything routes back to /connect
    const scope = await get(t, cookie, '/scope');
    expect(scope.statusCode).toBe(302);
    expect(scope.headers['location']).toBe('/connect');

    await post(t, cookie, '/connect', {
      site: 'https://g.atlassian.net',
      email: 'g@b.example',
      token: TOKEN,
    });
    // Connected but nothing else: run refused (redirects into onboarding), no job created
    const run = await post(t, cookie, '/runs', {});
    expect(run.statusCode).toBe(302);
    const tenantId = (await t.store.findUserByEmail('g@b.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(await t.store.listJobsForWorkspace(tenantId, workspace.id)).toHaveLength(0);
    // Assumptions page also refuses before the mapping steps
    const assumptions = await get(t, cookie, '/assumptions');
    expect(assumptions.statusCode).toBe(302);
  });

  it('a rejected connection stores nothing and reports the error class', async () => {
    const t = makeApp();
    t.gateway.failListWith = new GatewayError('auth-error', 'Jira rejected the credentials (401).');
    const cookie = await signIn(t, 'r@b.example');
    const response = await post(t, cookie, '/connect', {
      site: 'https://r.atlassian.net',
      email: 'r@b.example',
      token: TOKEN,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('auth-error');
    expect(response.body).not.toContain(TOKEN);
    expect(
      await t.store.listWorkspaces((await t.store.findUserByEmail('r@b.example'))!.tenantId),
    ).toHaveLength(0);
    const connected = t.events.find((e) => e.event === 'tm-web-workspace-connected')!;
    expect(connected.fields).toEqual({ provider: 'jira', ok: false, errorClass: 'auth-error' });
  });
});
