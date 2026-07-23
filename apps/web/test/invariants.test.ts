import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory';
import { SESSION_KEY, CREDENTIAL_KEY, makeApp, signIn, post, stubConnectors } from './helpers';
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
  /** Cold start (buildServer + first request) must stay fast for platform healthchecks. */
  coldStartMs: 1500,
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
  it('buildServer + first healthcheck is fast', async () => {
    const t0 = performance.now();
    const app = buildServer({
      store: new MemoryStore(),
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => {},
    });
    await app.inject({ method: 'GET', url: '/healthz' });
    expect(performance.now() - t0).toBeLessThan(BUDGET.coldStartMs);
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

describe('INVARIANT: canonical host (apex → app, no loop)', () => {
  it('redirects fbx1.com to app.fbx1.com but never loops on the canonical host', async () => {
    const t = makeApp();
    const apex = await t.app.inject({
      method: 'GET',
      url: '/x?y=1',
      headers: { host: 'fbx1.com' },
    });
    expect(apex.statusCode).toBe(301);
    expect(apex.headers['location']).toBe('https://app.fbx1.com/x?y=1');
    const canon = await t.app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'app.fbx1.com' },
    });
    expect(canon.statusCode).toBe(200);
  });
});
