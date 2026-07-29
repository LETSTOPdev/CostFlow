import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_KINDS } from '@costflow/domain';
import { STAGE_KIND_GUIDE, PROVENANCE_LABEL, ASSUMPTION_LABEL } from '@costflow/ui';

/**
 * The explanation layer has one owner per concept, and the build says so.
 *
 * Every table here was previously written out twice, in `apps/web/src/server.ts`
 * and `apps/marketing/src/pages.ts`, and had drifted: `/docs` described five of
 * the six stage kinds correctly and dropped the clause that tells a reader
 * mapping a status to `active` that its items still count toward stale and
 * overdue. Nothing failed, because nothing was checking.
 *
 * These assertions are structural rather than textual. They do not pin the
 * wording — wording is allowed to improve — they pin that there is exactly ONE
 * place the wording lives.
 */

const ROOT = join(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/** Every shipped source file, excluding tests and the canonical modules themselves. */
const SHIPPED = [
  ...sourceFiles(join(ROOT, 'apps/web/src')),
  ...sourceFiles(join(ROOT, 'apps/marketing/src')),
  ...sourceFiles(join(ROOT, 'packages/ui/src')),
];

const read = (f: string): string => readFileSync(f, 'utf8');

describe('closed vocabularies are explained in exactly one place', () => {
  it('every stage kind has a guide entry, and the domain set is covered exhaustively', () => {
    for (const kind of STAGE_KINDS) {
      expect(STAGE_KIND_GUIDE[kind], `no guide entry for stage kind "${kind}"`).toBeDefined();
      expect(STAGE_KIND_GUIDE[kind].use.length, `${kind}: empty "use it when"`).toBeGreaterThan(0);
      expect(
        STAGE_KIND_GUIDE[kind].changes.length,
        `${kind}: empty "what it changes"`,
      ).toBeGreaterThan(0);
    }
  });

  it('no surface writes its own stage-kind explanation', () => {
    // The phrase that anchored both former copies. Anything reintroducing a
    // hand-written table would reproduce a sentence like it.
    const offenders = SHIPPED.filter(
      (f) => !f.endsWith('vocabulary.ts') && /nobody has picked|Nobody has picked/.test(read(f)),
    );
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });

  it('no surface writes its own provenance labels', () => {
    const offenders = SHIPPED.filter(
      (f) =>
        !f.endsWith('vocabulary.ts') &&
        /'customer-accepted':\s*'|"customer-accepted":\s*"/.test(read(f)),
    );
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });

  it('provenance and assumption tables cover what the product renders', () => {
    for (const p of [
      'vendor-suggested',
      'customer-accepted',
      'customer-customized',
      'customer-measured',
    ] as const) {
      expect(PROVENANCE_LABEL[p].form.length, `${p}: no form label`).toBeGreaterThan(0);
      expect(PROVENANCE_LABEL[p].report.length, `${p}: no report label`).toBeGreaterThan(0);
    }
    for (const [key, entry] of Object.entries(ASSUMPTION_LABEL)) {
      expect(entry.short.length, `${key}: no short label`).toBeGreaterThan(0);
      expect(entry.field.length, `${key}: no field label`).toBeGreaterThan(0);
    }
  });

  /**
   * The markdown report has its own provenance table and must keep it.
   *
   * `packages/reporting` is a pure package whose `report.md` is compared
   * byte-for-byte by the goldens, so changing its labels is an engine change.
   * It also sits UPSTREAM of `@costflow/ui`, so it cannot import the canonical
   * table without inverting the dependency arrow that dependency-cruiser
   * enforces. Consolidation is therefore not available at any acceptable price.
   *
   * What IS available is a check. The two tables say the same thing today, and
   * this fails the moment they stop — which is the whole risk a second copy
   * carries. Documented as intentionally-not-consolidated in
   * `02-current-state.md`.
   */
  it('the markdown report and the web report agree on provenance wording', () => {
    const markdown = read(join(ROOT, 'packages/reporting/src/markdown.ts'));
    for (const [value, entry] of Object.entries(PROVENANCE_LABEL)) {
      const line = new RegExp(`'${value}':\\s*'([^']+)'`).exec(markdown);
      expect(line, `markdown report has no label for "${value}"`).not.toBeNull();
      // Markdown emphasises with ** around the whole phrase; strip it before
      // comparing the words themselves.
      const plain = (line?.[1] ?? '').replace(/\*\*/g, '');
      expect(plain, `"${value}" reads differently in the markdown report`).toBe(entry.report);
    }
  });

  it('the roles-skip cost and the clean-result message are stated once', () => {
    for (const [phrase, owner] of [
      ['caps the whole report at', 'vocabulary.ts'],
      ['your aging and queue thresholds may be set conservatively', 'vocabulary.ts'],
    ] as const) {
      const offenders = SHIPPED.filter((f) => !f.endsWith(owner) && read(f).includes(phrase));
      expect(
        offenders.map((f) => f.replace(ROOT, '')),
        `"${phrase}" should live only in ${owner}`,
      ).toEqual([]);
    }
  });
});

describe('no rendered surface parses engine prose', () => {
  /**
   * The engine authors skip reasons, confidence-cap reasons and comparability
   * details for an artifact. A renderer may READ those strings and show them; it
   * may not branch on their wording to reconstruct meaning, because the wording
   * is frozen only by convention and a reword degrades silently.
   *
   * One exception survives and is deliberate: `unpricedReason` recognises the
   * two skip-reason shapes in order to replace them with sentences a customer
   * can act on. It is pinned by `report-skip-reasons.test.ts`, which fails if
   * the engine's wording moves. Removing it needs the engine to carry the refs
   * structurally, which is engine work.
   */
  it('confines skip-reason matching to the one pinned translator', () => {
    const matchers = SHIPPED.filter((f) =>
      /Rests on vendor-suggested|Missing assumption /.test(read(f)),
    );
    expect(matchers.map((f) => f.replace(ROOT, ''))).toEqual(['/packages/ui/src/report-view.ts']);
  });
});
