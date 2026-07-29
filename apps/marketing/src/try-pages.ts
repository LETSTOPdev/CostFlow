import {
  buildDiagnosticsView,
  esc,
  JIRA_SAMPLE_SOURCE,
  MARKETING_SITE,
  appUrl,
  demoAnalyzingPage,
  layout,
  renderReportBody,
} from '@costflow/ui';
import { randomDemoSeed, renderDemoCompany } from './demo-live';

/**
 * The two pages that cannot be prerendered: every visit generates a different
 * company and runs it through the real engine.
 *
 * Kept in their own module, apart from `routes.ts`, because this is the only
 * code the marketing site ships as a running function. `routes.ts` reads the
 * sample artifact off disk at build time; a function that imported it would
 * carry a file read into a bundle where that path does not exist.
 */

const site = MARKETING_SITE;

/** The "analyzing…" page. A fresh seed per visit is the whole point. */
export function renderTryPage(): string {
  return demoAnalyzingPage(randomDemoSeed());
}

/**
 * The generated company's report. The seed is a bounded positive integer that
 * only feeds a PRNG — no injection surface — and an invalid or absent one just
 * gets a fresh random company rather than an error.
 */
export function renderTryReportPage(rawSeed: string | undefined): string {
  const parsed = rawSeed !== undefined && /^\d{1,10}$/.test(rawSeed) ? Number(rawSeed) : NaN;
  const seed = parsed >= 1 && parsed <= 2_147_483_646 ? parsed : randomDemoSeed();
  let demo;
  try {
    demo = renderDemoCompany(seed);
  } catch {
    return layout(
      'Demo',
      '<div class="empty" style="max-width:34rem;margin:2.5rem auto"><h3>The demo hiccuped</h3><p>Please <a href="/try">try another company</a>.</p></div>',
      undefined,
      { noindex: true, site },
    );
  }
  const banner = `<div class="info">You just analyzed <strong>${esc(demo.companyName)}</strong>, a simulated ${esc(demo.industry)} with ${demo.issueCount} issues and a ${demo.teamSize}-person team, generated fresh for this demo and run through the real CostFlow engine. <a href="/try">Generate a different company →</a></div>`;
  const cta =
    '<div class="cta-band" style="margin-top:2.5rem">' +
    '<h2>Now do it for your own team.</h2>' +
    '<p class="lead">Connect Jira or ClickUp in about a minute and get this report on your real board. Free and read-only.</p>' +
    `<div class="hero-actions"><a class="btn btn-lg lp-cta-btn" href="${appUrl(site, '/signup')}">Get started free</a>` +
    '<a class="lp-cta-link" href="/try">or try another company →</a></div>' +
    '</div>';
  return layout(
    `Demo: ${demo.companyName}`,
    `${banner}${renderReportBody(demo.run, {
      runId: `demo-${demo.seed}`,
      diagnostics: buildDiagnosticsView(demo.run, JIRA_SAMPLE_SOURCE),
      demo: true,
    })}${cta}<p style="margin-top:1.5rem"><a href="/">← Home</a></p>`,
    undefined,
    // Infinite seed space — canonicalise crawlers to /try, don't index each.
    { canonical: `${site.canonicalOrigin}/try`, noindex: true, site },
  );
}
