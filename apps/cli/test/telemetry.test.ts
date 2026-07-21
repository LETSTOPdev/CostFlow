import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCsv, transformAsana, transformJira, transformMonday } from '@costflow/ingestion';
import { runAnalysis, type AnalysisRun } from '@costflow/analysis';
import {
  TELEMETRY_TAXONOMY,
  deriveRunTelemetry,
  serializeTelemetry,
  type TelemetryEvent,
} from '@costflow/telemetry';
import { buildPseudonymizationContext } from '../src/pseudonym';
import { interactionEvent } from '../src/telemetry-edge';
import {
  assumptionSetSchema,
  asanaMappingSchema,
  jiraMappingSchema,
  mappingTemplateSchema,
  mondayMappingSchema,
} from '../src/schemas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');
const EXPECTED = join(ROOT, 'tools/golden/expected');
const NOW = '2026-07-20T00:00:00Z';

function pseudonymization() {
  const salt = readFileSync(join(FIXTURES, 'salt.txt'), 'utf8').trim();
  return buildPseudonymizationContext('costflow-golden', salt);
}

function read(...parts: string[]): string {
  return readFileSync(join(...parts), 'utf8');
}

/** All five golden runs — the fixture corpus for the privacy/determinism proofs. */
const GOLDEN_RUNS: Record<string, () => AnalysisRun> = {
  'demo-ops': () =>
    runAnalysis({
      runId: 'golden-demo-ops',
      now: NOW,
      batch: importCsv({
        batchId: 'batch-golden-demo-ops',
        csvText: read(FIXTURES, 'demo-ops.csv'),
        mapping: mappingTemplateSchema.parse(JSON.parse(read(FIXTURES, 'mapping.json'))),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(JSON.parse(read(FIXTURES, 'assumptions.json'))),
    }),
  'demo-flow': () =>
    runAnalysis({
      runId: 'golden-demo-flow',
      now: NOW,
      batch: importCsv({
        batchId: 'batch-golden-demo-flow',
        csvText: read(FIXTURES, 'demo-flow.csv'),
        eventsCsvText: read(FIXTURES, 'demo-flow-events.csv'),
        mapping: mappingTemplateSchema.parse(JSON.parse(read(FIXTURES, 'demo-flow-mapping.json'))),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(read(FIXTURES, 'demo-flow-assumptions.json')),
      ),
    }),
  'demo-jira': () =>
    runAnalysis({
      runId: 'golden-demo-jira',
      now: NOW,
      batch: transformJira({
        batchId: 'batch-golden-demo-jira',
        searchPages: [read(FIXTURES, 'jira', 'raw', 'search-page-0.json')],
        mapping: jiraMappingSchema.parse(JSON.parse(read(FIXTURES, 'jira', 'mapping.json'))),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(read(FIXTURES, 'jira', 'assumptions.json')),
      ),
    }),
  'demo-monday': () =>
    runAnalysis({
      runId: 'golden-demo-monday',
      now: NOW,
      batch: transformMonday({
        batchId: 'batch-golden-demo-monday',
        itemsPages: [read(FIXTURES, 'monday', 'raw', 'items-page-0.json')],
        activityPages: [read(FIXTURES, 'monday', 'raw', 'activity-page-0.json')],
        mapping: mondayMappingSchema.parse(JSON.parse(read(FIXTURES, 'monday', 'mapping.json'))),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(read(FIXTURES, 'monday', 'assumptions.json')),
      ),
    }),
  'demo-asana': () =>
    runAnalysis({
      runId: 'golden-demo-asana',
      now: NOW,
      batch: transformAsana({
        batchId: 'batch-golden-demo-asana',
        taskPages: [read(FIXTURES, 'asana', 'raw', 'tasks-page-0.json')],
        storiesByTask: {
          '9001': [read(FIXTURES, 'asana', 'raw', 'stories-9001-0.json')],
          '9002': [read(FIXTURES, 'asana', 'raw', 'stories-9002-0.json')],
          '9003': [read(FIXTURES, 'asana', 'raw', 'stories-9003-0.json')],
        },
        sectionsDoc: read(FIXTURES, 'asana', 'raw', 'sections.json'),
        mapping: asanaMappingSchema.parse(JSON.parse(read(FIXTURES, 'asana', 'mapping.json'))),
        importedAt: NOW,
        pseudonymization: pseudonymization(),
      }),
      assumptions: assumptionSetSchema.parse(
        JSON.parse(read(FIXTURES, 'asana', 'assumptions.json')),
      ),
    }),
};

/** Customer vocabulary from ALL golden fixtures — none may ever appear (P3 proof 3). */
const PROHIBITED = [
  // titles
  'Website redesign brief',
  'Vendor contract renewal',
  'Spring campaign wrap-up',
  'Draft NDA for new vendor',
  'Update onboarding checklist',
  'Ship pricing page update',
  'Renew data processing agreement',
  'Vendor risk review',
  'Quarterly access audit',
  // stage names (and their slugs via instance ids)
  'Backlog',
  'Waiting for review',
  'Waiting for approval',
  'Working on it',
  'To Do',
  'In Progress',
  'Contract Review',
  'Intake',
  'Doing',
  'Legal review',
  'Stuck',
  // actor values and pseudonyms
  'Maya Founder',
  'Guy Freelancer',
  'Rina Legal',
  'Tomer Helper',
  'Noa Legal',
  'Dan Ops',
  'Guy Contractor',
  'anon-',
  // role names
  'Founder',
  'Legal',
  'Finance',
  'Procurement',
  'Marketing',
  // rate values (quoted decimal-string form), currency, scope, customer ids
  '"120"',
  '"110"',
  '"100"',
  '"90"',
  '"75"',
  'USD',
  'costflow-golden',
  'monday-ops-board',
  'asana-legal-project',
  'jira-ops-project',
  'demo-flow-board',
  'assumptions"',
];

/** Engine vocabulary is lowercase-mechanical; customer vocabulary virtually never is. */
const MACHINE_SHAPE = /^[a-z0-9@.:-]+$/;

function assertMachineShape(value: unknown, path: string): void {
  if (typeof value === 'string') {
    expect(value, `${path} must be machine-shaped, got "${value}"`).toMatch(MACHINE_SHAPE);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertMachineShape(child, `${path}.${key}`);
    }
  }
}

describe('telemetry proofs over the golden corpus (doc 15 P3)', () => {
  for (const [name, make] of Object.entries(GOLDEN_RUNS)) {
    it(`${name}: derived telemetry reproduces the frozen artifact byte-exactly (proof 4)`, () => {
      const serialized = serializeTelemetry(deriveRunTelemetry(make()));
      expect(serialized).toBe(read(EXPECTED, name, 'telemetry.jsonl'));
      expect(serializeTelemetry(deriveRunTelemetry(make()))).toBe(serialized);
    });

    it(`${name}: no prohibited data, machine-shaped fields only (proof 3)`, () => {
      const events = deriveRunTelemetry(make());
      const serialized = serializeTelemetry(events);
      for (const secret of PROHIBITED) {
        expect(serialized, `must not contain ${secret}`).not.toContain(secret);
      }
      for (const event of events) {
        assertMachineShape(event.fields, `${event.event}.fields`);
      }
    });

    it(`${name}: derivation leaves the run artifact untouched (proof 1)`, () => {
      const run = make();
      const before = JSON.stringify(run);
      deriveRunTelemetry(run);
      expect(JSON.stringify(run)).toBe(before);
    });
  }

  it('proof 5: derived and interaction events are disjoint, registered kinds', () => {
    const derivedRegistered = new Set(
      TELEMETRY_TAXONOMY.filter((m) => m.kind === 'derived').map((m) => m.event),
    );
    const interactionRegistered = new Set(
      TELEMETRY_TAXONOMY.filter((m) => m.kind === 'interaction').map((m) => m.event),
    );
    const derived = deriveRunTelemetry(GOLDEN_RUNS['demo-ops']!());
    for (const event of derived) {
      expect(event.kind).toBe('derived');
      expect(derivedRegistered.has(event.event)).toBe(true);
      expect(interactionRegistered.has(event.event)).toBe(false);
    }
    const interaction: TelemetryEvent = interactionEvent('tm-cli-analyze', {
      provider: 'csv',
      mode: 'report',
      ok: true,
      errorClass: null,
      durationMs: 1,
    });
    expect(interaction.kind).toBe('interaction');
    expect(interactionRegistered.has(interaction.event)).toBe(true);
    expect(interaction.runId).toBeUndefined(); // v1: no funnel linkage by default
    assertMachineShape(interaction.fields, 'tm-cli-analyze.fields');
  });
});

describe('telemetry failure containment at the CLI edge (proof 2)', () => {
  const analyzeArgs = (out: string) => [
    'costflow',
    'analyze',
    '--csv',
    join(FIXTURES, 'demo-ops.csv'),
    '--mapping',
    join(FIXTURES, 'mapping.json'),
    '--assumptions',
    join(FIXTURES, 'assumptions.json'),
    '--org',
    'costflow-golden',
    '--salt-file',
    join(FIXTURES, 'salt.txt'),
    '--now',
    NOW,
    '--run-id',
    'telemetry-proof',
    '--out',
    out,
    '--quiet',
  ];

  it('an unwritable interaction destination warns and never fails the run', () => {
    const out = mkdtempSync(join(tmpdir(), 'costflow-tm-'));
    const result = spawnSync('pnpm', analyzeArgs(out), {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        // A path UNDER a regular file: mkdir must fail.
        COSTFLOW_TELEMETRY_DIR: join(FIXTURES, 'salt.txt', 'nope'),
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('interaction telemetry not recorded');
    expect(result.stderr).toContain('analysis unaffected');
    expect(existsSync(join(out, 'run.json'))).toBe(true);
    expect(existsSync(join(out, 'report.md'))).toBe(true);
    expect(existsSync(join(out, 'telemetry.jsonl'))).toBe(true);
  }, 60_000);

  it('COSTFLOW_TELEMETRY=off disables the interaction log entirely', () => {
    const out = mkdtempSync(join(tmpdir(), 'costflow-tm-'));
    const interactionDir = join(out, 'interactions-dir');
    const result = spawnSync('pnpm', analyzeArgs(out), {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, COSTFLOW_TELEMETRY: 'off', COSTFLOW_TELEMETRY_DIR: interactionDir },
    });
    expect(result.status).toBe(0);
    expect(existsSync(interactionDir)).toBe(false); // nothing written, nothing created
    expect(existsSync(join(out, 'telemetry.jsonl'))).toBe(true); // derived artifact unaffected
  }, 60_000);

  it('interaction events land in the configured local file with wall-clock separation', () => {
    const out = mkdtempSync(join(tmpdir(), 'costflow-tm-'));
    const interactionDir = join(out, 'interactions-dir');
    const result = spawnSync('pnpm', analyzeArgs(out), {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, COSTFLOW_TELEMETRY_DIR: interactionDir },
    });
    expect(result.status).toBe(0);
    const lines = readFileSync(join(interactionDir, 'interactions.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as TelemetryEvent);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'tm-cli-analyze',
      kind: 'interaction',
      fields: { provider: 'csv', mode: 'report', ok: true, errorClass: null },
    });
    // The derived artifact holds ONLY derived events (proof 5 file separation).
    const derivedKinds = new Set(
      readFileSync(join(out, 'telemetry.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as TelemetryEvent).kind),
    );
    expect([...derivedKinds]).toEqual(['derived']);
  }, 60_000);
});
