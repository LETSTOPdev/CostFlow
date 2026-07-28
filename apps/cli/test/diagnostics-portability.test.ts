import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = join(ROOT, 'packages/diagnostics/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(ROOT.length + 1),
  text: readFileSync(path, 'utf8'),
}));

/**
 * ADR-0006 + founder directive 2026-07-28: the diagnostic layer must stay
 * portable across connectors. It reasons in evidence capabilities and nothing
 * else — it asks "do I have transition history?", never "is this ClickUp?".
 *
 * depcruise already forbids packages/ → apps/, so a diagnostic cannot IMPORT
 * the connector registry. These tests close the softer hole: a provider name
 * hard-coded in a string, a comment that special-cases a platform, or a
 * diagnostic reaching past its declared capability gate into the raw batch
 * capability profile to infer what kind of source it came from.
 */
describe('the diagnostics layer is connector-blind (ADR-0006)', () => {
  it('has source files to check (guards against the glob silently matching nothing)', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  // Every provider that has an ingestion transform today, plus platforms a
  // connector might plausibly be written for next (ADR-0005 makes that a new
  // module, not a new branch). Adding a connector must not add a branch here.
  const PROVIDERS = ['jira', 'clickup', 'monday', 'asana', 'linear', 'trello', 'shortcut'];

  for (const provider of PROVIDERS) {
    it(`never mentions "${provider}"`, () => {
      const offenders = FILES.filter((f) => new RegExp(provider, 'i').test(f.text)).map(
        (f) => f.path,
      );
      expect(offenders, `provider name leaked into the diagnostics layer`).toEqual([]);
    });
  }

  /**
   * The raw `CapabilityProfile` describes what an IMPORT contained. Translating
   * that (together with the connector, the platform's limits, and the
   * workspace's configuration) into an `EvidenceProfile` is the app edge's job.
   * A diagnostic that reads `hasEventHistory` directly has re-implemented half
   * that translation inside the portable layer, and would silently disagree
   * with the app's own explanation of why it could not run.
   */
  const RAW_CAPABILITY_KEYS = ['hasEventHistory', 'hasDueDates', 'hasLastUpdated', 'hasActors'];

  for (const key of RAW_CAPABILITY_KEYS) {
    it(`never reads the raw capability key "${key}"`, () => {
      const offenders = FILES.filter((f) => f.text.includes(key)).map((f) => f.path);
      expect(offenders, `gate on EvidenceProfile, not the raw batch capability`).toEqual([]);
    });
  }

  it('gates every declared diagnostic through checkCapabilities', () => {
    // Anything that declares a DiagnosticSignalMeta is a diagnostic and must
    // gate on its requirements. Shared helpers in signals/ are not diagnostics.
    const declaring = FILES.filter((f) => f.text.includes(': DiagnosticSignalMeta'));
    expect(declaring.length).toBeGreaterThan(0);
    for (const file of declaring) {
      expect(file.text, `${file.path} declares a diagnostic but never gates it`).toContain(
        'checkCapabilities',
      );
    }
  });
});
