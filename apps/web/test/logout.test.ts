import { describe, expect, it } from 'vitest';
import { TOKEN, get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * P4.2 defect fix: the authenticated UI must expose a reachable, CSRF-safe
 * sign-out control on the shared navigation (doc 09 P4.2 Gate 2). These tests
 * drive it through the rendered page, using the token the UI actually emits.
 */

function csrfFromHtml(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('no csrf token rendered on the page');
  return match[1] as string;
}

async function connectOnly(t: TestApp, email: string): Promise<string> {
  const cookie = await signIn(t, email);
  await post(t, cookie, '/connect', {
    site: 'https://acme.atlassian.net',
    email,
    token: TOKEN,
  });
  return cookie;
}

describe('authenticated sign-out control (doc 09 P4.2 Gate 2 fix)', () => {
  it('is present in the shared header on the connect and runs pages (and onboarding steps)', async () => {
    const t = makeApp();
    const cookie = await connectOnly(t, 'nav@acme.example');
    for (const url of ['/connect', '/runs', '/scope']) {
      const page = await get(t, cookie, url);
      expect(page.statusCode, url).toBe(200);
      // Correct form method + action (a real submittable POST control).
      expect(page.body, `${url} exposes a POST /logout form`).toMatch(
        /<form[^>]*method="post"[^>]*action="\/logout"|<form[^>]*action="\/logout"[^>]*method="post"/i,
      );
      expect(page.body, `${url} shows Sign out`).toContain('Sign out');
      // The control carries a CSRF token (never a tokenless POST target).
      expect(
        /action="\/logout"[\s\S]*name="csrf"|name="csrf"[\s\S]*action="\/logout"/.test(page.body),
      ).toBe(true);
    }
  });

  it('is present on every deeper onboarding page and the dashboard', async () => {
    const t = makeApp();
    const cookie = await connectOnly(t, 'deep@acme.example');
    await post(t, cookie, '/scope', { project: '0' });
    await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
    await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
    await post(t, cookie, '/assumptions', {
      rate0: '120',
      rate1: '90',
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
    for (const url of ['/mapping/statuses', '/mapping/actors', '/assumptions', '/dashboard']) {
      const page = await get(t, cookie, url);
      expect(page.statusCode, url).toBe(200);
      expect(page.body, `${url} exposes a logout form`).toContain('action="/logout"');
    }
  });

  it('the public sign-in page has NO sign-out control', async () => {
    const t = makeApp();
    const login = await get(t, await signIn(t, 'x@y.example'), '/'); // authed redirect target
    // The dev /login page itself (unauthenticated) uses no layout header.
    const raw = await t.app.inject({ method: 'GET', url: '/login' });
    expect(raw.body).not.toContain('action="/logout"');
    expect(login.statusCode).toBe(302);
  });

  it('submitting the rendered control logs out: 302 → /login and the session is terminated', async () => {
    const t = makeApp();
    const cookie = await connectOnly(t, 'flow@acme.example');

    // Use the EXACT token the UI rendered — proves the real control works.
    const connectPage = await get(t, cookie, '/connect');
    const token = csrfFromHtml(connectPage.body);

    const logout = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: `csrf=${encodeURIComponent(token)}`,
    });
    expect(logout.statusCode).toBe(302);
    // Lands on the neutral page, NOT /login (which would re-trigger OIDC).
    expect(logout.headers['location']).toBe('/logged-out');

    // Session terminated: the cleared cookie no longer authenticates.
    const cleared = String(logout.headers['set-cookie']);
    expect(cleared).toContain('cf_session=');
    const after = await t.app.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: 'cf_session=' },
    });
    expect(after.statusCode).toBe(302);
    expect(after.headers['location']).toBe('/login');
  });

  it('unauthenticated access: protected pages redirect to /login and POST /logout is harmless', async () => {
    const t = makeApp();
    // No session: a protected page redirects to sign-in (no logout control seen).
    const protectedPage = await t.app.inject({ method: 'GET', url: '/connect' });
    expect(protectedPage.statusCode).toBe(302);
    expect(protectedPage.headers['location']).toBe('/login');
    // POST /logout with no session simply redirects to /logged-out (no crash).
    const logout = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(logout.statusCode).toBe(302);
    expect(logout.headers['location']).toBe('/logged-out');
    // The landing page is public, renders, and carries no logout control.
    const landing = await t.app.inject({ method: 'GET', url: '/logged-out' });
    expect(landing.statusCode).toBe(200);
    expect(landing.body).toContain('signed out');
    expect(landing.body).not.toContain('action="/logout"');
  });

  it('CSRF is still enforced — a forged/missing token cannot log a session out', async () => {
    const t = makeApp();
    const cookie = await connectOnly(t, 'csrf@acme.example');
    const forged = await t.app.inject({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: 'csrf=not-the-real-token',
    });
    expect(forged.statusCode).toBe(403);
    // The session still works after the rejected forgery.
    const still = await get(t, cookie, '/connect');
    expect(still.statusCode).toBe(200);
  });
});
