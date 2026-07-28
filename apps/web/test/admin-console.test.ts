import { describe, expect, it } from 'vitest';
import { makeApp, signIn, type TestApp } from './helpers';

/**
 * Internal operations console (COSTFLOW_ADMIN_EMAILS only). These pin the two
 * properties that matter most on a live multi-tenant system: (1) only an
 * allowlisted admin can reach ANY console surface (everyone else gets a 404
 * with no disclosure), and (2) no secret or raw financial content ever reaches
 * the rendered HTML. Plus pagination/search and the audited, CSRF-gated actions.
 */

const ADMIN = 'boss@ops.example';

const get = (t: TestApp, cookie: string, url: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });

/** An app whose signed-in user is on the admin allowlist. */
async function adminApp(): Promise<{ t: TestApp; cookie: string }> {
  const t = makeApp({ adminEmails: [ADMIN] });
  const cookie = await signIn(t, ADMIN);
  return { t, cookie };
}

/** Seed a SECOND tenant full of data (with deliberately-recognizable secrets). */
async function seedTenant(t: TestApp): Promise<{
  tenantId: string;
  ownerId: string;
  memberId: string;
  workspaceId: string;
  invitationId: string;
}> {
  const { tenant, user } = await t.store.createTenantWithUser(
    'owner@acme.example',
    'SALT-SECRET-should-never-render',
  );
  await t.store.updateTenantName(tenant.id, 'Acme Corp');
  const member = await t.store.createUserInTenant(tenant.id, 'member@acme.example', 'member');
  const ws = await t.store.createWorkspace(tenant.id, {
    provider: 'jira',
    connectionParams: { site: 'https://acme.atlassian.net', email: 'ops@acme.example' },
    tokenCiphertext: 'TOKEN-SECRET-should-never-render',
  });
  const job = await t.store.createJob(tenant.id, ws.id);
  await t.store.updateJob(tenant.id, job.id, {
    status: 'failed',
    errorClass: 'fetch-error',
    finishedAt: new Date().toISOString(),
  });
  await t.store.createRun({
    id: 'run-acme-1',
    tenantId: tenant.id,
    workspaceId: ws.id,
    createdAt: new Date().toISOString(),
    runJson: 'RUNJSON-SECRET-should-never-render',
    reportMd: 'REPORTMD-SECRET-should-never-render',
    telemetryJsonl: 'TELEMETRY-SECRET-should-never-render',
  });
  const inv = await t.store.createInvitation(tenant.id, {
    email: 'invitee@acme.example',
    role: 'member',
    token: 'INVITE-TOKEN-SECRET-should-never-render',
    invitedBy: user.id,
  });
  return {
    tenantId: tenant.id,
    ownerId: user.id,
    memberId: member.id,
    workspaceId: ws.id,
    invitationId: inv.id,
  };
}

describe('admin console — access control', () => {
  const surfaces = [
    '/admin',
    '/admin/system',
    '/admin/tenants',
    '/admin/users',
    '/admin/workspaces',
    '/admin/jobs',
    '/admin/runs',
    '/admin/invitations',
    '/admin/audit',
    '/admin/search?q=acme',
  ];

  it('serves every surface to an allowlisted admin', async () => {
    const { t, cookie } = await adminApp();
    for (const url of surfaces) {
      const res = await get(t, cookie, url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('Operations console');
    }
  });

  it('returns 404 (no disclosure) to a signed-in non-admin', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    const cookie = await signIn(t, 'nobody@else.example');
    for (const url of surfaces) {
      const res = await get(t, cookie, url);
      expect(res.statusCode, url).toBe(404);
    }
  });

  it('redirects an unauthenticated request to /login', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    const res = await t.app.inject({ method: 'GET', url: '/admin/tenants' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('is inert when no admin allowlist is configured', async () => {
    const t = makeApp(); // no adminEmails
    const cookie = await signIn(t, 'anyone@example.com');
    const res = await get(t, cookie, '/admin');
    expect(res.statusCode).toBe(404);
  });
});

describe('admin console — never leaks secrets or raw financial content', () => {
  const SECRETS = [
    'TOKEN-SECRET-should-never-render',
    'SALT-SECRET-should-never-render',
    'RUNJSON-SECRET-should-never-render',
    'REPORTMD-SECRET-should-never-render',
    'TELEMETRY-SECRET-should-never-render',
    'INVITE-TOKEN-SECRET-should-never-render',
  ];

  it('no console page exposes a token, salt, invite token, or run content', async () => {
    const { t, cookie } = await adminApp();
    const seed = await seedTenant(t);
    const pages = [
      '/admin',
      '/admin/tenants',
      `/admin/tenants/${seed.tenantId}`,
      '/admin/users',
      '/admin/workspaces',
      '/admin/jobs',
      '/admin/runs',
      '/admin/invitations',
      '/admin/audit',
      '/admin/search?q=acme',
    ];
    for (const url of pages) {
      const res = await get(t, cookie, url);
      expect(res.statusCode, url).toBe(200);
      for (const secret of SECRETS) {
        expect(res.body.includes(secret), `${secret} leaked on ${url}`).toBe(false);
      }
    }
  });

  it('shows token PRESENCE without the token value', async () => {
    const { t, cookie } = await adminApp();
    await seedTenant(t);
    const res = await get(t, cookie, '/admin/workspaces');
    expect(res.body).toContain('stored'); // the "token stored" badge
    expect(res.body).not.toContain('TOKEN-SECRET');
  });
});

describe('admin console — pagination, sorting, search', () => {
  it('paginates and bounds page size', async () => {
    const { t, cookie } = await adminApp();
    for (let i = 0; i < 12; i++) await t.store.createTenantWithUser(`org${i}@x.example`, 'salt');
    const first = await get(t, cookie, '/admin/tenants?limit=5&offset=0');
    expect(first.statusCode).toBe(200);
    // 13 orgs total (12 + the admin's own); page shows 5.
    expect(first.body).toContain('of 13');
    // Next link carries the incremented offset.
    expect(first.body).toContain('offset=5');
  });

  it('search finds a seeded organization by name', async () => {
    const { t, cookie } = await adminApp();
    await seedTenant(t);
    const res = await get(t, cookie, '/admin/search?q=Acme');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Acme Corp');
  });
});

describe('admin console — audited actions (CSRF-gated)', () => {
  const postRaw = (t: TestApp, cookie: string, url: string, payload: string) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload,
    });
  const csrfOf = (cookie: string): string => {
    const value = cookie.split('=').slice(1).join('=');
    const body = value.split('.')[0] as string;
    return (JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { csrf: string }).csrf;
  };

  it('changes a user role and writes an audit row', async () => {
    const { t, cookie } = await adminApp();
    const seed = await seedTenant(t);
    const csrf = csrfOf(cookie);
    const res = await postRaw(
      t,
      cookie,
      '/admin/actions/user-role',
      `csrf=${csrf}&tenant=${seed.tenantId}&user=${seed.memberId}&role=admin&back=/admin/users`,
    );
    expect(res.statusCode).toBe(302);
    const updated = await t.store.getUser(seed.tenantId, seed.memberId);
    expect(updated?.role).toBe('admin');
    const audit = await t.store.adminListAudit({ limit: 50, offset: 0 });
    expect(audit.rows.some((a) => a.action === 'user-role' && a.targetId === seed.memberId)).toBe(
      true,
    );
  });

  it('rejects an action with a bad CSRF token (no effect)', async () => {
    const { t, cookie } = await adminApp();
    const seed = await seedTenant(t);
    const res = await postRaw(
      t,
      cookie,
      '/admin/actions/user-role',
      `csrf=WRONG&tenant=${seed.tenantId}&user=${seed.memberId}&role=admin`,
    );
    expect(res.statusCode).toBe(403);
    const unchanged = await t.store.getUser(seed.tenantId, seed.memberId);
    expect(unchanged?.role).toBe('member');
  });

  it('revokes a pending invitation and audits it', async () => {
    const { t, cookie } = await adminApp();
    const seed = await seedTenant(t);
    const csrf = csrfOf(cookie);
    const res = await postRaw(
      t,
      cookie,
      '/admin/actions/invitation-revoke',
      `csrf=${csrf}&tenant=${seed.tenantId}&invitation=${seed.invitationId}&back=/admin/invitations`,
    );
    expect(res.statusCode).toBe(302);
    const invites = await t.store.listInvitations(seed.tenantId);
    expect(invites.find((i) => i.id === seed.invitationId)?.status).toBe('revoked');
    const audit = await t.store.adminListAudit({ limit: 50, offset: 0 });
    expect(audit.rows.some((a) => a.action === 'invitation-revoke')).toBe(true);
  });

  it('job-retry shows a confirmation page, then re-queues on POST', async () => {
    const { t, cookie } = await adminApp();
    const seed = await seedTenant(t);
    const confirm = await get(
      t,
      cookie,
      `/admin/actions/job-retry?tenant=${seed.tenantId}&workspace=${seed.workspaceId}&job=x`,
    );
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain('Re-run this import?');
    const csrf = csrfOf(cookie);
    const before = (await t.store.listJobsForWorkspace(seed.tenantId, seed.workspaceId)).length;
    const res = await postRaw(
      t,
      cookie,
      '/admin/actions/job-retry',
      `csrf=${csrf}&tenant=${seed.tenantId}&workspace=${seed.workspaceId}&job=x&back=/admin/jobs`,
    );
    expect(res.statusCode).toBe(302);
    const after = (await t.store.listJobsForWorkspace(seed.tenantId, seed.workspaceId)).length;
    expect(after).toBe(before + 1);
    const audit = await t.store.adminListAudit({ limit: 50, offset: 0 });
    expect(audit.rows.some((a) => a.action === 'job-retry')).toBe(true);
  });
});

/**
 * The console answers a probe with 404 rather than 403 so its existence is not
 * disclosed. That is right for outsiders and unhelpful for the operator, who
 * cannot tell "my email is not on the allowlist" from "I typed the URL wrong".
 * A sanitized server log answers it without weakening the response.
 */
describe('admin denial is diagnosable from the log, never from the response', () => {
  it('logs the shape of the denial when the allowlist does not match', async () => {
    const t = await makeApp({ adminEmails: ['someone-else@example.com'] });
    const cookie = await signIn(t, 'nobody@example.com');

    const res = await get(t, cookie, '/admin');
    expect(res.statusCode).toBe(404);

    const denied = t.logs.find((l) => l['msg'] === 'admin-denied');
    expect(denied).toBeDefined();
    expect(denied!['hasAllowlist']).toBe(true);
    expect(denied!['allowlistSize']).toBe(1);
    expect(denied!['hasUser']).toBe(true);
  });

  /** Distinguishes "variable not set" from "set but wrong", which is the whole point. */
  it('distinguishes an unset allowlist from a non-matching one', async () => {
    const t = await makeApp({ adminEmails: [] });
    const cookie = await signIn(t, 'nobody@example.com');
    await get(t, cookie, '/admin');

    const denied = t.logs.find((l) => l['msg'] === 'admin-denied');
    expect(denied!['hasAllowlist']).toBe(false);
    expect(denied!['allowlistSize']).toBe(0);
  });

  /** Logs are booleans, enums and ids only. An email is none of those. */
  it('never writes the attempted email or the allowlist into the log', async () => {
    const t = await makeApp({ adminEmails: ['secret-admin@example.com'] });
    const cookie = await signIn(t, 'attacker@example.com');
    await get(t, cookie, '/admin');

    const serialized = JSON.stringify(t.logs);
    expect(serialized).not.toContain('attacker@example.com');
    expect(serialized).not.toContain('secret-admin@example.com');
  });

  it('stays silent when the caller is a legitimate admin', async () => {
    const t = await makeApp({ adminEmails: ['boss@example.com'] });
    const cookie = await signIn(t, 'boss@example.com');
    expect((await get(t, cookie, '/admin')).statusCode).toBe(200);
    expect(t.logs.find((l) => l['msg'] === 'admin-denied')).toBeUndefined();
  });
});
