import { describe, expect, it } from 'vitest';
import { renderDemoCompany } from '../src/demo-live';
import { renderTryPage, renderTryReportPage } from '../src/try-pages';

/**
 * Interactive Demo Mode: a random realistic company is fed through the REAL
 * engine (transformJira → runAnalysis → renderReportBody), never hardcoded.
 * The report must be a genuine priced report, safe (no injection/PII), and
 * reproducible from its seed (shareable links); a fresh visit differs.
 */
describe('interactive demo', () => {
  it('/try shows the animated analyser and hands off to a seeded report', () => {
    const analysing = renderTryPage();
    expect(analysing).toContain('Analyzing a live company');
    // No-JS handoff to the deterministic report.
    expect(analysing).toMatch(/http-equiv="refresh" content="\d+; url=\/try\/report\?seed=\d+"/);
  });

  it('/try/report renders a real, priced, safe report for a seed', () => {
    const body = renderTryReportPage('42');
    expect(body).toContain('You just analyzed');
    expect(body).toContain('Ranked frictions');
    // The report leads with the action; the money is evidence beneath it.
    expect(body).toContain('Highest-leverage action');
    expect(body).toContain('of priced friction');
    expect(body).toContain('/signup'); // conversion CTA
    // Genuine content, not a stub.
    expect((body.match(/class="friction"/g) ?? []).length).toBeGreaterThan(3);
    // Safety: no unescaped script, no raw generated names (pseudonymised).
    expect(body).not.toContain('<script>');
    expect(body).not.toMatch(/Okafor|Nguyen/);
  });

  it('the conversion CTA points at the application host, not a relative path', () => {
    // A prospect who signs up mid-demo must land on the application directly.
    // A relative /signup here would 404 on the marketing site.
    expect(renderTryReportPage('42')).toContain('https://app.fbx1.com/signup');
  });

  it('an absent or malformed seed still renders a company rather than an error', () => {
    for (const seed of [undefined, '', 'abc', '0', '99999999999', '-1']) {
      expect(renderTryReportPage(seed)).toContain('You just analyzed');
    }
  });

  it('is deterministic by seed (shareable) and varies across seeds', () => {
    expect(renderDemoCompany(42).reportBody).toBe(renderDemoCompany(42).reportBody);
    const names = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => renderDemoCompany(s).companyName));
    expect(names.size).toBeGreaterThan(2); // small seeds still decorrelate (warm-up)
  });

  it('every generated company yields real priced friction (impressive, not a toy)', () => {
    for (const seed of [11, 222, 3333, 44444, 555555]) {
      const d = renderDemoCompany(seed);
      const priced = (d.reportBody.match(/class="friction"/g) ?? []).length;
      expect(priced).toBeGreaterThan(3);
      expect(d.issueCount).toBeGreaterThanOrEqual(60);
    }
  });
});
