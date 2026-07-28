import { describe, expect, it } from 'vitest';
import { OWNERSHIP_THRESHOLDS, detectMissingOwnership } from '../src/index';
import { evidence, item, overdueOver, runWith, stage } from './fixture';

const WITH_SNAPSHOTS = evidence('stage-snapshots');
const OWNED = { kind: 'role' as const, roleRef: 'Founder' };
const NO_OWNER = { kind: 'missing' as const };

/** n items in `at`, the first `unowned` of them without an owner. */
const items = (at: ReturnType<typeof stage>, n: number, unowned: number, prefix = '') =>
  Array.from({ length: n }, (_, i) =>
    item(`${prefix}${at.name}-${i}`, at, i < unowned ? NO_OWNER : OWNED),
  );

describe('D4 — missing ownership', () => {
  it('is unavailable, naming the capability, when stage snapshots are absent', () => {
    const result = detectMissingOwnership(runWith([]), evidence());
    expect(result.findings).toEqual([]);
    expect(result.unavailable?.missing).toEqual(['stage-snapshots']);
  });

  it('fires when unowned items are over-represented among items carrying friction', () => {
    const open = stage('Open');
    const all = items(open, 20, 6); // 30% unowned across the workspace
    // 10 items carry friction, 8 of them unowned → 80% vs a 30% base rate.
    const frictionIds = [
      ...all.slice(0, 6).map((i) => i.id), // the 6 unowned
      ...all.slice(6, 10).map((i) => i.id), // 4 owned
    ];
    const run = runWith([overdueOver(open, frictionIds)], all);

    const { findings } = detectMissingOwnership(run, WITH_SNAPSHOTS);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;

    expect(f.facts['baseSharePercent']).toBe(30);
    expect(f.facts['frictionItems']).toBe(10);
    expect(f.facts['frictionUnowned']).toBe(6);
    expect(f.facts['frictionSharePercent']).toBe(60);
    expect(f.facts['liftPoints']).toBe(30);
    expect(f.subject.stage.name).toBe('Open');
    expect(f.intervention.primitive).toBe('assign-ownership');
    expect(f.intervention.complexity).toBe('Low');
  });

  /**
   * The cu01 result. 19% of items are unowned, but none of the items carrying
   * friction are, so ownership is demonstrably NOT the driver and the honest
   * output is no finding at all (doc 07 §1.3).
   */
  it('stays silent when unowned items carry no friction (cu01 result)', () => {
    const open = stage('Open');
    const all = items(open, 79, 15); // 19% unowned, matching cu01
    const ownedIds = all.filter((i) => i.actor.kind === 'role').map((i) => i.id);
    const run = runWith([overdueOver(open, ownedIds.slice(0, 27))], all);

    const result = detectMissingOwnership(run, WITH_SNAPSHOTS);
    expect(result.findings).toEqual([]);
    expect(result.unavailable).toBeNull();
  });

  /**
   * A workspace that never mapped an actor column has every item unowned. The
   * base rate and the friction rate are both 100%, so the lift is zero: a
   * mapping gap must not be reported as a bottleneck.
   */
  it('stays silent when no actor column was mapped at all', () => {
    const open = stage('Open');
    const all = items(open, 20, 20);
    const run = runWith(
      [
        overdueOver(
          open,
          all.slice(0, 10).map((i) => i.id),
        ),
      ],
      all,
    );
    expect(detectMissingOwnership(run, WITH_SNAPSHOTS).findings).toEqual([]);
  });

  it('stays silent when unowned items are merely proportional, not over-represented', () => {
    const open = stage('Open');
    const all = items(open, 20, 10); // 50% base rate
    const frictionIds = [...all.slice(0, 5), ...all.slice(10, 15)].map((i) => i.id); // 50% too
    expect(
      detectMissingOwnership(runWith([overdueOver(open, frictionIds)], all), WITH_SNAPSHOTS)
        .findings,
    ).toEqual([]);
  });

  it('refuses the comparison below the declared minimum of friction-carrying items', () => {
    const open = stage('Open');
    const all = items(open, 20, 4);
    const frictionIds = all.slice(0, 4).map((i) => i.id); // 4 < minFrictionItems
    expect(frictionIds.length).toBeLessThan(OWNERSHIP_THRESHOLDS.minFrictionItems);
    expect(
      detectMissingOwnership(runWith([overdueOver(open, frictionIds)], all), WITH_SNAPSHOTS)
        .findings,
    ).toEqual([]);
  });

  it('caps confidence at B when the comparison is thinly evidenced', () => {
    const open = stage('Open');
    const all = items(open, 20, 5);
    const frictionIds = [...all.slice(0, 5), all[10]!].map((i) => i.id); // 6 items, 5 unowned
    const f = detectMissingOwnership(runWith([overdueOver(open, frictionIds)], all), WITH_SNAPSHOTS)
      .findings[0]!;
    expect(f.confidence.tier).toBe('B');
    expect(f.confidence.reasons.join(' ')).toContain('thinly evidenced');
  });

  it('counts each item once even when it carries several frictions', () => {
    const open = stage('Open');
    const review = stage('in review', 'review');
    const all = items(open, 20, 8);
    const ids = all.slice(0, 10).map((i) => i.id);
    // The same ten items appear in two instances at two stages.
    const run = runWith([overdueOver(open, ids), overdueOver(review, ids)], all);
    const f = detectMissingOwnership(run, WITH_SNAPSHOTS).findings[0]!;
    expect(f.facts['frictionItems']).toBe(10);
    expect(f.facts['frictionUnowned']).toBe(8);
  });

  it('locates the subject at the stage holding the most unowned friction', () => {
    const few = stage('few');
    const many = stage('many');
    const all = [...items(few, 10, 2, 'a'), ...items(many, 10, 6, 'b')];
    const ids = [
      ...all.filter((i) => i.stage.name === 'few' && i.actor.kind === 'missing').map((i) => i.id),
      ...all.filter((i) => i.stage.name === 'many' && i.actor.kind === 'missing').map((i) => i.id),
    ];
    const run = runWith(
      [
        overdueOver(
          few,
          ids.filter((i) => i.includes('few')),
        ),
        overdueOver(
          many,
          ids.filter((i) => i.includes('many')),
        ),
      ],
      all,
    );
    const f = detectMissingOwnership(run, WITH_SNAPSHOTS).findings[0]!;
    expect(f.subject.stage.name).toBe('many');
    expect(f.facts['unownedInSubjectStage']).toBe(6);
  });

  it('never carries an identity into the finding', () => {
    const open = stage('Open');
    const all = items(open, 20, 8);
    const f = detectMissingOwnership(
      runWith(
        [
          overdueOver(
            open,
            all.slice(0, 10).map((i) => i.id),
          ),
        ],
        all,
      ),
      WITH_SNAPSHOTS,
    ).findings[0]!;
    const serialized = JSON.stringify(f);
    expect(serialized).not.toContain('Founder');
    expect(serialized).not.toContain('roleRef');
  });
});
