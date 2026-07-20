import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');

function cli(args: string[]): { status: number; stdout: string; stderr: string } {
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

describe('costflow preflight (M1 pass 1 — structure only, no financials)', () => {
  it('reports structure, coverage, and PASSED verdict on a valid dataset with events', () => {
    const result = cli([
      'preflight',
      '--csv',
      join(FIXTURES, 'demo-flow.csv'),
      '--events',
      join(FIXTURES, 'demo-flow-events.csv'),
      '--mapping',
      join(FIXTURES, 'demo-flow-mapping.json'),
      '--assumptions',
      join(FIXTURES, 'demo-flow-assumptions.json'),
      '--org',
      'preflight-test',
      '--salt-file',
      join(FIXTURES, 'salt.txt'),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('total 4 · imported 4 · dropped 0');
    expect(result.stdout).toContain('mapped to roles 3 · unmapped (would pseudonymize) 1');
    expect(result.stdout).toContain('every mapped role has a rate-card entry');
    expect(result.stdout).toContain('11 events imported · strict validation PASSED');
    expect(result.stdout).toContain('Preflight verdict: PASSED');
    // Structure only — no money anywhere in preflight output.
    expect(result.stdout).not.toMatch(/USD|\bcost\b|estimate/i);
  });

  it('surfaces drops, warnings, and missing rate coverage on the messier fixture', () => {
    const result = cli([
      'preflight',
      '--csv',
      join(FIXTURES, 'demo-ops.csv'),
      '--mapping',
      join(FIXTURES, 'mapping.json'),
      '--assumptions',
      join(FIXTURES, 'assumptions.json'),
      '--org',
      'preflight-test',
      '--salt-file',
      join(FIXTURES, 'salt.txt'),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('total 10 · imported 9 · dropped 1');
    expect(result.stdout).toContain('== Dropped rows ==');
    expect(result.stdout).toContain('== Warnings ==');
    expect(result.stdout).toContain('event history no');
  });

  it('fails with a STRUCTURAL ERROR verdict (exit 1) instead of proceeding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'costflow-preflight-'));
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'Item ID,Name\n1,A\n'); // missing mapped columns
    const result = cli([
      'preflight',
      '--csv',
      bad,
      '--mapping',
      join(FIXTURES, 'mapping.json'),
      '--org',
      'preflight-test',
      '--salt-file',
      join(FIXTURES, 'salt.txt'),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('STRUCTURAL ERROR');
    expect(result.stdout).toContain('Preflight verdict: FAILED');
  });
});
