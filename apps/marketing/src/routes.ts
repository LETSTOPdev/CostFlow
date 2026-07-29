import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDiagnosticsView,
  JIRA_SAMPLE_SOURCE,
  MARKETING_ORIGIN,
  MARKETING_SITE,
  appUrl,
  layout,
  marketingUrl,
  parseRun,
  renderReportBody,
} from '@costflow/ui';
import { renderLanding, renderPrivacy, renderTerms } from './landing';
import {
  renderAbout,
  renderAccessibility,
  renderBlog,
  renderCareers,
  renderChangelog,
  renderContact,
  renderCookies,
  renderDocs,
  renderFaq,
  renderPricing,
  renderSecurity,
  renderSitemap,
  renderSubprocessors,
} from './pages';

/**
 * Every public page, and the one file that decides what the marketing site is.
 *
 * The site is prerendered: `build.ts` walks `PRERENDERED` once and writes plain
 * HTML that a CDN serves without running anything. That is not an optimisation
 * for its own sake — these pages have no session, no database and no per-visitor
 * state, so a request that reaches a server is a request that could have been a
 * file. The two exceptions are `/try` and `/try/report`, which generate a
 * different company on every visit and therefore run.
 */

const site = MARKETING_SITE;

/** A page: the URL it answers on, and the HTML it produces. */
export interface Page {
  readonly path: string;
  readonly render: () => string;
}

export const PRERENDERED: readonly Page[] = [
  { path: '/', render: () => renderLanding(site) },
  { path: '/pricing', render: () => renderPricing(site) },
  { path: '/demo', render: renderDemoPage },
  { path: '/security', render: () => renderSecurity(site) },
  { path: '/about', render: () => renderAbout(site) },
  { path: '/contact', render: () => renderContact(site) },
  { path: '/changelog', render: () => renderChangelog(site) },
  { path: '/blog', render: () => renderBlog(site) },
  { path: '/careers', render: () => renderCareers(site) },
  { path: '/docs', render: () => renderDocs(site) },
  { path: '/faq', render: () => renderFaq(site) },
  { path: '/terms', render: () => renderTerms(site) },
  { path: '/privacy', render: () => renderPrivacy(site) },
  { path: '/cookies', render: () => renderCookies(site) },
  { path: '/dpa', render: () => renderSubprocessors(site) },
  { path: '/accessibility', render: () => renderAccessibility(site) },
  { path: '/sitemap', render: () => renderSitemap(site) },
];

/* ------------------------------------------------------------------ *
 * The sample report — a fixed artifact, so it prerenders
 * ------------------------------------------------------------------ */

/**
 * Committed snapshot of the demo-jira golden run. A visitor understands the
 * product before connecting anything. A static sample is fine — it never needs
 * to match the live engine byte for byte, only to be a real artifact rendered
 * by the real report view.
 */
const DEMO_RUN_JSON = readFileSync(
  fileURLToPath(new URL('./demo-run.json', import.meta.url)),
  'utf8',
);

function renderDemoPage(): string {
  const banner =
    '<div class="info">This is a <strong>sample report</strong> built from demo data. ' +
    `<a href="${appUrl(site, '/login')}">Sign in</a> to run one on your own Jira or ClickUp.</div>`;
  const demoRun = parseRun(DEMO_RUN_JSON);
  const body = renderReportBody(demoRun, {
    runId: 'demo',
    diagnostics: buildDiagnosticsView(demoRun, JIRA_SAMPLE_SOURCE),
    demo: true,
  });
  const cta =
    '<div class="cta-band" style="margin-top:2.5rem">' +
    '<h2>Ready to see your own?</h2>' +
    '<p class="lead">Connect Jira or ClickUp and get a report like this for your own team in about a minute. Free while in beta.</p>' +
    `<div class="hero-actions"><a class="btn btn-lg" href="${appUrl(site, '/login')}">Get started free</a></div>` +
    '</div>';
  return layout(
    'Sample report',
    `${banner}${body}${cta}<p style="margin-top:1.5rem"><a href="${marketingUrl(site, '/')}">← Home</a></p>`,
    undefined,
    { canonical: `${site.canonicalOrigin}/demo`, site },
  );
}

/* ------------------------------------------------------------------ *
 * SEO and the branded 404
 * ------------------------------------------------------------------ */

/**
 * `robots.txt` for the public site. It allows everything it publishes and
 * names the sitemap, because this host IS the canonical home of every public
 * URL. `/try/report` is excluded: the seed space is unbounded, so every crawl
 * would mint a new URL for a company that never existed twice.
 */
export function robotsTxt(): string {
  return `User-agent: *
Allow: /
Disallow: /try/report

Sitemap: ${MARKETING_ORIGIN}/sitemap.xml
`;
}

/** Priorities are editorial: what a first-time visitor should find first. */
const SITEMAP_PRIORITY: Readonly<Record<string, string>> = {
  '/': '1.0',
  '/try': '0.9',
  '/demo': '0.8',
  '/pricing': '0.8',
  '/security': '0.6',
  '/about': '0.5',
  '/contact': '0.5',
  '/docs': '0.5',
  '/faq': '0.5',
  '/changelog': '0.4',
  '/blog': '0.4',
  '/careers': '0.3',
  '/privacy': '0.3',
  '/terms': '0.3',
  '/cookies': '0.2',
  '/dpa': '0.2',
  '/accessibility': '0.2',
  '/sitemap': '0.2',
};

/**
 * Every indexable URL, derived from the pages that actually exist plus `/try`,
 * which runs rather than prerenders. Deriving it means a page cannot be added
 * without appearing here, which is how the previous hand-maintained list would
 * have gone stale.
 */
export function sitemapXml(): string {
  const paths = [...PRERENDERED.map((p) => p.path), '/try'].sort(
    (a, b) => Number(SITEMAP_PRIORITY[b] ?? '0.5') - Number(SITEMAP_PRIORITY[a] ?? '0.5'),
  );
  const urls = paths
    .map(
      (path) =>
        `  <url><loc>${MARKETING_ORIGIN}${path === '/' ? '/' : path}</loc><changefreq>weekly</changefreq><priority>${SITEMAP_PRIORITY[path] ?? '0.5'}</priority></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The branded 404, prerendered and served by the error route. */
export function notFoundPage(): string {
  return layout(
    'Page not found',
    `<div class="empty" style="max-width:34rem;margin:2.5rem auto">
       <h3>We couldn't find that page</h3>
       <p>The link may be broken or the page may have moved.</p>
       <a class="btn" href="/">Back to CostFlow</a>
     </div>`,
    undefined,
    { noindex: true, site },
  );
}
