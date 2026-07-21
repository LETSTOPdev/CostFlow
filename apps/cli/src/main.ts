import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIsoUtc } from '@costflow/domain';
import { importCsv, transformAsana, transformJira, transformMonday } from '@costflow/ingestion';
import type { ImportBatch } from '@costflow/domain';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { CliError, readJsonFile, readTextFile } from './io';
import { preflight } from './preflight';
import { buildPseudonymizationContext } from './pseudonym';
import { fetchJira } from './fetchers/jira';
import { fetchMonday } from './fetchers/monday';
import { fetchAsana } from './fetchers/asana';
import {
  assumptionSetSchema,
  asanaMappingSchema,
  jiraMappingSchema,
  mappingTemplateSchema,
  mondayMappingSchema,
} from './schemas';

// The ONLY effectful edge in M0. Invalid or ambiguous input must fail loudly
// with a non-zero exit (R-01/R-08): "no frictions detected" may only ever
// follow a valid, completed analysis.

const USAGE = `Usage:
  costflow analyze   --csv <file> --mapping <file> --assumptions <file> [options]
  costflow analyze   --provider jira|monday|asana --raw <dir> --mapping <file> --assumptions <file> [options]
  costflow preflight --csv <file> --mapping <file> [--assumptions <file>] [options]
  costflow fetch     --provider jira --site <url> --email <email> --token-file <file> --project <KEY> --out <dir>
  costflow fetch     --provider monday --token-file <file> --project <board-id> --out <dir>
  costflow fetch     --provider asana --token-file <file> --project <project-gid> --out <dir>

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
  --simulation           Price vendor-suggested assumptions too (clearly-bannered
                         simulation register; default report mode prices only
                         customer-owned assumptions)
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

/** Raw fetch output layout: prefer <dir>/raw, fall back to <dir> itself. */
function listRawDir(rawOpt: string): { baseDir: string; fileNames: string[] } {
  const rawDir = join(rawOpt, 'raw');
  try {
    return { baseDir: rawDir, fileNames: readdirSync(rawDir) };
  } catch {
    return { baseDir: rawOpt, fileNames: readdirSync(rawOpt) };
  }
}

/** Numbered raw pages in numeric order (page 10 sorts after page 9, not after 1). */
function readNumberedPages(baseDir: string, fileNames: string[], pattern: RegExp): string[] {
  return fileNames
    .map((f) => pattern.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => readTextFile(join(baseDir, m[0]), m[0]));
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
      simulation: { type: 'boolean' },
      provider: { type: 'string' },
      raw: { type: 'string' },
      site: { type: 'string' },
      email: { type: 'string' },
      'token-file': { type: 'string' },
      project: { type: 'string' },
    },
  });

  const subcommand = positionals[0];
  if (subcommand === 'fetch') {
    const provider = values.provider;
    if (provider !== 'jira' && provider !== 'monday' && provider !== 'asana') {
      throw new CliError('fetch supports --provider jira, monday, or asana.');
    }
    if (!values['token-file'] || !values.project || !values.out) {
      throw new CliError(USAGE);
    }
    const token = readTextFile(values['token-file'], 'token file').trim();
    if (token.length < 8) throw new CliError('The token file looks empty.');
    const out = values.out;
    const fetchPromise = (() => {
      if (provider === 'jira') {
        if (!values.site || !values.email) throw new CliError(USAGE);
        return fetchJira(
          { site: values.site, email: values.email, token, projectKey: values.project },
          out,
        );
      }
      if (provider === 'monday') {
        return fetchMonday({ token, boardId: values.project }, out);
      }
      return fetchAsana({ token, projectGid: values.project }, out);
    })();
    void fetchPromise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error instanceof CliError ? message : `Error: ${message}`);
      process.exit(1);
    });
    return;
  }
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

  if (subcommand !== 'analyze' || !values.mapping || !values.assumptions) {
    throw new CliError(USAGE);
  }

  if (values.now !== undefined && parseIsoUtc(values.now) === null) {
    throw new CliError(
      `Invalid --now value "${values.now}" — expected ISO-8601 UTC, e.g. 2026-07-20 or 2026-07-20T00:00:00Z.`,
    );
  }

  const provider = values.provider ?? 'csv';
  const assumptions = readJsonFile(values.assumptions, 'assumption set', assumptionSetSchema);
  const now = values.now ?? new Date(Date.now()).toISOString();

  /** Deterministic run id over raw pages + mapping + assumptions + scope + salt + now. */
  const apiRunId = (pages: readonly string[], mapping: unknown): string =>
    values['run-id'] ??
    createHash('sha256')
      .update(JSON.stringify(pages))
      .update(JSON.stringify(mapping))
      .update(JSON.stringify(assumptions))
      .update(values.org ?? '')
      .update(readTextFile(values['salt-file'] as string, 'salt file'))
      .update(now)
      .digest('hex')
      .slice(0, 16);

  let batch: ImportBatch;
  let runId: string;
  if (provider === 'jira') {
    if (!values.raw)
      throw new CliError('--provider jira requires --raw <dir> (fetched raw pages).');
    const jiraMapping = readJsonFile(values.mapping as string, 'Jira mapping', jiraMappingSchema);
    const pseudonymization = resolvePseudonymization(values, true);
    const { baseDir, fileNames } = listRawDir(values.raw);
    const searchPages = readNumberedPages(baseDir, fileNames, /^search-page-(\d+)\.json$/);
    if (searchPages.length === 0) {
      throw new CliError(
        `No search-page-*.json files found in ${baseDir} — run costflow fetch first.`,
      );
    }
    const supplementaryChangelogs: Record<string, string[]> = {};
    for (const f of fileNames.filter((n) => /^changelog-.+-\d+\.json$/.test(n)).sort()) {
      const match = /^changelog-(.+)-\d+\.json$/.exec(f);
      if (!match) continue;
      const key = match[1] as string;
      (supplementaryChangelogs[key] ??= []).push(readTextFile(join(baseDir, f), f));
    }
    runId = apiRunId(searchPages, jiraMapping);
    batch = transformJira({
      batchId: `batch-${runId}`,
      searchPages,
      supplementaryChangelogs,
      mapping: jiraMapping,
      importedAt: now,
      pseudonymization,
    });
  } else if (provider === 'monday') {
    if (!values.raw)
      throw new CliError('--provider monday requires --raw <dir> (fetched raw pages).');
    const mondayMapping = readJsonFile(
      values.mapping as string,
      'monday mapping',
      mondayMappingSchema,
    );
    const pseudonymization = resolvePseudonymization(values, true);
    const { baseDir, fileNames } = listRawDir(values.raw);
    const itemsPages = readNumberedPages(baseDir, fileNames, /^items-page-(\d+)\.json$/);
    if (itemsPages.length === 0) {
      throw new CliError(
        `No items-page-*.json files found in ${baseDir} — run costflow fetch first.`,
      );
    }
    const activityPages = readNumberedPages(baseDir, fileNames, /^activity-page-(\d+)\.json$/);
    runId = apiRunId([...itemsPages, ...activityPages], mondayMapping);
    batch = transformMonday({
      batchId: `batch-${runId}`,
      itemsPages,
      activityPages: activityPages.length > 0 ? activityPages : undefined,
      mapping: mondayMapping,
      importedAt: now,
      pseudonymization,
    });
  } else if (provider === 'asana') {
    if (!values.raw)
      throw new CliError('--provider asana requires --raw <dir> (fetched raw pages).');
    const asanaMapping = readJsonFile(
      values.mapping as string,
      'Asana mapping',
      asanaMappingSchema,
    );
    const pseudonymization = resolvePseudonymization(values, true);
    const { baseDir, fileNames } = listRawDir(values.raw);
    const taskPages = readNumberedPages(baseDir, fileNames, /^tasks-page-(\d+)\.json$/);
    if (taskPages.length === 0) {
      throw new CliError(
        `No tasks-page-*.json files found in ${baseDir} — run costflow fetch first.`,
      );
    }
    const sectionsDoc = readTextFile(join(baseDir, 'sections.json'), 'sections.json');
    const storiesByTask: Record<string, string[]> = {};
    for (const f of fileNames.filter((n) => /^stories-.+-\d+\.json$/.test(n)).sort()) {
      const match = /^stories-(.+)-\d+\.json$/.exec(f);
      if (!match) continue;
      const gid = match[1] as string;
      (storiesByTask[gid] ??= []).push(readTextFile(join(baseDir, f), f));
    }
    runId = apiRunId(
      [...taskPages, sectionsDoc, ...Object.values(storiesByTask).flat()],
      asanaMapping,
    );
    batch = transformAsana({
      batchId: `batch-${runId}`,
      taskPages,
      storiesByTask,
      sectionsDoc,
      mapping: asanaMapping,
      importedAt: now,
      pseudonymization,
    });
  } else if (provider === 'csv') {
    if (!values.csv) throw new CliError(USAGE);
    const csvText = readTextFile(values.csv, 'CSV file');
    const mapping = readJsonFile(
      values.mapping as string,
      'mapping template',
      mappingTemplateSchema,
    );
    const pseudonymization = resolvePseudonymization(values, mapping.columns.actor !== undefined);
    const eventsCsvText =
      values.events !== undefined ? readTextFile(values.events, 'event-history CSV') : undefined;
    if (eventsCsvText !== undefined && mapping.events === undefined) {
      throw new CliError(
        'An --events file was provided but the mapping template has no "events" section.',
      );
    }
    runId =
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
    batch = importCsv({
      batchId: `batch-${runId}`,
      csvText,
      eventsCsvText,
      mapping,
      importedAt: now,
      pseudonymization,
    });
  } else {
    throw new CliError(`Unknown provider "${provider}" — supported: csv, jira, monday, asana.`);
  }
  const analysisRun = runAnalysis({
    runId,
    now,
    batch,
    assumptions,
    mode: values.simulation ? 'simulation' : 'report',
  });
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
