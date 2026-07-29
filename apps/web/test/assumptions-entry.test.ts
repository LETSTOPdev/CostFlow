import { describe, expect, it } from 'vitest';
import { get, makeApp, post, signIn, type TestApp } from './helpers';

/**
 * The assumptions step, as a manager actually experiences it.
 *
 * Two changes are under test. Managers think about people, not role labels, so
 * the rate card leads with who is being priced. And most managers know a monthly
 * salary rather than an hourly rate, so the step accepts either.
 *
 * Both are constrained by the same rule: the AssumptionSet the engine prices on
 * carries hourly rates keyed on ROLE, and nothing else. A person's name reaching
 * `roleRef` would surface in the report's formula trace as `rates.<roleRef>`,
 * trip the attribution guard, and withhold the entire report.
 */

/** Drives a ClickUp workspace as far as the assumptions step. */
async function toAssumptions(
  t: TestApp,
  email: string,
): Promise<{ cookie: string; tenantId: string }> {
  const cookie = await signIn(t, email);
  await post(t, cookie, '/connect', {
    provider: 'clickup',
    token: 'pk_1234567_SECRETSECRETSECRET',
  });
  await post(t, cookie, '/scope', { scope: '901', action: 'import' });
  await post(t, cookie, '/mapping/statuses', {
    s0: 'queue',
    s1: 'done',
    s2: 'active',
    s3: 'review',
  });
  // Observed actors sort to: Dan Ops, Guy Contractor, Noa Legal.
  await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: 'Legal' });
  const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
  return { cookie, tenantId };
}

const HOURLY_FIELDS = {
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
};

describe('the rate card leads with people', () => {
  it('shows the mapped person as the primary label, with the role secondary', async () => {
    const t = makeApp();
    const { cookie } = await toAssumptions(t, 'people@acme.example');

    const form = await get(t, cookie, '/assumptions');
    expect(form.statusCode).toBe(200);
    // Roles sort Legal, Ops — so the rows are Noa Legal then Dan Ops.
    expect(form.body).toContain('Noa Legal');
    expect(form.body).toContain('Dan Ops');
    // The role is still shown, as secondary information.
    expect(form.body).toContain('Legal');
    expect(form.body).toContain('Ops');
  });

  /**
   * The whole point of keeping this display-only. If a name reached `roleRef`
   * it would render into the report trace and the guard would withhold the run.
   */
  it('never writes a person name into the stored assumption set', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'guard@acme.example');
    await post(t, cookie, '/assumptions', { ...HOURLY_FIELDS, rate0: '120', rate1: '90' });

    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    const serialized = JSON.stringify(workspace.assumptions);
    for (const person of ['Dan Ops', 'Guy Contractor', 'Noa Legal']) {
      expect(serialized, `${person} must not reach the assumption set`).not.toContain(person);
    }
    expect(workspace.assumptions!.rates.map((r) => r.roleRef).sort()).toEqual(['Legal', 'Ops']);
  });

  it('falls back to the role when nobody is mapped to it', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'unmapped@acme.example');
    await post(t, cookie, '/connect', {
      provider: 'clickup',
      token: 'pk_1234567_SECRETSECRETSECRET',
    });
    await post(t, cookie, '/scope', { scope: '901', action: 'import' });
    await post(t, cookie, '/mapping/statuses', {
      s0: 'queue',
      s1: 'done',
      s2: 'active',
      s3: 'review',
    });
    await post(t, cookie, '/mapping/actors', { a0: 'Ops', a1: '', a2: '' });
    const form = await get(t, cookie, '/assumptions');
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('Ops');
  });
});

describe('monthly salary mode', () => {
  it('offers the switch, and there is no client JavaScript doing it', async () => {
    const t = makeApp();
    const { cookie } = await toAssumptions(t, 'switch@acme.example');

    const hourly = await get(t, cookie, '/assumptions');
    expect(hourly.body).toContain('/assumptions?mode=monthly');
    expect(hourly.body).toContain('name="rate0"');

    const monthly = await get(t, cookie, '/assumptions?mode=monthly');
    expect(monthly.body).toContain('name="monthly0"');
    expect(monthly.body).toContain('name="hoursPerMonth"');
    expect(monthly.body).toContain('/assumptions?mode=hourly');
  });

  /**
   * 8000 ÷ 176 = 45.454545… Exact decimal through the engine's Money type,
   * rounded to 4dp. A float would produce a figure that cannot reproduce itself.
   */
  it('derives the hourly rate by exact decimal division', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'derive@acme.example');
    await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '176',
      monthly0: '8000',
      monthly1: '7040',
    });

    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    const byRole = Object.fromEntries(
      workspace.assumptions!.rates.map((r) => [r.roleRef, r.hourlyRate]),
    );
    expect(byRole['Legal']).toBe('45.4545');
    expect(byRole['Ops']).toBe('40'); // 7040 ÷ 176 divides exactly
  });

  it('remembers the salary and divisor so the derivation can be shown again', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'remember@acme.example');
    await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '160',
      monthly0: '8000',
      monthly1: '8000',
    });

    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.rateInput).toMatchObject({ mode: 'monthly', hoursPerMonth: 160 });
    expect(workspace.rateInput!.monthlyByRole['Legal']).toBe('8000');

    // Returning to the step shows the arithmetic, not just the result.
    const form = await get(t, cookie, '/assumptions');
    expect(form.body).toContain('8000');
    expect(form.body).toContain('÷ 160 h');
    expect(form.body).toContain('50 USD/h');
  });

  /** The salary is workspace configuration; the engine still prices on hourly. */
  it('keeps the salary out of the assumption set entirely', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'sep@acme.example');
    await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '176',
      monthly0: '8000',
      monthly1: '8000',
    });
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(JSON.stringify(workspace.assumptions)).not.toContain('8000');
    expect(JSON.stringify(workspace.assumptions)).not.toContain('hoursPerMonth');
  });

  /** A salary the customer typed is theirs, so it leaves vendor-suggested. */
  it('treats an entered salary as customer-owned', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'prov@acme.example');
    await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '176',
      monthly0: '8000',
      monthly1: '9000',
    });
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    for (const rate of workspace.assumptions!.rates) {
      expect(rate.provenance).not.toBe('vendor-suggested');
    }
  });

  it('rejects a malformed salary rather than guessing', async () => {
    const t = makeApp();
    const { cookie } = await toAssumptions(t, 'bad@acme.example');
    const res = await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '176',
      monthly0: 'eight thousand',
      monthly1: '8000',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid');
  });

  it('switching back to hourly clears the stale salary record', async () => {
    const t = makeApp();
    const { cookie, tenantId } = await toAssumptions(t, 'clear@acme.example');
    await post(t, cookie, '/assumptions', {
      ...HOURLY_FIELDS,
      rateMode: 'monthly',
      hoursPerMonth: '176',
      monthly0: '8000',
      monthly1: '8000',
    });
    await post(t, cookie, '/assumptions', { ...HOURLY_FIELDS, rate0: '120', rate1: '90' });
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    expect(workspace.rateInput).toBeNull();
    expect(workspace.assumptions!.rates.find((r) => r.roleRef === 'Legal')!.hourlyRate).toBe('120');
  });
});

describe('ClickUp token instructions', () => {
  /**
   * The previous copy said "Settings → Apps", which is the path ClickUp's own
   * developer documentation still gives and which no longer exists in the UI.
   * It also pointed at Generate first — regenerating asks for the account
   * password and invalidates the current token, breaking anything else using it.
   */
  it('gives the current path and warns about regenerating', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'help@acme.example');
    const form = await get(t, cookie, '/connect?provider=clickup');

    expect(form.body).toContain('Integrations &amp; ClickApps');
    expect(form.body).toContain('ClickUp API');
    expect(form.body).toContain('API Token');
    expect(form.body).toContain('Only use Regenerate if you have no token yet');
    expect(form.body).toContain('invalidates the current token');
    // The stale path must not come back.
    expect(form.body).not.toMatch(/Settings<\/strong> → <strong>Apps/);
  });

  it('still explains what the Total Time in Status ClickApp unlocks', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'clickapp@acme.example');
    const form = await get(t, cookie, '/connect?provider=clickup');
    expect(form.body).toContain('Total Time in Status');
    expect(form.body).toContain('time spent waiting in a stage');
  });
});

/**
 * Two onboarding steps let a customer make a choice whose consequence only
 * appears in the report, several minutes later. Both cost the same thing —
 * confidence in the first analysis — and both were silent about it.
 */
describe('onboarding states the cost of the fast path', () => {
  it('warns that skipping roles caps the whole report at confidence C', async () => {
    const t = makeApp();
    const email = 'roles@acme.example';
    const cookie = await signIn(t, email);
    await post(t, cookie, '/connect', { provider: 'clickup', token: 'pk_12345678' });
    await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    await post(
      t,
      cookie,
      '/mapping/statuses',
      Object.fromEntries(
        workspace.observedStatuses.map((st, i) => [
          `s${i}`,
          st === 'complete' || st === 'done' ? 'done' : st === 'review' ? 'review' : 'queue',
        ]),
      ),
    );

    const form = await get(t, cookie, '/mapping/actors');
    expect(form.statusCode).toBe(200);
    // Still honestly the fastest path.
    expect(form.body).toContain('fastest path');
    // And now the price of taking it, at the point of choice.
    expect(form.body).toContain('confidence C');
  });

  it('says on the assumptions step what leaving a value unconfirmed produces', async () => {
    const t = makeApp();
    const { cookie } = await toAssumptions(t, 'consequence@acme.example');
    const form = await get(t, cookie, '/assumptions');
    // The consequence before the button, not discovered in the report.
    const warning = form.body.indexOf('stays vendor-suggested');
    const save = form.body.indexOf('Save assumptions');
    expect(warning).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(warning);
    expect(form.body).toContain('<strong>unpriced</strong>');
  });
});
