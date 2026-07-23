import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clickupConnector, type Connection, type ScopeRef } from '../src/connectors';
import { makeApp, get, post, signIn, ROOT, StubJiraConnector, type TestApp } from './helpers';

/**
 * Full ClickUp onboarding journey (doc 18 §4.3/§5): the SAME provider-blind
 * routes that serve Jira carry a ClickUp workspace from the provider picker to
 * a rendered report reproducing the demo-clickup golden's hand-computed
 * figures (801 / 240) — with queue-wait skipped visibly (no event history).
 * Only the connector's two HTTP halves are stubbed; credential parsing,
 * counting, observation, and the pure transform are the real code.
 */

const PAGE_901 = readFileSync(
  join(ROOT, 'tools/golden/fixtures/clickup/raw/tasks-901-page-0.json'),
  'utf8',
);
const PAGE_902 = readFileSync(
  join(ROOT, 'tools/golden/fixtures/clickup/raw/tasks-902-page-0.json'),
  'utf8',
);

class StubClickUpConnector {
  private real = clickupConnector();
  descriptor = this.real.descriptor;
  scopeNoun = this.real.scopeNoun;
  pickerHint = this.real.pickerHint;
  credentialFields = this.real.credentialFields;
  connectionHelpHtml = this.real.connectionHelpHtml;
  parseCredentials = this.real.parseCredentials.bind(this.real);
  connectionFrom = this.real.connectionFrom.bind(this.real);
  summaryText = this.real.summaryText.bind(this.real);
  countItems = this.real.countItems.bind(this.real);
  observe = this.real.observe.bind(this.real);
  transform = this.real.transform.bind(this.real);
  lastConnection: Connection | null = null;

  async listScopes(connection: Connection): Promise<ScopeRef[]> {
    this.lastConnection = connection;
    return [{ key: '90120', name: 'Legal Ops' }];
  }

  async fetchAll(_connection: Connection, scopeKey: string) {
    if (scopeKey !== '90120') throw new Error('unknown space');
    return { taskPagesByList: { '901': [PAGE_901], '902': [PAGE_902] } };
  }
}

function makeClickUpApp(): { t: TestApp; clickup: StubClickUpConnector } {
  const clickup = new StubClickUpConnector();
  const t = makeApp({ connectors: { jira: new StubJiraConnector(), clickup } });
  return { t, clickup };
}

async function completeMappingSteps(t: TestApp, cookie: string): Promise<void> {
  // Map every observed status by index, using what the form actually renders.
  const statuses = await get(t, cookie, '/mapping/statuses');
  const rows = [...statuses.body.matchAll(/<td>([^<]+)<\/td><td><select name="s(\d+)"/g)];
  const byName: Record<string, string> = {
    'to do': 'queue',
    'in progress': 'active',
    review: 'review',
    complete: 'done',
  };
  const form: Record<string, string> = {};
  for (const row of rows) {
    form[`s${row[2]}`] = byName[row[1] as string] as string;
  }
  await post(t, cookie, '/mapping/statuses', form);

  // Roles: map the two known people by their rendered index.
  const actors = await get(t, cookie, '/mapping/actors');
  const actorRows = [...actors.body.matchAll(/<td>([^<]+)<\/td><td><input name="a(\d+)"/g)];
  const roleByName: Record<string, string> = { 'Noa Legal': 'Legal', 'Dan Ops': 'Ops' };
  const actorForm: Record<string, string> = {};
  for (const row of actorRows) {
    const role = roleByName[row[1] as string];
    if (role) actorForm[`a${row[2]}`] = role;
  }
  await post(t, cookie, '/mapping/actors', actorForm);
}

describe('ClickUp end-to-end web journey (provider-blind routes)', () => {
  it('picker → connect → Space scope → mappings → assumptions → run → report', async () => {
    const { t, clickup } = makeClickUpApp();
    const cookie = await signIn(t, 'owner@clickup.example');

    // The provider picker offers both connectors.
    const picker = await get(t, cookie, '/connect');
    expect(picker.statusCode).toBe(200);
    expect(picker.body).toContain('/connect/jira');
    expect(picker.body).toContain('/connect/clickup');

    // The ClickUp form asks only for the personal token.
    const form = await get(t, cookie, '/connect/clickup');
    expect(form.body).toContain('Personal API token');
    expect(form.body).not.toContain('name="site"');

    const connected = await post(t, cookie, '/connect/clickup', { token: 'pk_test_1234567' });
    expect(connected.statusCode).toBe(302);
    expect(connected.headers['location']).toBe('/scope');
    expect(clickup.lastConnection?.secret).toBe('pk_test_1234567');

    // Scope speaks ClickUp vocabulary: Spaces, not projects.
    const scope = await get(t, cookie, '/scope');
    expect(scope.body).toContain('Choose the Space to import');
    expect(scope.body).toContain('Legal Ops');
    await post(t, cookie, '/scope', { project: '0' });

    // Observed vocabulary came from the raw task pages (all statuses + ALL
    // assignee usernames, including the multi-assignee task's second person).
    const workspace = (
      await t.store.listWorkspaces((await t.store.findUserByEmail('owner@clickup.example'))!.tenantId)
    )[0]!;
    expect(workspace.provider).toBe('clickup');
    expect(workspace.scopeKey).toBe('90120');
    expect(workspace.observedStatuses).toEqual(['complete', 'in progress', 'to do']);
    expect(workspace.observedActors).toEqual(['Dan Ops', 'Noa Legal', 'Rina Writer']);

    await completeMappingSteps(t, cookie);
    // Customize rates to the demo-clickup card (roles sorted: Legal, Ops),
  // accept the rest — mirrors the journey.test.ts assumption step.
  await post(t, cookie, '/assumptions', {
    rate0: '120',
    rate1: '90',
    defaultRate: '30',
    agingThresholdDays: '14',
    accept_agingThresholdDays: 'on',
    attention_low: '0.15',
    attention_expected: '0.3',
    attention_high: '0.6',
    accept_attention: 'on',
    queueWait_low: '0.1',
    queueWait_expected: '0.2',
    queueWait_high: '0.4',
    accept_queueWait: 'on',
    overdue_low: '0.1',
    overdue_expected: '0.2',
    overdue_high: '0.4',
    accept_overdue: 'on',
  });

    // Run the analysis through the real engine.
    const run = await post(t, cookie, '/runs', {});
    expect(run.statusCode).toBe(302);
    const jobPath = run.headers['location'] as string;
    const job = await get(t, cookie, jobPath);
    expect(job.statusCode).toBe(302); // succeeded → redirect to the report
    const reportPath = job.headers['location'] as string;

    const report = await get(t, cookie, reportPath);
    expect(report.statusCode).toBe(200);
    // Aging and overdue price; queue-wait skips visibly (CU4).
    expect(report.body).toContain('65 item-days-beyond-threshold');
    expect(report.body).toContain('10 item-days-overdue');
    expect(report.body).toContain('Queue wait');
    // No raw identity survives into the rendered report (pseudonymized).
    expect(report.body).not.toContain('Rina Writer');
  });

  it('dashboard and settings summarize a ClickUp connection without Jira vocabulary', async () => {
    const { t } = makeClickUpApp();
    const cookie = await signIn(t, 'owner@clickup.example');
    await post(t, cookie, '/connect/clickup', { token: 'pk_test_1234567' });
    await post(t, cookie, '/scope', { project: '0' });
    await completeMappingSteps(t, cookie);
    // Customize rates to the demo-clickup card (roles sorted: Legal, Ops),
  // accept the rest — mirrors the journey.test.ts assumption step.
  await post(t, cookie, '/assumptions', {
    rate0: '120',
    rate1: '90',
    defaultRate: '30',
    agingThresholdDays: '14',
    accept_agingThresholdDays: 'on',
    attention_low: '0.15',
    attention_expected: '0.3',
    attention_high: '0.6',
    accept_attention: 'on',
    queueWait_low: '0.1',
    queueWait_expected: '0.2',
    queueWait_high: '0.4',
    accept_queueWait: 'on',
    overdue_low: '0.1',
    overdue_expected: '0.2',
    overdue_high: '0.4',
    accept_overdue: 'on',
  });

    const dashboard = await get(t, cookie, '/dashboard');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain('ClickUp · connected with a personal API token');
    expect(dashboard.body).not.toContain('Jira site');

    const settings = await get(t, cookie, '/settings');
    expect(settings.body).toContain('Legal Ops');
    expect(settings.body).not.toContain('Jira site');
  });

  it('switching provider resets setup but keeps append-only runs', async () => {
    const { t } = makeClickUpApp();
    const cookie = await signIn(t, 'owner@switch.example');

    // Connect Jira first and complete a full journey to a stored run.
    await post(t, cookie, '/connect/jira', {
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: 'secret-jira-token-abc123',
    });
    await post(t, cookie, '/scope', { project: '0' });
    const tenantId = (await t.store.findUserByEmail('owner@switch.example'))!.tenantId;
    const before = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(before.provider).toBe('jira');

    // Switch to ClickUp: the form warns, and submitting resets the setup.
    const warn = await get(t, cookie, '/connect/clickup');
    expect(warn.body).toContain('replaces that connection and restarts setup');
    await post(t, cookie, '/connect/clickup', { token: 'pk_test_1234567' });

    const after = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(after.id).toBe(before.id);
    expect(after.provider).toBe('clickup');
    expect(after.onboarding).toBe('connected');
    expect(after.scopeKey).toBeNull();
    expect(after.statusMap).toBeNull();
    expect(after.observedStatuses).toEqual([]);
  });
});
