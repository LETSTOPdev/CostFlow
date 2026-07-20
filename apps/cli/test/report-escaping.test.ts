import { describe, expect, it } from 'vitest';
import { importCsv } from '@costflow/ingestion';
import type { MappingTemplate } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import type { AssumptionSet } from '@costflow/domain';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';

const mapping: MappingTemplate = {
  id: 'hostile-map',
  version: '1',
  columns: {
    itemId: 'ID',
    title: 'Title',
    status: 'Status',
    actor: 'Actor',
    lastUpdatedAt: 'Updated',
  },
  statusMap: { 'Wait | huh': 'review' },
  actorRoleMap: { 'legal person': 'Le|gal' },
};

const assumptions: AssumptionSet = {
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [{ roleRef: 'Le|gal', hourlyRate: '100', provenance: 'customer-customized' }],
  defaultRate: { hourlyRate: '75', provenance: 'vendor-suggested' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
};

describe('report escapes customer-controlled strings (regression: R-07)', () => {
  it('hostile titles, statuses, and roles cannot corrupt tables or inject links', () => {
    const csv = [
      'ID,Title,Status,Actor,Updated',
      '"1","Evil | [click me](https://evil.example) `code`","Wait | huh","legal person","2026-06-01"',
    ].join('\n');
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });
    const run = runAnalysis({ runId: 'hostile', now: '2026-07-20T00:00:00Z', batch, assumptions });
    const report = renderMarkdown(buildReportModel(run));

    // The raw injection sequences must not survive into the markdown.
    expect(report).not.toContain('[click me](https://evil.example)');
    expect(report).not.toContain('Evil | [click');
    expect(report).toContain('Evil \\|');
    expect(report).toContain('\\[click me\\]');
    expect(report).toContain('\\`code\\`');
    expect(report).toContain('Wait \\| huh');
    expect(report).toContain('Le\\|gal');

    // Table rows must keep their column count despite embedded pipes:
    // ranked table data row = 6 columns → exactly 7 unescaped pipes.
    const rankedRow = report.split('\n').find((l) => l.startsWith('| 1 | aging |'));
    expect(rankedRow).toBeDefined();
    const unescapedPipes = (rankedRow as string).match(/(?<!\\)\|/g) ?? [];
    expect(unescapedPipes).toHaveLength(7);
  });

  it('renders context as explanatory only: escaped, versioned, and money-free (doc 14)', () => {
    const csv = 'ID,Title,Status,Actor,Updated\n1,"Task","Wait | huh",legal person,2026-06-01';
    const batch = importCsv({
      batchId: 'b',
      csvText: csv,
      mapping,
      importedAt: '2026-07-20T00:00:00Z',
    });
    const report = renderMarkdown(
      buildReportModel(
        runAnalysis({ runId: 'ctx', now: '2026-07-20T00:00:00Z', batch, assumptions }),
      ),
    );
    expect(report).toContain('## Context');
    expect(report).toContain('not priced, graded, or ranked');
    expect(report).toContain('c6-wip-load@1.0.0');
    // Hostile stage names are escaped inside the context statement too.
    expect(report).toContain('pool is stage "Wait \\| huh"');
    // The context section carries no currency and no confidence tier.
    const contextSection = report.split('## Context')[1]?.split('##')[0] ?? '';
    expect(contextSection).not.toMatch(/USD|Confidence/);
  });

  it('remains deterministic with escaping applied', () => {
    const csv = 'ID,Title,Status,Actor,Updated\n1,"A|B","Wait | huh",legal person,2026-06-01';
    const make = () => {
      const batch = importCsv({
        batchId: 'b',
        csvText: csv,
        mapping,
        importedAt: '2026-07-20T00:00:00Z',
      });
      return renderMarkdown(
        buildReportModel(
          runAnalysis({ runId: 'r', now: '2026-07-20T00:00:00Z', batch, assumptions }),
        ),
      );
    };
    expect(make()).toBe(make());
  });
});
