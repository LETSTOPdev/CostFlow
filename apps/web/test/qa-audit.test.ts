import { describe, expect, it } from 'vitest';
import { signValue } from '../src/crypto';
import { forbiddenJiraSite } from '../src/connectors/jira';
import { frictionInsight, humanizeMagnitude } from '../src/report-view';
import { POOL_CONFIG } from '../src/store/pg';
import { SESSION_TTL_MS } from '../src/auth';
import { SESSION_KEY, TOKEN, cookieOf, makeApp, post, signIn } from './helpers';

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
