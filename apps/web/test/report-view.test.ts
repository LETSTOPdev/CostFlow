import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, get, makeApp, signIn, type TestApp } from './helpers';

/**
 * P5 acceptance: the structured, explorable report view renders the IMMUTABLE
 * run.json artifact — the same golden figures the engine froze — with
 * confidence/provenance as first-class UI, formula-trace drill-downs,
 * coverage, context, a run-over-run trend, and an executive print export.
 * Pure presentation: no number is re-derived (asserted by matching goldens).
 */

const RUN_JSON = readFileSync(join(ROOT, 'tools/golden/expected/demo-jira/run.json'), 'utf8');
const REPORT_MD = readFileSync(join(ROOT, 'tools/golden/expected/demo-jira/report.md'), 'utf8');

async function seedRun(
  t: TestApp,
  email: string,
  runId: string,
  createdAt: string,
  observedActors: string[] = [],
): Promise<string> {
  const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
  const workspace =
    (await t.store.listWorkspaces(tenantId))[0] ??
    (await t.store.createWorkspace(tenantId, {
      provider: 'jira',
      connection: { site: 'https://acme.atlassian.net', email },
      tokenCiphertext: 'tok',
    }));
  if (observedActors.length > 0) {
    await t.store.updateWorkspace(tenantId, workspace.id, { observedActors });
  }
  await t.store.createRun({
    id: runId,
    tenantId,
    workspaceId: workspace.id,
    createdAt,
    runJson: RUN_JSON,
    reportMd: REPORT_MD,
    telemetryJsonl: '',
  });
  return workspace.id;
}

describe('P5 structured report view', () => {
  it('renders the golden figures with confidence, provenance, drill-down, and coverage', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner@r.example');
    await seedRun(t, 'owner@r.example', 'run-jira', '2026-07-20T00:00:00Z');

    const res = await get(t, cookie, '/reports/run-jira');
    expect(res.statusCode).toBe(200);
    // The P1 hand-computed golden figures render through the structured view.
    expect(res.body).toContain('1,062');
    expect(res.body).toContain('342');
    expect(res.body).toContain('297');
    // First-class confidence + provenance UI.
    expect(res.body).toContain('Confidence');
    expect(res.body).toMatch(/tier-[ABC]/);
    expect(res.body).toContain('customized by customer');
    // Drill-down (the four E1 questions) and sections.
    expect(res.body).toContain('How was it computed?');
    expect(res.body).toContain('What data went in?');
    expect(res.body).toContain('Ranked frictions');
    expect(res.body).toContain('Coverage');
    expect(res.body).toContain('Context');
    // Export affordances.
    expect(res.body).toContain('/reports/run-jira/print');
    expect(res.body).toContain('/reports/run-jira/raw');
    // A first-view telemetry event fired.
    expect(t.events.some((e) => e.event === 'tm-web-report-viewed')).toBe(true);
  });

  it('serves an executive print export with the methodology appendix and expanded drill-downs', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner2@r.example');
    await seedRun(t, 'owner2@r.example', 'run-print', '2026-07-20T00:00:00Z');

    const res = await get(t, cookie, '/reports/run-print/print');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Methodology');
    expect(res.body).toContain('1,062');
    expect(res.body).toContain('<details open>'); // drill-downs expanded for print
    expect(res.body).not.toContain('<header>'); // chrome-free standalone document
  });

  it('serves the raw markdown fallback view', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner3@r.example');
    await seedRun(t, 'owner3@r.example', 'run-raw', '2026-07-20T00:00:00Z');

    const res = await get(t, cookie, '/reports/run-raw/raw');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Structured report'); // back-link
    expect(res.body).toContain('CostFlow Friction Report'); // markdown heading
  });

  it('shows a run-over-run trend only when a previous run exists', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner4@r.example');
    await seedRun(t, 'owner4@r.example', 'run-old', '2026-07-19T00:00:00Z');
    await seedRun(t, 'owner4@r.example', 'run-new', '2026-07-20T00:00:00Z');

    const newer = await get(t, cookie, '/reports/run-new');
    expect(newer.body).toContain('Change since previous run');
    const older = await get(t, cookie, '/reports/run-old');
    expect(older.body).not.toContain('Change since previous run');
  });

  it('the attribution guard withholds the structured view if a rendered field matches a raw identity', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'owner5@r.example');
    // A work-item title that the drill-down renders is registered as a raw
    // observed-actor identity — the guard must withhold the whole response.
    await seedRun(t, 'owner5@r.example', 'run-leak', '2026-07-20T00:00:00Z', [
      'Quarterly access audit',
    ]);

    const res = await get(t, cookie, '/reports/run-leak');
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('withheld');
    expect(res.body).not.toContain('Quarterly access audit');
    // A withheld report is not counted as viewed.
    expect(t.events.some((e) => e.event === 'tm-web-report-viewed')).toBe(false);
  });
});
