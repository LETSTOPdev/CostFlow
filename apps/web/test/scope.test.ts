import { describe, expect, it } from 'vitest';
import { GatewayError } from '../src/connectors/types';
import { TOKEN, get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * POST /scope regression suite (P4.2 defect 2). The stub gateway serves the
 * golden Jira raw page for the OPS project; failure modes are injected to
 * prove sanitized, well-classified diagnostics with no secret/customer-data
 * leakage.
 */

async function reachScope(t: TestApp, email: string): Promise<string> {
  const cookie = await signIn(t, email);
  await post(t, cookie, '/connect', {
    provider: 'jira',
    site: 'https://acme.atlassian.net',
    email,
    token: TOKEN,
  });
  return cookie;
}

describe('project import (POST /scope)', () => {
  it('imports the selected real project and advances onboarding', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'ok@acme.example');
    const res = await post(t, cookie, '/scope', { project: '0' }); // OPS
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/mapping/statuses');
    expect(t.gateway.lastFetchScopeId).toBe('OPS');

    const tenantId = (await t.store.findUserByEmail('ok@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.scopeId).toBe('OPS');
    expect(workspace.onboarding).toBe('scope-selected');
    expect(workspace.observedStatuses.length).toBeGreaterThan(0); // parsed from the import
  });

  it('submits the project by list position → the correct project key', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'idx@acme.example');
    // GET /scope renders radios keyed by index; index 1 is MKT.
    const scopePage = await get(t, cookie, '/scope');
    expect(scopePage.body).toContain('value="0"'); // OPS
    expect(scopePage.body).toContain('value="1"'); // MKT
    // Submitting index 1 must fetch MKT, not OPS (position → key mapping).
    await post(t, cookie, '/scope', { project: '1' });
    expect(t.gateway.lastFetchScopeId).toBe('MKT');
  });

  it('an out-of-range selection is rejected without calling the gateway import', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'oor@acme.example');
    const res = await post(t, cookie, '/scope', { project: '99' });
    expect(res.statusCode).toBe(400);
    expect(t.gateway.lastFetchScopeId).toBeNull();
  });

  it('a removed-endpoint style failure is shown as a sanitized, staged diagnostic (defect signature)', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'gone@acme.example');
    t.gateway.failFetchWith = new GatewayError(
      'fetch-error',
      'search',
      'Jira request failed at search (HTTP 410).',
      410,
    );
    const res = await post(t, cookie, '/scope', { project: '0' });
    expect(res.statusCode).toBe(400);
    // The UI now identifies the stage + status, not a bare "fetch-error".
    expect(res.body).toContain('fetch-error');
    expect(res.body).toContain('at search');
    expect(res.body).toContain('HTTP 410');
    expect(res.body).not.toContain(TOKEN);

    // A sanitized diagnostic log line was emitted — class/stage/status only.
    const diag = t.logs.find((l) => l['msg'] === 'import-failed');
    expect(diag).toMatchObject({ errorClass: 'fetch-error', stage: 'search', status: 410 });
    const serialized = JSON.stringify(t.logs);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('gone@acme.example');
    // Nothing was persisted; onboarding did not advance.
    const tenantId = (await t.store.findUserByEmail('gone@acme.example'))!.tenantId;
    expect((await t.store.listWorkspaces(tenantId))[0]!.onboarding).toBe('connected');
  });

  it('invalid/expired credentials surface as an auth-error stage diagnostic', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'auth@acme.example');
    t.gateway.failFetchWith = new GatewayError(
      'auth-error',
      'search',
      'Jira rejected the credentials at search (HTTP 401).',
      401,
    );
    const res = await post(t, cookie, '/scope', { project: '0' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('auth-error');
    expect(t.logs.find((l) => l['msg'] === 'import-failed')).toMatchObject({
      errorClass: 'auth-error',
      stage: 'search',
    });
  });

  it('lists only real Jira projects — no selectable offline/example placeholder', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'list@acme.example');
    const scopePage = await get(t, cookie, '/scope');
    // Exactly the gateway's projects are offered; the app injects no example.
    expect(scopePage.body).toContain('Operations (OPS)');
    expect(scopePage.body).toContain('Marketing Website (MKT)');
    expect((scopePage.body.match(/type="radio"/g) ?? []).length).toBe(2);
  });
});
