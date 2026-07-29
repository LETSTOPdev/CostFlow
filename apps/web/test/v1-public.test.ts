import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_KEY,
  SESSION_KEY,
  cookieOf,
  get,
  makeApp,
  signIn,
  stubConnectors,
} from './helpers';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory';
import { MARKETING_PATHS } from '@costflow/ui';

/**
 * What the application host serves without a session: the entrance, the shared
 * brand assets, and a 301 for every public URL that now lives on the marketing
 * site. The public pages themselves are tested where they are built, in
 * `apps/marketing`.
 */

describe('the application entrance', () => {
  /**
   * Not a login gateway. Someone arriving from a colleague's shared report link
   * has never seen the marketing site, and "Create account" is a bigger ask
   * than a wordmark and two buttons can carry.
   */
  it('says what the product is before it asks a signed-out visitor for anything', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);

    // The value statement comes before the buttons, not under them. Anchored on
    // the panel's own markup, because the shared header carries a "Sign in" link
    // of its own further up the page.
    const value = res.body.indexOf('highest-leverage change');
    const signInButton = res.body.indexOf('class="btn btn-lg" href="/login"');
    expect(value).toBeGreaterThan(-1);
    expect(signInButton).toBeGreaterThan(-1);
    expect(value).toBeLessThan(signInButton);
    expect(res.body).toContain('Know what to fix first');
    expect(res.body).toContain('Create account');
    // What signing in commits them to, where they decide.
    expect(res.body).toContain('nothing is ever written back');

    // Not the landing page rendered here as well.
    expect(res.body).not.toContain('Know the one thing to fix');
    // A route back to the marketing site, and to a report needing no account.
    expect(res.body).toContain('href="https://fbx1.com/"');
    expect(res.body).toContain('href="https://fbx1.com/demo"');
    // Never indexed: it is an application door, not a page.
    expect(res.body).toContain('noindex');
  });

  it('sends every marketing link in the shell to the marketing site', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('href="https://fbx1.com/pricing"');
    expect(res.body).toContain('href="https://fbx1.com/terms"');
    // Never a relative one, which would 301 away on the next click.
    expect(res.body).not.toContain('href="/pricing"');
  });
});

/**
 * Every public URL was served here for months, so it is indexed, bookmarked and
 * pasted into chat threads. A 301 transfers all of it. The rule is
 * one-directional — this host redirects only what it does not own, toward a
 * host with no rule sending it back — so no redirect can loop.
 */
describe('public URLs move to the marketing site', () => {
  it('301s every marketing path, and follows in exactly one hop', async () => {
    const t = makeApp();
    for (const path of MARKETING_PATHS) {
      const res = await t.app.inject({ method: 'GET', url: path });
      expect(res.statusCode, `app.fbx1.com${path}`).toBe(301);
      expect(res.headers['location']).toBe(`https://fbx1.com${path}`);
    }
  });

  it('301s the sample reports, which are part of the evaluation experience', async () => {
    const t = makeApp();
    for (const path of ['/demo', '/try', '/try/report?seed=42']) {
      const res = await t.app.inject({ method: 'GET', url: path });
      expect(res.statusCode, `app.fbx1.com${path}`).toBe(301);
      expect(res.headers['location']).toBe(`https://fbx1.com${path}`);
    }
  });

  it('never redirects / — the one path both hosts own', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
  });

  it('never redirects authentication, which stays entirely on this host', async () => {
    const t = makeApp();
    for (const path of ['/login', '/logged-out']) {
      const res = await t.app.inject({ method: 'GET', url: path });
      expect(res.statusCode, `${path} was redirected off the application host`).not.toBe(301);
    }
  });
});

/**
 * Shared assets answer identically on both hosts and must never redirect: the
 * identity provider's login page fetches the logo from THIS origin, and the
 * platform's health probes arrive without a recognisable Host.
 */
describe('shared brand assets', () => {
  it('serves the CostFlow brand logo publicly for Auth0 to use', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/brand/logo.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('CostFlow'); // aria-label
    expect(String(res.headers['cache-control'])).toContain('max-age');
  });

  it('serves the favicon set, brand PNGs, web manifest and social card', async () => {
    const t = makeApp();
    for (const [url, type] of [
      ['/favicon.ico', 'image/x-icon'],
      ['/brand/icon-192.png', 'image/png'],
      ['/brand/icon-512.png', 'image/png'],
      ['/brand/logo-dark.png', 'image/png'],
      ['/brand/logo-light.png', 'image/png'],
      ['/site.webmanifest', 'application/manifest+json'],
      ['/apple-touch-icon.png', 'image/png'],
    ] as const) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain(type);
      expect(String(res.headers['cache-control'])).toContain('max-age');
      expect(res.rawPayload.length).toBeGreaterThan(200); // real asset, not a stub
    }
    const og = await t.app.inject({ method: 'GET', url: '/og.jpg' });
    expect(og.statusCode).toBe(200);
    expect(og.headers['content-type']).toContain('image/jpeg');
    expect(og.rawPayload.length).toBeGreaterThan(10_000); // a real image, not a stub
    expect(og.rawPayload.length).toBeLessThan(300_000); // under WhatsApp's reliable limit
  });

  it('shows the brand lockup in the header on application pages', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('src="/brand/logo-light.png"');
    expect(res.body).toContain('srcset="/brand/icon-192.png"');
  });
});

/**
 * The application host stays crawlable on purpose. Every public URL was indexed
 * under app.fbx1.com, and a crawler forbidden to fetch one cannot see the 301
 * that would move it — the old URL would sit there stale instead of
 * transferring.
 */
describe('robots.txt on the application host', () => {
  it('disallows only what is genuinely private, and declares no sitemap', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).not.toMatch(/^Disallow: \/$/m);
    expect(res.body).toContain('Disallow: /dashboard');
    expect(res.body).toContain('Disallow: /admin');
    // One sitemap, declared once, on the host that owns the public pages.
    expect(res.body).not.toContain('Sitemap:');
  });
});

describe('v1 activation-funnel analytics', () => {
  it('counts distinct organizations reaching each stage (aggregate, no identities)', async () => {
    const store = new MemoryStore();
    // Org A: signs up, connects, runs, views a report.
    const a = (await store.createTenantWithUser('a@f.example', 's')).tenant;
    const wsA = await store.createWorkspace(a.id, {
      provider: 'jira',
      connectionParams: { site: 'https://a.example', email: 'a@f.example' },
      tokenCiphertext: 'tok',
    });
    await store.createRun({
      id: 'run-a',
      tenantId: a.id,
      workspaceId: wsA.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson: '{}',
      reportMd: '# r',
      telemetryJsonl: '',
    });
    await store.markRunViewed(a.id, 'run-a', '2026-07-20T01:00:00Z');
    // Org B: signs up and connects only.
    const b = (await store.createTenantWithUser('b@f.example', 's')).tenant;
    await store.createWorkspace(b.id, {
      provider: 'jira',
      connectionParams: { site: 'https://b.example', email: 'b@f.example' },
      tokenCiphertext: 'tok',
    });
    // Org C: signs up only.
    await store.createTenantWithUser('c@f.example', 's');

    expect(await store.funnelStats()).toEqual({
      organizations: 3,
      connectedWorkspaces: 2,
      analysesRun: 1,
      reportsViewed: 1,
    });
  });
});

describe('v1 founder admin page', () => {
  function appWithAdmins(adminEmails: string[]) {
    const store = new MemoryStore();
    const app = buildServer({
      store,
      connectors: stubConnectors(),
      auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
      telemetry: () => undefined,
      adminEmails,
    });
    return { app, store };
  }

  it('shows the funnel to an allow-listed founder', async () => {
    const t = appWithAdmins(['founder@fbx1.com']);
    const login = await t.app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=founder@fbx1.com',
    });
    const cookie = cookieOf(login, 'cf_session');
    // P4.5 moved the funnel off the overview onto its own page, where it gained
    // per-step conversion, drop-off, and time-to-next-step.
    const res = await t.app.inject({ method: 'GET', url: '/admin/funnel', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Onboarding funnel');
    expect(res.body).toContain('Signed up');
    const overview = await t.app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.body).toContain('Growth');
  });

  it('404s a non-admin authenticated user (no disclosure)', async () => {
    const t = makeApp({ adminEmails: ['founder@fbx1.com'] });
    const cookie = await signIn(t, 'stranger@acme.example');
    const res = await get(t, cookie, '/admin');
    expect(res.statusCode).toBe(404);
  });

  it('redirects an unauthenticated visitor to sign-in', async () => {
    const t = makeApp({ adminEmails: ['founder@fbx1.com'] });
    const res = await t.app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});
