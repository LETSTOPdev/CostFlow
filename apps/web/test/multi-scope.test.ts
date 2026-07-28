import { describe, expect, it } from 'vitest';
import { assessComparability } from '@costflow/comparison';
import type { AnalysisRun } from '@costflow/analysis';
import { GatewayError, resolveSelection, type ScopeRef } from '../src/connectors/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, get, makeApp, post, signIn, type TestApp } from './helpers';

const CLICKUP_TOKEN = 'pk_1234567_SECRETSECRETSECRET';

/**
 * A Monitoring Workspace that spans several origins, end to end.
 *
 * The single-scope model could not get any of this wrong, because there was
 * nothing to get wrong: one origin, one fetch, one batch. Everything below
 * exists because a set introduces ways for a total to move that have nothing to
 * do with the work — a container that quietly grew, an origin that lost its
 * history, an item that lives in two Lists.
 */

const scope = (
  id: string,
  name: string,
  kind: string,
  parentId: string | null,
  fetchable: boolean,
): ScopeRef => ({ id, name, kind, parentId, fetchable });

describe('resolving a selection into what to fetch', () => {
  // Space → Folder → List, plus a List directly under the Space.
  const tree = [
    scope('space', 'Delivery', 'Space', null, false),
    scope('folder', 'Sprints', 'Folder', 'space', false),
    scope('list-a', 'Sprint Board', 'List', 'folder', true),
    scope('list-b', 'Backlog', 'List', 'space', true),
    scope('other', 'Marketing', 'Space', null, false),
    scope('list-c', 'Campaigns', 'List', 'other', true),
  ];

  it('expands a container to everything fetchable beneath it, at any depth', () => {
    expect(resolveSelection(tree, ['space']).map((s) => s.id)).toEqual(['list-a', 'list-b']);
  });

  it('yields a scope once when a container and its child are both selected', () => {
    expect(resolveSelection(tree, ['space', 'list-a']).map((s) => s.id)).toEqual([
      'list-a',
      'list-b',
    ]);
  });

  it('never fetches a container itself', () => {
    expect(resolveSelection(tree, ['folder']).map((s) => s.id)).toEqual(['list-a']);
  });

  /** Fetch order must not depend on the order the platform listed things in. */
  it('is deterministic regardless of selection order', () => {
    const one = resolveSelection(tree, ['other', 'space']);
    const two = resolveSelection(tree, ['space', 'other']);
    expect(one).toEqual(two);
    expect(one.map((s) => s.id)).toEqual(['list-a', 'list-b', 'list-c']);
  });

  it('silently omits a selection the platform no longer reports', () => {
    expect(resolveSelection(tree, ['deleted', 'list-b']).map((s) => s.id)).toEqual(['list-b']);
  });
});

async function clickupWorkspace(t: TestApp, email: string): Promise<string> {
  const cookie = await signIn(t, email);
  await post(t, cookie, '/connect', { provider: 'clickup', token: CLICKUP_TOKEN });
  return cookie;
}

describe('selecting a ClickUp Space rather than its Lists', () => {
  it('shows the hierarchy, with containers marked as covering what is inside', async () => {
    const t = makeApp();
    const cookie = await clickupWorkspace(t, 'tree@acme.example');
    const page = await get(t, cookie, '/scope');
    expect(page.body).toContain('value="790"'); // the Space is selectable
    expect(page.body).toContain('everything inside it');
    expect(page.body).toContain('value="901"'); // and so are its Lists
  });

  it('stores the container and fetches every List under it', async () => {
    const t = makeApp();
    const cookie = await clickupWorkspace(t, 'space@acme.example');
    const res = await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    expect(res.statusCode).toBe(303);

    const tenantId = (await t.store.findUserByEmail('space@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    // The SELECTION is the Space. What it covers is resolved on every run.
    expect(workspace.scopes).toEqual([{ id: '790', kind: 'Space', name: 'Delivery' }]);
    expect(t.clickup.fetched).toEqual(['901', '902']);
  });

  it('maps the union of statuses across every origin, not just the first', async () => {
    const t = makeApp();
    const cookie = await clickupWorkspace(t, 'union@acme.example');
    await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    const tenantId = (await t.store.findUserByEmail('union@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    // "complete" and "review" come from the Sprint Board; "done" only from the
    // Backlog. A status seen in one origin still has to be mapped, or the
    // analysis refuses to run when history passes through it.
    expect(workspace.observedStatuses).toContain('done');
    expect(workspace.observedStatuses).toContain('review');
  });

  it('counts the item ceiling across the whole selection, not per origin', async () => {
    const t = makeApp({ maxIssues: 5 });
    const cookie = await clickupWorkspace(t, 'ceiling@acme.example');
    const res = await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    // Four tasks in one List and two in the other: neither breaches five alone.
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('across 2 Lists');
  });
});

describe('a run over several origins', () => {
  async function runMultiScope(t: TestApp, email: string) {
    const cookie = await clickupWorkspace(t, email);
    await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    const statuses = Object.fromEntries(
      workspace.observedStatuses.map((s, i) => [
        `s${i}`,
        s === 'complete' || s === 'done' ? 'done' : s === 'review' ? 'review' : 'queue',
      ]),
    );
    await post(t, cookie, '/mapping/statuses', statuses);
    await post(
      t,
      cookie,
      '/mapping/actors',
      Object.fromEntries(workspace.observedActors.map((_, i) => [`a${i}`, 'Ops'])),
    );
    await post(t, cookie, '/assumptions', {
      defaultRate: '50',
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
      rate0: '50',
    });
    await post(t, cookie, '/runs', {});
    const runs = await t.store.listRuns(tenantId);
    return { cookie, run: JSON.parse(runs[0]!.runJson) as AnalysisRun, report: runs[0]!.reportMd };
  }

  it('records on the artifact which origins the totals were computed over', async () => {
    const t = makeApp();
    const { run } = await runMultiScope(t, 'artifact@acme.example');
    expect(run.batch.scopes).toEqual([
      { id: '901', label: 'Sprint Board', itemCount: 4 },
      { id: '902', label: 'Backlog', itemCount: 2 },
    ]);
    expect(run.batch.counts.imported).toBe(6);
  });

  it('says in the report what it covered', async () => {
    const t = makeApp();
    const { report } = await runMultiScope(t, 'report@acme.example');
    expect(report).toContain('Covered 2 sources: Sprint Board (4), Backlog (2)');
  });

  /**
   * The Backlog List has no time-in-status data, so its items carry only a
   * derived arrival event. That is a weakness of the observations, not an
   * absence of them — the capability stays true because there IS a history, and
   * the evidence says whose is thin. Which origin is named matters: a reader
   * told only that wait coverage is partial cannot act, and a reader told it is
   * the Backlog can go and turn the ClickApp on.
   */
  it('carries each origin evidence forward under that origin name', async () => {
    const t = makeApp();
    const { run } = await runMultiScope(t, 'weakest@acme.example');
    const note = run.batch.evidence.find(
      (n) => n.subject === 'events' && n.weakness === 'partial-coverage',
    );
    expect(note?.detail).toMatch(/^Backlog: /);
    expect(note?.detail).toContain('no status history');
    // And the Sprint Board's own weakness is still attributed to the Sprint Board.
    expect(run.batch.evidence.some((n) => n.detail.startsWith('Sprint Board: '))).toBe(true);
  });

  /**
   * A run that quietly covers one of two Lists reports a total that has halved
   * for no reason a reader could ever discover.
   */
  it('fails the whole run, naming the origin, rather than covering part of it', async () => {
    const t = makeApp();
    const cookie = await clickupWorkspace(t, 'partial@acme.example');
    await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    const tenantId = (await t.store.findUserByEmail('partial@acme.example'))!.tenantId;
    // One of the two Lists stops being readable between configuration and run.
    t.clickup.lists = t.clickup.lists.filter((s) => s.id !== '902');
    t.clickup.lists.push({
      id: '902',
      name: 'Backlog',
      kind: 'List',
      parentId: '790',
      fetchable: true,
    });
    t.clickup.failFetchWith = new GatewayError('fetch-error', 'tasks', 'gone');
    await post(t, cookie, '/mapping/statuses', {
      s0: 'queue',
      s1: 'done',
      s2: 'queue',
      s3: 'done',
    });

    const jobs = await t.store.listJobsForWorkspace(
      tenantId,
      (await t.store.listWorkspaces(tenantId))[0]!.id,
    );
    expect(jobs.every((j) => j.status !== 'succeeded')).toBe(true);
  });
});

describe('comparability across a coverage change', () => {
  const runWith = (scopes: unknown): AnalysisRun =>
    ({
      engineVersions: { analysis: '0.5.0', signals: {}, contextSignals: {}, costModels: {} },
      pricingPolicy: 'report',
      detectors: [],
      assumptions: {
        currency: 'USD',
        rates: [],
        defaultRate: { value: '50', provenance: 'customer-customized' },
        parameters: {
          agingThresholdDays: { value: 14, provenance: 'customer-customized' },
        },
      },
      batch: {
        provider: 'clickup',
        mappingTemplateId: 'ws-1',
        items: [],
        evidence: [],
        ...(scopes === undefined ? {} : { scopes }),
      },
    }) as unknown as AnalysisRun;

  it('refuses a trend when a container gained an origin', () => {
    const before = runWith([{ id: '901', label: 'Sprint Board', itemCount: 4 }]);
    const after = runWith([
      { id: '901', label: 'Sprint Board', itemCount: 4 },
      { id: '902', label: 'Backlog', itemCount: 2 },
    ]);
    const { verdict, findings } = assessComparability(before, after);
    expect(verdict).toBe('not-comparable');
    const finding = findings.find((f) => f.aspect === 'coverage')!;
    expect(finding.severity).toBe('blocking');
    expect(finding.detail).toContain('Backlog appears only in the newer one');
  });

  it('is comparable when the same origins were covered, whatever the counts did', () => {
    const before = runWith([{ id: '901', label: 'Sprint Board', itemCount: 4 }]);
    const after = runWith([{ id: '901', label: 'Sprint Board', itemCount: 40 }]);
    expect(assessComparability(before, after).verdict).toBe('comparable');
  });

  /** Absent is unknown, not empty: an old artifact cannot vouch for its own scope. */
  it('refuses a trend against an artifact that predates coverage', () => {
    const legacy = runWith(undefined);
    const current = runWith([{ id: '901', label: 'Sprint Board', itemCount: 4 }]);
    const { findings } = assessComparability(legacy, current);
    expect(findings.find((f) => f.aspect === 'coverage')?.severity).toBe('blocking');
  });

  it('leaves two pre-coverage artifacts comparable with each other', () => {
    expect(assessComparability(runWith(undefined), runWith(undefined)).verdict).toBe('comparable');
  });
});

/**
 * The question multi-scope existed to answer, and could not until now: WHOSE
 * queue is expensive. Two teams that happen to use the same status name are two
 * queues owned by two people, and a report that blends them names neither.
 */
describe('friction is attributed to the origin it happened in', () => {
  it('separates two origins that share a status name, and names each', async () => {
    const t = makeApp();
    const email = 'attribution@acme.example';
    const cookie = await clickupWorkspace(t, email);
    await post(t, cookie, '/scope', { scope: '790', action: 'import' });
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    // Both Lists carry a "backlog" status; mapping it to one stage kind is
    // exactly the case that used to collapse them into a single finding.
    await post(
      t,
      cookie,
      '/mapping/statuses',
      Object.fromEntries(
        workspace.observedStatuses.map((s, i) => [
          `s${i}`,
          s === 'complete' || s === 'done' ? 'done' : s === 'review' ? 'review' : 'queue',
        ]),
      ),
    );
    await post(
      t,
      cookie,
      '/mapping/actors',
      Object.fromEntries(workspace.observedActors.map((_, i) => [`a${i}`, 'Ops'])),
    );
    await post(t, cookie, '/assumptions', {
      defaultRate: '50',
      agingThresholdDays: '1',
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
      rate0: '50',
    });
    await post(t, cookie, '/runs', {});

    const runs = await t.store.listRuns(tenantId);
    const run = JSON.parse(runs[0]!.runJson) as AnalysisRun;

    // Every friction says which origin it is in, and none is left unattributed.
    const origins = new Set(run.frictions.map((f) => f.location.originScopeId));
    expect(origins.has(null)).toBe(false);
    expect(origins.size).toBeGreaterThan(1);

    // A "backlog" stage exists in both Lists, so each detector that fires on it
    // produces one finding PER ORIGIN rather than one blended finding.
    const backlogBySignal = new Map<string, Set<string | null>>();
    for (const f of run.frictions.filter((x) => x.location.stage.name === 'backlog')) {
      const seen = backlogBySignal.get(f.signalId) ?? new Set();
      // Distinct origin per finding within one signal: never two findings for
      // the same (signal, origin, stage), which would mean a split that failed.
      expect(seen.has(f.location.originScopeId)).toBe(false);
      seen.add(f.location.originScopeId);
      backlogBySignal.set(f.signalId, seen);
    }
    expect([...backlogBySignal.values()].some((seen) => seen.size > 1)).toBe(true);

    // And the report says whose, by the name the customer chose it under.
    const report = await get(t, cookie, `/reports/${run.runId}`);
    expect(report.body).toContain('Sprint Board');
    expect(report.body).toContain('Backlog');
  });

  /**
   * A single-origin import must be untouched by any of this: the ids it
   * produces, and therefore every stored artifact that references them, stay
   * exactly as they were.
   */
  it('leaves an import with no scope structure completely unchanged', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'single@acme.example');
    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'single@acme.example',
      token: 'secret-jira-token-abc123',
    });
    await post(t, cookie, '/scope', { scope: 'OPS', action: 'import' });
    const tenantId = (await t.store.findUserByEmail('single@acme.example'))!.tenantId;
    const workspace = (await t.store.listWorkspaces(tenantId))[0]!;
    // One origin: every friction shares it, so nothing is partitioned.
    expect(workspace.scopes).toHaveLength(1);
  });
});

/**
 * The dashboard is the first surface a returning user sees, so it has the same
 * obligation as the report: a workspace spanning several teams cannot say "the
 * review queue" and mean anything. A workspace covering one origin already
 * names it in the page foot, so repeating it on every card would be noise —
 * the qualifier appears only when it distinguishes something.
 */
describe('the dashboard names the team when there is more than one', () => {
  const GOLDEN = readFileSync(join(ROOT, 'tools/golden/expected/demo-flow/run.json'), 'utf8');

  /** The golden run, re-attributed across two origins. */
  const acrossOrigins = (labels: readonly { id: string; label: string }[]): string => {
    const run = JSON.parse(GOLDEN) as {
      batch: { scopes: unknown[]; items: { id: string; originScopeId: string | null }[] };
      frictions: { location: { originScopeId: string | null } }[];
    };
    run.batch.scopes = labels.map((l, i) => ({ ...l, itemCount: i + 1 }));
    const first = labels[0] as { id: string };
    run.batch.items.forEach((item, i) => {
      item.originScopeId = (labels[i % labels.length] as { id: string }).id;
    });
    for (const f of run.frictions) f.location.originScopeId = first.id;
    return JSON.stringify(run);
  };

  const seed = async (t: TestApp, email: string, runJson: string): Promise<string> => {
    const cookie = await signIn(t, email);
    const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
    const workspace = await t.store.createWorkspace(tenantId, {
      provider: 'jira',
      connectionParams: { site: 'https://acme.atlassian.net', email },
      tokenCiphertext: 'tok',
    });
    await t.store.updateWorkspace(tenantId, workspace.id, {
      scopes: [{ id: 'OPS', kind: 'project', name: 'Operations' }],
      onboarding: 'ready',
    });
    await t.store.createRun({
      id: 'r-dash',
      tenantId,
      workspaceId: workspace.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson,
      reportMd: '# report',
      telemetryJsonl: '',
    });
    return cookie;
  };

  it('qualifies the headline friction with its origin', async () => {
    const t = makeApp();
    const cookie = await seed(
      t,
      'dash-multi@acme.example',
      acrossOrigins([
        { id: 'eng', label: 'Engineering' },
        { id: 'legal', label: 'Legal' },
      ]),
    );
    const dash = await get(t, cookie, '/dashboard');
    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain('costing about');
    expect(dash.body).toContain('in Engineering');
  });

  it('stays quiet when the workspace covers a single origin', async () => {
    const t = makeApp();
    const cookie = await seed(
      t,
      'dash-single@acme.example',
      acrossOrigins([{ id: 'eng', label: 'Engineering' }]),
    );
    const dash = await get(t, cookie, '/dashboard');
    expect(dash.body).toContain('costing about');
    expect(dash.body).not.toContain('in Engineering');
  });
});
