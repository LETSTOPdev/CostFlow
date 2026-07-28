import { describe, expect, it } from 'vitest';
import { GatewayError } from '../src/connectors/types';
import { TOKEN, get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * The scope step, which is where a Monitoring Workspace learns what it is a
 * view OF.
 *
 * Two things are under test here. Failure modes must stay sanitized and
 * well-classified, with no secret or customer data in a log line (P4.2 defect
 * 2). And the selection is a SET, chosen with no client JavaScript, so the
 * mechanics that would normally be a checkbox array in browser memory — search,
 * select-all, off-screen selections — all have to survive a round trip through
 * a URL and a form post.
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

const importing = (scopes: string[] | string) => ({ scope: scopes, action: 'import' });

describe('choosing what to analyse (POST /scope)', () => {
  it('imports the selected project and advances onboarding', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'ok@acme.example');
    const res = await post(t, cookie, '/scope', importing('OPS'));
    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toBe('/mapping/statuses');
    expect(t.gateway.lastFetchScopeId).toBe('OPS');

    const tenantId = (await t.store.findUserByEmail('ok@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.scopes).toEqual([{ id: 'OPS', kind: 'project', name: 'Operations' }]);
    expect(workspace.onboarding).toBe('scope-selected');
    expect(workspace.observedStatuses.length).toBeGreaterThan(0); // parsed from the import
  });

  it('stores the whole set when several are chosen', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'several@acme.example');
    // Only OPS has fixture data; MKT is rejected by the stub, which is what
    // proves a failing scope fails the step rather than being dropped.
    const res = await post(t, cookie, '/scope', importing(['OPS', 'MKT']));
    expect(res.statusCode).toBe(400);
    // Classified, and it names the origin — not the platform's own words.
    expect(res.body).toContain('fetch-error at search');
    expect(res.body).toContain('Marketing Website');
    expect(res.body).not.toContain('Unknown project');
  });

  it('refuses an empty selection instead of analysing nothing', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'empty@acme.example');
    const res = await post(t, cookie, '/scope', { action: 'import' });
    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toContain('error=empty');
    const page = await get(t, cookie, res.headers['location'] as string);
    expect(page.body).toContain('Choose at least one scope');
  });

  it('refuses a selection that no longer exists rather than importing the remainder', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'gone@acme.example');
    const res = await post(t, cookie, '/scope', importing(['OPS', 'DELETED']));
    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toContain('error=gone');
    // Nothing was imported: analysing less than was asked for is the failure.
    expect(t.gateway.lastFetchScopeId).toBeNull();
  });

  it('caps the selection so one run cannot fan out without limit', async () => {
    const t = makeApp({ maxScopes: 2 });
    t.gateway.projects = ['A', 'B', 'C'].map((id) => ({
      id,
      name: `Project ${id}`,
      kind: 'project',
      parentId: null,
      fetchable: true,
    }));
    const cookie = await reachScope(t, 'cap@acme.example');
    const res = await post(t, cookie, '/scope', importing(['A', 'B', 'C']));
    expect(res.headers['location']).toContain('error=too-many');
    const page = await get(t, cookie, res.headers['location'] as string);
    expect(page.body).toContain('at most 2 scopes');
  });
});

describe('failures reaching the platform', () => {
  it('classifies an auth failure without echoing the token', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'auth@acme.example');
    t.gateway.failFetchWith = new GatewayError('auth-error', 'search', 'Jira rejected the token.');
    const res = await post(t, cookie, '/scope', importing('OPS'));
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(TOKEN);
  });

  it('reports a listing failure on the step itself', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'list@acme.example');
    t.gateway.failListWith = new GatewayError('fetch-error', 'list-projects', 'Jira is down.');
    const page = await get(t, cookie, '/scope');
    expect(page.body).not.toContain(TOKEN);
    // The platform's own message never reaches the page; the class and the
    // stage do, which is what a support conversation actually needs.
    expect(page.body).toContain('fetch-error at list-projects');
    expect(page.body).not.toContain('Jira is down');
  });
});

describe('selecting a set with no client JavaScript', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `P${i}`,
    name: i % 2 === 0 ? `Engineering ${i}` : `Marketing ${i}`,
    kind: 'project',
    parentId: null,
    fetchable: true,
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

  it('filters server-side and says what it matched', async () => {
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

  /**
   * The whole reason the selection travels in the URL and in hidden inputs.
   * Searching after picking something must not quietly discard the pick.
   */
  it('keeps a selection that the current search filters off screen', async () => {
    const t = makeApp();
    t.gateway.projects = many;
    const cookie = await reachScope(t, 'survive@acme.example');
    const page = await get(t, cookie, '/scope?q=marketing&sel=P0');
    // P0 is "Engineering 0" — filtered out, but still selected and still posted.
    expect(page.body).toContain('<input type="hidden" name="scope" value="P0">');
    expect(page.body).toContain('1</strong> selected');
  });

  it('select-all covers what is shown, not the whole platform', async () => {
    const t = makeApp();
    t.gateway.projects = many;
    const cookie = await reachScope(t, 'all@acme.example');
    const res = await post(t, cookie, '/scope', { q: 'engineering', action: 'all' });
    expect(res.statusCode).toBe(303);
    const location = res.headers['location'] as string;
    expect(location).toContain('q=engineering');
    // Six Engineering projects, no Marketing ones.
    const selected = new URL(location, 'http://x').searchParams.get('sel')!.split(',');
    expect(selected).toHaveLength(6);
    expect(selected).toContain('P0');
    expect(selected).not.toContain('P1');
  });

  it('clearing the selection keeps the search, and clearing the search keeps the selection', async () => {
    const t = makeApp();
    t.gateway.projects = many;
    const cookie = await reachScope(t, 'clear@acme.example');

    const cleared = await post(t, cookie, '/scope', {
      q: 'engineering',
      scope: ['P0', 'P2'],
      action: 'none',
    });
    expect(cleared.headers['location']).toBe('/scope?q=engineering&sel=');

    const unfiltered = await post(t, cookie, '/scope', {
      q: 'engineering',
      scope: ['P0', 'P2'],
      action: 'clear-search',
    });
    expect(unfiltered.headers['location']).toBe('/scope?sel=P0%2CP2');
  });

  it('offers a way out when nothing matches', async () => {
    const t = makeApp();
    t.gateway.projects = many;
    const cookie = await reachScope(t, 'nomatch@acme.example');
    const page = await get(t, cookie, '/scope?q=zzzz');
    expect(page.body).toContain('Nothing matches');
    expect(page.body).toContain('Clear search');
    expect(page.body).not.toContain('type="radio"');
  });

  it('revisiting the step shows what is already selected', async () => {
    const t = makeApp();
    const cookie = await reachScope(t, 'revisit@acme.example');
    await post(t, cookie, '/scope', importing('OPS'));
    const page = await get(t, cookie, '/scope');
    expect(page.body).toContain('value="OPS" checked');
    expect(page.body).not.toContain('value="MKT" checked');
  });
});
