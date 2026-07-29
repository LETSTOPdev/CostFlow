import { describe, expect, it } from 'vitest';
import { APP_PATH_PREFIXES, MARKETING_PATHS } from '@costflow/ui';
import { PRERENDERED, notFoundPage, robotsTxt, sitemapXml } from '../src/routes';
import { renderTryReportPage } from '../src/try-pages';

/**
 * The public site: the landing, the sample report, the trust and company
 * pages, and the SEO surface. Nothing here touches the deterministic engine
 * except through the sample artifact, and nothing here has a session — which is
 * why every one of these pages is a file on a CDN rather than a request to a
 * server.
 */

const pages = new Map(PRERENDERED.map((p) => [p.path, p.render]));
const render = (path: string): string => {
  const page = pages.get(path);
  if (!page) throw new Error(`No page is registered at ${path}`);
  return page();
};

describe('the public pages', () => {
  it('serves the marketing landing at / with a CTA, FAQ, and legal links', () => {
    const body = render('/');
    expect(body).toContain('Get started free');
    expect(body).toContain('FAQ');
    expect(body).toContain('/terms');
    expect(body).toContain('/privacy');
    expect(body).toContain('/demo');
  });

  it('carries complete social-sharing metadata with absolute HTTPS asset URLs', () => {
    const body = render('/');
    expect(body).toContain('property="og:type" content="website"');
    expect(body).toContain('property="og:url" content="https://fbx1.com/"');
    expect(body).toContain('property="og:title"');
    expect(body).toContain('property="og:description"');
    expect(body).toContain('property="og:image" content="https://fbx1.com/og.jpg?v=2"');
    expect(body).toContain('property="og:image:width" content="1200"');
    expect(body).toContain('property="og:image:height" content="630"');
    expect(body).toContain('name="twitter:card" content="summary_large_image"');
    expect(body).toContain('name="twitter:image" content="https://fbx1.com/og.jpg?v=2"');
    expect(body).toContain('rel="icon"');
    expect(body).toContain('rel="apple-touch-icon"');
    expect(body).toContain('name="theme-color"');
  });

  it('shows the brand lockup in the header', () => {
    // Light-theme-only product: always the ink-on-light wordmark, icon on
    // compact viewports (official assets).
    const body = render('/');
    expect(body).toContain('src="/brand/logo-light.png"');
    expect(body).toContain('srcset="/brand/icon-192.png"');
  });

  it('serves Terms and Privacy', () => {
    expect(render('/terms')).toContain('Terms of Service');
    const privacy = render('/privacy');
    expect(privacy).toContain('Privacy');
    expect(privacy).toContain('pseudonymized');
  });

  it('renders the demo report from the snapshot with the golden figures', () => {
    const body = render('/demo');
    expect(body).toContain('sample report');
    // Same P1 hand-computed figures the engine froze — proves the structured
    // view renders real artifact data with no login.
    expect(body).toContain('1,062');
    expect(body).toContain('Ranked frictions');
    expect(body).toContain('Confidence');
    expect(body).toContain('/login'); // sign-in CTA
    // No raw individual identity in the public sample.
    expect(body).not.toContain('Guy Contractor');
  });
});

/**
 * The two hosts, as a customer meets them: marketing here, the product there,
 * and every way in pointing at the right one. A relative auth link would 404 on
 * this host, which is the one failure mode of the split that costs a signup.
 */
describe('the marketing site and the application are separate hosts', () => {
  it('sends every sign-in and get-started CTA to the application host', () => {
    for (const path of ['/', '/pricing', '/docs', '/demo']) {
      const body = render(path);
      expect(body, `${path} sign-in`).toContain('href="https://app.fbx1.com/login"');
      expect(body, `${path} relative /login`).not.toContain('href="/login"');
      expect(body, `${path} relative /signup`).not.toContain('href="/signup"');
    }
    expect(render('/pricing')).toContain('href="https://app.fbx1.com/signup"');
  });

  it('keeps every marketing link relative, so it never leaves this host', () => {
    const body = render('/pricing');
    expect(body).toContain('href="/docs"');
    expect(body).toContain('href="/terms"');
    // The canonical URL is absolute because a canonical URL has to be; no link
    // a visitor can click is.
    expect(body).not.toMatch(/<a [^>]*href="https:\/\/fbx1\.com/);
  });

  /**
   * The list of paths this host forwards is the mirror image of the list the
   * application forwards. If a path were in neither, an old link would 404 on
   * both hosts; if it were in both, it would loop.
   */
  it('forwards no path it also serves', () => {
    for (const appPath of APP_PATH_PREFIXES) {
      expect(pages.has(appPath), `${appPath} is both served and forwarded`).toBe(false);
      expect(MARKETING_PATHS, `${appPath} is claimed by both hosts`).not.toContain(appPath);
    }
  });

  it('serves every path the application redirects here', () => {
    // `/sitemap.xml` and `/try` are generated rather than prerendered.
    const generated = ['/sitemap.xml', '/try'];
    for (const path of MARKETING_PATHS) {
      expect(pages.has(path) || generated.includes(path), `nothing serves ${path}`).toBe(true);
    }
  });
});

describe('SEO', () => {
  it('points canonical, og and structured data at this host', () => {
    const body = render('/');
    expect(body).toContain('<link rel="canonical" href="https://fbx1.com/">');
    expect(body).toContain('<meta property="og:url" content="https://fbx1.com/">');
    expect(body).toContain('application/ld+json');
    expect(body).toContain('SoftwareApplication');
    expect(body).toContain('FAQPage');
    expect(body).toContain('"@id":"https://fbx1.com/#org"');
    // The application host must never appear as the home of the public site.
    expect(body).not.toContain('canonical" href="https://app.fbx1.com');
  });

  it('gives every page its own canonical URL on this host', () => {
    for (const page of PRERENDERED) {
      const body = page.render();
      if (page.path === '/') continue;
      const canonical = body.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
      expect(canonical, `${page.path} has no canonical URL`).toBe(`https://fbx1.com${page.path}`);
    }
  });

  it('publishes one sitemap, listing only this host', () => {
    const xml = sitemapXml();
    expect(xml).toContain('<loc>https://fbx1.com/</loc>');
    expect(xml).toContain('<loc>https://fbx1.com/pricing</loc>');
    expect(xml).toContain('<loc>https://fbx1.com/try</loc>');
    expect(xml).not.toContain('app.fbx1.com');
    // Derived from the pages that exist, so it cannot list one that does not.
    for (const page of PRERENDERED) {
      expect(xml, `sitemap omits ${page.path}`).toContain(
        `<loc>https://fbx1.com${page.path === '/' ? '/' : page.path}</loc>`,
      );
    }
  });

  it('allows crawling everything except the unbounded seed space', () => {
    const robots = robotsTxt();
    expect(robots).toContain('Allow: /');
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain('Disallow: /try/report');
    expect(robots).toContain('Sitemap: https://fbx1.com/sitemap.xml');
  });

  it('keeps the 404 out of the index and offers a way back', () => {
    const body = notFoundPage();
    expect(body).toContain("We couldn't find that page");
    expect(body).toContain('noindex');
    expect(body).toContain('href="/"');
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
   * prospect learned a word the product would never show them again.
   */
  it('never shows a stage kind that does not exist', () => {
    for (const path of publicPages) {
      const body = render(path);
      // The word may appear as plain English ("stalled work"), never as a
      // mapping target or a member of the stage list.
      expect(body, path).not.toMatch(/→\s*<i[^>]*>stalled/);
      expect(body, path).not.toMatch(/stages \([^)]*stalled/);
    }
  });

  /**
   * The strongest thing the product does is say what to fix first, and the
   * entire acquisition path sold measurement: "ranked cost report", with no
   * occurrence of the word anywhere before signup.
   */
  it('promises the decision, not only the measurement', () => {
    const landing = render('/');
    // The promise is the decision; the money is what justifies it (D22).
    expect(landing).toContain('Know the one thing to fix');
    expect(landing).toContain('the highest-leverage change');
    // And the product screenshot mirrors the real report's order: action
    // first, evidence second, ranked list last.
    const act = landing.indexOf('Highest-leverage action');
    const evidence = landing.indexOf('The evidence');
    const ranked = landing.indexOf('Ranked frictions');
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
  it('says on the pricing page that billing does not exist yet', () => {
    const body = render('/pricing');
    expect(body).toContain('billing is not built yet');
    // The prices and tiers are unchanged; only their availability is stated.
    expect(body).toContain('$20 / user / month');
    expect(body).toContain('$100 / user / month');
  });

  it('marks every unbuilt plan feature as planned', () => {
    const body = render('/pricing');
    // Each of these is listed against a paid tier and does not exist.
    for (const feature of [
      'CSV and raw JSON export on every report',
      'Multiple workspaces per organization',
      'SSO / SAML sign-in for your whole org',
      'Audit logs across workspaces and members',
    ]) {
      const at = body.indexOf(feature);
      expect(at, `${feature} is no longer on the pricing page`).toBeGreaterThan(-1);
      expect(body.slice(at, at + 200), `${feature} is not marked planned`).toContain('planned');
    }
  });

  it('never claims a machine-readable export it cannot produce', () => {
    for (const path of ['/faq', '/docs']) {
      expect(render(path), `${path} offers JSON export`).not.toMatch(
        /export any report as raw JSON|can be exported as raw JSON/,
      );
    }
  });

  /**
   * /docs was eight section titles describing documents that did not exist.
   * The check is for substance rather than exact wording: the things a stuck
   * customer would actually be looking for.
   */
  it('documents the product rather than listing chapter titles', () => {
    const body = render('/docs');
    // The word the whole product is denominated in, defined.
    expect(body).toContain('A <strong>friction</strong> is');
    // The capability that decides whether ClickUp wait analysis works at all.
    expect(body).toContain('Total Time in Status');
    // What the confidence tiers mean, not just that they exist.
    expect(body).toContain('demonstrated in your event history');
    // The refusals, which are most of what loses a reader's trust unexplained.
    expect(body).toContain('When CostFlow refuses to answer');
  });

  it('says on the security page that assignee names are stored', () => {
    for (const path of ['/security', '/privacy']) {
      expect(render(path), `${path} omits stored names`).toMatch(/assignee names/i);
    }
  });

  it('does not imply an API that does not exist', () => {
    expect(render('/privacy')).not.toContain('API response');
  });
});

/**
 * The founder's decision, 2026-07-28: the recommendations are the strongest
 * thing the product does, so a prospect should see them before signing up. The
 * condition is that a visitor can never mistake a recommendation computed from
 * generated data for one computed from their own. The other half of that
 * condition — that a real customer's report never carries the disclaimer — is
 * tested in the application.
 */
describe('recommendations on the sample surfaces', () => {
  it('marks the static sample as generated from demonstration data', () => {
    expect(render('/demo')).toContain('Generated from demonstration data');
  });

  it('marks the interactive demo the same way', () => {
    const body = renderTryReportPage('42');
    expect(body).toContain('Highest-leverage action');
    expect(body).toContain('Generated from demonstration data');
    expect(body).toContain('not from any real organisation');
  });

  /**
   * The static sample is below the evidence gate, so it recommends nothing.
   * That is correct, and on a marketing surface it is also an opportunity: the
   * refusal is a differentiator, and the prospect should leave with somewhere
   * to go.
   */
  it('explains the refusal and routes to a full-size demonstration', () => {
    const body = render('/demo');
    expect(body).toContain('smaller than the evidence threshold');
    expect(body).toContain('href="/try"');
  });
});
