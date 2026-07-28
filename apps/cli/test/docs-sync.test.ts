import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOCS = join(ROOT, 'docs');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The documentation under docs/ is the canonical source of truth for the current
 * state of this project, and updating it is part of the Definition of Done.
 *
 * Most of that is judgement and cannot be tested. These are the parts that can:
 * places where the documentation and the codebase can be shown to disagree. A
 * stale document is worse than a missing one, because it is believed — this
 * project has already lost a milestone's premise to a note nobody checked.
 */
describe('the documentation matches the codebase', () => {
  const LIVING = [
    '00-project-brief',
    '01-architecture',
    '02-current-state',
    '03-roadmap',
    '04-engineering-principles',
    '05-decisions',
    '06-known-risks',
    '07-testing',
    '08-admin',
  ];

  it('has every living document the contributing guide promises', () => {
    for (const name of LIVING) {
      expect(existsSync(join(DOCS, `${name}.md`)), `docs/${name}.md is missing`).toBe(true);
    }
  });

  it('keeps the entry point readable in under five minutes', () => {
    // ~200 wpm on technical prose; 1,200 words is a comfortable ceiling for the
    // five-minute promise the document itself makes. If it grows past this, the
    // detail belongs in whichever document owns that subject.
    const words = read('docs/00-project-brief.md').split(/\s+/).filter(Boolean).length;
    expect(words, 'docs/00-project-brief.md has outgrown its five-minute promise').toBeLessThan(
      1200,
    );
  });

  /**
   * Adding a package without describing it leaves the architecture document
   * quietly wrong about the shape of the system, which is exactly the failure
   * the Definition of Done exists to prevent.
   */
  it('describes every package in the architecture document', () => {
    const architecture = read('docs/01-architecture.md');
    for (const pkg of readdirSync(join(ROOT, 'packages'))) {
      expect(architecture, `packages/${pkg} is not described in docs/01-architecture.md`).toContain(
        pkg,
      );
    }
  });

  it('describes every application in the architecture document', () => {
    const architecture = read('docs/01-architecture.md');
    for (const app of readdirSync(join(ROOT, 'apps'))) {
      expect(architecture, `apps/${app} is not described in docs/01-architecture.md`).toContain(
        app,
      );
    }
  });

  /**
   * The reference corpus kept its original filenames so that the 162 citations
   * in source code of the form `doc 07 §1.2` still resolve. Renumbering or
   * removing one silently breaks comments the compiler cannot check.
   */
  it('preserves the reference corpus the source code cites by number', () => {
    const cited = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.sql')) continue;
        for (const m of readFileSync(full, 'utf8').matchAll(/\bdocs? (\d{2})\b/g)) {
          cited.add(m[1] as string);
        }
      }
    };
    walk(join(ROOT, 'packages'));
    walk(join(ROOT, 'apps'));

    const available = new Set(
      readdirSync(join(DOCS, 'reference'))
        .map((f) => /^(\d{2})-/.exec(f)?.[1])
        .filter((n): n is string => n !== undefined),
    );
    const missing = [...cited].filter((n) => !available.has(n)).sort();
    expect(missing, 'source code cites a reference document that no longer exists').toEqual([]);
  });

  it('preserves every ADR the source code cites', () => {
    const cited = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.sql')) continue;
        for (const m of readFileSync(full, 'utf8').matchAll(/\bADR-(\d{4})\b/g)) {
          cited.add(m[1] as string);
        }
      }
    };
    walk(join(ROOT, 'packages'));
    walk(join(ROOT, 'apps'));

    const available = new Set(
      readdirSync(join(DOCS, 'adr'))
        .map((f) => /^(\d{4})-/.exec(f)?.[1])
        .filter((n): n is string => n !== undefined),
    );
    const missing = [...cited].filter((n) => !available.has(n)).sort();
    expect(missing, 'source code cites an ADR that no longer exists').toEqual([]);
  });

  it('resolves every internal link in the living documentation', () => {
    const broken: string[] = [];
    for (const name of [...LIVING, 'README']) {
      const rel = `docs/${name}.md`;
      for (const m of read(rel).matchAll(/\]\(([^)#]+?)\)/g)) {
        const link = m[1] as string;
        if (/^(https?:|mailto:)/.test(link)) continue;
        if (!existsSync(resolve(DOCS, link))) broken.push(`${rel} → ${link}`);
      }
    }
    expect(broken).toEqual([]);
  });

  /** The Definition of Done is stated where a fresh session will actually find it. */
  it('states the Definition of Done in both entry points', () => {
    expect(read('docs/README.md')).toContain('Definition of Done');
    expect(read('CLAUDE.md')).toContain('Definition of Done');
  });
});
