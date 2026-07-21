import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * R-15: depcruise bans node builtins in pure packages, but nothing else stops
 * a third-party I/O package (e.g. fs-extra) from sneaking in. This allowlist
 * makes adding any dependency to a pure package a deliberate, reviewed act.
 */
const ALLOWED_EXTERNAL: Record<string, string[]> = {
  domain: [],
  ingestion: ['csv-parse'],
  friction: [],
  'cost-engine': ['decimal.js'],
  analysis: [],
  reporting: [],
  telemetry: [],
};

describe('pure packages carry no unreviewed external dependencies (R-15)', () => {
  const packages = readdirSync(join(ROOT, 'packages'));

  it('covers every package that exists (no unlisted package slips by)', () => {
    expect([...packages].sort()).toEqual([...Object.keys(ALLOWED_EXTERNAL)].sort());
  });

  for (const pkg of Object.keys(ALLOWED_EXTERNAL)) {
    it(`${pkg}: dependencies ⊆ workspace siblings + allowlist`, () => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys(manifest.dependencies ?? {});
      const external = deps.filter((d) => !d.startsWith('@costflow/'));
      expect(external.sort()).toEqual([...(ALLOWED_EXTERNAL[pkg] ?? [])].sort());
      // Pure packages get their tooling from the workspace root, not locally.
      expect(manifest.devDependencies ?? {}).toEqual({});
    });
  }
});
