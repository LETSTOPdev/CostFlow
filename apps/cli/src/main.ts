import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { parseIsoUtc } from '@costflow/domain';
import { importCsv } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { buildPseudonymizationContext } from './pseudonym';
import { assumptionSetSchema, mappingTemplateSchema } from './schemas';

// The ONLY effectful edge in M0. Invalid or ambiguous input must fail loudly
// with a non-zero exit (R-01/R-08): "no frictions detected" may only ever
// follow a valid, completed analysis.

const USAGE = `Usage: costflow analyze --csv <file> --mapping <file> --assumptions <file> [options]

Options:
  --csv <file>           Work-items CSV export to analyze (required)
  --mapping <file>       Mapping template JSON (required)
  --assumptions <file>   Assumption set JSON (required)
  --events <file>        Optional event-history CSV (requires "events" in the mapping)
  --org <scope>          Pseudonymization scope id (required when an actor column is mapped)
  --salt-file <file>     File containing the org's pseudonymization salt (required with --org;
                         keep it out of the repo and out of shell history)
  --now <iso>            Analysis time, ISO-8601 UTC (default: current time)
  --run-id <id>          Run id (default: sha256 of inputs + now — deterministic)
  --out <dir>            Output directory for run.json + report.md (default: ./out)
  --quiet                Suppress report on stdout

Status messages go to stderr; the report goes to stdout unless --quiet.
`;

class CliError extends Error {}

function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ${label} at "${path}": ${(error as Error).message}`);
  }
}

function readJsonFile<T>(
  path: string,
  label: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const text = readTextFile(path, label);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${label} at "${path}" is not valid JSON: ${(error as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new CliError(`Invalid ${label} at "${path}":\n${issues}`);
  }
  return result.data;
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

  if (positionals[0] !== 'analyze' || !values.csv || !values.mapping || !values.assumptions) {
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

  // R-20: pseudonymization is mandatory whenever actor data flows in — the
  // core refuses unmapped actors without a context, and we refuse earlier,
  // with a friendlier message. The salt comes from a file, never from argv.
  let pseudonymization = undefined;
  if (mapping.columns.actor !== undefined) {
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
    pseudonymization = buildPseudonymizationContext(values.org, salt);
  }

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
