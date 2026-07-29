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
      connectionParams: { site: 'https://acme.atlassian.net', email },
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

/**
 * MW1 (doc 19). A trend is a claim. When the two runs are not measuring the
 * same thing, the product renders no trend at all — a wrong trend is worse than
 * no trend, and a caveat above a table of arrows does not stop anyone reading
 * the arrows.
 */
describe('MW1: the trend is gated on comparability', () => {
  const withEngine = (json: string, costModels: Record<string, string>) => {
    const run = JSON.parse(json) as { engineVersions: { costModels: unknown } };
    run.engineVersions.costModels = costModels;
    return JSON.stringify(run);
  };
  const withAgingThreshold = (json: string, value: number) => {
    const run = JSON.parse(json) as {
      assumptions: { parameters: { agingThresholdDays: { value: number } } };
    };
    run.assumptions.parameters.agingThresholdDays.value = value;
    return JSON.stringify(run);
  };

  it('renders the change table when the runs are comparable', async () => {
    const t = await makeApp();
    const cookie = await signIn(t, 'mw1a@example.com');
    await seedRun(t, 'mw1a@example.com', 'r-old', '2026-07-01T00:00:00Z');
    await seedRun(t, 'mw1a@example.com', 'r-new', '2026-07-02T00:00:00Z');

    const res = await get(t, cookie, '/reports/r-new');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Change since previous run');
    expect(res.body).toContain('Δ expected');
    expect(res.body).not.toContain('not measuring the same thing');
  });

  it('refuses the trend, and explains why, when the engine version moved', async () => {
    const t = await makeApp();
    const email = 'mw1b@example.com';
    const cookie = await signIn(t, email);
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    await seedRun(t, email, 'r-old', '2026-07-01T00:00:00Z');
    const old = (await t.store.getRun(tenantId, 'r-old'))!;
    await seedRun(t, email, 'r-new', '2026-07-02T00:00:00Z');
    // Rewrite the OLDER run as if a previous engine produced it.
    await t.store.createRun({
      ...old,
      id: 'r-old2',
      createdAt: '2026-07-01T12:00:00Z',
      runJson: withEngine(old.runJson, { 'c1-legacy': '0.0.1' }),
    });

    const res = await get(t, cookie, '/reports/r-new');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('not measuring the same thing');
    expect(res.body).toContain('The change is ours, not yours');
    // No table of arrows anywhere.
    expect(res.body).not.toContain('Δ expected');
    expect(res.body).not.toContain('▲ increased');
  });

  it('refuses when a threshold change alters which work counts', async () => {
    const t = await makeApp();
    const email = 'mw1c@example.com';
    const cookie = await signIn(t, email);
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    await seedRun(t, email, 'r-old', '2026-07-01T00:00:00Z');
    const old = (await t.store.getRun(tenantId, 'r-old'))!;
    await seedRun(t, email, 'r-new', '2026-07-02T00:00:00Z');
    await t.store.createRun({
      ...old,
      id: 'r-old2',
      createdAt: '2026-07-01T12:00:00Z',
      runJson: withAgingThreshold(old.runJson, 99),
    });

    const res = await get(t, cookie, '/reports/r-new');
    expect(res.body).toContain('which work counts');
    expect(res.body).not.toContain('Δ expected');
  });
});

/**
 * The fallback lead states a CAUSE only when the artifact supports one.
 *
 * "No pattern cleared the evidence threshold" is Condition B: every diagnostic
 * ran and none met its bar. Missing history is Condition A: a diagnostic could
 * not run at all, which produces a `DiagnosticUnavailable` and renders below as
 * "What this data cannot tell you yet".
 *
 * The lead used to assert Condition A's remedy unconditionally — "a workspace
 * with more history behind each stage gives the diagnostics enough to name an
 * intervention" — including on reports where that list was EMPTY. The page told
 * the reader to go and enable evidence they already had, while showing nothing
 * missing thirty lines down. On a real report that sends a customer to their
 * workspace admin for nothing.
 *
 * `DiagnosticsView.unavailable` is the single source of truth and is already
 * computed; the lead reads it rather than guessing.
 */
describe('the fallback lead offers a cause only when one exists', () => {
  const OPS_RUN = readFileSync(join(ROOT, 'tools/golden/expected/demo-ops/run.json'), 'utf8');
  const UNLOCK_HINT = 'What this data cannot tell you yet';

  async function seedJson(t: TestApp, email: string, runId: string, json: string): Promise<void> {
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const workspace =
      (await t.store.listWorkspaces(tenantId))[0] ??
      (await t.store.createWorkspace(tenantId, {
        provider: 'jira',
        connectionParams: { site: 'https://acme.atlassian.net', email },
        tokenCiphertext: 'tok',
      }));
    await t.store.createRun({
      id: runId,
      tenantId,
      workspaceId: workspace.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson: json,
      reportMd: '',
      telemetryJsonl: '',
    });
  }

  it('stays silent about causes when every diagnostic ran (demo-jira)', async () => {
    const t = await makeApp();
    const email = 'lead-none@example.com';
    const cookie = await signIn(t, email);
    await seedJson(t, email, 'r-all-ran', RUN_JSON);

    const res = await get(t, cookie, '/reports/r-all-ran');
    expect(res.body).toContain('Largest measured cost');
    expect(res.body).toContain('rather than a fitted recommendation');
    // Nothing was unavailable, so the section that would name it is absent...
    expect(res.body).not.toContain(UNLOCK_HINT);
    // ...and the lead must not imply otherwise.
    expect(res.body).not.toContain('more history behind each stage');
    expect(res.body).not.toContain('could not be assessed at all');
  });

  it('points at the section that names what is missing (demo-ops)', async () => {
    const t = await makeApp();
    const email = 'lead-gap@example.com';
    const cookie = await signIn(t, email);
    await seedJson(t, email, 'r-gap', OPS_RUN);

    const res = await get(t, cookie, '/reports/r-gap');
    expect(res.body).toContain('Largest measured cost');
    // This artifact carries no events, so serial gatekeeping genuinely cannot
    // run — the one case where offering a cause is truthful.
    expect(res.body).toContain(UNLOCK_HINT);
    expect(res.body).toContain('could not be assessed at all');
  });
});
