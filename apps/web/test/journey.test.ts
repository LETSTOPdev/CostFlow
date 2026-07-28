import { describe, expect, it } from 'vitest';
import { CREDENTIAL_KEY, TOKEN, get, makeApp, post, signIn, type TestApp } from './helpers';
import { decryptSecret } from '../src/crypto';

/**
 * P4.1 acceptance: the complete first-report journey (doc 09 plan §8) —
 * sign in → connect → scope → statuses → roles → assumptions → run →
 * report → return in a fresh session. The stub gateway serves the golden
 * demo-jira raw page and the job clock is pinned, so the report's figures
 * are the SAME hand-computed numbers the CLI golden froze in P1.
 */

async function completeJourneyToAssumptions(t: TestApp, cookie: string): Promise<string[]> {
  const bodies: string[] = [];
  const record = (response: { body: string }) => {
    bodies.push(response.body);
    return response;
  };

  // 2. connect a Jira workspace (validated against the gateway)
  record(
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: TOKEN,
    }),
  );
  // 3. choose the imported scope (project OPS is index 0 in the stub)
  record(await get(t, cookie, '/scope'));
  record(await post(t, cookie, '/scope', { scope: 'OPS', action: 'import' }));
  // 4a. map statuses (observed, sorted: In Progress, Review, To Do)
  record(await get(t, cookie, '/mapping/statuses'));
  record(await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' }));
  // 4b. map roles (observed, sorted: Dan Ops, Guy Contractor, Noa Legal)
  record(await get(t, cookie, '/mapping/actors'));
  record(await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' }));
  // 5. assumptions: customize rates to the demo-jira card, accept the rest
  record(await get(t, cookie, '/assumptions'));
  record(
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
    }),
  );
  return bodies;
}

describe('P4.1 acceptance: the complete first-report journey', () => {
  it('signs in, onboards, runs, views the report, and returns in a fresh session', async () => {
    const t = makeApp();
    const bodies: string[] = [];

    // 1. sign in
    const cookie = await signIn(t, 'founder@acme.example');
    bodies.push(...(await completeJourneyToAssumptions(t, cookie)));

    // provenance states persisted exactly per the transition rules
    const founderTenantId = (await t.store.findUserByEmail('founder@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(founderTenantId))[0]!;
    const assumptions = workspace.assumptions!;
    expect(assumptions.rates.map((r) => [r.roleRef, r.hourlyRate, r.provenance])).toEqual([
      ['Legal', '120', 'customer-customized'],
      ['Ops', '90', 'customer-customized'],
    ]);
    expect(assumptions.defaultRate).toMatchObject({
      hourlyRate: '30',
      provenance: 'customer-customized',
    });
    expect(assumptions.parameters.agingThresholdDays.provenance).toBe('customer-accepted');
    expect(assumptions.parameters.overdueAttentionHoursPerDay?.provenance).toBe(
      'customer-accepted',
    );
    expect(workspace.onboarding).toBe('assumptions-set');
    // credential is encrypted at rest and decrypts back to the token
    expect(workspace.tokenCiphertext).not.toContain(TOKEN);
    expect(decryptSecret(workspace.tokenCiphertext, CREDENTIAL_KEY)).toBe(TOKEN);

    // 6. run CostFlow (job awaited in tests)
    const runResponse = await post(t, cookie, '/runs', {});
    expect(runResponse.statusCode).toBe(302);
    const jobUrl = runResponse.headers['location'] as string;
    const jobPage = await get(t, cookie, jobUrl);
    expect(jobPage.statusCode).toBe(302); // succeeded → report
    const reportUrl = jobPage.headers['location'] as string;

    // 7. view the report: the P1 hand-computed figures, via the web
    const report = await get(t, cookie, reportUrl);
    bodies.push(report.body);
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain('1,062'); // F1 queue-wait "To Do" expected
    expect(report.body).toContain('342'); // F3 overdue "To Do" expected
    expect(report.body).toContain('297'); // F2 aging "To Do" expected
    expect(report.body).not.toContain('Guy Contractor'); // raw identity never rendered

    // workspace reached 'ready'; run persisted append-only
    const tenantId = (await t.store.findUserByEmail('founder@acme.example'))!.tenantId;
    const runs = await t.store.listRuns(tenantId);
    expect(runs).toHaveLength(1);
    expect((await t.store.listWorkspaces(tenantId))[0]!.onboarding).toBe('ready');
    // pseudonymization applied in the persisted artifact; raw identity absent
    expect(runs[0]!.runJson).toContain('anon-');
    expect(runs[0]!.runJson).not.toContain('Guy Contractor');

    // 8. return later: a FRESH session sees the persisted run
    const secondCookie = await signIn(t, 'founder@acme.example');
    const runsPage = await get(t, secondCookie, '/runs');
    expect(runsPage.body).toContain(runs[0]!.id);
    const again = await get(t, secondCookie, `/reports/${runs[0]!.id}`);
    expect(again.statusCode).toBe(200);
    expect(again.body).toContain('1,062');

    // credential redaction (plan §2): the token appears in NO response body
    for (const body of bodies) {
      expect(body).not.toContain(TOKEN);
    }

    // onboarding funnel telemetry: order, counts only, no customer vocabulary
    const names = t.events.map((e) => e.event);
    expect(names).toEqual([
      'tm-web-signin',
      'tm-web-workspace-connected',
      'tm-web-scope-selected',
      'tm-web-statuses-mapped',
      'tm-web-actors-mapped',
      'tm-web-assumptions-confirmed',
      'tm-web-run',
      'tm-web-report-viewed',
      'tm-web-signin',
      'tm-web-report-viewed',
    ]);
    const confirmed = t.events.find((e) => e.event === 'tm-web-assumptions-confirmed')!;
    expect(confirmed.fields).toEqual({ accepted: 4, customized: 3, vendorRemaining: 0 });
    const firstView = t.events.filter((e) => e.event === 'tm-web-report-viewed');
    expect(firstView[0]!.fields).toEqual({ firstView: true });
    expect(firstView[1]!.fields).toEqual({ firstView: false });
    const serialized = JSON.stringify(t.events);
    for (const secret of [
      TOKEN,
      'Guy Contractor',
      'Noa Legal',
      'To Do',
      'acme.atlassian',
      'Quarterly',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('report-mode provenance gate reaches the web: vendor-suggested assumptions leave frictions unpriced', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'careless@acme.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: TOKEN,
    });
    await post(t, cookie, '/scope', { scope: 'OPS', action: 'import' });
    await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
    await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
    // Submit assumptions accepting/customizing NOTHING: everything stays vendor-suggested.
    await post(t, cookie, '/assumptions', {
      rate0: '50',
      rate1: '50',
      defaultRate: '50',
      agingThresholdDays: '14',
      attention_low: '0.15',
      attention_expected: '0.3',
      attention_high: '0.6',
      queueWait_low: '0.1',
      queueWait_expected: '0.2',
      queueWait_high: '0.4',
      overdue_low: '0.1',
      overdue_expected: '0.2',
      overdue_high: '0.4',
    });
    const confirmed = t.events.find((e) => e.event === 'tm-web-assumptions-confirmed')!;
    expect(confirmed.fields['vendorRemaining']).toBe(7); // 2 roles + default + 4 params

    const runResponse = await post(t, cookie, '/runs', {});
    const jobPage = await get(t, cookie, runResponse.headers['location'] as string);
    const report = await get(t, cookie, jobPage.headers['location'] as string);
    expect(report.body).toContain('Unpriced frictions');
    expect(report.body).toContain('vendor-suggested');
    // Nothing priced at all — and the report says so as a blocked analysis
    // rather than a healthy one, because frictions WERE found (D23).
    expect(report.body).toContain('could not price');
    expect(report.body).not.toContain('genuinely healthy sign');
  });

  it('"Accept all suggested values" (v1) reaches a priced report in one click', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'fast@acme.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: TOKEN,
    });
    await post(t, cookie, '/scope', { scope: 'OPS', action: 'import' });
    await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
    await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
    // Keep the suggested values as-is and tick ONLY the master "accept all" box.
    await post(t, cookie, '/assumptions', {
      accept_all: 'on',
      rate0: '50',
      rate1: '50',
      defaultRate: '50',
      agingThresholdDays: '14',
      attention_low: '0.15',
      attention_expected: '0.3',
      attention_high: '0.6',
      queueWait_low: '0.1',
      queueWait_expected: '0.2',
      queueWait_high: '0.4',
      overdue_low: '0.1',
      overdue_expected: '0.2',
      overdue_high: '0.4',
    });
    // Every assumption is now accepted — nothing left vendor-suggested.
    const confirmed = t.events.find((e) => e.event === 'tm-web-assumptions-confirmed')!;
    expect(confirmed.fields['vendorRemaining']).toBe(0);
    expect(confirmed.fields['accepted']).toBe(7);

    const runResponse = await post(t, cookie, '/runs', {});
    const jobPage = await get(t, cookie, runResponse.headers['location'] as string);
    const report = await get(t, cookie, jobPage.headers['location'] as string);
    // A priced report, not the all-unpriced gate.
    expect(report.body).toContain('Ranked frictions');
    expect(report.body).not.toContain('No priced friction crossed your thresholds');
    expect(report.body).toContain('Confidence');
  });
});
