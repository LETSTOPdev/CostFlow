import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'tools/golden/fixtures');
const EXPECTED = join(ROOT, 'tools/golden/expected');

/**
 * R-20 rule 7: raw actor identifiers must never reach generated artifacts.
 * The check is derived from the fixtures themselves: every actorRoleMap key
 * (mapped raw values) and every known unmapped fixture value must be absent
 * from every generated golden file. Roles ("Legal") MAY appear; raw values
 * ("Sarah Cohen") may not.
 */
function actorValuesFromFixtures(): string[] {
  const values = new Set<string>();
  for (const file of ['mapping.json', 'demo-flow-mapping.json']) {
    const mapping = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
      actorRoleMap?: Record<string, string>;
    };
    for (const raw of Object.keys(mapping.actorRoleMap ?? {})) values.add(raw);
  }
  // Deliberately-unmapped fixture actors (kept in sync with the fixture CSVs).
  values.add('Uri Levi');
  values.add('unknown.person');
  return [...values];
}

function generatedArtifacts(): { path: string; content: string }[] {
  const artifacts: { path: string; content: string }[] = [];
  for (const dir of readdirSync(EXPECTED)) {
    for (const file of readdirSync(join(EXPECTED, dir))) {
      const path = join(EXPECTED, dir, file);
      artifacts.push({ path, content: readFileSync(path, 'utf8') });
    }
  }
  return artifacts;
}

describe('raw actor values never leak into generated artifacts (R-20 rule 7)', () => {
  it('fixture actor values are all absent from every golden run.json and report.md', () => {
    const rawValues = actorValuesFromFixtures();
    expect(rawValues.length).toBeGreaterThanOrEqual(7);
    const artifacts = generatedArtifacts();
    expect(artifacts.length).toBeGreaterThanOrEqual(4);
    for (const artifact of artifacts) {
      for (const raw of rawValues) {
        expect(artifact.content.includes(raw), `"${raw}" leaked into ${artifact.path}`).toBe(false);
      }
    }
  });

  it('pseudonyms in artifacts follow the anon-<hex> shape and carry no raw fragments', () => {
    const runJson = readFileSync(join(EXPECTED, 'demo-flow', 'run.json'), 'utf8');
    const pseudonyms = runJson.match(/"pseudonym":\s*"([^"]+)"/g) ?? [];
    expect(pseudonyms.length).toBeGreaterThanOrEqual(1);
    for (const match of pseudonyms) {
      expect(match).toMatch(/"pseudonym":\s*"anon-[0-9a-f]{12}"/);
    }
  });
});
