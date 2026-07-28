import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interventionForUnit } from '@costflow/diagnostics';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GOLDEN = join(ROOT, 'tools/golden/expected');

/**
 * `interventionForUnit` fails closed at runtime: an unmapped magnitude unit
 * produces no finding rather than a defaulted one, because confident-but-wrong
 * advice is worse than silence. That safety net must never actually be load
 * bearing, though — a unit the engine really emits should always have an
 * intervention.
 *
 * The goldens are the frozen record of what the engine emits, so they are the
 * right place to check it from. Adding a friction family with a new magnitude
 * unit will regenerate a golden and fail this test until the map is extended,
 * which is exactly when someone should be deciding what to recommend for it.
 */
describe('every magnitude unit the engine emits has an intervention', () => {
  const runs = readdirSync(GOLDEN, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(GOLDEN, e.name, 'run.json'))
    .filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });

  it('finds golden artifacts to read (guards against checking nothing)', () => {
    expect(runs.length).toBeGreaterThan(0);
  });

  const units = new Set<string>();
  for (const path of runs) {
    const run = JSON.parse(readFileSync(path, 'utf8')) as {
      frictions?: { magnitude?: { unit?: string } }[];
    };
    for (const f of run.frictions ?? []) {
      if (f.magnitude?.unit) units.add(f.magnitude.unit);
    }
  }

  it('observes the units the engine actually produces', () => {
    expect(units.size).toBeGreaterThan(0);
  });

  for (const unit of [...units].sort()) {
    it(`"${unit}" maps to an intervention`, () => {
      expect(interventionForUnit(unit)).not.toBeNull();
    });
  }

  it('returns null for a unit it has never heard of, rather than a default', () => {
    expect(interventionForUnit('item-decades-in-purgatory')).toBeNull();
  });
});
