import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIsoUtc } from '@costflow/domain';
import { importCsv } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { CliError, readJsonFile, readTextFile } from './io';
import { preflight } from './preflight';
import { buildPseudonymizationContext } from './pseudonym';
import { assumptionSetSchema, mappingTemplateSchema } from './schemas';

// The ONLY effectful edge in M0. Invalid or ambiguous input must fail loudly
// with a non-zero exit (R-01/R-08): "no frictions detected" may only ever
// follow a valid, completed analysis.

const USAGE = `Usage:
  costflow analyze   --csv <file> --mapping <file> --assumptions <file> [options]
  costflow preflight --csv <file> --mapping <file> [--assumptions <file>] [options]

analyze runs the full pipeline and writes artifacts. preflight runs ONLY the
structural import validation and prints a values-free structure summary — no
detectors, no cost figures, no artifacts (M1 intake pass 1).

Options:
  --csv <file>           Work-items CSV export (required)
  --mapping <file>       Mapping template JSON (required)
  --assumptions <file>   Assumption set JSON (required for analyze)
  --events <file>        Optional event-history CSV (requires "events" in the mapping)
  --org <scope>          Pseudonymization scope id (required when an actor column is mapped)
  --salt-file <file>     File containing the org's pseudonymization salt (required with --org;
                         keep it out of the repo and out of shell history)
  --now <iso>            Analysis time, ISO-8601 UTC (default: current time; analyze only)
  --run-id <id>          Run id (default: sha256 of inputs + now — deterministic)
  --out <dir>            Output directory for run.json + report.md (default: ./out)
  --quiet                Suppress report on stdout

Status messages go to stderr; the report goes to stdout unless --quiet.
`;

/**
 * R-20: pseudonymization is mandatory whenever actor data flows in — the
 * core refuses unmapped actors without a context, and we refuse earlier,
 * with a friendlier message. The salt comes from a file, never from argv.
 */
function resolvePseudonymization(
  values: { org?: string | undefined; 'salt-file'?: string | undefined },
  actorColumnMapped: boolean,
) {
  if (!actorColumnMapped) return undefined;
  if (!values.org || !values['salt-file']) {
    throw new CliError(
      'The mapping template maps an actor column, so --org <scope> and --salt-file <file> are required: ' +
        'unmapped actor values are pseudonymized with an org-scoped salt (raw identities are never stored).',
    );
  }
  const salt = readTextFile(values['salt-file'], 'salt file').trim();
  if (salt.length < 8) {
    throw new CliError('The salt file must contain at least 8 non-whitespace characters.');
  }
  return buildPseudonymizationContext(values.org, salt);
}

function run(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      csv: { type: 'string' },
      mapping: { type: 'string' },
      assumptions: { type: 'string' },
      events: { type: 'string' },
      org: { type: 'string' },
      'salt-file': { type: 'string' },
      now: { type: 'string' },
      'run-id': { type: 'string' },
      out: { type: 'string' },
      quiet: { type: 'boolean' },
    },
  });

  const subcommand = positionals[0];
  if (subcommand === 'preflight') {
    if (!values.csv || !values.mapping) {
      throw new CliError(USAGE);
    }
    const mapping = readJsonFile(values.mapping, 'mapping template', mappingTemplateSchema);
    const result = preflight({
      csvText: readTextFile(values.csv, 'CSV file'),
      eventsCsvText:
        values.events !== undefined ? readTextFile(values.events, 'event-history CSV') : undefined,
      mapping,
      assumptions: values.assumptions
        ? readJsonFile(values.assumptions, 'assumption set', assumptionSetSchema)
        : undefined,
      pseudonymization: resolvePseudonymization(values, mapping.columns.actor !== undefined),
    });
    console.log(result.lines.join('\n'));
    if (!result.ok) process.exit(1);
    return;
  }

  if (subcommand !== 'analyze' || !values.csv || !values.mapping || !values.assumptions) {
    throw new CliError(USAGE);
  }

  if (values.now !== undefined && parseIsoUtc(values.now) === null) {
    throw new CliError(
      `Invalid --now value "${values.now}" — expected ISO-8601 UTC, e.g. 2026-07-20 or 2026-07-20T00:00:00Z.`,
    );
  }

  const csvText = readTextFile(values.csv, 'CSV file');
  const mapping = readJsonFile(values.mapping, 'mapping template', mappingTemplateSchema);
  const assumptions = readJsonFile(values.assumptions, 'assumption set', assumptionSetSchema);

  const pseudonymization = resolvePseudonymization(values, mapping.columns.actor !== undefined);

  const eventsCsvText =
    values.events !== undefined ? readTextFile(values.events, 'event-history CSV') : undefined;
  if (eventsCsvText !== undefined && mapping.events === undefined) {
    throw new CliError(
      'An --events file was provided but the mapping template has no "events" section.',
    );
  }

  const now = values.now ?? new Date(Date.now()).toISOString();
  const runId =
    values['run-id'] ??
    createHash('sha256')
      .update(csvText)
      .update(eventsCsvText ?? '')
      .update(JSON.stringify(mapping))
      .update(JSON.stringify(assumptions))
      .update(values.org ?? '')
      .update(pseudonymization ? readTextFile(values['salt-file'] as string, 'salt file') : '')
      .update(now)
      .digest('hex')
      .slice(0, 16);

  const batch = importCsv({
    batchId: `batch-${runId}`,
    csvText,
    eventsCsvText,
    mapping,
    importedAt: now,
    pseudonymization,
  });
  const analysisRun = runAnalysis({ runId, now, batch, assumptions });
  const report = renderMarkdown(buildReportModel(analysisRun));

  const outDir = values.out ?? 'out';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(analysisRun, null, 2) + '\n');
  writeFileSync(join(outDir, 'report.md'), report);

  if (!values.quiet) {
    console.log(report);
  }
  console.error(`Run ${runId}: artifacts written to ${outDir}/run.json and ${outDir}/report.md`);
}

try {
  run();
} catch (error) {
  // One line, no stack trace: these are user-facing input errors, and a stack
  // trace teaches partners the tool is broken rather than the input (R-08).
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof CliError ? message : `Error: ${message}`);
  process.exit(1);
}
