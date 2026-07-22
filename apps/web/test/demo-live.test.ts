import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';
import { renderDemoCompany } from '../src/demo-live';

/**
 * Interactive Demo Mode: a random realistic company is fed through the REAL
 * engine (transformJira → runAnalysis → renderReportBody), never hardcoded.
 * The report must be a genuine priced report, safe (no injection/PII), and
 * reproducible from its seed (shareable links); a fresh visit differs.
 */
describe('interactive demo', () => {
  it('/try shows the animated analyser and hands off to a seeded report', async () => {
    const t = makeApp();
    const analysing = await t.app.inject({ method: 'GET', url: '/try' });
    expect(analysing.statusCode).toBe(200);
    expect(analysing.body).toContain('Analysing a live company');
    // No-JS handoff to the deterministic report.
    expect(analysing.body).toMatch(
      /http-equiv="refresh" content="\d+; url=\/try\/report\?seed=\d+"/,
    );
    expect(analysing.headers['cache-control']).toContain('no-store');
  });

  it('/try/report renders a real, priced, safe report for a seed', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/try/report?seed=42' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('You just analysed');
    expect(res.body).toContain('Ranked frictions');
    expect(res.body).toContain('Total priced friction');
    expect(res.body).toContain('/signup'); // conversion CTA
    // Genuine content, not a stub.
    expect((res.body.match(/class="friction"/g) ?? []).length).toBeGreaterThan(3);
    // Safety: no unescaped script, no raw generated names (pseudonymised).
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toMatch(/Okafor|Nguyen/);
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
