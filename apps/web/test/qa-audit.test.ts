import { describe, expect, it, vi } from 'vitest';
import { signValue } from '../src/crypto';
import { forbiddenJiraSite } from '../src/connectors/jira';
import { frictionInsight, humanizeMagnitude } from '../src/report-view';
import { POOL_CONFIG } from '../src/store/pg';
import { gracefulShutdown } from '../src/main';
import { MemoryStore } from '../src/store/memory';
import { PgStore } from '../src/store/pg';
import { securityHeaders } from '../src/security';
import { SESSION_TTL_MS } from '../src/auth';
import { CREDENTIAL_KEY, SESSION_KEY, TOKEN, cookieOf, makeApp, post, signIn } from './helpers';

/** Minimal OIDC config for tests: only the issuer origin matters for CSP. */
const OIDC_AUTH = {
  mode: 'oidc',
  sessionKey: SESSION_KEY,
  credentialKey: CREDENTIAL_KEY,
  secureCookies: true,
  oidc: {
    issuer: 'https://tenant.us.auth0.com/',
    clientId: 'client-abc',
    clientSecret: 'secret-xyz',
    redirectUri: 'https://app.example.com/oidc/callback',
    postLogoutRedirectUri: 'https://app.example.com/logged-out',
  },
} as const;

/**
 * Regression tests from the pre-release QA audit. Each group pins a fix:
 * sessions expire, the Jira site URL cannot point at internal addresses,
 * and a run cannot be started twice concurrently for one workspace.
 */

describe('session expiry (absolute TTL)', () => {
  it('rejects an expired session cookie: the request is treated as signed out', async () => {
    const t = makeApp();
    const expired = signValue(
      { userId: 'u-1', tenantId: 't-1', csrf: 'c-1', exp: Date.now() - 1_000 },
      SESSION_KEY,
    );
    const res = await t.app.inject({
      method: 'GET',
      url: '/runs',
      headers: { cookie: `cf_session=${expired}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('rejects a legacy cookie without an expiry (pre-TTL format)', async () => {
    const t = makeApp();
    const legacy = signValue({ userId: 'u-1', tenantId: 't-1', csrf: 'c-1' }, SESSION_KEY);
    const res = await t.app.inject({
      method: 'GET',
      url: '/runs',
      headers: { cookie: `cf_session=${legacy}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('issues fresh sessions with a bounded Max-Age and honors them', async () => {
    const t = makeApp();
    const login = await t.app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=ttl%40acme.example',
    });
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    const cookie = cookieOf(login, 'cf_session');
    const home = await t.app.inject({ method: 'GET', url: '/runs', headers: { cookie } });
    expect(home.statusCode).toBe(200);
  });
});

describe('SSRF guard on the Jira site URL', () => {
  it.each([
    'https://localhost',
    'https://sub.localhost',
    'https://127.0.0.1',
    'https://10.0.0.8',
    'https://172.20.1.2',
    'https://192.168.1.1',
    'https://169.254.169.254',
    'https://100.100.1.1',
    'https://0.0.0.0',
    'https://[::1]',
    'https://[fe80::1]',
    'https://[fc00::1]',
    'https://user:pass@jira.example.com',
    'https://foo.internal',
    'https://printer.local',
    'https://gw.home.arpa',
    'https://intranet',
    'http://jira.example.com',
    'not-a-url',
  ])('refuses %s', (site) => {
    expect(forbiddenJiraSite(site)).toBe(true);
  });

  it.each([
    'https://your-org.atlassian.net',
    'https://jira.example.com:8443',
    'https://172.15.0.1',
    'https://172.32.0.1',
    'https://100.63.0.1',
    'https://[2600:1f18::1]',
  ])('allows %s', (site) => {
    expect(forbiddenJiraSite(site)).toBe(false);
  });

  it('rejects a private site at the connect form with a helpful message', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ssrf@acme.example');
    const res = await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://10.0.0.8',
      email: 'ops@acme.example',
      token: TOKEN,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('public https:// URL');
    // The gateway was never contacted with the private address.
    expect(t.gateway.lastCredentials).toBeNull();
  });
});

describe('logout is robust to how the client encodes the POST (prod "does nothing")', () => {
  // The intermittent "sign out does nothing" was a connection-severing race
  // (fixed via graceful shutdown + multi-replica). While proving it, a related
  // server-side edge surfaced: a POST with an unparseable content-type could
  // 415 with an empty body. Pin that the logout endpoint always redirects
  // (never 415/500/hang) regardless of how a client encodes the request, so a
  // click can never silently no-op at the server layer.
  const cases: { name: string; headers: Record<string, string>; payload: string }[] = [
    { name: 'no content-type, no body', headers: {}, payload: '' },
    {
      name: 'urlencoded + csrf',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'csrf=x',
    },
    {
      name: 'urlencoded, empty body',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    },
    { name: 'application/json', headers: { 'content-type': 'application/json' }, payload: '{}' },
  ];
  it.each(cases)('POST /logout ($name) redirects, never 415/500', async ({ headers, payload }) => {
    const t = makeApp(); // dev mode: no session -> redirect to /logged-out
    const res = await t.app.inject({ method: 'POST', url: '/logout', headers, payload });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/logged-out');
  });
});

describe('CSP form-action allows the OIDC logout redirect (prod "Sign out does nothing")', () => {
  // The real prod-only "Sign out does nothing": the no-JS Sign-out form POSTs to
  // /logout, which in OIDC mode 302s to the IdP's cross-origin logout endpoint.
  // Browsers check EVERY hop of a form-initiated navigation against form-action,
  // so with a bare `form-action 'self'` the cross-origin redirect is silently
  // blocked and the page never moves. Dev mode redirects to same-origin
  // /logged-out, which is why it only reproduced in production.
  // Raw securityHeaders() uses 'Content-Security-Policy'; Fastify lowercases
  // response header names, so accept either casing.
  const cspOf = (h: Record<string, unknown>) =>
    String(h['Content-Security-Policy'] ?? h['content-security-policy'] ?? '');
  const formActionOf = (csp: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('form-action')) ?? '';

  it('securityHeaders keeps just self when no extra origins are given', () => {
    expect(formActionOf(cspOf(securityHeaders(true)))).toBe("form-action 'self'");
  });

  it('securityHeaders adds extra origins (the IdP) after self', () => {
    const fa = formActionOf(cspOf(securityHeaders(true, ['https://tenant.us.auth0.com'])));
    expect(fa).toBe("form-action 'self' https://tenant.us.auth0.com");
  });

  it('a dev-mode server emits form-action self only (redirect is same-origin)', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/login' });
    expect(formActionOf(cspOf(res.headers as Record<string, string>))).toBe("form-action 'self'");
  });

  it('an OIDC-mode server allowlists the IdP origin so the logout redirect is not blocked', async () => {
    const t = makeApp({ auth: OIDC_AUTH });
    const res = await t.app.inject({ method: 'GET', url: '/login' });
    const fa = formActionOf(cspOf(res.headers as Record<string, string>));
    // The IdP origin (no trailing slash, path stripped) must be present so the
    // form POST -> https://tenant.us.auth0.com/oidc/logout hop is allowed.
    expect(fa).toContain("'self'");
    expect(fa).toContain('https://tenant.us.auth0.com');
    expect(fa).not.toContain('/oidc/logout'); // origin only, never a full path
  });
});

describe('graceful shutdown drains connections on SIGTERM (prod 503 incident)', () => {
  // The prod incident: on redeploy Railway SIGTERMs the process; without a
  // handler, keep-alive connections are severed and non-idempotent POSTs
  // (sign-out) "did nothing" or 503'd. These pin the drain-then-exit behavior.
  it('closes the server (draining in-flight + keep-alive) then the store, then exits 0', async () => {
    const order: string[] = [];
    const app = { close: vi.fn(async () => void order.push('app.close')) };
    const store = new PgStore('postgres://unused');
    // Avoid touching a real DB: stub the pool close the store delegates to.
    vi.spyOn(store, 'close').mockImplementation(async () => void order.push('store.close'));
    const exit = vi.fn(() => void order.push('exit'));

    await gracefulShutdown(app, store, exit as unknown as (code: number) => void, () => {});

    expect(order).toEqual(['app.close', 'store.close', 'exit']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('still exits when the store has no close() (MemoryStore) and when close() throws', async () => {
    // MemoryStore exposes no close(): shutdown must still drain the app and exit.
    const app1 = { close: vi.fn(async () => undefined) };
    const exit1 = vi.fn();
    await gracefulShutdown(
      app1,
      new MemoryStore(),
      exit1 as unknown as (c: number) => void,
      () => {},
    );
    expect(app1.close).toHaveBeenCalledOnce();
    expect(exit1).toHaveBeenCalledWith(0);

    // A drain error must never block the exit (the platform would SIGKILL us).
    const app2 = { close: vi.fn(async () => Promise.reject(new Error('boom'))) };
    const exit2 = vi.fn();
    await gracefulShutdown(
      app2,
      new MemoryStore(),
      exit2 as unknown as (c: number) => void,
      () => {},
    );
    expect(exit2).toHaveBeenCalledWith(0);
  });
});

describe('Postgres pool is hardened against connection hangs (prod 503 incident)', () => {
  // The prod incident: authenticated routes "did nothing" or returned an edge
  // 503 while public routes stayed up. Cause was the default pool —
  // connectionTimeoutMillis:0 (wait forever) with no TCP keepalive — letting a
  // dead connection across the Railway network hop hang a query indefinitely.
  // These pin the fix so a refactor can't silently restore the infinite wait.
  it('bounds every wait (no infinite connection or query timeout)', () => {
    expect(POOL_CONFIG.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(POOL_CONFIG.connectionTimeoutMillis).toBeLessThanOrEqual(30_000);
    expect(POOL_CONFIG.statement_timeout).toBeGreaterThan(0);
    expect(POOL_CONFIG.query_timeout).toBeGreaterThan(0);
    expect(POOL_CONFIG.idleTimeoutMillis).toBeGreaterThan(0);
  });

  it('enables TCP keepalive so dead connections are detected, not hung on', () => {
    expect(POOL_CONFIG.keepAlive).toBe(true);
  });
});

describe('report render escapes attacker-controllable tracker data', () => {
  // A Jira/ClickUp status or stage name is chosen by anyone on the customer's
  // board — an untrusted string that reaches the report HTML. These pin the
  // esc() choke points so a future refactor can't silently reintroduce XSS.
  const XSS = '<script>alert(1)</script>';

  it('frictionInsight escapes a malicious stage name', () => {
    for (const type of ['queue-wait', 'aging', 'overdue', 'other']) {
      const html = frictionInsight(type, XSS, 14);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    }
  });

  it('humanizeMagnitude escapes a malicious unit', () => {
    const html = humanizeMagnitude(5, XSS);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('concurrent-run guard', () => {
  it('POST /runs redirects to an already in-flight job instead of starting a second', async () => {
    // Complete onboarding (awaitJobs runs the job synchronously to completion),
    // then seed a fresh queued job to stand in for one still in flight — this
    // is deterministic, unlike racing the async executor.
    const t = makeApp();
    const cookie = await signIn(t, 'double@acme.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: TOKEN,
    });
    await post(t, cookie, '/scope', { project: '0' });
    await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
    await post(t, cookie, '/mapping/actors', {});
    await post(t, cookie, '/assumptions', {
      rate0: '90',
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

    const tenantId = (await t.store.findUserByEmail('double@acme.example'))!.tenantId;
    const ws = (await t.store.listWorkspaces(tenantId))[0]!;
    const inFlight = await t.store.createJob(tenantId, ws.id); // status 'queued'

    const res = await post(t, cookie, '/runs', {});
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/jobs/${inFlight.id}`);

    // No second job was created while the first is still queued.
    const jobs = await t.store.listJobsForWorkspace(tenantId, ws.id);
    expect(jobs.length).toBe(1);
  });
});
