import { describe, expect, it } from 'vitest';
import { GatewayError } from '../src/connectors/types';
import { redactPath } from '../src/security';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory';
import type { RunRecord } from '../src/store/contract';
import {
  CREDENTIAL_KEY,
  SESSION_KEY,
  StubJiraGateway,
  cookieOf,
  get,
  makeApp,
  post,
  signIn,
  stubConnectors,
  StubClickUpGateway,
} from './helpers';

/**
 * P4 production-readiness hardening: log redaction of the invitation
 * capability token, the global sanitized error boundary, member authorization
 * on the job surface, and graceful gateway-failure handling on /scope.
 */

describe('redactPath (log sanitization)', () => {
  it('collapses the invite capability token and internal UUIDs', () => {
    expect(redactPath('/invite/super-secret-token-abc123')).toBe('/invite/:token');
    expect(redactPath('/org/members/11111111-2222-3333-4444-555555555555/role')).toBe(
      '/org/members/:id/role',
    );
    expect(redactPath('/runs')).toBe('/runs');
  });
});

describe('invitation token never reaches the request log', () => {
  it('logs /invite/:token, not the real token', async () => {
    const t = makeApp();
    const ownerCookie = await signIn(t, 'owner@log.example');
    await post(t, ownerCookie, '/org/invitations', { email: 'joiner@log.example', role: 'member' });
    const ownerTenant = (await t.store.findUserByEmail('owner@log.example'))!.tenantId;
    const token = (await t.store.listInvitations(ownerTenant))[0]!.token;

    await t.app.inject({ method: 'GET', url: `/invite/${token}` });
    const inviteLog = t.logs.find(
      (l) => l['msg'] === 'request' && String(l['path']).startsWith('/invite'),
    );
    expect(inviteLog?.['path']).toBe('/invite/:token');
    expect(JSON.stringify(t.logs)).not.toContain(token);
  });
});

describe('global error boundary', () => {
  class ThrowingRunsStore extends MemoryStore {
    override async listRuns(): Promise<RunRecord[]> {
      throw new Error('SECRET-INTERNAL-DETAIL: relation "runs" does not exist at 10.0.0.5');
    }
  }

  it('returns a generic 500 without leaking the error message, and logs the error name only', async () => {
    const logs: Record<string, unknown>[] = [];
    const app = buildServer({
      store: new ThrowingRunsStore(),
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => undefined,
      logSink: (line) => logs.push(line),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=boom@x.example',
    });
    const cookie = cookieOf(login, 'cf_session');

    const res = await app.inject({ method: 'GET', url: '/runs', headers: { cookie } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('SECRET-INTERNAL-DETAIL');
    expect(res.body).not.toContain('10.0.0.5');
    expect(res.body).toContain('Something went wrong');
    // The error is logged by name (a class), never by message.
    const errLog = logs.find((l) => l['msg'] === 'request-error');
    expect(errLog).toMatchObject({ status: 500, error: 'Error', path: '/runs' });
    expect(JSON.stringify(logs)).not.toContain('SECRET-INTERNAL-DETAIL');
  });
});

describe('authenticated responses forbid caching (financial data privacy)', () => {
  it('sets Cache-Control: no-store on an authenticated page but not on the public landing', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'cache@acme.example');
    const authed = await get(t, cookie, '/runs');
    expect(String(authed.headers['cache-control'])).toContain('no-store');
    const publicLanding = await t.app.inject({ method: 'GET', url: '/' });
    expect(publicLanding.headers['cache-control']).toBeUndefined();
  });
});

describe('member authorization on the job surface', () => {
  it('a member cannot view a job page (manager-gated)', async () => {
    const t = makeApp();
    await signIn(t, 'owner@jobs.example');
    const tenant = (await t.store.findUserByEmail('owner@jobs.example'))!.tenantId;
    await t.store.createUserInTenant(tenant, 'member@jobs.example', 'member');
    const memberCookie = await signIn(t, 'member@jobs.example');
    const res = await get(t, memberCookie, '/jobs/any-job-id');
    expect(res.statusCode).toBe(403);
  });
});

describe('least-privilege UI on /settings', () => {
  it('shows the org-erase control only to the owner, not to admins', async () => {
    const t = makeApp();
    await signIn(t, 'owner@set.example');
    const tenant = (await t.store.findUserByEmail('owner@set.example'))!.tenantId;
    await t.store.createUserInTenant(tenant, 'admin@set.example', 'admin');

    const ownerCookie = await signIn(t, 'owner@set.example');
    const adminCookie = await signIn(t, 'admin@set.example');

    const ownerView = await get(t, ownerCookie, '/settings');
    expect(ownerView.body).toContain('Delete my entire organization');

    const adminView = await get(t, adminCookie, '/settings');
    expect(adminView.statusCode).toBe(200); // admins may reach settings
    expect(adminView.body).not.toContain('Delete my entire organization');
    expect(adminView.body).toContain('Only the organization owner');
  });
});

describe('graceful gateway failure on /scope', () => {
  it('a project-list failure during import returns a 400 import error, not a 500', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner@scope.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: 'secret-jira-token-abc123',
    });
    // The gateway now fails to list projects on the scope step.
    t.gateway.failListWith = new GatewayError('auth-error', 'list-projects', 'nope', 401);
    const res = await post(t, cookie, '/scope', { project: '0' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Import failed');
    expect(res.body).not.toContain('nope'); // raw gateway message is not echoed
  });

  it('refuses a project above the issue ceiling before the memory-heavy analysis', async () => {
    // A single unbounded analysis holds ~1GB heap at 100k issues; on a shared
    // process that OOMs every tenant. The guard converts it into a clear 400.
    class HugeGateway extends StubJiraGateway {
      override async fetchAll() {
        // Jira's first page carries the authoritative `total`.
        return {
          provider: 'jira' as const,
          searchPages: [JSON.stringify({ total: 999_999, issues: [] })],
          supplementaryChangelogs: {},
        };
      }
    }
    const store = new MemoryStore();
    const gateway = new HugeGateway();
    const app = buildServer({
      store,
      connectors: stubConnectors(gateway),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => {},
      jobNowFn: () => '2026-07-20T00:00:00Z',
      awaitJobs: true,
      maxIssues: 50_000,
    });
    const t = { app, store, gateway, clickup: new StubClickUpGateway(), events: [], logs: [] };
    const cookie = await signIn(t, 'huge@scope.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: 'secret-jira-token-abc123',
    });
    const res = await post(t, cookie, '/scope', { project: '0' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('999,999');
    expect(res.body).toContain('50,000');
    // The workspace never advances to a state that could trigger the analysis.
    const ws = (
      await store.listWorkspaces((await store.findUserByEmail('huge@scope.example'))!.tenantId)
    )[0]!;
    expect(ws.onboarding).toBe('connected');
  });
});
