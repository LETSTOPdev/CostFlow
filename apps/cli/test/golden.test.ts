import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCsv } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { buildPseudonymizationContext } from '../src/pseudonym';
import { assumptionSetSchema, mappingTemplateSchema } from '../src/schemas';

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

  it('demo-ops matches the Slice 1 hand-computed cost table (actors changed, numbers did not)', () => {
    const model = buildReportModel(goldenRun('demo-ops'));
    expect(
      model.ranked.map((r) => [
        r.instance.location.stage.name,
        r.estimate.cost.expected,
        r.estimate.confidence.tier,
      ]),
    ).toEqual([
      ['Working on it', '1842', 'C'],
      ['Waiting for approval', '1320', 'B'],
      ['Stuck', '546', 'B'],
    ]);
    // F1 must be visibly skipped without history — never silently absent.
    const run = model.run;
    expect(run.detectors.find((d) => d.signalId === 'f1-queue-wait')).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('hasEventHistory'),
    });
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
      ['aging', 'Working on it', '360', 'C'],
      ['aging', 'Contract Review', '180', 'B'],
    ]);

    const backlog = model.ranked[1];
    expect(backlog?.estimate.cost).toEqual({ low: '375.5', expected: '751', high: '1502' });
    expect(backlog?.estimate.confidence.reasons).toEqual([]);

    const contractReview = model.ranked[0];
    expect(contractReview?.estimate.cost).toEqual({ low: '496.5', expected: '993', high: '1986' });
    expect(contractReview?.estimate.confidence.reasons.join(' ')).toContain('open stage intervals');

    // The unmapped actor's item is priced at the default rate, capped C, and pseudonymized.
    const aging = model.ranked[2];
    expect(aging?.estimate.trace.terms[0]).toMatchObject({
      kind: 'aging-attention',
      rateSource: 'defaultRate:unmapped-actor',
    });
    expect(aging?.instance.evidence[0]?.actor.kind).toBe('unknown');
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
      };
    };

    const first = invoke();
    const second = invoke();
    expect(first.run).toBe(second.run);
    expect(first.report).toBe(second.report);
    expect(first.run).toBe(readFileSync(join(EXPECTED, 'demo-flow', 'run.json'), 'utf8'));
    expect(first.report).toBe(readFileSync(join(EXPECTED, 'demo-flow', 'report.md'), 'utf8'));
  }, 60_000);
});
