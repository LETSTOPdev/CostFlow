import { describe, expect, it } from 'vitest';
import { cookieOf, csrfOf, form, get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * P4.4 acceptance: organization & workspace management — roles (owner/admin/
 * member), invitations, member management, workspace membership, and
 * permission enforcement across routes. CSRF is required on every mutation;
 * telemetry stays enum/count-only. The engine and goldens are untouched.
 */

async function tenantIdFor(t: TestApp, email: string): Promise<string> {
  return (await t.store.findUserByEmail(email))!.tenantId;
}

/** Sign in through the dev adapter carrying an invitation cookie (browser-like). */
async function acceptInvite(t: TestApp, token: string, email: string) {
  const landing = await t.app.inject({ method: 'GET', url: `/invite/${token}` });
  const inviteCookie = cookieOf(landing, 'cf_invite');
  return t.app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: inviteCookie },
    payload: `email=${encodeURIComponent(email)}`,
  });
}

describe('P4.4 invitations & membership', () => {
  it('an invited email joins the EXISTING org with the invited role at sign-in', async () => {
    const t = makeApp();
    const ownerCookie = await signIn(t, 'owner@acme.example');
    const ownerTenant = await tenantIdFor(t, 'owner@acme.example');
    await post(t, ownerCookie, '/org/invitations', {
      email: 'joiner@acme.example',
      role: 'member',
    });
    const invitation = (await t.store.listInvitations(ownerTenant))[0]!;

    const login = await acceptInvite(t, invitation.token, 'joiner@acme.example');
    expect(login.statusCode).toBe(302);

    const joiner = await t.store.findUserByEmail('joiner@acme.example');
    expect(joiner).toMatchObject({ tenantId: ownerTenant, role: 'member' });
    // Invitation is consumed; the invite cookie is cleared.
    expect((await t.store.getInvitationByToken(invitation.token))?.status).toBe('accepted');
    expect(t.events.some((e) => e.event === 'tm-web-invite-accepted')).toBe(true);
    // No second organization was created for the joiner.
    const tenants = new Set(
      await Promise.all(
        ['owner@acme.example', 'joiner@acme.example'].map((e) => tenantIdFor(t, e)),
      ),
    );
    expect(tenants.size).toBe(1);
  });

  it('a stale/revoked invitation link does not provision anything', async () => {
    const t = makeApp();
    const ownerCookie = await signIn(t, 'owner2@acme.example');
    const ownerTenant = await tenantIdFor(t, 'owner2@acme.example');
    await post(t, ownerCookie, '/org/invitations', { email: 'ghost@acme.example', role: 'member' });
    const invitation = (await t.store.listInvitations(ownerTenant))[0]!;
    await post(t, ownerCookie, `/org/invitations/${invitation.id}/revoke`, {});

    const landing = await t.app.inject({ method: 'GET', url: `/invite/${invitation.token}` });
    expect(landing.body).toContain('Invitation unavailable');
    // Signing in as that email now creates its OWN org (not the inviter's).
    const cookie = await signIn(t, 'ghost@acme.example');
    expect(await tenantIdFor(t, 'ghost@acme.example')).not.toBe(ownerTenant);
    void cookie;
  });

  it('a signed-in member is blocked from manager routes and lands on runs', async () => {
    const t = makeApp();
    await signIn(t, 'owner3@acme.example');
    const ownerTenant = await tenantIdFor(t, 'owner3@acme.example');
    await t.store.createUserInTenant(ownerTenant, 'member3@acme.example', 'member');
    const memberCookie = await signIn(t, 'member3@acme.example');

    for (const url of ['/connect', '/org', '/settings', '/dashboard']) {
      expect((await get(t, memberCookie, url)).statusCode).toBe(403);
    }
    // Home routes a member to their runs.
    const home = await get(t, memberCookie, '/');
    expect(home.statusCode).toBe(302);
    expect(home.headers['location']).toBe('/runs');
    // Member cannot invite or delete via POST either (manager gate).
    expect(
      (await post(t, memberCookie, '/org/invitations', { email: 'x@y.example', role: 'member' }))
        .statusCode,
    ).toBe(403);
  });

  it('workspace membership gates a member access to runs and reports', async () => {
    const t = makeApp();
    await signIn(t, 'owner4@acme.example');
    const ownerTenant = await tenantIdFor(t, 'owner4@acme.example');
    const ownerCookie = await signIn(t, 'owner4@acme.example');
    const workspace = await t.store.createWorkspace(ownerTenant, {
      provider: 'jira',
      site: 'https://w.example',
      email: 'owner4@acme.example',
      tokenCiphertext: 'tok',
    });
    await t.store.createRun({
      id: 'run-m',
      tenantId: ownerTenant,
      workspaceId: workspace.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson: '{}',
      reportMd: '# r',
      telemetryJsonl: '',
    });
    const member = await t.store.createUserInTenant(ownerTenant, 'member4@acme.example', 'member');
    const memberCookie = await signIn(t, 'member4@acme.example');

    // Before being granted the workspace, the member sees no runs and cannot open the report.
    expect((await get(t, memberCookie, '/runs')).body).toContain('No reports yet');
    expect((await get(t, memberCookie, '/reports/run-m')).statusCode).toBe(404);

    // Owner grants workspace access.
    await post(t, ownerCookie, `/workspaces/${workspace.id}/members`, { userId: member.id });
    expect((await get(t, memberCookie, '/runs')).body).toContain('run-m');
    expect((await get(t, memberCookie, '/reports/run-m')).statusCode).toBe(200);

    // Revoking access removes visibility again.
    await post(t, ownerCookie, `/workspaces/${workspace.id}/members/${member.id}/remove`, {});
    expect((await get(t, memberCookie, '/reports/run-m')).statusCode).toBe(404);
  });
});

describe('P4.4 role administration & guards', () => {
  async function orgWithAdminAndMember(t: TestApp) {
    await signIn(t, 'owner@guard.example');
    const tenant = await tenantIdFor(t, 'owner@guard.example');
    const owner = (await t.store.findUserByEmail('owner@guard.example'))!;
    const admin = await t.store.createUserInTenant(tenant, 'admin@guard.example', 'admin');
    const member = await t.store.createUserInTenant(tenant, 'member@guard.example', 'member');
    return { tenant, owner, admin, member };
  }

  it('admins cannot delete the org, grant owner, or modify an owner', async () => {
    const t = makeApp();
    const { owner, member } = await orgWithAdminAndMember(t);
    const adminCookie = await signIn(t, 'admin@guard.example');

    expect(
      (await post(t, adminCookie, '/account/delete', { confirm: 'DELETE ALL DATA' })).statusCode,
    ).toBe(403);
    expect(
      (await post(t, adminCookie, `/org/members/${member.id}/role`, { role: 'owner' })).statusCode,
    ).toBe(403);
    expect(
      (await post(t, adminCookie, `/org/members/${owner.id}/role`, { role: 'member' })).statusCode,
    ).toBe(403);
    // Nothing changed.
    expect((await t.store.getUser(owner.tenantId, owner.id))?.role).toBe('owner');
    expect((await t.store.getUser(member.tenantId, member.id))?.role).toBe('member');
  });

  it('protects the last owner from demotion and self-removal', async () => {
    const t = makeApp();
    const { tenant, owner } = await orgWithAdminAndMember(t);
    const ownerCookie = await signIn(t, 'owner@guard.example');
    expect(
      (await post(t, ownerCookie, `/org/members/${owner.id}/role`, { role: 'admin' })).statusCode,
    ).toBe(400);
    expect((await post(t, ownerCookie, `/org/members/${owner.id}/remove`, {})).statusCode).toBe(
      400,
    );
    expect((await t.store.getUser(tenant, owner.id))?.role).toBe('owner');
  });

  it('an owner changes a member role and removes a member', async () => {
    const t = makeApp();
    const { tenant, member } = await orgWithAdminAndMember(t);
    const ownerCookie = await signIn(t, 'owner@guard.example');
    expect(
      (await post(t, ownerCookie, `/org/members/${member.id}/role`, { role: 'admin' })).statusCode,
    ).toBe(302);
    expect((await t.store.getUser(tenant, member.id))?.role).toBe('admin');
    expect((await post(t, ownerCookie, `/org/members/${member.id}/remove`, {})).statusCode).toBe(
      302,
    );
    expect(await t.store.getUser(tenant, member.id)).toBeNull();
  });

  it('renames the org and requires CSRF on org mutations', async () => {
    const t = makeApp();
    await signIn(t, 'owner@guard.example');
    const tenant = await tenantIdFor(t, 'owner@guard.example');
    const ownerCookie = await signIn(t, 'owner@guard.example');
    // Valid rename.
    expect((await post(t, ownerCookie, '/org/rename', { name: 'Guarded LLC' })).statusCode).toBe(
      302,
    );
    expect((await t.store.getTenant(tenant))?.name).toBe('Guarded LLC');
    // Missing/invalid CSRF is refused and changes nothing.
    const bad = await t.app.inject({
      method: 'POST',
      url: '/org/rename',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ownerCookie },
      payload: form({ csrf: 'nope', name: 'Hacked' }),
    });
    expect(bad.statusCode).toBe(403);
    expect((await t.store.getTenant(tenant))?.name).toBe('Guarded LLC');
  });

  it('cross-tenant isolation: an admin cannot manage another org', async () => {
    const t = makeApp();
    const victim = await orgWithAdminAndMember(t); // owner@guard.example org
    const attackerCookie = await signIn(t, 'attacker@evil.example'); // owner of their own org
    // Attacker (owner of a different org) targeting the victim's member id.
    const res = await t.app.inject({
      method: 'POST',
      url: `/org/members/${victim.member.id}/remove`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: attackerCookie },
      payload: form({ csrf: csrfOf(attackerCookie) }),
    });
    expect(res.statusCode).toBe(404); // not found in the attacker's tenant
    expect(await t.store.getUser(victim.tenant, victim.member.id)).not.toBeNull();
  });

  it('membership telemetry carries only role enums/counts — no emails, org names, or tokens', async () => {
    const t = makeApp();
    const ownerCookie = await signIn(t, 'owner@secret.example');
    await post(t, ownerCookie, '/org/rename', { name: 'SecretCorp' });
    await post(t, ownerCookie, '/org/invitations', {
      email: 'invitee@secret.example',
      role: 'admin',
    });
    const serialized = JSON.stringify(t.events);
    for (const secret of ['invitee@secret.example', 'SecretCorp', 'owner@secret.example']) {
      expect(serialized).not.toContain(secret);
    }
    const invited = t.events.find((e) => e.event === 'tm-web-member-invited')!;
    expect(invited.fields).toEqual({ role: 'admin' });
    const ownerTenant = await tenantIdFor(t, 'owner@secret.example');
    const token = (await t.store.listInvitations(ownerTenant))[0]!.token;
    expect(serialized).not.toContain(token);
  });
});
