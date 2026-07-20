import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function depcruise(extraArgs: string[] = []): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'pnpm',
      [
        'exec',
        'depcruise',
        'packages',
        'apps',
        '--config',
        '.dependency-cruiser.cjs',
        ...extraArgs,
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    return { ok: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('dependency boundaries are enforced, not aspirational (doc 05 §3)', () => {
  it('the current tree passes', () => {
    const result = depcruise();
    expect(result.ok, result.output).toBe(true);
  });

  it('a forbidden import (cost-engine → ingestion) fails the check', () => {
    const offender = join(ROOT, 'packages/cost-engine/src/tmp-boundary-violation.ts');
    mkdirSync(dirname(offender), { recursive: true });
    writeFileSync(
      offender,
      "import { importCsv } from '../../ingestion/src/index';\nexport const x = importCsv;\n",
    );
    try {
      const result = depcruise();
      expect(result.ok).toBe(false);
      expect(result.output).toContain('cost-engine');
    } finally {
      rmSync(offender, { force: true });
    }
  }, 60_000);
});
