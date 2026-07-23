import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  importCsv,
  transformAsana,
  transformClickUp,
  transformJira,
  transformMonday,
} from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { buildPseudonymizationContext } from '../src/pseudonym';
import {
  assumptionSetSchema,
  asanaMappingSchema,
  clickupMappingSchema,
  jiraMappingSchema,
  mappingTemplateSchema,
  mondayMappingSchema,
} from '../src/schemas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');
const EXPECTED = join(ROOT, 'tools/golden/expected');

const NOW = '2026-07-20T00:00:00Z';
const SCOPE = 'costflow-golden';

function pseudonymization() {
  const salt = readFileSync(join(FIXTURES, 'salt.txt'), 'utf8').trim();
  return buildPseudonymizationContext(SCOPE, salt);
}

function goldenRun(name: 'demo-ops' | 'demo-flow') {
  const files =
    name === 'demo-ops'
      ? {
          csv: 'demo-ops.csv',
          mapping: 'mapping.json',
          assumptions: 'assumptions.json',
          events: undefined,
        }
      : {
          csv: 'demo-flow.csv',
          mapping: 'demo-flow-mapping.json',
          assumptions: 'demo-flow-assumptions.json',
          events: 'demo-flow-events.csv',
        };
  const runId = `golden-${name}`;
  const batch = importCsv({
    batchId: `batch-${runId}`,
    csvText: readFileSync(join(FIXTURES, files.csv), 'utf8'),
    eventsCsvText: files.events ? readFileSync(join(FIXTURES, files.events), 'utf8') : undefined,
    mapping: mappingTemplateSchema.parse(
      JSON.parse(readFileSync(join(FIXTURES, files.mapping), 'utf8')),
    ),
    importedAt: NOW,
    pseudonymization: pseudonymization(),
  });
  return runAnalysis({
    runId,
    now: NOW,
    batch,
    assumptions: assumptionSetSchema.parse(
      JSON.parse(readFileSync(join(FIXTURES, files.assumptions), 'utf8')),
    ),
  });
}

describe('golden datasets (NFR-1: the constitution)', () => {
  for (const name of ['demo-ops', 'demo-flow'] as const) {
    it(`${name}: reproduces the frozen run artifact byte-exactly`, () => {
      const artifact = JSON.stringify(goldenRun(name), null, 2) + '\n';
      expect(artifact).toBe(readFileSync(join(EXPECTED, name, 'run.json'), 'utf8'));
    });

    it(`${name}: reproduces the frozen report byte-exactly`, () => {
      const report = renderMarkdown(buildReportModel(goldenRun(name)));
      expect(report).toBe(readFileSync(join(EXPECTED, name, 'report.md'), 'utf8'));
    });

    it(`${name}: is deterministic — two full pipeline runs are byte-identical`, () => {
      expect(JSON.stringify(goldenRun(name))).toBe(JSON.stringify(goldenRun(name)));
    });
  }

  it('demo-ops matches the Slice 3 hand-computed multi-signal table (F2 rows unchanged, F3 added)', () => {
    const model = buildReportModel(goldenRun('demo-ops'));
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['overdue', 'Waiting for approval', '1624', 'A'],
      ['aging', 'Waiting for approval', '1320', 'B'],
      ['aging', 'Stuck', '546', 'B'],
      ['overdue', 'Working on it', '342', 'A'],
      ['overdue', 'Stuck', '280', 'A'],
    ]);

    // Report-mode provenance policy (doc 03 P4 as amended): the F2 instance
    // touching the vendor-suggested default rate (item 1007, missing actor)
    // is UNPRICED with the offending ref named — no partial pricing.
    const suppressed = model.unpriced.find((u) => u.instance.frictionType === 'aging');
    expect(suppressed?.instance.location.stage.name).toBe('Working on it');
    expect(suppressed?.reason).toContain('vendor-suggested');
    expect(suppressed?.reason).toContain('defaultRate:missing-actor');
    expect(model.run.pricingPolicy).toBe('report');

    // F3 is the first snapshot detector to reach A (doc 12 §7): explicit
    // customer commitments, distinct dues, customer-owned assumptions.
    const overdueTop = model.ranked[0];
    expect(overdueTop?.estimate.confidence).toEqual({ tier: 'A', reasons: [] });
    // Every overdue term answers "overdue relative to what?" (doc 12 §8).
    for (const term of overdueTop?.estimate.trace.terms ?? []) {
      expect(term.kind).toBe('overdue-attention');
      expect(term.kind === 'overdue-attention' && term.dueAt).toBeTruthy();
    }
    // Item 1009 (F2-unevaluable: bad lastUpdated) is priced by F3 — the
    // detector complementarity the doc 12 design predicted.
    const overdueWoi = model.ranked[3];
    expect(overdueWoi?.instance.evidence.map((e) => e.workItemId)).toEqual(['1009']);

    // F1 must be visibly skipped without history — never silently absent.
    const run = model.run;
    expect(run.detectors.find((d) => d.signalId === 'f1-queue-wait')).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('hasEventHistory'),
    });
    // Context observation present, versioned, and outside the pricing pipeline.
    expect(run.context[0]).toMatchObject({ signalId: 'c6-wip-load', signalVersion: '1.0.0' });
    expect(run.pricing.some((p) => p.frictionInstanceId.startsWith('c6'))).toBe(false);
  });

  it('demo-flow matches the Slice 2 hand-computed multi-signal table', () => {
    const model = buildReportModel(goldenRun('demo-flow'));
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['queue-wait', 'Contract Review', '993', 'B'],
      ['queue-wait', 'Backlog', '751', 'A'],
      ['aging', 'Contract Review', '180', 'B'],
    ]);

    const backlog = model.ranked[1];
    expect(backlog?.estimate.cost).toEqual({ low: '375.5', expected: '751', high: '1502' });
    expect(backlog?.estimate.confidence.reasons).toEqual([]);

    const contractReview = model.ranked[0];
    expect(contractReview?.estimate.cost).toEqual({ low: '496.5', expected: '993', high: '1986' });
    expect(contractReview?.estimate.confidence.reasons.join(' ')).toContain('open stage intervals');

    // The unmapped actor's item would need the vendor-suggested default rate:
    // under report-mode policy the aging instance is UNPRICED (no partial
    // pricing), with the actor still pseudonymized in evidence.
    const suppressedAging = model.unpriced.find((u) => u.instance.frictionType === 'aging');
    expect(suppressedAging?.reason).toContain('defaultRate:unmapped-actor');
    expect(suppressedAging?.instance.evidence[0]?.actor.kind).toBe('unknown');

    // And the F3 friction stays unpriced for its own reason: missing assumption.
    expect(model.unpriced).toHaveLength(2);
    const unpricedOverdue = model.unpriced.find((u) => u.instance.frictionType === 'overdue');
    expect(unpricedOverdue?.reason).toContain('overdueAttentionHoursPerDay');
  });
});

describe('golden dataset: demo-jira (provider SPI v2, doc 15 P1)', () => {
  function jiraGoldenRun() {
    const dir = join(FIXTURES, 'jira');
    return runAnalysis({
      runId: 'golden-demo-jira',
      now: NOW,
      batch: transformJira({
        batchId: 'batch-golden-demo-jira',
        searchPages: [readFileSync(join(dir, 'raw', 'search-page-0.json'), 'utf8')],
        mapping: jiraMappingSchema.parse(
          JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')),
        ),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(readFileSync(join(dir, 'assumptions.json'), 'utf8')),
      ),
    });
  }

  it('reproduces the frozen artifacts byte-exactly and deterministically', () => {
    const artifact = JSON.stringify(jiraGoldenRun(), null, 2) + '\n';
    expect(artifact).toBe(readFileSync(join(EXPECTED, 'demo-jira', 'run.json'), 'utf8'));
    const report = renderMarkdown(buildReportModel(jiraGoldenRun()));
    expect(report).toBe(readFileSync(join(EXPECTED, 'demo-jira', 'report.md'), 'utf8'));
    expect(JSON.stringify(jiraGoldenRun())).toBe(JSON.stringify(jiraGoldenRun()));
  });

  it('matches the P1 hand-computed table: F1 finally priced on connector-derived events', () => {
    const model = buildReportModel(jiraGoldenRun());
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['queue-wait', 'To Do', '1062', 'C'],
      ['overdue', 'To Do', '342', 'A'],
      ['aging', 'To Do', '297', 'B'],
      ['queue-wait', 'Review', '288', 'B'],
      ['overdue', 'Review', '240', 'A'],
    ]);
    // J1 arrival derivation feeds F1: OPS-3 never transitioned, yet its
    // 49-day open queue wait is observed (created + current status facts).
    const queueTop = model.ranked[0];
    expect(queueTop?.instance.evidence[0]).toMatchObject({
      workItemId: 'OPS-3',
      waitHours: 1176,
      openAtAnalysisTime: true,
    });
    // customer-accepted provenance prices in report mode at full confidence.
    const overdueReview = model.ranked[4];
    expect(overdueReview?.estimate.confidence).toEqual({ tier: 'A', reasons: [] });
    expect(model.unpriced).toHaveLength(0);
    expect(model.run.batch.provider).toBe('jira');
  });
});

describe('golden dataset: demo-monday (P2: the SPI promise test, first half)', () => {
  function mondayGoldenRun() {
    const dir = join(FIXTURES, 'monday');
    return runAnalysis({
      runId: 'golden-demo-monday',
      now: NOW,
      batch: transformMonday({
        batchId: 'batch-golden-demo-monday',
        itemsPages: [readFileSync(join(dir, 'raw', 'items-page-0.json'), 'utf8')],
        activityPages: [readFileSync(join(dir, 'raw', 'activity-page-0.json'), 'utf8')],
        mapping: mondayMappingSchema.parse(
          JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')),
        ),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(readFileSync(join(dir, 'assumptions.json'), 'utf8')),
      ),
    });
  }

  it('reproduces the frozen artifacts byte-exactly and deterministically', () => {
    const artifact = JSON.stringify(mondayGoldenRun(), null, 2) + '\n';
    expect(artifact).toBe(readFileSync(join(EXPECTED, 'demo-monday', 'run.json'), 'utf8'));
    const report = renderMarkdown(buildReportModel(mondayGoldenRun()));
    expect(report).toBe(readFileSync(join(EXPECTED, 'demo-monday', 'report.md'), 'utf8'));
    expect(JSON.stringify(mondayGoldenRun())).toBe(JSON.stringify(mondayGoldenRun()));
  });

  it('matches the P2 hand-computed table (M1/M2/M3 + J1 arrival on real-shape data)', () => {
    const model = buildReportModel(mondayGoldenRun());
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['queue-wait', 'Backlog', '1020', 'C'],
      ['overdue', 'Backlog', '240', 'A'],
      ['aging', 'Backlog', '180', 'B'],
      ['queue-wait', 'Waiting for review', '112', 'C'],
      ['overdue', 'Waiting for review', '48', 'C'],
    ]);
    // J1 on monday: item 101 never transitioned — its 45-day open Backlog
    // wait derives from created_at + current status (two facts).
    expect(model.ranked[0]?.instance.evidence[0]).toMatchObject({
      workItemId: '101',
      waitHours: 1080,
      openAtAnalysisTime: true,
    });
    // M2: activity timestamps (17-digit) landed as exact ISO instants, and
    // the Done item's closed Backlog interval (168h) still counts.
    const backlog = model.ranked[0]?.instance;
    if (backlog?.frictionType !== 'queue-wait') throw new Error('expected queue-wait first');
    expect(backlog.evidence.map((e) => [e.workItemId, e.waitHours])).toEqual([
      ['101', 1080],
      ['102', 192],
      ['103', 168],
    ]);
    expect(model.unpriced).toHaveLength(0);
    expect(model.run.batch.provider).toBe('monday');
  });
});

describe('golden dataset: demo-asana (P2: the SPI promise test, second half)', () => {
  function asanaGoldenRun() {
    const dir = join(FIXTURES, 'asana');
    return runAnalysis({
      runId: 'golden-demo-asana',
      now: NOW,
      batch: transformAsana({
        batchId: 'batch-golden-demo-asana',
        taskPages: [readFileSync(join(dir, 'raw', 'tasks-page-0.json'), 'utf8')],
        storiesByTask: {
          '9001': [readFileSync(join(dir, 'raw', 'stories-9001-0.json'), 'utf8')],
          '9002': [readFileSync(join(dir, 'raw', 'stories-9002-0.json'), 'utf8')],
          '9003': [readFileSync(join(dir, 'raw', 'stories-9003-0.json'), 'utf8')],
        },
        sectionsDoc: readFileSync(join(dir, 'raw', 'sections.json'), 'utf8'),
        mapping: asanaMappingSchema.parse(
          JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')),
        ),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(readFileSync(join(dir, 'assumptions.json'), 'utf8')),
      ),
    });
  }

  it('reproduces the frozen artifacts byte-exactly and deterministically', () => {
    const artifact = JSON.stringify(asanaGoldenRun(), null, 2) + '\n';
    expect(artifact).toBe(readFileSync(join(EXPECTED, 'demo-asana', 'run.json'), 'utf8'));
    const report = renderMarkdown(buildReportModel(asanaGoldenRun()));
    expect(report).toBe(readFileSync(join(EXPECTED, 'demo-asana', 'report.md'), 'utf8'));
    expect(JSON.stringify(asanaGoldenRun())).toBe(JSON.stringify(asanaGoldenRun()));
  });

  it('matches the P2 hand-computed table (A1/A2/A3 scoping + completion semantics)', () => {
    const model = buildReportModel(asanaGoldenRun());
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['queue-wait', 'Intake', '476', 'C'],
      ['queue-wait', 'Legal review', '352', 'B'],
      ['overdue', 'Legal review', '176', 'A'],
      ['aging', 'Intake', '84', 'C'],
    ]);
    // A2: the completed task sits in Done (terminal), so its overdue due date
    // (2026-06-25) does NOT surface — only the in-flight breach prices.
    const overdue = model.ranked[2];
    expect(overdue?.instance.evidence.map((e) => e.workItemId)).toEqual(['9001']);
    // A2 completion event closed 9003's intervals: 96h Intake, nothing open.
    const intake = model.ranked[0]?.instance;
    if (intake?.frictionType !== 'queue-wait') throw new Error('expected queue-wait first');
    expect(intake.evidence.map((e) => [e.workItemId, e.waitHours])).toEqual([
      ['9002', 1008],
      ['9001', 168],
      ['9003', 96],
    ]);
    // A3: the foreign-project move is visible as a diagnostic, not an event.
    expect(model.run.batch.diagnostics.map((d) => d.message).join(' ')).toContain(
      'section move(s) in other projects ignored',
    );
    expect(model.unpriced).toHaveLength(0);
    expect(model.run.batch.provider).toBe('asana');
  });
});

describe('golden dataset: demo-clickup (ADR-0005: the connector-architecture promise test)', () => {
  function clickupGoldenRun() {
    const dir = join(FIXTURES, 'clickup');
    return runAnalysis({
      runId: 'golden-demo-clickup',
      now: NOW,
      batch: transformClickUp({
        batchId: 'batch-golden-demo-clickup',
        taskPages: [readFileSync(join(dir, 'raw', 'tasks-page-0.json'), 'utf8')],
        timeInStatusPages: [readFileSync(join(dir, 'raw', 'time-in-status-0.json'), 'utf8')],
        mapping: clickupMappingSchema.parse(
          JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')),
        ),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(readFileSync(join(dir, 'assumptions.json'), 'utf8')),
      ),
    });
  }

  it('reproduces the frozen artifacts byte-exactly and deterministically', () => {
    const artifact = JSON.stringify(clickupGoldenRun(), null, 2) + '\n';
    expect(artifact).toBe(readFileSync(join(EXPECTED, 'demo-clickup', 'run.json'), 'utf8'));
    const report = renderMarkdown(buildReportModel(clickupGoldenRun()));
    expect(report).toBe(readFileSync(join(EXPECTED, 'demo-clickup', 'report.md'), 'utf8'));
    expect(JSON.stringify(clickupGoldenRun())).toBe(JSON.stringify(clickupGoldenRun()));
  });

  it('matches the hand-computed table (CU1 chains + CU2 arrival + terminal-due exclusion)', () => {
    const model = buildReportModel(clickupGoldenRun());
    expect(
      model.ranked.map((r) => [
        r.instance.frictionType,
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['queue-wait', 'backlog', '1110', 'C'],
      ['overdue', 'backlog', '342', 'A'],
      ['aging', 'backlog', '297', 'B'],
      ['queue-wait', 'review', '288', 'B'],
      ['overdue', 'review', '240', 'A'],
    ]);
    // CU2 feeds F1: 86czqc3 has NO time-in-status document, yet its 49-day
    // open backlog wait derives from date_created + current status.
    const queueTop = model.ranked[0];
    expect(queueTop?.instance.evidence[0]).toMatchObject({
      workItemId: '86czqc3',
      waitHours: 1176,
      openAtAnalysisTime: true,
    });
    // CU1 chain: 86czqa1's residency reconstructs backlog(5d) → in
    // progress → review, so its closed backlog interval prices (120h wait).
    const backlogWait = queueTop?.instance;
    if (backlogWait?.frictionType !== 'queue-wait') throw new Error('expected queue-wait first');
    expect(backlogWait.evidence.map((e) => [e.workItemId, e.waitHours])).toEqual([
      ['86czqc3', 1176],
      ['86czqb2', 240],
      ['86czqa1', 120],
      ['86czqd4', 48],
    ]);
    // Terminal-stage exclusion: 86czqd4 is complete (done) with a past due
    // date — it must NOT surface as overdue (same semantics as demo-asana).
    for (const ranked of model.ranked) {
      if (ranked.instance.frictionType !== 'overdue') continue;
      expect(ranked.instance.evidence.map((e) => e.workItemId)).not.toContain('86czqd4');
    }
    // CU3 is visible, never silent: the second assignee on 86czqb2 counted.
    expect(model.run.batch.diagnostics.map((d) => d.message).join(' ')).toContain(
      '1 additional assignee(s)',
    );
    // The unmapped actor (Guy Contractor) is pseudonymized and priced at the
    // default rate — visible as the C-tier constraint on queue-wait.
    expect(queueTop?.estimate.confidence.reasons.join(' ')).toContain('unmapped');
    expect(model.unpriced).toHaveLength(0);
    expect(model.run.batch.provider).toBe('clickup');
  });
});

describe('CLI end-to-end determinism gate (multi-signal)', () => {
  it('two spawned CLI runs on demo-flow are byte-identical and match the frozen files', () => {
    const invoke = () => {
      const out = mkdtempSync(join(tmpdir(), 'costflow-golden-'));
      execFileSync(
        'pnpm',
        [
          'costflow',
          'analyze',
          '--csv',
          join(FIXTURES, 'demo-flow.csv'),
          '--events',
          join(FIXTURES, 'demo-flow-events.csv'),
          '--mapping',
          join(FIXTURES, 'demo-flow-mapping.json'),
          '--assumptions',
          join(FIXTURES, 'demo-flow-assumptions.json'),
          '--org',
          SCOPE,
          '--salt-file',
          join(FIXTURES, 'salt.txt'),
          '--now',
          NOW,
          '--run-id',
          'golden-demo-flow',
          '--out',
          out,
          '--quiet',
        ],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return {
        run: readFileSync(join(out, 'run.json'), 'utf8'),
        report: readFileSync(join(out, 'report.md'), 'utf8'),
        telemetry: readFileSync(join(out, 'telemetry.jsonl'), 'utf8'),
      };
    };

    const first = invoke();
    const second = invoke();
    expect(first.run).toBe(second.run);
    expect(first.report).toBe(second.report);
    expect(first.telemetry).toBe(second.telemetry);
    expect(first.run).toBe(readFileSync(join(EXPECTED, 'demo-flow', 'run.json'), 'utf8'));
    expect(first.report).toBe(readFileSync(join(EXPECTED, 'demo-flow', 'report.md'), 'utf8'));
    expect(first.telemetry).toBe(
      readFileSync(join(EXPECTED, 'demo-flow', 'telemetry.jsonl'), 'utf8'),
    );
  }, 60_000);
});
