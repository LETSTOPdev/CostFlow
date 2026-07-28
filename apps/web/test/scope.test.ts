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

  /**
   * The form submits the scope ID, not a list position. Search filters the list
   * server-side, so a position would resolve against a different list than the
   * one the customer was looking at and silently import the wrong project.
   */
  it('submits the project by id → the correct project key', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'idx@acme.example');
    const scopePage = await get(t, cookie, '/scope');
    expect(scopePage.body).toContain('value="OPS"');
    expect(scopePage.body).toContain('value="MKT"');
    await post(t, cookie, '/scope', { scope: 'MKT' });
    expect(t.gateway.lastFetchScopeId).toBe('MKT');
  });

  /**
   * A form rendered before the id-based change submits a bare integer. It must
   * still resolve, rather than being rejected or importing whatever now sits at
   * that position.
   */
  it('still accepts a positional submission from a form rendered before the change', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'legacy@acme.example');
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
    expect(scopePage.body).toContain('Operations');
    expect(scopePage.body).toContain('Marketing Website');
    expect(scopePage.body).toContain('value="OPS"');
    expect(scopePage.body).toContain('value="MKT"');
    expect((scopePage.body.match(/type="radio"/g) ?? []).length).toBe(2);
  });

  /**
   * Search is a GET round trip because there is no client JavaScript and the
   * CSP forbids adding any. It appears only when the list is long enough to be
   * worth filtering.
   */
  describe('search', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `P${i}`,
      name: i % 2 === 0 ? `Engineering ${i}` : `Marketing ${i}`,
    }));

    it('stays out of the way for a short list', async () => {
      const t = makeApp();
      const cookie = await reachScope(t, 'short@acme.example');
      const page = await get(t, cookie, '/scope');
      expect(page.body).not.toContain('name="q"');
    });

    it('appears for a long list and reports how many there are', async () => {
      const t = makeApp();
      t.gateway.projects = many;
      const cookie = await reachScope(t, 'long@acme.example');
      const page = await get(t, cookie, '/scope');
      expect(page.body).toContain('name="q"');
      expect(page.body).toContain('12 projects available');
    });

    it('filters by name, server-side, and says what it matched', async () => {
      const t = makeApp();
      t.gateway.projects = many;
      const cookie = await reachScope(t, 'filter@acme.example');
      const page = await get(t, cookie, '/scope?q=engineering');
      expect(page.body).toContain('6 of 12 match');
      expect(page.body).toContain('Engineering 0');
      expect(page.body).not.toContain('Marketing 1');
      // No script anywhere: the filtering happened on the server.
      expect(page.body).not.toContain('<script');
    });

    it('filters by id as well as name', async () => {
      const t = makeApp();
      t.gateway.projects = many;
      const cookie = await reachScope(t, 'byid@acme.example');
      const page = await get(t, cookie, '/scope?q=P11');
      expect(page.body).toContain('1 of 12 match');
      expect(page.body).toContain('value="P11"');
    });

    /**
     * The reason the form submits an id. A position resolved against the
     * unfiltered list would import a different project than the one shown.
     */
    it('submits the right project even when the visible list was filtered', async () => {
      const t = makeApp();
      t.gateway.projects = many;
      const cookie = await reachScope(t, 'filtered-submit@acme.example');
      await get(t, cookie, '/scope?q=marketing');
      await post(t, cookie, '/scope', { scope: 'P7' });
      expect(t.gateway.lastFetchScopeId).toBe('P7');
    });

    it('offers a way out when nothing matches', async () => {
      const t = makeApp();
      t.gateway.projects = many;
      const cookie = await reachScope(t, 'nomatch@acme.example');
      const page = await get(t, cookie, '/scope?q=zzzz');
      expect(page.body).toContain('Nothing matches');
      expect(page.body).toContain('Show all projects');
      expect(page.body).not.toContain('type="radio"');
    });
  });
});
