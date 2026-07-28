import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSummary } from '../src/report-view';
import { ROOT, get, makeApp, signIn, type TestApp } from './helpers';

/**
 * Executive dashboard: one dominant recoverable-cost hero, three plain-English
 * insight cards, history below the fold, configuration exiled to /settings.
 * Rendered from the immutable run.json artifact — the figures asserted here
 * are the same goldens the report renders (never re-derived).
 */

const RUN_JSON = readFileSync(join(ROOT, 'tools/golden/expected/demo-jira/run.json'), 'utf8');

async function seedWorkspace(
  t: TestApp,
  email: string,
): Promise<{ tenantId: string; workspaceId: string }> {
  const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
  const ws = await t.store.createWorkspace(tenantId, {
    provider: 'jira',
    connectionParams: { site: 'https://acme.atlassian.net', email },
    tokenCiphertext: 'tok',
  });
  await t.store.updateWorkspace(tenantId, ws.id, {
    scopes: [{ id: 'OPS', kind: 'project', name: 'Operations' }],
    onboarding: 'ready',
  });
  return { tenantId, workspaceId: ws.id };
}

async function seedRun(
  t: TestApp,
  tenantId: string,
  workspaceId: string,
  runId: string,
  createdAt: string,
): Promise<void> {
  await t.store.createRun({
    id: runId,
    tenantId,
    workspaceId,
    createdAt,
    runJson: RUN_JSON,
    reportMd: '',
    telemetryJsonl: '',
  });
}

describe('executive dashboard', () => {
  it('first run: a single dominant CTA, value preview, and no configuration UI', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ceo@dash.example');
    await seedWorkspace(t, 'ceo@dash.example');

    const res = await get(t, cookie, '/dashboard');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Run first analysis');
    // Provider vocabulary from the descriptor, on the first screen.
    expect(res.body.split('</head>')[1]).toContain('Jira');
    // What-you-get preview instead of an empty report list.
    expect(res.body).toContain('Graded evidence');
    expect(res.body).not.toContain('Past analyses');
  });

  it('with findings: the hero leads with the exact priced total and an Analyze Again CTA', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ceo@dash.example');
    const { tenantId, workspaceId } = await seedWorkspace(t, 'ceo@dash.example');
    await seedRun(t, tenantId, workspaceId, 'run-a', '2026-07-20T10:00:00Z');

    const res = await get(t, cookie, '/dashboard');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Potential recoverable cost');
    // The hero figure is the report's own total — same formatter, same model.
    const summary = runSummary(RUN_JSON)!;
    expect(summary.priced).toBeGreaterThan(0);
    expect(res.body).toContain(summary.expectedText);
    expect(res.body).toContain('Analyze again');
    expect(res.body).not.toContain('Run first analysis');
  });

  it('insight cards read as executive sentences, not categories', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ceo@dash.example');
    const { tenantId, workspaceId } = await seedWorkspace(t, 'ceo@dash.example');
    await seedRun(t, tenantId, workspaceId, 'run-a', '2026-07-20T10:00:00Z');

    const res = await get(t, cookie, '/dashboard');
    expect(res.body).toContain('Where it&#39;s going'.replace('&#39;', "'"));
    expect(res.body).toContain('costing about');
    expect(res.body).toContain('Strongest evidence:');
    expect(res.body).toContain('What to do today');
    // Engine units never reach the executive surface.
    expect(res.body).not.toContain('item-hours-waiting');
    expect(res.body).not.toContain('item-days-beyond-threshold');
  });

  it('a second identical run yields an honest "unchanged" trend line', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ceo@dash.example');
    const { tenantId, workspaceId } = await seedWorkspace(t, 'ceo@dash.example');
    await seedRun(t, tenantId, workspaceId, 'run-a', '2026-07-19T10:00:00Z');
    await seedRun(t, tenantId, workspaceId, 'run-b', '2026-07-20T10:00:00Z');

    const res = await get(t, cookie, '/dashboard');
    expect(res.body).toContain('Unchanged vs the previous analysis');
    expect(res.body).toContain('Past analyses');
    expect(res.body).toContain('/reports/run-b');
    expect(res.body).toContain('/reports/run-a');
  });

  it('configuration is exiled: no config links on the dashboard, all of them on /settings', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'ceo@dash.example');
    const { tenantId, workspaceId } = await seedWorkspace(t, 'ceo@dash.example');
    await seedRun(t, tenantId, workspaceId, 'run-a', '2026-07-20T10:00:00Z');

    const dash = await get(t, cookie, '/dashboard');
    expect(dash.statusCode).toBe(200);
    for (const href of [
      '/connect',
      '/scope',
      '/mapping/statuses',
      '/mapping/actors',
      '/assumptions',
      '/org',
    ]) {
      expect(dash.body).not.toContain(`href="${href}"`);
    }
    expect(dash.body).toContain('href="/settings"');
    // The trust line survives (provider-correct connection description).
    expect(dash.body).toContain('Credentials encrypted at rest');

    const settings = await get(t, cookie, '/settings');
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain('Workspace configuration');
    for (const href of [
      '/connect',
      '/scope',
      '/mapping/statuses',
      '/mapping/actors',
      '/assumptions',
      '/org',
    ]) {
      expect(settings.body).toContain(`href="${href}"`);
    }
    // Data & privacy (GDPR erasure) remains intact below the hub.
    expect(settings.body).toContain('Data &amp; privacy');
  });
});
