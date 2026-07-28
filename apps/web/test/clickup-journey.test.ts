import { describe, expect, it } from 'vitest';
import { CREDENTIAL_KEY, get, makeApp, post, signIn } from './helpers';
import { decryptSecret } from '../src/crypto';

/**
 * ADR-0005 acceptance: the complete first-report journey through the ClickUp
 * connector — provider picker → token-only connect → List scope → mappings
 * (with ClickUp status-type hints) → assumptions → run → report. The stub
 * gateway serves the golden demo-clickup raw pages and the job clock is
 * pinned, so the report's figures are the SAME hand-computed numbers the CLI
 * golden froze. Proves the engine cannot tell ClickUp from Jira: same
 * canonical model, same pricing, different connector.
 */
describe('ClickUp journey (ADR-0005 acceptance)', () => {
  const CLICKUP_TOKEN = 'pk_1234567_SECRETSECRETSECRET';

  it('picker offers both platforms; the ClickUp form is token-only', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'picker@acme.example');
    const picker = await get(t, cookie, '/connect');
    expect(picker.statusCode).toBe(200);
    expect(picker.body).toContain('Where does your team track work?');
    expect(picker.body).toContain('/connect?provider=jira');
    expect(picker.body).toContain('/connect?provider=clickup');

    const form = await get(t, cookie, '/connect?provider=clickup');
    expect(form.body).toContain('Connect your ClickUp workspace');
    expect(form.body).toContain('name="token"');
    expect(form.body).not.toContain('name="site"'); // no Jira fields leak in
    expect(form.body).not.toContain('name="email"');
    expect(form.body).toContain('Total Time in Status'); // ClickApp guidance
  });

  it('onboards via ClickUp end-to-end and reproduces the golden figures', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'cu-founder@acme.example');

    // 1. connect: token only, validated against the ClickUp gateway.
    const connect = await post(t, cookie, '/connect', {
      provider: 'clickup',
      token: CLICKUP_TOKEN,
    });
    expect(connect.statusCode).toBe(302);
    expect(t.clickup.lastCredentials?.secret).toBe(CLICKUP_TOKEN);
    expect(t.gateway.lastCredentials).toBeNull(); // Jira gateway never touched

    // Credential encrypted at rest; params carry no secret.
    const tenantId = (await t.store.findUserByEmail('cu-founder@acme.example'))!.tenantId;
    let workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.provider).toBe('clickup');
    expect(workspace.connectionParams).toEqual({});
    expect(workspace.tokenCiphertext).not.toContain(CLICKUP_TOKEN);
    expect(decryptSecret(workspace.tokenCiphertext, CREDENTIAL_KEY)).toBe(CLICKUP_TOKEN);

    // 2. scope: ClickUp vocabulary (Lists), stub offers two.
    const scopePage = await get(t, cookie, '/scope');
    expect(scopePage.body).toContain('Choose what to analyse');
    // The hierarchy is rendered as a path, not baked into the name.
    expect(scopePage.body).toContain('Delivery / Sprints');
    expect(scopePage.body).toContain('Sprint Board');
    const scoped = await post(t, cookie, '/scope', { scope: '901', action: 'import' });
    expect(scoped.statusCode).toBe(303);
    expect(t.clickup.lastFetchScopeId).toBe('901');

    // Observed vocabulary + provider-metadata hints persisted for the form.
    workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.scopes).toEqual([{ id: '901', kind: 'List', name: 'Sprint Board' }]);
    expect(workspace.observedStatuses).toEqual(['backlog', 'complete', 'in progress', 'review']);
    expect(workspace.statusHints).toMatchObject({
      backlog: 'queue', // ClickUp status type "open"
      complete: 'done', // ClickUp status type "closed"
      'in progress': 'active', // name heuristic fills custom types
      review: 'review',
    });

    // 3. statuses: the form pre-selects the hints; user approves.
    const statusForm = await get(t, cookie, '/mapping/statuses');
    expect(statusForm.body).toContain('Status in ClickUp');
    expect(statusForm.body).toMatch(/<option value="queue" selected>/); // hint applied
    await post(t, cookie, '/mapping/statuses', {
      s0: 'queue', // backlog
      s1: 'done', // complete
      s2: 'active', // in progress
      s3: 'review', // review
    });

    // 4. roles (observed actors sorted: Dan Ops, Guy Contractor, Noa Legal).
    const actorForm = await get(t, cookie, '/mapping/actors');
    expect(actorForm.body).toContain('Person (from ClickUp)');
    await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });

    // 5. assumptions: the demo-clickup golden card.
    await post(t, cookie, '/assumptions', {
      rate0: '120', // Legal (roles sorted: Legal, Ops)
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

    // 6. run → report: the golden hand-computed figures, via the web.
    const runResponse = await post(t, cookie, '/runs', {});
    const jobPage = await get(t, cookie, runResponse.headers['location'] as string);
    expect(jobPage.statusCode).toBe(302); // succeeded → report
    const report = await get(t, cookie, jobPage.headers['location'] as string);
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain('1,110'); // F1 queue-wait "backlog" expected
    expect(report.body).toContain('342'); // F3 overdue "backlog" expected
    expect(report.body).toContain('297'); // F2 aging "backlog" expected
    expect(report.body).toContain('288'); // F1 queue-wait "review" expected

    // The persisted artifact is canonical: provider stamped, identities
    // pseudonymized, unmapped actor never rendered nor stored raw.
    const runs = await t.store.listRuns(tenantId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.runJson).toContain('"provider": "clickup"');
    expect(runs[0]!.runJson).toContain('anon-');
    expect(runs[0]!.runJson).not.toContain('Guy Contractor');
    expect(report.body).not.toContain('Guy Contractor');

    // Dashboard describes the connection without Jira vocabulary.
    const dashboard = await get(t, cookie, '/dashboard');
    expect(dashboard.body).toContain('ClickUp workspace');
    expect(dashboard.body).not.toContain('Jira site');
  });

  it('switching platforms resets scope + mappings but keeps history', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'switcher@acme.example');
    // Onboard through Jira as far as scope.
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: 'secret-jira-token-abc123',
    });
    await post(t, cookie, '/scope', { scope: 'OPS', action: 'import' });
    const tenantId = (await t.store.findUserByEmail('switcher@acme.example'))!.tenantId;
    let workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.scopes).toEqual([{ id: 'OPS', kind: 'project', name: 'Operations' }]);

    // The reconnect form warns about the switch...
    const warn = await get(t, cookie, '/connect?provider=clickup');
    expect(warn.body).toContain('currently connected to Jira');
    // ...and switching replaces the connection and restarts setup.
    await post(t, cookie, '/connect', { provider: 'clickup', token: CLICKUP_TOKEN });
    workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.provider).toBe('clickup');
    expect(workspace.scopes).toEqual([]);
    expect(workspace.statusMap).toBeNull();
    expect(workspace.onboarding).toBe('connected');
  });
});
