import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, get, makeApp, signIn, type TestApp } from './helpers';
import { buildActionCards } from '../src/oi-view';
import type { DiagnosticFinding } from '@costflow/diagnostics';

/**
 * OI1 acceptance (ADR-0006). The report gains an operational layer: where
 * attention pays off, what evidence says so, what the action is, and what the
 * data cannot yet tell you.
 */

const FLOW_RUN = readFileSync(join(ROOT, 'tools/golden/expected/demo-flow/run.json'), 'utf8');
const FLOW_MD = readFileSync(join(ROOT, 'tools/golden/expected/demo-flow/report.md'), 'utf8');

async function seedRun(
  t: TestApp,
  email: string,
  runId: string,
  provider: string,
  runJson: string,
  observedActors: string[] = [],
): Promise<void> {
  const tenantId = (await t.store.findUserByEmail(email))!.tenantId;
  const workspace = await t.store.createWorkspace(tenantId, {
    provider,
    connectionParams: { site: 'https://acme.atlassian.net', email },
    tokenCiphertext: 'tok',
  });
  if (observedActors.length > 0) {
    await t.store.updateWorkspace(tenantId, workspace.id, { observedActors });
  }
  await t.store.createRun({
    id: runId,
    tenantId,
    workspaceId: workspace.id,
    createdAt: '2026-07-20T00:00:00Z',
    runJson,
    reportMd: FLOW_MD,
    telemetryJsonl: '',
  });
}

describe('OI1 — the operational layer on the report', () => {
  it('renders findings with impact and complexity as separate, unfused facts', async () => {
    const t = await makeApp();
    const email = 'oi1@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);

    const res = await get(t, cookie, '/reports/r-flow');
    expect(res.statusCode).toBe(200);

    expect(res.body).toContain('Where to act first');
    expect(res.body).toContain('Operational impact:');
    expect(res.body).toContain('Implementation complexity:');
    // The two are displayed side by side and never combined into one number.
    expect(res.body).not.toMatch(/priority score/i);
    expect(res.body).not.toMatch(/ROI/i);
  });

  /**
   * A CEO with two minutes reads the total, then stops. Until 2026-07-28 the
   * recommendations came after the methodology, so stopping meant never seeing
   * the part of the product that says what to do.
   */
  it('puts what to do above the working behind it', async () => {
    const t = await makeApp();
    const email = 'oi-order@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);

    const res = await get(t, cookie, '/reports/r-flow');
    const act = res.body.indexOf('Where to act first');
    const detail = res.body.indexOf('Supporting detail');
    const ranked = res.body.indexOf('Ranked frictions');
    const coverage = res.body.indexOf('Coverage &amp; confidence');
    expect(act).toBeGreaterThan(-1);
    expect(act).toBeLessThan(detail);
    expect(detail).toBeLessThan(ranked);
    expect(ranked).toBeLessThan(coverage);
  });

  /**
   * The export is what gets forwarded to whoever did not run the analysis. It
   * omitted the recommendations entirely.
   */
  it('includes the recommendations in the printable export', async () => {
    const t = await makeApp();
    const email = 'oi-print@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);

    const res = await get(t, cookie, '/reports/r-flow/print');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Where to act first');
    expect(res.body).toContain('Suggested intervention');
  });

  it('labels the ordering honestly and disclaims it as a sequence', async () => {
    const t = await makeApp();
    const email = 'oi2@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);

    const res = await get(t, cookie, '/reports/r-flow');
    expect(res.body).toContain('not a recommended sequence');
    expect(res.body).toContain('never changes this order');
  });

  it('shows the gate it could not assess, naming the capability and the platform reason', async () => {
    const t = await makeApp();
    const email = 'oi3@example.com';
    const cookie = await signIn(t, email);
    // A snapshot-only artifact on the aggregate-only platform: D3 cannot run.
    const snapshotOnly = JSON.stringify({
      ...JSON.parse(FLOW_RUN),
      batch: {
        ...JSON.parse(FLOW_RUN).batch,
        events: [],
        capability: {
          hasEventHistory: false,
          hasDueDates: true,
          hasLastUpdated: true,
          hasActors: true,
        },
      },
    });
    await seedRun(t, email, 'r-snap', 'clickup', snapshotOnly);

    const res = await get(t, cookie, '/reports/r-snap');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('What this data cannot tell you yet');
    expect(res.body).toContain('Serial gatekeeping could not be assessed');
    expect(res.body).toContain('transition history');
    // This platform CAN supply it behind a workspace setting, so the copy must
    // not claim incapability.
    expect(res.body).not.toContain('does not expose transition history');
  });

  /**
   * The gated platform CAN supply transition history: its Time-in-Status
   * entries carry the instant each status was entered, which the ingestion
   * transform reconstructs into a real event chain (see the demo-clickup
   * golden, where queue wait runs). So a workspace missing it must be told the
   * actionable thing — enable the ClickApp and re-import — not that the
   * platform is incapable.
   *
   * This test previously asserted the opposite, on the strength of a
   * partner-run note written from a plan probe that never returned a payload.
   */
  it('offers the unlock when the capability is gated rather than impossible', async () => {
    const t = await makeApp();
    const email = 'oi4@example.com';
    const cookie = await signIn(t, email);
    const snapshotOnly = JSON.stringify({
      ...JSON.parse(FLOW_RUN),
      batch: {
        ...JSON.parse(FLOW_RUN).batch,
        events: [],
        capability: {
          hasEventHistory: false,
          hasDueDates: true,
          hasLastUpdated: true,
          hasActors: true,
        },
      },
    });
    await seedRun(t, email, 'r-snap', 'clickup', snapshotOnly);

    const res = await get(t, cookie, '/reports/r-snap');
    expect(res.body).toContain('Total Time in Status');
    expect(res.body).toContain('re-import');
    expect(res.body).not.toContain('does not expose transition history');
  });

  /**
   * The OI section is appended before the attribution guard runs, so it is
   * covered by the same choke point as the rest of the report. If a diagnostic
   * ever rendered a raw identity, the whole response must be withheld.
   */
  it('is covered by the attribution guard, not bypassing it', async () => {
    const t = await makeApp();
    const email = 'oi5@example.com';
    const cookie = await signIn(t, email);
    // "Contract Review" is a stage name the diagnostics DO render. Registering
    // it as an observed actor makes the guard's exact-substring match fire on
    // OI-rendered bytes specifically.
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN, ['Contract Review']);

    const res = await get(t, cookie, '/reports/r-flow');
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('withheld');
  });

  it('groups findings that share a stage and an action into one card', () => {
    const base = {
      signalVersion: '1.0.0',
      subject: { stage: { name: 'Contract Review', kind: 'review' as const }, originScopeId: null },
      shareOf: 'x',
      facts: {},
      statement: 's',
      confidence: { tier: 'A' as const, reasons: [] },
      intervention: {
        primitive: 'add-stage-sla' as const,
        complexity: 'Low' as const,
        effortClass: 'policy' as const,
        recommendation: 'Set a service-level target for this stage.',
        stage: { name: 'Contract Review', kind: 'review' as const },
      },
    };
    const findings = [
      { ...base, signalId: 'dc', signalName: 'Friction concentration', sharePercent: 51 },
      { ...base, signalId: 'd3', signalName: 'Serial gatekeeping', sharePercent: 51 },
    ] as DiagnosticFinding[];

    const cards = buildActionCards(findings);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.findings).toHaveLength(2);
    expect(cards[0]!.topShare).toBe(51);
  });

  it('keeps distinct actions on the same stage as distinct cards', () => {
    const stage = { name: 'Open', kind: 'queue' as const };
    const make = (primitive: string, label: string, share: number) =>
      ({
        signalId: primitive,
        signalVersion: '1.0.0',
        signalName: 'n',
        subject: { stage },
        sharePercent: share,
        shareOf: 'x',
        facts: {},
        statement: 's',
        confidence: { tier: 'A' as const, reasons: [] },
        intervention: {
          primitive,
          complexity: 'Low' as const,
          effortClass: 'policy' as const,
          recommendation: label,
          stage,
        },
      }) as unknown as DiagnosticFinding;

    const cards = buildActionCards([
      make('escalate-on-age', 'Escalate', 40),
      make('assign-ownership', 'Assign', 80),
    ]);
    expect(cards).toHaveLength(2);
    // Equal confidence, so concentration decides and the stronger leads.
    expect(cards[0]!.topShare).toBe(80);
  });

  /**
   * Doc 07 §1.4: a finding never outranks one of a strictly higher grade,
   * regardless of magnitude. A 90%-of-one-item outlier must not sit above a
   * solid, broadly evidenced 40% result.
   */
  it('ranks confidence above magnitude, never the reverse', () => {
    const card = (name: string, tier: 'A' | 'B', share: number) =>
      ({
        signalId: name,
        signalVersion: '1.0.0',
        signalName: name,
        subject: { stage: { name, kind: 'queue' as const }, originScopeId: null },
        sharePercent: share,
        shareOf: 'x',
        facts: {},
        statement: 's',
        confidence: { tier, reasons: tier === 'B' ? ['B: outlier'] : [] },
        intervention: {
          primitive: 'review-queue' as const,
          complexity: 'Low' as const,
          effortClass: 'process-change' as const,
          recommendation: 'Review',
          stage: { name, kind: 'queue' as const },
        },
      }) as unknown as DiagnosticFinding;

    const cards = buildActionCards([card('flashy', 'B', 90), card('solid', 'A', 40)]);
    expect(cards[0]!.stageName).toBe('solid');
    expect(cards[0]!.bestTier).toBe('A');
    expect(cards[1]!.topShare).toBe(90);
  });

  it('says so plainly when nothing clears the thresholds', async () => {
    const t = await makeApp();
    const email = 'oi6@example.com';
    const cookie = await signIn(t, email);
    const empty = JSON.stringify({
      ...JSON.parse(FLOW_RUN),
      frictions: [],
      estimates: [],
      pricing: [],
    });
    await seedRun(t, email, 'r-empty', 'jira', empty);

    const res = await get(t, cookie, '/reports/r-empty');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('That is a result, not an omission');
  });
});

/**
 * The founder's decision, 2026-07-28: the recommendations are the strongest
 * thing the product does, so a prospect should see them before signing up. The
 * condition is that a visitor can never mistake a recommendation computed from
 * generated data for one computed from their own.
 */
describe('recommendations on the public sample surfaces', () => {
  it('shows them on /demo, marked as generated from demonstration data', async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Where to act first');
    expect(res.body).toContain('Generated from demonstration data');
  });

  it('shows them on the interactive demo too, with the same provenance line', async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/try/report?seed=42' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Where to act first');
    expect(res.body).toContain('Generated from demonstration data');
    expect(res.body).toContain('not from any real organisation');
  });

  /** A real customer's own report must never carry the demo disclaimer. */
  it('never marks a real report as demonstration data', async () => {
    const t = await makeApp();
    const email = 'real@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);
    const res = await get(t, cookie, '/reports/r-flow');
    expect(res.body).not.toContain('Generated from demonstration data');
  });
});

/**
 * The static sample is below the evidence gate, so it recommends nothing. That
 * is correct, and on a marketing surface it is also an opportunity: the refusal
 * is a differentiator, and the prospect should leave with somewhere to go.
 */
describe('the sample report with nothing to recommend', () => {
  it('explains the refusal and routes to a full-size demonstration', async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/demo' });
    expect(res.body).toContain('smaller than the evidence threshold');
    expect(res.body).toContain('href="/try"');
  });

  it('keeps the plain wording on a real customer report', async () => {
    const t = await makeApp();
    const email = 'quiet@example.com';
    const cookie = await signIn(t, email);
    await seedRun(t, email, 'r-flow', 'jira', FLOW_RUN);
    const res = await get(t, cookie, '/reports/r-flow');
    expect(res.body).not.toContain('smaller than the evidence threshold');
  });
});
