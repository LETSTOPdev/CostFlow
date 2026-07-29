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
    expect(res.body).toContain('property="og:image" content="https://app.fbx1.com/og.jpg?v=2"');
    expect(res.body).toContain('property="og:image:width" content="1200"');
    expect(res.body).toContain('property="og:image:height" content="630"');
    expect(res.body).toContain('name="twitter:card" content="summary_large_image"');
    expect(res.body).toContain('name="twitter:image" content="https://app.fbx1.com/og.jpg?v=2"');
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

  it('shows the brand lockup in the header on public and app pages', async () => {
    const t = makeApp();
    const landing = await t.app.inject({ method: 'GET', url: '/' });
    // Light-theme-only product: always the ink-on-light wordmark, icon on
    // compact viewports (official assets).
    expect(landing.body).toContain('src="/brand/logo-light.png"');
    expect(landing.body).toContain('srcset="/brand/icon-192.png"');
  });

  it('serves the favicon set, brand PNGs, and web manifest', async () => {
    const t = makeApp();
    for (const [url, type] of [
      ['/favicon.ico', 'image/x-icon'],
      ['/brand/icon-192.png', 'image/png'],
      ['/brand/icon-512.png', 'image/png'],
      ['/brand/logo-dark.png', 'image/png'],
      ['/brand/logo-light.png', 'image/png'],
      ['/site.webmanifest', 'application/manifest+json'],
    ] as const) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain(type);
      expect(String(res.headers['cache-control'])).toContain('max-age');
      expect(res.rawPayload.length).toBeGreaterThan(200); // real asset, not a stub
    }
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

describe('SEO + canonical host', () => {
  it('serves robots.txt and sitemap.xml pointing at the canonical host', async () => {
    const { makeApp } = await import('./helpers');
    const t = makeApp();
    const robots = await t.app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['content-type']).toContain('text/plain');
    expect(robots.body).toContain('Sitemap: https://app.fbx1.com/sitemap.xml');
    expect(robots.body).toContain('Disallow: /try/report');
    expect(robots.body).toContain('Disallow: /admin');
    const sitemap = await t.app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemap.statusCode).toBe(200);
    expect(sitemap.headers['content-type']).toContain('xml');
    expect(sitemap.body).toContain('<loc>https://app.fbx1.com/</loc>');
    expect(sitemap.body).toContain('<loc>https://app.fbx1.com/try</loc>');
  });

  it('landing carries canonical + JSON-LD structured data', async () => {
    const { makeApp } = await import('./helpers');
    const res = await makeApp().app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('<link rel="canonical" href="https://app.fbx1.com/">');
    expect(res.body).toContain('application/ld+json');
    expect(res.body).toContain('SoftwareApplication');
    expect(res.body).toContain('FAQPage');
  });

  it('points canonical, og and structured data at the marketing origin', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    const res = await t.app.inject({ method: 'GET', url: '/', headers: { host: 'fbx1.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<link rel="canonical" href="https://fbx1.com/">');
    expect(res.body).toContain('<meta property="og:url" content="https://fbx1.com/">');
    expect(res.body).toContain('"@id":"https://fbx1.com/#org"');
    // The application host must not appear as the home of the public site.
    expect(res.body).not.toContain('canonical" href="https://app.fbx1.com');
  });

  it('serves one sitemap, on the marketing host, listing marketing URLs', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    const xml = await t.app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { host: 'fbx1.com' },
    });
    expect(xml.statusCode).toBe(200);
    expect(xml.body).toContain('<loc>https://fbx1.com/pricing</loc>');
    expect(xml.body).not.toContain('app.fbx1.com');
    // On the application host it moves rather than duplicating.
    const moved = await t.app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { host: 'app.fbx1.com' },
    });
    expect(moved.statusCode).toBe(301);
    expect(moved.headers['location']).toBe('https://fbx1.com/sitemap.xml');
  });

  /**
   * The application host stays crawlable on purpose. Every marketing URL is
   * currently indexed under app.fbx1.com, and a crawler forbidden to fetch one
   * cannot see the 301 that would move it — the old URL would sit there stale
   * instead of transferring.
   */
  it('keeps the application host crawlable so its redirects transfer', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    const robots = await t.app.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { host: 'app.fbx1.com' },
    });
    expect(robots.statusCode).toBe(200);
    expect(robots.body).not.toMatch(/^Disallow: \/$/m);
    expect(robots.body).toContain('Disallow: /dashboard');
    // One sitemap, declared once, on the host that owns the public pages.
    expect(robots.body).not.toContain('Sitemap:');
    const marketing = await t.app.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { host: 'fbx1.com' },
    });
    expect(marketing.body).toContain('Sitemap: https://fbx1.com/sitemap.xml');
  });
});

/**
 * The split as a customer meets it: marketing on one host, the product on the
 * other, and every way in pointing at the right one.
 */
describe('the marketing site and the application are separate hosts', () => {
  it('every public page answers on the marketing host', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const { MARKETING_PATHS } = await import('../src/site');
    const t = makeApp({ site: SPLIT_SITE });
    for (const path of ['/', ...MARKETING_PATHS]) {
      const res = await t.app.inject({ method: 'GET', url: path, headers: { host: 'fbx1.com' } });
      expect(res.statusCode, `fbx1.com${path}`).toBe(200);
    }
  });

  /**
   * The entrance to the product, not a login gateway. Someone arriving from a
   * colleague's shared report link has never seen the marketing site, and
   * "Create account" is a bigger ask than a wordmark and two buttons can carry.
   */
  it('says what the product is before it asks a signed-out visitor for anything', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    const res = await t.app.inject({ method: 'GET', url: '/', headers: { host: 'app.fbx1.com' } });
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

    // Not the landing page rendered twice.
    expect(res.body).not.toContain('Know the one thing to fix');
    // A route back to the marketing site, and to a report needing no account.
    expect(res.body).toContain('href="https://fbx1.com/"');
    expect(res.body).toContain('href="https://fbx1.com/demo"');
    // Never indexed: it is an application door, not a page.
    expect(res.body).toContain('noindex');
  });

  /**
   * Founder decision, 2026-07-29: the sample reports are part of the evaluation
   * experience, so they live with the marketing site rather than the product.
   * `/try/report` matters most — it is the one a prospect reaches by generating
   * a company, and a redirect mid-evaluation is where they would drop out.
   */
  it('keeps the whole evaluation experience on the marketing host', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    for (const path of ['/demo', '/try', '/try/report']) {
      const onMarketing = await t.app.inject({
        method: 'GET',
        url: path,
        headers: { host: 'fbx1.com' },
      });
      expect(onMarketing.statusCode, `fbx1.com${path}`).toBe(200);
      const onApp = await t.app.inject({
        method: 'GET',
        url: path,
        headers: { host: 'app.fbx1.com' },
      });
      expect(onApp.statusCode, `app.fbx1.com${path}`).toBe(301);
      expect(onApp.headers['location']).toBe(`https://fbx1.com${path}`);
    }
  });

  it('sends every sign-in and get-started CTA to the application host', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    for (const path of ['/', '/pricing', '/docs', '/demo']) {
      const res = await t.app.inject({ method: 'GET', url: path, headers: { host: 'fbx1.com' } });
      const body = res.body;
      // Every auth link is absolute to the app, and none is left relative.
      expect(body, `${path} sign-in`).toContain('href="https://app.fbx1.com/login"');
      expect(body, `${path} relative /login`).not.toContain('href="/login"');
      expect(body, `${path} relative /signup`).not.toContain('href="/signup"');
    }
    const pricing = await t.app.inject({
      method: 'GET',
      url: '/pricing',
      headers: { host: 'fbx1.com' },
    });
    expect(pricing.body).toContain('href="https://app.fbx1.com/signup"');
  });

  it('keeps every marketing link on the marketing host', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    const res = await t.app.inject({
      method: 'GET',
      url: '/pricing',
      headers: { host: 'fbx1.com' },
    });
    expect(res.body).toContain('href="https://fbx1.com/docs"');
    expect(res.body).toContain('href="https://fbx1.com/terms"');
  });

  it('leaves authentication entirely on the application host', async () => {
    const { makeApp, SPLIT_SITE } = await import('./helpers');
    const t = makeApp({ site: SPLIT_SITE });
    // The auth routes are app-owned, so the marketing host hands them over
    // rather than serving a second copy on a second origin.
    for (const path of ['/login', '/signup', '/auth/callback', '/logged-out']) {
      const res = await t.app.inject({ method: 'GET', url: path, headers: { host: 'fbx1.com' } });
      expect(res.statusCode, `fbx1.com${path}`).toBe(301);
      expect(res.headers['location']).toBe(`https://app.fbx1.com${path}`);
    }
  });
});

/**
 * The acquisition path, checked by the cold-start walkthrough ritual
 * (`docs/09-ai-context.md` §3).
 *
 * These are not defects a test would have found on its own. They are what an
 * executive meets before they trust anything: a vocabulary that has to match
 * the product they are about to use, and a pitch that has to name the thing the
 * product is actually best at.
 */
describe('what the landing page promises', () => {
  const publicPages = ['/', '/pricing', '/docs'];

  /**
   * The landing page taught "Blocked → stalled". There is no `stalled` stage
   * kind — the six are queue, active, review, blocked, done, abandoned — so a
   * prospect learned a word the product would never show them again, and the
   * docs listed a four-kind set that invented one and omitted two.
   */
  it('never shows a stage kind that does not exist', async () => {
    const t = await makeApp();
    for (const url of publicPages) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      // The word may appear as plain English ("stalled work"), never as a
      // mapping target or a member of the stage list.
      expect(res.body, url).not.toMatch(/→\s*<i[^>]*>stalled/);
      expect(res.body, url).not.toMatch(/stages \([^)]*stalled/);
    }
  });

  /**
   * The strongest thing the product does is say what to fix first, and the
   * entire acquisition path sold measurement: "ranked cost report", with no
   * occurrence of the word anywhere before signup.
   */
  it('promises the decision, not only the measurement', async () => {
    const t = await makeApp();
    const landing = await t.app.inject({ method: 'GET', url: '/' });
    // The promise is the decision; the money is what justifies it (D22).
    expect(landing.body).toContain('Know the one thing to fix');
    expect(landing.body).toContain('the highest-leverage change');
    // And the product screenshot mirrors the real report's order: action
    // first, evidence second, ranked list last.
    const act = landing.body.indexOf('Highest-leverage action');
    const evidence = landing.body.indexOf('The evidence');
    const ranked = landing.body.indexOf('Ranked frictions');
    expect(act).toBeGreaterThan(-1);
    expect(act).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(ranked);
  });
});

/**
 * Launch readiness: the public surface must not promise what is not built.
 *
 * Every other empty page on this site says it is empty — /careers says it is
 * not hiring, /changelog says nothing has shipped, /blog says the posts are
 * unwritten. Pricing and Documentation were the two that did not hold that
 * line, and they are the two a design partner reads before deciding whether to
 * connect their company's Jira.
 */
describe('the public surface does not over-promise', () => {
  it('says on the pricing page that billing does not exist yet', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/pricing' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('billing is not built yet');
    // The prices and tiers are unchanged; only their availability is stated.
    expect(res.body).toContain('$20 / user / month');
    expect(res.body).toContain('$100 / user / month');
  });

  it('marks every unbuilt plan feature as planned', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/pricing' });
    // Each of these is listed against a paid tier and does not exist.
    for (const feature of [
      'CSV and raw JSON export on every report',
      'Multiple workspaces per organization',
      'SSO / SAML sign-in for your whole org',
      'Audit logs across workspaces and members',
    ]) {
      const at = res.body.indexOf(feature);
      expect(at, `${feature} is no longer on the pricing page`).toBeGreaterThan(-1);
      expect(res.body.slice(at, at + 200), `${feature} is not marked planned`).toContain('planned');
    }
  });

  it('never claims a machine-readable export it cannot produce', async () => {
    const t = makeApp();
    for (const url of ['/faq', '/docs']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body, `${url} offers JSON export`).not.toMatch(
        /export any report as raw JSON|can be exported as raw JSON/,
      );
    }
  });

  /**
   * /docs was eight section titles describing documents that did not exist.
   * The check is for substance rather than exact wording: the things a stuck
   * customer would actually be looking for.
   */
  it('documents the product rather than listing chapter titles', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    // The word the whole product is denominated in, defined.
    expect(res.body).toContain('A <strong>friction</strong> is');
    // The capability that decides whether ClickUp wait analysis works at all.
    expect(res.body).toContain('Total Time in Status');
    // What the confidence tiers mean, not just that they exist.
    expect(res.body).toContain('demonstrated in your event history');
    // The refusals, which are most of what loses a reader's trust unexplained.
    expect(res.body).toContain('When CostFlow refuses to answer');
  });

  it('says on the security page that assignee names are stored', async () => {
    const t = makeApp();
    for (const url of ['/security', '/privacy']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.body, `${url} omits stored names`).toMatch(/assignee names/i);
    }
  });

  it('does not imply an API that does not exist', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/privacy' });
    expect(res.body).not.toContain('API response');
  });
});
