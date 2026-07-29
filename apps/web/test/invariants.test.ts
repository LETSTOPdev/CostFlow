import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory';
import {
  SESSION_KEY,
  CREDENTIAL_KEY,
  SPLIT_SITE,
  makeApp,
  signIn,
  post,
  stubConnectors,
} from './helpers';
import { renderDemoCompany } from '../src/demo-live';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SECOND BRAIN — executable architectural invariants & budgets.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Load-bearing assumptions from docs/BIBLE §3 ("Invariants") and §16
 * ("Dangerous to change") encoded as tests, so a regression introduced 18
 * months from now fails HERE (in CI) instead of in production. Each block names
 * the invariant, the budget, and WHY it matters. Budgets are deliberately
 * generous headroom over measured values — they catch order-of-magnitude
 * regressions, not noise. If you change a budget, you are changing a promise;
 * do it deliberately and say why in the PR.
 *
 * Other invariants live where they are naturally enforced and are referenced
 * here so the map is complete:
 *  - Determinism of the ENGINE artifact (run.json/report.md/telemetry.jsonl):
 *    tools/golden byte-identical (root `pnpm test`).
 *  - Dependency direction + engine purity (no node builtins in pure packages,
 *    no provider leak): `.dependency-cruiser.cjs` (`pnpm depcruise`).
 *  - Pricing gate (vendor-suggested assumptions never priced in report mode):
 *    journey.test.ts.
 *  - Attribution guard (no raw identity in a report): attribution-guard.test.ts.
 *  - Import ceiling (OOM guard): production-hardening.test.ts.
 *  - Report drill-down row cap: report-scale.test.ts.
 */

// ── Budgets (single source of truth) ───────────────────────────────────────
const BUDGET = {
  /** Report HTML must stay bounded regardless of project size (QA: pre-cap 27MB@100k). */
  reportHtmlKb: 300,
  /** Full analysis + render of a realistic project must feel instant. */
  timeToReportMs: 1500,
  /**
   * Cold start (buildServer + first request) must stay cheap for platform
   * healthchecks — measured in CPU time, not wall time.
   *
   * Wall time here measured scheduler contention rather than the code. The same
   * work benchmarks at 157ms wall alone, 56ms wall inside the suite, and
   * 2200–2700ms wall when the machine is loaded, while CPU time stays at 69–72ms
   * throughout. A budget against a number that moves 40x on machine load is a
   * coin flip, and a gate that fails at random stops being read.
   *
   * The default vitest pool is `forks`, so each test file owns its process and
   * `process.cpuUsage()` accrues only this file's own work. 400ms against ~70ms
   * observed is a ~5.7x margin: strictly TIGHTER than the 1500ms wall budget it
   * replaces, because it is no longer padded to absorb noise.
   */
  coldStartCpuMs: 400,
  /**
   * A loose wall-clock backstop, because CPU time cannot see async I/O waiting.
   * Cold start does no I/O today; if it ever grows a database connect or a
   * remote config fetch, CPU time would under-measure it and this would catch
   * the hang. Set far above any contention this suite can produce.
   */
  coldStartWallMs: 8000,
} as const;

describe('INVARIANT: report HTML size budget', () => {
  it('a full generated report stays well under the size budget', () => {
    // renderDemoCompany runs the REAL engine (transform → analyse → render) on
    // a realistic 60–160 issue company — representative of a real customer.
    let maxKb = 0;
    for (const seed of [1, 42, 777, 123456, 999999999]) {
      const kb = Buffer.byteLength(renderDemoCompany(seed).reportBody) / 1024;
      maxKb = Math.max(maxKb, kb);
    }
    expect(maxKb).toBeLessThan(BUDGET.reportHtmlKb);
  });
});

describe('INVARIANT: time-to-report budget', () => {
  it('generating a real report is fast', () => {
    const t0 = performance.now();
    const d = renderDemoCompany(20240723);
    const ms = performance.now() - t0;
    expect(d.reportBody.length).toBeGreaterThan(1000); // it really rendered
    expect(ms).toBeLessThan(BUDGET.timeToReportMs);
  });
});

describe('INVARIANT: cold-start budget', () => {
  it('buildServer + first healthcheck is cheap', async () => {
    const wall0 = performance.now();
    const cpu0 = process.cpuUsage();
    const app = buildServer({
      store: new MemoryStore(),
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => {},
    });
    await app.inject({ method: 'GET', url: '/healthz' });
    const cpu = process.cpuUsage(cpu0);

    // Primary: the cost of the work itself, immune to what else the machine is
    // doing. This is the assertion that should fail when cold start regresses.
    expect((cpu.user + cpu.system) / 1000).toBeLessThan(BUDGET.coldStartCpuMs);
    // Backstop: catches a hang or an async I/O dependency that burns no CPU.
    expect(performance.now() - wall0).toBeLessThan(BUDGET.coldStartWallMs);
  });
});

describe('INVARIANT: report determinism (same inputs → identical bytes)', () => {
  it('the same seed renders byte-identical reports (shareable, comparable)', () => {
    expect(renderDemoCompany(424242).reportBody).toBe(renderDemoCompany(424242).reportBody);
  });
});

describe('INVARIANT: money-format safety (no leaked internals in a report)', () => {
  it('a rendered report never contains NaN / undefined / Infinity / [object Object]', () => {
    for (const seed of [3, 99, 500500, 1700000000]) {
      const body = renderDemoCompany(seed).reportBody;
      expect(body).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/);
    }
  });
});

describe('INVARIANT: multi-tenant isolation (no cross-tenant object reference)', () => {
  it("tenant B cannot read tenant A's run via any report route", async () => {
    const t = makeApp();
    // Tenant A owns a run.
    await signIn(t, 'tenant-a@x.example');
    const tenantA = (await t.store.findUserByEmail('tenant-a@x.example'))!.tenantId;
    const wsA = await t.store.createWorkspace(tenantA, {
      provider: 'jira',
      connectionParams: { site: 'https://a.example', email: 'a@x.example' },
      tokenCiphertext: 'tok',
    });
    await t.store.createRun({
      id: 'run-secret',
      tenantId: tenantA,
      workspaceId: wsA.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson: '{}',
      reportMd: '# r',
      telemetryJsonl: '',
    });
    // Tenant B (different org) probes A's known run id on every report surface.
    const cookieB = await signIn(t, 'tenant-b@x.example');
    for (const path of [
      '/reports/run-secret',
      '/reports/run-secret/print',
      '/reports/run-secret/raw',
    ]) {
      const res = await t.app.inject({ method: 'GET', url: path, headers: { cookie: cookieB } });
      expect(res.statusCode).toBe(404); // not 200, not 403-with-data — no disclosure
    }
  });
});

describe('INVARIANT: security posture (headers + CSRF)', () => {
  it('production responses carry the full security-header set and a JS-free CSP', async () => {
    const app = buildServer({
      store: new MemoryStore(),
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => {},
      production: true,
    });
    const res = await app.inject({ method: 'GET', url: '/' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'"); // no client JS, ever
    expect(res.headers['strict-transport-security']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('a mutating POST without a valid CSRF token is rejected', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'csrf@x.example');
    const res = await t.app.inject({
      method: 'POST',
      url: '/org/rename',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'csrf=WRONG&name=x',
    });
    expect(res.statusCode).toBe(403);
    // Sanity: the same route succeeds with the right token (guard isn't just off).
    const ok = await post(t, cookie, '/org/rename', { name: 'Acme' });
    expect(ok.statusCode).toBe(302);
  });
});

describe('INVARIANT: provider-aware copy (never name a platform the customer is not on)', () => {
  // ADR-0005 made the app multi-platform; every workspace-scoped screen must
  // draw platform vocabulary from the connector descriptor, never a literal.
  // A ClickUp customer reading "never changes anything in Jira" stops
  // trusting every other sentence — this guards the whole class.
  const dashboardFor = async (
    t: ReturnType<typeof makeApp>,
    email: string,
    provider: string,
    connectionParams: Record<string, string>,
  ): Promise<string> => {
    const cookie = await signIn(t, email);
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const ws = await t.store.createWorkspace(tenantId, {
      provider,
      connectionParams,
      tokenCiphertext: 'tok',
    });
    await t.store.updateWorkspace(tenantId, ws.id, {
      scopes: [{ id: 'scope-1', kind: 'project', name: 'Engineering' }],
      onboarding: 'ready',
    });
    const res = await t.app.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    // The <head> is site-wide metadata (og/meta description name every
    // platform we support — correct there). The invariant governs what the
    // customer READS, so assert on the body only.
    const body = res.body.split('</head>')[1];
    expect(body).toBeTruthy();
    return body!;
  };

  it("a ClickUp workspace's dashboard names ClickUp and never Jira", async () => {
    const body = await dashboardFor(makeApp(), 'cu-owner@x.example', 'clickup', {});
    expect(body).toContain('ClickUp');
    expect(body).not.toContain('Jira');
  });

  it("a Jira workspace's dashboard names Jira and never ClickUp", async () => {
    const body = await dashboardFor(makeApp(), 'jira-owner@x.example', 'jira', {
      site: 'https://acme.atlassian.net',
      email: 'owner@acme.example',
    });
    expect(body).toContain('Jira');
    expect(body).not.toContain('ClickUp');
  });
});

/**
 * The marketing site and the application are two hostnames served by one
 * process. The invariant that matters is not which way a given path goes — it
 * is that following the redirects always terminates. Each host redirects only
 * the paths it does not own, to the host that does, and that host has no rule
 * that would send them back.
 */
describe('INVARIANT: two hosts, and no request can bounce between them', () => {
  const MARKETING = 'fbx1.com';
  const APP = 'app.fbx1.com';

  it('sends each path to the host that owns it, preserving path and query', async () => {
    const t = makeApp({ site: SPLIT_SITE });
    const appPathOnMarketing = await t.app.inject({
      method: 'GET',
      url: '/dashboard?x=1',
      headers: { host: MARKETING },
    });
    expect(appPathOnMarketing.statusCode).toBe(301);
    expect(appPathOnMarketing.headers['location']).toBe('https://app.fbx1.com/dashboard?x=1');

    const marketingPathOnApp = await t.app.inject({
      method: 'GET',
      url: '/pricing?y=2',
      headers: { host: APP },
    });
    expect(marketingPathOnApp.statusCode).toBe(301);
    expect(marketingPathOnApp.headers['location']).toBe('https://fbx1.com/pricing?y=2');
  });

  /**
   * Follow every redirect to its end. A loop shows up as a request that never
   * arrives at a host willing to serve it — which is what a 301 pointing back
   * at the origin it came from would produce, and the failure mode a customer
   * experiences as a browser error rather than as a page.
   */
  it('terminates for every path on both hosts', async () => {
    const t = makeApp({ site: SPLIT_SITE });
    const paths = [
      '/',
      '/pricing',
      '/docs',
      '/demo',
      '/try',
      '/terms',
      '/login',
      '/signup',
      '/dashboard',
      '/runs',
      '/robots.txt',
      '/brand/logo.svg',
      '/healthz',
      '/nothing-here',
    ];
    for (const start of paths) {
      for (const startHost of [MARKETING, APP, 'www.fbx1.com']) {
        let host = startHost;
        let url = start;
        let hops = 0;
        for (;;) {
          const res = await t.app.inject({ method: 'GET', url, headers: { host } });
          if (res.statusCode !== 301) break;
          const next = new URL(res.headers['location'] as string);
          host = next.host;
          url = `${next.pathname}${next.search}`;
          hops += 1;
          expect(hops, `${startHost}${start} keeps redirecting`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('folds www into the apex rather than letting two marketing origins exist', async () => {
    const t = makeApp({ site: SPLIT_SITE });
    const res = await t.app.inject({
      method: 'GET',
      url: '/pricing',
      headers: { host: 'www.fbx1.com' },
    });
    expect(res.statusCode).toBe(301);
    expect(res.headers['location']).toBe('https://fbx1.com/pricing');
  });

  /**
   * `/` is the one path both hosts own — the landing on one, the way in on the
   * other. If either redirected it, the two would trade a visitor forever.
   */
  it('never redirects the root, on either host', async () => {
    const t = makeApp({ site: SPLIT_SITE });
    for (const host of [MARKETING, APP]) {
      const res = await t.app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(res.statusCode, `${host}/ should be served, not redirected`).toBe(200);
    }
  });

  /**
   * Health probes arrive on the platform's internal hostname, and the identity
   * provider's login page loads the logo from wherever it was configured. A
   * redirect on either is an outage that looks like a DNS problem.
   */
  it('serves shared assets and health probes on any host, unredirected', async () => {
    const t = makeApp({ site: SPLIT_SITE });
    for (const host of [MARKETING, APP, 'costflow.up.railway.app']) {
      for (const url of ['/healthz', '/brand/logo.svg', '/favicon.ico']) {
        const res = await t.app.inject({ method: 'GET', url, headers: { host } });
        expect(res.statusCode, `${host}${url}`).toBe(200);
      }
    }
  });

  it('does nothing at all until the split is configured', async () => {
    const t = makeApp();
    for (const host of ['fbx1.com', 'app.fbx1.com', 'localhost']) {
      const res = await t.app.inject({ method: 'GET', url: '/pricing', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });
});
