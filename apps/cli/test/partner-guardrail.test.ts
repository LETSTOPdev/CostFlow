import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function gitCheckIgnore(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * M1 concierge guardrail: partner data lives under partner-runs/ and must be
 * structurally incapable of entering version control. If this test fails,
 * STOP any partner session until it passes again.
 */
describe('partner-runs/ is git-ignored (M1 privacy guardrail)', () => {
  it('.gitignore contains the partner-runs/ pattern', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^partner-runs\/$/m);
  });

  it('git agrees: every partner-run path shape is ignored', () => {
    for (const path of [
      'partner-runs/acme/raw/export.csv',
      'partner-runs/acme/config/salt.txt',
      'partner-runs/acme/config/mapping.json',
      'partner-runs/acme/output/run.json',
      'partner-runs/acme/notes/findings-memo.md',
    ]) {
      expect(gitCheckIgnore(path), `${path} must be git-ignored`).toBe(true);
    }
  });

  it('a real canary file inside partner-runs/ never appears in git status', () => {
    const canaryDir = join(ROOT, 'partner-runs', 'canary-test', 'raw');
    const canary = join(canaryDir, 'canary.csv');
    mkdirSync(canaryDir, { recursive: true });
    writeFileSync(canary, 'canary,data\n');
    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString();
      expect(status).not.toContain('partner-runs');
    } finally {
      rmSync(join(ROOT, 'partner-runs', 'canary-test'), { recursive: true, force: true });
    }
  });
});
