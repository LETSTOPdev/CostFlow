import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCsv } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { assumptionSetSchema, mappingTemplateSchema } from '../src/schemas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');
const EXPECTED = join(ROOT, 'tools/golden/expected');

const NOW = '2026-07-20T00:00:00Z';
const RUN_ID = 'golden-demo-ops';

function goldenRun() {
  const csvText = readFileSync(join(FIXTURES, 'demo-ops.csv'), 'utf8');
  const mapping = mappingTemplateSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, 'mapping.json'), 'utf8')),
  );
  const assumptions = assumptionSetSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, 'assumptions.json'), 'utf8')),
  );
  const batch = importCsv({ batchId: `batch-${RUN_ID}`, csvText, mapping, importedAt: NOW });
  return runAnalysis({ runId: RUN_ID, now: NOW, batch, assumptions });
}

describe('golden dataset (NFR-1: the constitution)', () => {
  it('reproduces the frozen run artifact byte-exactly', () => {
    const artifact = JSON.stringify(goldenRun(), null, 2) + '\n';
    const expected = readFileSync(join(EXPECTED, 'run.json'), 'utf8');
    expect(artifact).toBe(expected);
  });

  it('reproduces the frozen report byte-exactly', () => {
    const report = renderMarkdown(buildReportModel(goldenRun()));
    const expected = readFileSync(join(EXPECTED, 'report.md'), 'utf8');
    expect(report).toBe(expected);
  });

  it('matches the hand-computed expectations from the implementation log', () => {
    const run = goldenRun();
    const model = buildReportModel(run);

    // Import honesty: 10 rows, 1008 dropped (unmapped status), 1009 date warning.
    expect(run.batch.counts).toEqual({ totalRows: 10, imported: 9, dropped: 1 });
    expect(run.batch.diagnostics).toHaveLength(2);

    // Ranking: Working on it (1842) > Waiting for approval (1320) > Stuck (546).
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

    // Range bounds follow the attention range exactly (0.15 / 0.6 vs expected 0.3).
    const top = model.ranked[0]!.estimate;
    expect(top.cost.low).toBe('921');
    expect(top.cost.high).toBe('3684');
  });

  it('is deterministic: two full pipeline runs are byte-identical', () => {
    const a = JSON.stringify(goldenRun());
    const b = JSON.stringify(goldenRun());
    expect(a).toBe(b);
  });
});

describe('CLI end-to-end determinism gate', () => {
  it('two spawned CLI runs produce byte-identical artifacts matching the frozen files', () => {
    const invoke = () => {
      const out = mkdtempSync(join(tmpdir(), 'costflow-golden-'));
      execFileSync(
        'pnpm',
        [
          'costflow',
          'analyze',
          '--csv',
          join(FIXTURES, 'demo-ops.csv'),
          '--mapping',
          join(FIXTURES, 'mapping.json'),
          '--assumptions',
          join(FIXTURES, 'assumptions.json'),
          '--now',
          NOW,
          '--run-id',
          RUN_ID,
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
    expect(first.run).toBe(readFileSync(join(EXPECTED, 'run.json'), 'utf8'));
    expect(first.report).toBe(readFileSync(join(EXPECTED, 'report.md'), 'utf8'));
  }, 60_000);
});
