import { describe, expect, it } from 'vitest';
import { makeApp, post, signIn, type TestApp } from './helpers';
import {
  CUSTOMER_STATUS_LABELS,
  HEALTH_MAX_SCORE,
  matchesCustomerFilter,
  scoreCustomer,
} from '../src/health';
import {
  buildFunnel,
  conversionPct,
  dropOffPct,
  formatDuration,
  FUNNEL_STEPS,
} from '../src/funnel';
import { authProviderFromSub, sanitizeFields, shouldTouchLastSeen } from '../src/events';
import type { CustomerSignals } from '../src/store/contract';

/**
 * Customer database & activity spine (P4.5).
 *
 * The properties pinned here are the ones that would quietly rot: the health
 * score staying deterministic and explainable, the funnel refusing to invent
 * timings it cannot know, the events table refusing customer vocabulary, and
 * every new console surface staying behind the admin allowlist with no secret
 * or raw financial content in the rendered HTML.
 */

const ADMIN = 'boss@ops.example';
const NOW = '2026-07-28T12:00:00.000Z';

const get = (t: TestApp, cookie: string, url: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });

async function adminApp(): Promise<{ t: TestApp; cookie: string }> {
  const t = makeApp({ adminEmails: [ADMIN] });
  const cookie = await signIn(t, ADMIN);
  return { t, cookie };
}

/** Signals for a customer who does everything, used as the scoring ceiling. */
function perfectSignals(): CustomerSignals {
  return {
    nowIso: NOW,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: NOW,
    signInCount: 40,
    workspaces: 3,
    readyWorkspaces: 3,
    analyses: 60,
    analyses30d: 12,
    lastAnalysisAt: NOW,
    reportsViewed: 30,
    onboardingRank: 5,
    returned: true,
  };
}

function signals(overrides: Partial<CustomerSignals>): CustomerSignals {
  return {
    nowIso: NOW,
    createdAt: NOW,
    lastSeenAt: null,
    signInCount: 0,
    workspaces: 0,
    readyWorkspaces: 0,
    analyses: 0,
    analyses30d: 0,
    lastAnalysisAt: null,
    reportsViewed: 0,
    onboardingRank: -1,
    returned: false,
    ...overrides,
  };
}

const daysAgo = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

describe('health score is deterministic and explainable', () => {
  it('returns an identical result for identical signals', () => {
    const a = scoreCustomer(perfectSignals());
    const b = scoreCustomer(perfectSignals());
    expect(a).toEqual(b);
  });

  it('tops out at exactly the declared maximum', () => {
    const result = scoreCustomer(perfectSignals());
    expect(result.score).toBe(HEALTH_MAX_SCORE);
    expect(result.band).toBe('healthy');
  });

  it('floors at zero for a long-abandoned signup', () => {
    const result = scoreCustomer(signals({ createdAt: daysAgo(400), lastSeenAt: daysAgo(400) }));
    expect(result.score).toBe(0);
  });

  it('always reports factors that sum to the score', () => {
    for (const s of [
      perfectSignals(),
      signals({}),
      signals({ analyses30d: 3, readyWorkspaces: 1 }),
    ]) {
      const result = scoreCustomer(s);
      const summed = result.factors.reduce((total, f) => total + f.points, 0);
      expect(summed).toBe(result.score);
      expect(result.factors.reduce((total, f) => total + f.max, 0)).toBe(HEALTH_MAX_SCORE);
    }
  });

  it('never lets a factor exceed its own maximum', () => {
    const result = scoreCustomer(perfectSignals());
    for (const factor of result.factors) expect(factor.points).toBeLessThanOrEqual(factor.max);
  });
});

describe('lifecycle status separates churn from a stalled start', () => {
  it('calls a quiet, previously-engaged customer a churn risk', () => {
    const result = scoreCustomer(
      signals({
        createdAt: daysAgo(90),
        lastSeenAt: daysAgo(25),
        analyses: 8,
        lastAnalysisAt: daysAgo(25),
        readyWorkspaces: 1,
        onboardingRank: 5,
      }),
    );
    expect(result.status).toBe('churn-risk');
    expect(result.band).toBe('churn-risk');
  });

  it('does NOT call a never-engaged signup a churn risk', () => {
    // Same silence, no prior engagement. Chasing this customer to "win them
    // back" would be chasing someone who never arrived.
    const result = scoreCustomer(
      signals({
        createdAt: daysAgo(90),
        lastSeenAt: daysAgo(60),
        workspaces: 1,
        onboardingRank: 0,
      }),
    );
    expect(result.status).toBe('inactive');
    expect(result.band).toBe('inactive');
  });

  it('classifies a fresh signup with no connection as new', () => {
    expect(scoreCustomer(signals({ createdAt: daysAgo(2), lastSeenAt: daysAgo(1) })).status).toBe(
      'new',
    );
  });

  it('classifies a connected, not-yet-analyzing customer as onboarding', () => {
    const result = scoreCustomer(
      signals({ createdAt: daysAgo(3), lastSeenAt: daysAgo(1), workspaces: 1, onboardingRank: 2 }),
    );
    expect(result.status).toBe('onboarding');
  });

  it('classifies a recently-analyzing customer as active', () => {
    const result = scoreCustomer(
      signals({
        createdAt: daysAgo(30),
        lastSeenAt: daysAgo(1),
        workspaces: 1,
        readyWorkspaces: 1,
        onboardingRank: 5,
        analyses: 5,
        analyses30d: 3,
        lastAnalysisAt: daysAgo(2),
      }),
    );
    expect(result.status).toBe('active');
  });

  it('covers every status with a label', () => {
    for (const status of ['new', 'onboarding', 'active', 'inactive', 'churn-risk'] as const)
      expect(CUSTOMER_STATUS_LABELS[status]).toBeTruthy();
  });

  it('matches abandoned onboarding: connected, never analyzed, gone quiet', () => {
    const abandoned = matchesCustomerFilter('abandoned');
    expect(abandoned({ status: 'inactive', analyses: 0, workspaces: 1, readyWorkspaces: 0 })).toBe(
      true,
    );
    // Finished setting up, so not abandoned.
    expect(abandoned({ status: 'inactive', analyses: 0, workspaces: 1, readyWorkspaces: 1 })).toBe(
      false,
    );
    // Never connected anything, so there was no onboarding to abandon.
    expect(abandoned({ status: 'inactive', analyses: 0, workspaces: 0, readyWorkspaces: 0 })).toBe(
      false,
    );
  });
});

describe('funnel arithmetic', () => {
  const rowWith = (reached: boolean[], at: (string | null)[]) => ({ tenantId: 't', reached, at });
  const pad = <T>(values: T[], fill: T): T[] => {
    const out = [...values];
    while (out.length < FUNNEL_STEPS.length) out.push(fill);
    return out;
  };

  it('counts organizations reaching each step', () => {
    const report = buildFunnel(
      [
        rowWith(pad([true, true, true, true], false), pad([NOW, null, NOW, NOW], null)),
        rowWith(pad([true, true], false), pad([NOW, null], null)),
      ],
      null,
      null,
    );
    expect(report.steps[0]?.reached).toBe(2);
    expect(report.steps[3]?.reached).toBe(1);
  });

  it('reports conversion from the first step and drop-off from the previous one', () => {
    const report = buildFunnel(
      [
        rowWith(pad([true, true, true, true], false), pad([], null)),
        rowWith(pad([true, true], false), pad([], null)),
        rowWith(pad([true, true], false), pad([], null)),
        rowWith(pad([true], false), pad([], null)),
      ],
      null,
      null,
    );
    const first = report.steps[0]!;
    expect(first.reached).toBe(4);
    // 3 of 4 reached step 2 → 75% conversion, 25% drop-off from step 1.
    expect(conversionPct(report.steps[1]!, first)).toBe(75);
    expect(dropOffPct(report.steps[1]!, first)).toBe(25);
    // 1 of 4 reached step 3 → 25% conversion, but 66.7% drop-off from step 2.
    expect(conversionPct(report.steps[2]!, first)).toBe(25);
    expect(dropOffPct(report.steps[2]!, report.steps[1]!)).toBe(66.7);
  });

  it('averages time to next step only when BOTH endpoints are timestamped', () => {
    const hourLater = new Date(Date.parse(NOW) + 3_600_000).toISOString();
    const report = buildFunnel(
      [
        // Step 0 → 1 has both timestamps; step 2 → 3 has only the first.
        rowWith(pad([true, true, true, true], false), pad([NOW, hourLater, NOW, null], null)),
      ],
      null,
      null,
    );
    expect(report.steps[0]?.avgToNextMs).toBe(3_600_000);
    expect(report.steps[2]?.avgToNextMs).toBeNull();
  });

  it('never reports a negative duration from out-of-order backfilled history', () => {
    const earlier = new Date(Date.parse(NOW) - 3_600_000).toISOString();
    const report = buildFunnel(
      [rowWith(pad([true, true], false), pad([NOW, earlier], null))],
      null,
      null,
    );
    expect(report.steps[0]?.avgToNextMs).toBeNull();
  });

  it('flags a step whose membership came from state rather than a timestamp', () => {
    const report = buildFunnel(
      [rowWith(pad([true, true], false), pad([NOW, null], null))],
      null,
      null,
    );
    expect(report.steps[0]?.fromState).toBe(false);
    expect(report.steps[1]?.fromState).toBe(true);
  });

  it('formats durations compactly and says nothing when there is nothing to say', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(3 * 3_600_000 + 30 * 60_000)).toBe('3h 30m');
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
  });
});

describe('the events table cannot be made to hold customer vocabulary', () => {
  it('keeps counts, enums, booleans, and null', () => {
    expect(sanitizeFields({ ok: true, count: 12, errorClass: 'auth-error', prev: null })).toEqual({
      ok: true,
      count: 12,
      errorClass: 'auth-error',
      prev: null,
    });
  });

  it('drops nested structures, which is how free text arrives', () => {
    const cleaned = sanitizeFields({
      issue: { title: 'Fix the billing bug for Acme' },
      actors: ['alice@acme.example', 'bob@acme.example'],
      ok: true,
    });
    expect(cleaned).toEqual({ ok: true });
  });

  it('truncates long strings rather than storing a sentence', () => {
    const long = 'x'.repeat(400);
    const value = sanitizeFields({ note: long })['note'] as string;
    expect(value.length).toBeLessThanOrEqual(64);
  });

  it('caps the number of fields', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) wide[`k${i}`] = i;
    expect(Object.keys(sanitizeFields(wide)).length).toBeLessThanOrEqual(12);
  });

  it('drops non-finite numbers', () => {
    expect(sanitizeFields({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 1 })).toEqual({ c: 1 });
  });
});

describe('activity tracking is bounded and honest about identity', () => {
  it('refreshes last-seen when never set or stale, and skips when fresh', () => {
    expect(shouldTouchLastSeen(null, NOW)).toBe(true);
    expect(shouldTouchLastSeen(new Date(Date.parse(NOW) - 60_000).toISOString(), NOW)).toBe(false);
    expect(shouldTouchLastSeen(new Date(Date.parse(NOW) - 3_600_000).toISOString(), NOW)).toBe(
      true,
    );
  });

  it('keeps only the connection prefix of an IdP subject, never the subject id', () => {
    expect(authProviderFromSub('google-oauth2|10937')).toBe('google-oauth2');
    expect(authProviderFromSub('auth0|abc')).toBe('auth0');
    expect(authProviderFromSub(undefined)).toBeUndefined();
    expect(authProviderFromSub('')).toBeUndefined();
  });
});

describe('the console records who did what', () => {
  it('attributes a sign-in to the user and their organization', async () => {
    const { t, cookie } = await adminApp();
    const res = await get(t, cookie, '/admin/activity');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('signed in');
    expect(res.body).toContain(ADMIN);
  });

  it('counts the first sign-in exactly once', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    await signIn(t, ADMIN);
    const user = await t.store.findUserByEmail(ADMIN);
    expect(user?.identity.signInCount).toBe(1);
    expect(user?.identity.firstSeenAt).not.toBeNull();
  });

  it('increments the count on a second sign-in and keeps the first-seen instant', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    await signIn(t, ADMIN);
    const first = (await t.store.findUserByEmail(ADMIN))?.identity.firstSeenAt;
    await signIn(t, ADMIN);
    const user = await t.store.findUserByEmail(ADMIN);
    expect(user?.identity.signInCount).toBe(2);
    expect(user?.identity.firstSeenAt).toBe(first);
  });

  it('records naming a monitoring workspace, and shows the name in the console', async () => {
    const { t, cookie } = await adminApp();
    const session = await t.store.findUserByEmail(ADMIN);
    const ws = await t.store.createWorkspace(session!.tenantId, {
      provider: 'jira',
      connectionParams: { site: 'https://x.atlassian.net', email: 'a@b.c' },
      tokenCiphertext: 'TOKEN-SECRET-should-never-render',
    });
    const named = await post(t, cookie, `/workspaces/${ws.id}/name`, { name: 'Engineering' });
    expect(named.statusCode).toBe(302);
    const monitoring = await get(t, cookie, '/admin/monitoring');
    expect(monitoring.body).toContain('Engineering');
    const feed = await get(t, cookie, '/admin/activity');
    expect(feed.body).toContain('named a monitoring workspace');
  });

  it('clears the name when the field is submitted empty', async () => {
    const { t, cookie } = await adminApp();
    const user = await t.store.findUserByEmail(ADMIN);
    const ws = await t.store.createWorkspace(user!.tenantId, {
      provider: 'jira',
      connectionParams: {},
      tokenCiphertext: 'x',
    });
    await post(t, cookie, `/workspaces/${ws.id}/name`, { name: 'Engineering' });
    await post(t, cookie, `/workspaces/${ws.id}/name`, { name: '  ' });
    const after = await t.store.getWorkspace(user!.tenantId, ws.id);
    expect(after?.name).toBeNull();
  });

  /**
   * The spine has to outlive the vocabulary it shipped with. A rolling deploy
   * alone guarantees the older replica reads rows written by the newer one, so
   * an unrecognized type must render as an ordinary feed entry rather than a
   * blank line, a crash, or an escape hatch for unescaped text.
   */
  it('renders an event type it has never seen, without crashing or breaking escaping', async () => {
    const { t, cookie } = await adminApp();
    const user = await t.store.findUserByEmail(ADMIN);
    await t.store.recordEvent({
      tenantId: user!.tenantId,
      userId: user!.id,
      workspaceId: null,
      type: 'quota.<script>alert(1)</script>',
      fields: {},
    });
    const feed = await get(t, cookie, '/admin/activity');
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('quota.&lt;script&gt;');
    expect(feed.body).not.toContain('<script>');
    // The fallback description names the actor rather than dropping the row.
    expect(feed.body).toContain(ADMIN);
  });

  it('erases activity along with the organization (FR-22)', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    const cookie = await signIn(t, 'owner@acme.example');
    const user = await t.store.findUserByEmail('owner@acme.example');
    const before = await t.store.adminActivityFeed({ limit: 50, offset: 0 });
    expect(before.total).toBeGreaterThan(0);
    const erased = await post(t, cookie, '/account/delete', { confirm: 'DELETE ALL DATA' });
    expect(erased.statusCode).toBe(302);
    const after = await t.store.adminActivityFeed({
      limit: 50,
      offset: 0,
      tenantId: user!.tenantId,
    });
    expect(after.total).toBe(0);
  });
});

describe('every CRM surface stays behind the admin allowlist', () => {
  const SURFACES = [
    '/admin',
    '/admin/customers',
    '/admin/funnel',
    '/admin/activity',
    '/admin/monitoring',
  ];

  it('404s a non-admin authenticated user on every surface, with no disclosure', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    const cookie = await signIn(t, 'stranger@acme.example');
    for (const url of SURFACES) {
      const res = await get(t, cookie, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('Operations console');
    }
  });

  it('redirects an anonymous visitor to sign-in rather than answering', async () => {
    const t = makeApp({ adminEmails: [ADMIN] });
    for (const url of SURFACES) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(302);
    }
  });

  it('is inert when no allowlist is configured', async () => {
    const t = makeApp({});
    const cookie = await signIn(t, ADMIN);
    for (const url of SURFACES) expect((await get(t, cookie, url)).statusCode, url).toBe(404);
  });
});

describe('no secret or raw financial content reaches the CRM views', () => {
  const SECRETS = [
    'TOKEN-SECRET-should-never-render',
    'SALT-SECRET-should-never-render',
    'RUNJSON-SECRET-should-never-render',
    'REPORTMD-SECRET-should-never-render',
    'TELEMETRY-SECRET-should-never-render',
  ];

  async function seeded(): Promise<{
    t: TestApp;
    cookie: string;
    userId: string;
    tenantId: string;
  }> {
    const { t, cookie } = await adminApp();
    const { tenant, user } = await t.store.createTenantWithUser(
      'owner@acme.example',
      'SALT-SECRET-should-never-render',
    );
    await t.store.updateTenantName(tenant.id, 'Acme Corp');
    const ws = await t.store.createWorkspace(tenant.id, {
      provider: 'jira',
      connectionParams: { site: 'https://acme.atlassian.net', email: 'ops@acme.example' },
      tokenCiphertext: 'TOKEN-SECRET-should-never-render',
    });
    await t.store.updateWorkspace(tenant.id, ws.id, { onboarding: 'ready', name: 'Engineering' });
    await t.store.createRun({
      id: 'run-acme-1',
      tenantId: tenant.id,
      workspaceId: ws.id,
      createdAt: new Date().toISOString(),
      runJson: 'RUNJSON-SECRET-should-never-render',
      reportMd: 'REPORTMD-SECRET-should-never-render',
      telemetryJsonl: 'TELEMETRY-SECRET-should-never-render',
    });
    return { t, cookie, userId: user.id, tenantId: tenant.id };
  }

  it('renders the customer list, detail, org view, and feed without any secret', async () => {
    const { t, cookie, userId, tenantId } = await seeded();
    for (const url of [
      '/admin/customers',
      `/admin/customers/${userId}`,
      `/admin/tenants/${tenantId}`,
      '/admin/monitoring',
      '/admin/activity',
      '/admin/funnel',
      '/admin',
    ]) {
      const res = await get(t, cookie, url);
      expect(res.statusCode, url).toBe(200);
      for (const secret of SECRETS)
        expect(res.body, `${url} leaked ${secret}`).not.toContain(secret);
    }
  });

  it('shows the customer with an explainable score rather than a bare number', async () => {
    const { t, cookie, userId } = await seeded();
    const res = await get(t, cookie, `/admin/customers/${userId}`);
    expect(res.body).toContain('owner@acme.example');
    expect(res.body).toContain('Onboarding completion');
    expect(res.body).toContain('Analysis cadence');
    expect(res.body).toContain('Deterministic');
  });

  it('reports billing honestly as free beta with no invented dates', async () => {
    const { t, cookie, userId } = await seeded();
    const res = await get(t, cookie, `/admin/customers/${userId}`);
    expect(res.body).toContain('free_beta');
    expect(res.body).toContain('beta');
    // Trial and renewal read as absent, because they are.
    expect(res.body).toContain('Trial ends');
    expect(res.body).not.toContain('on_trial');
  });

  it('says which integrations an organization connected', async () => {
    const { t, cookie, tenantId } = await seeded();
    const res = await get(t, cookie, `/admin/tenants/${tenantId}`);
    expect(res.body).toContain('jira');
    expect(res.body).toContain('Engineering');
  });
});

describe('customer filters and pagination', () => {
  async function seedMany(count: number): Promise<{ t: TestApp; cookie: string }> {
    const { t, cookie } = await adminApp();
    for (let i = 0; i < count; i += 1) {
      const { tenant } = await t.store.createTenantWithUser(`user${i}@acme.example`, 'salt');
      await t.store.updateTenantName(tenant.id, `Org ${i}`);
    }
    return { t, cookie };
  }

  it('paginates without losing or repeating rows', async () => {
    const { t, cookie } = await seedMany(12);
    const first = await get(t, cookie, '/admin/customers?limit=5&offset=0&sort=email&dir=asc');
    const second = await get(t, cookie, '/admin/customers?limit=5&offset=5&sort=email&dir=asc');
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const emails = (body: string): string[] =>
      [...body.matchAll(/user(\d+)@acme\.example/g)].map((m) => m[0] as string);
    const page1 = new Set(emails(first.body));
    const page2 = new Set(emails(second.body));
    expect(page1.size).toBeGreaterThan(0);
    for (const email of page2) expect(page1.has(email)).toBe(false);
  });

  it('filters by lifecycle status', async () => {
    const { t, cookie } = await seedMany(3);
    const res = await get(t, cookie, '/admin/customers?cstatus=new');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('user0@acme.example');
    const none = await get(t, cookie, '/admin/customers?cstatus=active');
    expect(none.body).not.toContain('user0@acme.example');
  });

  it('filters by connected integration', async () => {
    const { t, cookie } = await adminApp();
    const { tenant } = await t.store.createTenantWithUser('clickup@acme.example', 'salt');
    await t.store.createWorkspace(tenant.id, {
      provider: 'clickup',
      connectionParams: {},
      tokenCiphertext: 'x',
    });
    const match = await get(t, cookie, '/admin/customers?provider=clickup');
    expect(match.body).toContain('clickup@acme.example');
    const miss = await get(t, cookie, '/admin/customers?provider=jira');
    expect(miss.body).not.toContain('clickup@acme.example');
  });

  it('searches by email and by organization name', async () => {
    const { t, cookie } = await adminApp();
    const { tenant } = await t.store.createTenantWithUser('findme@acme.example', 'salt');
    await t.store.updateTenantName(tenant.id, 'Northwind Traders');
    expect((await get(t, cookie, '/admin/customers?q=findme')).body).toContain(
      'findme@acme.example',
    );
    expect((await get(t, cookie, '/admin/customers?q=Northwind')).body).toContain(
      'findme@acme.example',
    );
    expect((await get(t, cookie, '/admin/customers?q=nobody-here')).body).not.toContain(
      'findme@acme.example',
    );
  });
});

describe('the console keeps its no-JavaScript posture', () => {
  it('ships no script tag on any CRM surface', async () => {
    const { t, cookie } = await adminApp();
    for (const url of ['/admin', '/admin/customers', '/admin/funnel', '/admin/activity']) {
      const res = await get(t, cookie, url);
      expect(res.body.toLowerCase(), url).not.toContain('<script');
      expect(res.body.toLowerCase(), url).not.toContain('onclick=');
    }
  });
});
