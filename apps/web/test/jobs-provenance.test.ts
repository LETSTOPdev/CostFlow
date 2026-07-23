import { describe, expect, it } from 'vitest';
import { GatewayError } from '../src/connectors/types';
import { nextProvenance } from '../src/assumptions';
import { TOKEN, get, makeApp, post, signIn, type TestApp } from './helpers';

async function onboardToReady(t: TestApp, email: string): Promise<string> {
  const cookie = await signIn(t, email);
  await post(t, cookie, '/connect', {
    provider: 'jira',
    site: 'https://acme.atlassian.net',
    email,
    token: TOKEN,
  });
  await post(t, cookie, '/scope', { project: '0' });
  await post(t, cookie, '/mapping/statuses', { s0: 'active', s1: 'review', s2: 'queue' });
  await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
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
  return cookie;
}

describe('job lifecycle, failure, and retry (doc 09 P4.1 plan §3/§7)', () => {
  it('a fetch failure produces a failed job with a sanitized class; retry is a NEW job that succeeds', async () => {
    const t = makeApp();
    const cookie = await onboardToReady(t, 'jobs@acme.example');
    t.gateway.failFetchWith = new GatewayError(
      'auth-error',
      'search',
      'Jira rejected the credentials (401).',
      401,
    );

    const failedRun = await post(t, cookie, '/runs', {});
    const failedJobUrl = failedRun.headers['location'] as string;
    const failedPage = await get(t, cookie, failedJobUrl);
    expect(failedPage.statusCode).toBe(200);
    expect(failedPage.body).toContain('Run failed');
    expect(failedPage.body).toContain('auth-error');
    expect(failedPage.body).not.toContain(TOKEN);

    const tenantId = (await t.store.findUserByEmail('jobs@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(await t.store.listJobsForWorkspace(tenantId, workspace.id)).toHaveLength(1);
    expect(await t.store.listRuns(tenantId)).toHaveLength(0);

    // Retry: gateway recovers; a SECOND job row appears; the first stays failed.
    t.gateway.failFetchWith = null;
    const retry = await post(t, cookie, '/runs', {});
    const retryPage = await get(t, cookie, retry.headers['location'] as string);
    expect(retryPage.statusCode).toBe(302); // succeeded → report redirect
    const jobs = await t.store.listJobsForWorkspace(tenantId, workspace.id);
    expect(jobs.map((j) => j.status)).toEqual(['failed', 'succeeded']);
    expect(await t.store.listRuns(tenantId)).toHaveLength(1);

    const runEvents = t.events.filter((e) => e.event === 'tm-web-run');
    expect(runEvents[0]!.fields).toMatchObject({ ok: false, errorClass: 'auth-error' });
    expect(runEvents[1]!.fields).toMatchObject({ ok: true, errorClass: null });
  });

  it('jobs left running by a crash are marked failed/interrupted at startup', async () => {
    const t = makeApp();
    await onboardToReady(t, 'crash@acme.example');
    const tenantId = (await t.store.findUserByEmail('crash@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    const job = await t.store.createJob(tenantId, workspace.id);
    await t.store.updateJob(tenantId, job.id, { status: 'running' });

    const recovered = await t.store.markInterruptedJobs('2026-07-21T00:00:00Z');
    expect(recovered).toBe(1);
    const after = await t.store.getJob(tenantId, job.id);
    expect(after).toMatchObject({
      status: 'failed',
      errorClass: 'unexpected',
      errorMessage: 'Interrupted by server restart.',
    });
  });
});

describe('provenance transitions (doc 09 P4.1 plan §5)', () => {
  it('follows the frozen transition table', () => {
    // vendor + accept → accepted; vendor + no action → vendor
    expect(nextProvenance('vendor-suggested', false, true)).toBe('customer-accepted');
    expect(nextProvenance('vendor-suggested', false, false)).toBe('vendor-suggested');
    // any change → customized, from any state
    expect(nextProvenance('vendor-suggested', true, false)).toBe('customer-customized');
    expect(nextProvenance('customer-accepted', true, false)).toBe('customer-customized');
    expect(nextProvenance('customer-measured', true, false)).toBe('customer-customized');
    // owned states never silently downgrade on an unchanged resubmit
    expect(nextProvenance('customer-accepted', false, false)).toBe('customer-accepted');
    expect(nextProvenance('customer-customized', false, false)).toBe('customer-customized');
    expect(nextProvenance('customer-customized', false, true)).toBe('customer-customized');
    expect(nextProvenance('customer-measured', false, false)).toBe('customer-measured');
  });

  it('re-editing assumptions preserves owned states and upgrades only what changed', async () => {
    const t = makeApp();
    const cookie = await onboardToReady(t, 'prov@acme.example');
    const tenantId = (await t.store.findUserByEmail('prov@acme.example'))!.tenantId;
    // Resubmit with ONE change (aging threshold 14 → 21) and no accept boxes.
    await post(t, cookie, '/assumptions', {
      rate0: '120',
      rate1: '90',
      defaultRate: '30',
      agingThresholdDays: '21',
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
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    const assumptions = workspace.assumptions!;
    expect(assumptions.parameters.agingThresholdDays).toMatchObject({
      value: 21,
      provenance: 'customer-customized',
    });
    // untouched values keep their earlier owned states
    expect(assumptions.parameters.attentionHoursPerDay.provenance).toBe('customer-accepted');
    expect(assumptions.rates[0]).toMatchObject({
      hourlyRate: '120',
      provenance: 'customer-customized',
    });
    expect(assumptions.version).toBe('2');
  });
});
