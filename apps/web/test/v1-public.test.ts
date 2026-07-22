import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_KEY,
  SESSION_KEY,
  StubJiraGateway,
  cookieOf,
  get,
  makeApp,
  signIn,
} from './helpers';
import { buildServer } from '../src/server';
import { MemoryStore } from '../src/store/memory';

/**
 * v1 (free public beta): the public marketing landing, the no-login demo
 * report, Terms/Privacy, and the founder-only activation-funnel page. Nothing
 * here touches the deterministic engine.
 */

describe('v1 public pages', () => {
  it('serves the marketing landing at / with a CTA, FAQ, and legal links', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Get started free');
    expect(res.body).toContain('FAQ');
    expect(res.body).toContain('/terms');
    expect(res.body).toContain('/privacy');
    expect(res.body).toContain('/demo');
  });

  it('carries complete social-sharing metadata with absolute HTTPS asset URLs', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('property="og:type" content="website"');
    expect(res.body).toContain('property="og:url" content="https://app.fbx1.com/"');
    expect(res.body).toContain('property="og:title"');
    expect(res.body).toContain('property="og:description"');
    expect(res.body).toContain('property="og:image" content="https://app.fbx1.com/og.jpg"');
    expect(res.body).toContain('property="og:image:width" content="1200"');
    expect(res.body).toContain('property="og:image:height" content="630"');
    expect(res.body).toContain('name="twitter:card" content="summary_large_image"');
    expect(res.body).toContain('name="twitter:image" content="https://app.fbx1.com/og.jpg"');
    expect(res.body).toContain('rel="icon"');
    expect(res.body).toContain('rel="apple-touch-icon"');
    expect(res.body).toContain('name="theme-color"');
  });

  it('serves the Open Graph card and apple-touch-icon as cacheable images', async () => {
    const t = makeApp();
    const og = await t.app.inject({ method: 'GET', url: '/og.jpg' });
    expect(og.statusCode).toBe(200);
    expect(og.headers['content-type']).toContain('image/jpeg');
    expect(String(og.headers['cache-control'])).toContain('max-age');
    expect(og.rawPayload.length).toBeGreaterThan(10_000); // a real image, not a stub
    expect(og.rawPayload.length).toBeLessThan(300_000); // stays under WhatsApp's reliable limit
    const icon = await t.app.inject({ method: 'GET', url: '/apple-touch-icon.png' });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['content-type']).toContain('image/png');
    expect(icon.rawPayload.length).toBeGreaterThan(1_000);
  });

  it('serves the CostFlow brand logo publicly for Auth0 to use', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/brand/logo.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('CostFlow'); // aria-label
    expect(String(res.headers['cache-control'])).toContain('max-age');
  });

  it('shows the brand mark in the header on public and app pages', async () => {
    const t = makeApp();
    const landing = await t.app.inject({ method: 'GET', url: '/' });
    expect(landing.body).toContain('viewBox="0 0 120 120"'); // header mark
  });

  it('serves Terms and Privacy publicly (no session)', async () => {
    const t = makeApp();
    const terms = await t.app.inject({ method: 'GET', url: '/terms' });
    expect(terms.statusCode).toBe(200);
    expect(terms.body).toContain('Terms of Service');
    const privacy = await t.app.inject({ method: 'GET', url: '/privacy' });
    expect(privacy.statusCode).toBe(200);
    expect(privacy.body).toContain('Privacy');
    expect(privacy.body).toContain('pseudonymized');
  });

  it('renders the demo report from the snapshot, publicly, with the golden figures', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('sample report');
    // Same P1 hand-computed figures the engine froze — proves the structured
    // view renders real artifact data with no login.
    expect(res.body).toContain('1,062');
    expect(res.body).toContain('Ranked frictions');
    expect(res.body).toContain('Confidence');
    expect(res.body).toContain('/login'); // sign-in CTA
    // No raw individual identity in the public sample.
    expect(res.body).not.toContain('Guy Contractor');
  });
});

describe('v1 activation-funnel analytics', () => {
  it('counts distinct organizations reaching each stage (aggregate, no identities)', async () => {
    const store = new MemoryStore();
    // Org A: signs up, connects, runs, views a report.
    const a = (await store.createTenantWithUser('a@f.example', 's')).tenant;
    const wsA = await store.createWorkspace(a.id, {
      provider: 'jira',
      site: 'https://a.example',
      email: 'a@f.example',
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
      site: 'https://b.example',
      email: 'b@f.example',
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
      gateway: new StubJiraGateway(),
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
    const res = await t.app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Activation funnel');
    expect(res.body).toContain('Signed up');
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
