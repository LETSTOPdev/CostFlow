import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReportBody } from '@costflow/ui';

/**
 * The contract between the engine's skip reasons and the renderer that
 * translates them.
 *
 * The engine authors those strings for an artifact: they name raw refs
 * (`parameters.overdueAttentionHoursPerDay`) and the report-mode one offers
 * simulation mode, which the web app never selects. `unpricedReason` in
 * `packages/ui/src/report-view.ts` rewrites each into a sentence a customer can
 * act on, and it recognises them by shape.
 *
 * A recogniser matched against a frozen string is only safe while something
 * checks the two still agree. Nothing did, and the gap was live: the "Missing
 * assumption" shape had no branch, so `demo-flow` rendered the raw ref straight
 * into the report. This suite closes that class — it walks every golden, finds
 * every reason the engine really emits, and asserts the rendered report contains
 * none of it verbatim. Reword a reason, or add a fourth shape, and this fails
 * here rather than in front of a customer.
 */

const GOLDEN_DIR = join(__dirname, '../../../tools/golden/expected');

interface SkipOutcome {
  readonly golden: string;
  readonly reason: string;
}

function skipReasons(): SkipOutcome[] {
  const out: SkipOutcome[] = [];
  for (const golden of readdirSync(GOLDEN_DIR)) {
    const path = join(GOLDEN_DIR, golden, 'run.json');
    const run = JSON.parse(readFileSync(path, 'utf8')) as {
      pricing: { status: string; reason?: string }[];
    };
    for (const p of run.pricing) {
      if (p.status === 'skipped' && p.reason) out.push({ golden, reason: p.reason });
    }
  }
  return out;
}

/** Anything that reads as an internal identifier rather than a business term. */
const RAW_REF = /parameters\.[A-Za-z]+|defaultRate:[a-z-]+|rates\.[A-Za-z]+/;

describe('the report never shows an engine skip reason verbatim', () => {
  it('finds skip reasons in the goldens at all (guards the guard)', () => {
    expect(skipReasons().length).toBeGreaterThan(0);
  });

  it('translates every shape the engine actually emits', () => {
    for (const { golden, reason } of skipReasons()) {
      const run = JSON.parse(readFileSync(join(GOLDEN_DIR, golden, 'run.json'), 'utf8'));
      const body = renderReportBody(run, { runId: golden });
      // The engine's own sentence must not survive into the rendered report.
      const tail = reason.split(' — ')[1];
      expect(body, `${golden}: engine reason rendered verbatim`).not.toContain(reason);
      if (tail) {
        expect(body, `${golden}: engine remedy clause rendered verbatim`).not.toContain(tail);
      }
    }
  });

  it('never renders a raw assumption ref, and never mentions simulation mode', () => {
    for (const golden of readdirSync(GOLDEN_DIR)) {
      const run = JSON.parse(readFileSync(join(GOLDEN_DIR, golden, 'run.json'), 'utf8'));
      const body = renderReportBody(run, { runId: golden });
      // "What was assumed?" renders refs deliberately, inside <code>. Strip the
      // drill-down tables before checking the prose around them.
      const prose = body.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<td>[\s\S]*?<\/td>/g, '');
      expect(prose, `${golden}: a raw ref reached the report prose`).not.toMatch(RAW_REF);
      expect(prose, `${golden}: simulation mode offered to a customer`).not.toContain(
        'simulation mode',
      );
    }
  });
});
