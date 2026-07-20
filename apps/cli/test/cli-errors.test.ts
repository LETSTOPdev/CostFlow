import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[]): CliResult {
  try {
    const stdout = execFileSync('pnpm', ['--silent', 'costflow', ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? -1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function expectCleanFailure(result: CliResult, messagePattern: RegExp): void {
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toMatch(messagePattern);
  // No stack traces at users (R-08): frames look like "    at fn (file:line)".
  expect(result.stderr).not.toMatch(/\n\s+at .*:\d+/);
}

const VALID = [
  '--csv',
  join(FIXTURES, 'demo-ops.csv'),
  '--mapping',
  join(FIXTURES, 'mapping.json'),
  '--assumptions',
  join(FIXTURES, 'assumptions.json'),
  '--org',
  'test-org',
  '--salt-file',
  join(FIXTURES, 'salt.txt'),
];

describe('CLI fails visibly on invalid input (regressions: R-01, R-04, R-05, R-08)', () => {
  it('rejects a non-ISO --now instead of silently reporting no frictions (R-01)', () => {
    const out = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const result = cli(['analyze', ...VALID, '--now', '20/07/2026', '--out', out]);
    expectCleanFailure(result, /Invalid --now value "20\/07\/2026"/);
  });

  it('rejects a missing input file with a readable message', () => {
    const result = cli([
      'analyze',
      ...VALID.slice(0, 2),
      '--mapping',
      '/nope/missing.json',
      '--assumptions',
      VALID[5] as string,
    ]);
    expectCleanFailure(result, /Cannot read mapping template at "\/nope\/missing\.json"/);
  });

  it('rejects malformed JSON with the file named', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const bad = join(dir, 'broken.json');
    writeFileSync(bad, '{ "id": "x", ');
    const result = cli([
      'analyze',
      ...VALID.slice(0, 2),
      '--mapping',
      bad,
      '--assumptions',
      VALID[5] as string,
    ]);
    expectCleanFailure(result, /is not valid JSON/);
  });

  it('rejects schema violations with field-level messages (negative rate, R-10)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const bad = join(dir, 'assumptions.json');
    writeFileSync(
      bad,
      JSON.stringify({
        id: 'a',
        version: '1',
        currency: 'USD',
        rates: [{ roleRef: 'Ops', hourlyRate: '-50', provenance: 'customer-customized' }],
        defaultRate: { hourlyRate: '75', provenance: 'vendor-suggested' },
        parameters: {
          agingThresholdDays: { value: 14, provenance: 'customer-customized' },
          attentionHoursPerDay: {
            range: { low: '0.1', expected: '0.2', high: '0.3' },
            provenance: 'customer-customized',
          },
        },
      }),
    );
    const result = cli(['analyze', ...VALID.slice(0, 4), '--assumptions', bad]);
    expectCleanFailure(result, /rates\.0\.hourlyRate.*non-negative/);
  });

  it('rejects unknown keys in config files instead of silently stripping them (R-09)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const bad = join(dir, 'mapping.json');
    writeFileSync(
      bad,
      JSON.stringify({
        id: 'm',
        version: '1',
        columns: { title: 'Name', status: 'Status' },
        statusMap: { Done: 'done' },
        statusmap: { Open: 'active' },
      }),
    );
    const result = cli([
      'analyze',
      ...VALID.slice(0, 2),
      '--mapping',
      bad,
      '--assumptions',
      VALID[5] as string,
    ]);
    expectCleanFailure(result, /Unrecognized key/i);
  });

  it('rejects unknown flags', () => {
    const result = cli(['analyze', ...VALID, '--frobnicate']);
    expectCleanFailure(result, /frobnicate/);
  });

  it('rejects a CSV whose header lacks a mapped column (R-05)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const csv = join(dir, 'bad.csv');
    writeFileSync(csv, 'Item ID,Name,Status\n1,A,Done\n');
    const result = cli(['analyze', '--csv', csv, ...VALID.slice(2)]);
    expectCleanFailure(result, /Mapped column\(s\) not found in CSV header/);
  });

  it('rejects a CSV with duplicate mapped headers (R-04)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-err-'));
    const csv = join(dir, 'dupe.csv');
    writeFileSync(
      csv,
      'Item ID,Name,Status,Status,Owner,Created,Due,Last Updated\n1,A,Done,Open,Sarah Cohen,2026-01-01,2026-02-01,2026-03-01\n',
    );
    const result = cli(['analyze', '--csv', csv, ...VALID.slice(2)]);
    expectCleanFailure(result, /duplicate mapped column/i);
  });
}, 120_000);
