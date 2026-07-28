import { describe, expect, it } from 'vitest';
import { assessComparability, compareRuns } from '../src/index';
import { assumptions, item, run } from './fixture';

const aspects = (
  a: Parameters<typeof assessComparability>[0],
  b: Parameters<typeof assessComparability>[1],
) => assessComparability(a, b).findings.map((f) => `${f.aspect}:${f.severity}`);

describe('comparability verdict (doc 19 MW1)', () => {
  it('calls two identical runs comparable, with nothing to say', () => {
    const result = assessComparability(run(), run());
    expect(result.verdict).toBe('comparable');
    expect(result.findings).toEqual([]);
  });

  /**
   * The case MC-5 Part A made reachable, and the single most important rule
   * here. We now tell ClickUp customers to enable Total Time in Status; when
   * they do, queue wait runs for the first time and the total gains a whole
   * category. That is not a regression in their work, and calling it one would
   * punish them for following our own advice.
   */
  it('refuses when a detector that used to skip now runs', () => {
    const before = run({ detectorsRan: ['f3-overdue'], detectorsSkipped: ['f1-queue-wait'] });
    const after = run({ detectorsRan: ['f3-overdue', 'f1-queue-wait'] });
    const result = assessComparability(before, after);

    expect(result.verdict).toBe('not-comparable');
    const finding = result.findings.find((f) => f.aspect === 'detectors')!;
    expect(finding.severity).toBe('blocking');
    expect(finding.detail).toContain('f1-queue-wait ran only in the newer run');
    expect(finding.detail).toContain('has not grown, it has widened');
  });

  it('refuses equally when a detector stops running', () => {
    const before = run({ detectorsRan: ['f3-overdue', 'f1-queue-wait'] });
    const after = run({ detectorsRan: ['f3-overdue'], detectorsSkipped: ['f1-queue-wait'] });
    expect(assessComparability(before, after).findings[0]!.detail).toContain(
      'f1-queue-wait ran only in the older run',
    );
  });

  it('refuses when the engine version moved, and says the change is ours', () => {
    const after = run({ engine: { costModels: { 'f3-overdue': '1.1.0' } } });
    const result = assessComparability(run(), after);
    expect(result.verdict).toBe('not-comparable');
    expect(result.findings[0]!.aspect).toBe('engine');
    expect(result.findings[0]!.detail).toContain('The change is ours, not yours');
  });

  it('is insensitive to key order within the engine version maps', () => {
    const a = run({ engine: { signals: { x: '1', y: '2' } } });
    const b = run({ engine: { signals: { y: '2', x: '1' } } });
    expect(assessComparability(a, b).verdict).toBe('comparable');
  });

  describe('assumptions are not all alike', () => {
    /**
     * A rate change moves the price of the same work. That is worth saying, and
     * it does not make the comparison meaningless.
     */
    it('notes a rate-card change without refusing the comparison', () => {
      const after = run({
        assumptions: assumptions({
          rates: [{ roleRef: 'Engineer', hourlyRate: '120', provenance: 'customer-customized' }],
        }),
      });
      const result = assessComparability(run(), after);
      expect(result.verdict).toBe('comparable-with-note');
      expect(result.findings[0]!.detail).toContain('the rate card');
      expect(result.findings[0]!.detail).toContain('even where the underlying hours did not');
    });

    /**
     * A threshold change decides WHICH items are frictions at all, so the two
     * runs are counting different populations. That is not a caveat.
     */
    it('refuses when a threshold changes, because the population changes', () => {
      const after = run({
        assumptions: assumptions({
          parameters: {
            agingThresholdDays: { value: 30, provenance: 'customer-customized' },
            attentionHoursPerDay: {
              range: { low: '0.1', expected: '0.2', high: '0.4' },
              provenance: 'customer-customized',
            },
          },
        }),
      });
      const result = assessComparability(run(), after);
      expect(result.verdict).toBe('not-comparable');
      expect(result.findings[0]!.detail).toContain('which work counts');
      expect(result.findings[0]!.detail).toContain('14 to 30 days');
    });

    /**
     * Crossing the customer-owned line changes what report mode will price at
     * all, so instances enter or leave the total with no work changing.
     */
    it('refuses when a provenance change alters what may be priced', () => {
      const after = run({
        assumptions: assumptions({
          defaultRate: { hourlyRate: '80', provenance: 'vendor-suggested' },
        }),
      });
      const result = assessComparability(run(), after);
      expect(result.verdict).toBe('not-comparable');
      expect(result.findings.some((f) => f.detail.includes('eligible to be priced'))).toBe(true);
    });

    it('ignores a provenance change that stays on the same side of the line', () => {
      const after = run({
        assumptions: assumptions({
          defaultRate: { hourlyRate: '80', provenance: 'customer-measured' },
        }),
      });
      // Still a change to the default rate object, so a note — but not blocking.
      expect(assessComparability(run(), after).verdict).toBe('comparable-with-note');
    });

    it('refuses on a currency change', () => {
      expect(
        assessComparability(run(), run({ assumptions: assumptions({ currency: 'EUR' }) })).verdict,
      ).toBe('not-comparable');
    });

    /** The version bumps on every SAVE, not every change, so it is never the test. */
    it('does not refuse merely because the assumption version differs', () => {
      const after = run({ assumptions: assumptions({ version: '7' }) });
      expect(assessComparability(run(), after).verdict).toBe('comparable');
    });
  });

  describe('scope', () => {
    /**
     * The status map is not carried in the artifact and the web app pins its
     * declared version to a constant, so a remap is invisible to the declared
     * identity. It is recovered from the items, which also lets the finding name
     * the status that moved.
     */
    it('detects a status remap from the items, and names the status', () => {
      const before = run({ items: [item('i1', 'In Review', 'active')] });
      const after = run({ items: [item('i1', 'In Review', 'review')] });
      const result = assessComparability(before, after);

      expect(result.verdict).toBe('not-comparable');
      const finding = result.findings.find((f) => f.aspect === 'scope')!;
      expect(finding.detail).toContain('"In Review" (active → review)');
    });

    it('does not invent a remap for a status present in only one run', () => {
      const before = run({ items: [item('i1', 'Open', 'queue')] });
      const after = run({ items: [item('i1', 'Open', 'queue'), item('i2', 'Blocked', 'blocked')] });
      expect(assessComparability(before, after).verdict).toBe('comparable');
    });

    it('refuses across different providers', () => {
      expect(assessComparability(run(), run({ provider: 'clickup' })).verdict).toBe(
        'not-comparable',
      );
    });
  });

  describe('evidence quality (doc 21)', () => {
    it('notes a change in how the observations were obtained', () => {
      const after = run({
        evidence: [
          { weakness: 'derived-not-observed', subject: 'events', detail: 'reconstructed' },
        ],
      });
      const result = assessComparability(run(), after);
      expect(result.verdict).toBe('comparable-with-note');
      expect(result.findings[0]!.aspect).toBe('evidence');
    });

    /**
     * Absent is not empty. A run predating the field says nothing about its own
     * quality, so comparing it to one that declares none is a real difference in
     * what is known — and must not be silently treated as agreement.
     */
    it('treats an artifact with no evidence field as different from one declaring none', () => {
      const legacy = run({ legacyNoEvidence: true });
      expect(assessComparability(legacy, run()).verdict).toBe('comparable-with-note');
      expect(assessComparability(legacy, run({ legacyNoEvidence: true })).verdict).toBe(
        'comparable',
      );
    });
  });

  it('refuses across pricing policies', () => {
    expect(assessComparability(run(), run({ pricingPolicy: 'simulation' })).verdict).toBe(
      'not-comparable',
    );
  });

  it('reports every reason, not just the first', () => {
    const after = run({
      provider: 'clickup',
      pricingPolicy: 'simulation',
      assumptions: assumptions({ currency: 'EUR' }),
    });
    expect(aspects(run(), after)).toEqual(
      expect.arrayContaining(['assumptions:blocking', 'scope:blocking', 'policy:blocking']),
    );
  });

  it('is deterministic', () => {
    const a = () => run({ provider: 'clickup', assumptions: assumptions({ currency: 'EUR' }) });
    expect(JSON.stringify(compareRuns(run(), a()))).toBe(JSON.stringify(compareRuns(run(), a())));
  });

  it('always computes the diff, even when the verdict refuses it', () => {
    const result = compareRuns(run(), run({ provider: 'clickup' }));
    expect(result.verdict).toBe('not-comparable');
    expect(result.diff).toBeDefined();
    expect(result.diff.instances.length).toBeGreaterThan(0);
  });
});
