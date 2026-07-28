import { describe, expect, it } from 'vitest';
import { CONCENTRATION_THRESHOLDS, detectConcentration } from '../src/index';
import { evidence, overdueAt, runWith, stage, waitAt } from './fixture';

const WITH_SNAPSHOTS = evidence('stage-snapshots');

describe('DC — friction concentration', () => {
  it('is unavailable, naming the capability, when stage snapshots are absent', () => {
    const result = detectConcentration(runWith([overdueAt(stage('Open'), [5, 5])]), evidence());
    expect(result.findings).toEqual([]);
    expect(result.unavailable?.missing).toEqual(['stage-snapshots']);
    expect(result.unavailable?.reason).toContain('stage-snapshots');
  });

  /**
   * The cu01 shape: one queue stage holding the overwhelming majority of the
   * workspace's overdue exposure, spread evenly across many items. Numbers are
   * the real partner-run distribution (180 of 224 item-days over 23 items,
   * every item between 7 and 11 days) reproduced synthetically.
   */
  it('identifies the dominant stage and reports its share (cu01 shape)', () => {
    // 23 items totalling 180 item-days, every value between 7 and 11, against
    // 44 item-days spread across three other stages: 224 in total.
    const open = [...Array<number>(16).fill(7), ...Array<number>(3).fill(8), 11, 11, 11, 11];
    expect(open).toHaveLength(23);
    expect(open.reduce((s, d) => s + d, 0)).toBe(180);

    const run = runWith([
      overdueAt(stage('Open'), open),
      overdueAt(stage('in review', 'review'), [11, 11]),
      overdueAt(stage('in progress', 'active'), [11]),
      overdueAt(stage('pending'), [11]),
    ]);

    const { findings } = detectConcentration(run, WITH_SNAPSHOTS);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;

    expect(f.subject.stage.name).toBe('Open');
    expect(f.subject.stage.kind).toBe('queue');
    expect(f.sharePercent).toBe(80);
    expect(f.sharePercent).toBeGreaterThanOrEqual(CONCENTRATION_THRESHOLDS.sharePercent);
    expect(f.facts['stageMagnitude']).toBe(180);
    expect(f.facts['workspaceMagnitude']).toBe(224);
    expect(f.facts['items']).toBe(23);
    expect(f.facts['contributingStages']).toBe(4);
    expect(f.shareOf).toBe('item-days overdue');

    // Tight distribution: no single item is anywhere near dominant, so the
    // finding is Grade A and the statement says why.
    expect(f.facts['largestSingleItem']).toBe(11);
    expect(f.facts['largestItemSharePercent']).toBe(6);
    expect(f.confidence.tier).toBe('A');
  });

  it('grades a broad, evenly spread concentration as A and calls it systemic', () => {
    const run = runWith([
      overdueAt(stage('Open'), [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]),
      overdueAt(stage('pending'), [5]),
    ]);
    const f = detectConcentration(run, WITH_SNAPSHOTS).findings[0]!;
    expect(f.confidence.tier).toBe('A');
    expect(f.confidence.reasons).toEqual([]);
    expect(f.statement).toContain('systemic rather than outlier-driven');
  });

  it('caps confidence at B when one item drives the concentration', () => {
    const run = runWith([
      overdueAt(stage('Open'), [90, 2, 2, 2, 2, 2]),
      overdueAt(stage('pending'), [5]),
    ]);
    const f = detectConcentration(run, WITH_SNAPSHOTS).findings[0]!;
    expect(f.confidence.tier).toBe('B');
    expect(f.confidence.reasons.join(' ')).toContain('outlier');
    expect(f.statement).toContain('driven by an outlier');
  });

  /**
   * A hard floor, not a downgrade. A grade is a caveat, and a caveat on a
   * headline is still a headline: "80% of your overdue exposure is in one
   * stage" reads as a finding whether or not it is labelled B, and on a
   * three-item workspace it is really a statement about three items. Very small
   * workspaces are where a confident-sounding number costs the most trust.
   */
  it('suppresses the finding entirely below the declared item floor', () => {
    const run = runWith([overdueAt(stage('Open'), [10, 10]), overdueAt(stage('pending'), [1])]);
    const result = detectConcentration(run, WITH_SNAPSHOTS);
    expect(result.findings).toEqual([]);
    expect(result.unavailable).toBeNull();
  });

  it('fires as soon as the item floor is met, and not before', () => {
    const below = Array<number>(CONCENTRATION_THRESHOLDS.minItems - 1).fill(10);
    const at = Array<number>(CONCENTRATION_THRESHOLDS.minItems).fill(10);
    const build = (open: number[]) =>
      runWith([overdueAt(stage('Open'), open), overdueAt(stage('pending'), [1])]);

    expect(detectConcentration(build(below), WITH_SNAPSHOTS).findings).toEqual([]);
    const fired = detectConcentration(build(at), WITH_SNAPSHOTS).findings;
    expect(fired).toHaveLength(1);
    expect(fired[0]!.facts['items']).toBe(CONCENTRATION_THRESHOLDS.minItems);
  });

  it('does not fire below the declared share threshold', () => {
    const run = runWith([
      overdueAt(stage('Open'), [10, 10, 10, 10, 10]),
      overdueAt(stage('pending'), [10, 10, 10, 10, 10]),
      overdueAt(stage('blocked', 'blocked'), [10, 10, 10, 10, 10]),
    ]);
    expect(detectConcentration(run, WITH_SNAPSHOTS).findings).toEqual([]);
  });

  it('refuses the vacuous 100% claim when only one stage has friction', () => {
    const run = runWith([overdueAt(stage('Open'), [10, 10, 10, 10, 10, 10])]);
    const result = detectConcentration(run, WITH_SNAPSHOTS);
    expect(result.findings).toEqual([]);
    expect(result.unavailable).toBeNull();
  });

  /**
   * item-days-overdue and item-hours-waiting measure different things. Summing
   * them would produce a share of a meaningless total, so each unit is its own
   * comparison and its own finding.
   */
  it('never mixes magnitude units, and reports each unit separately', () => {
    const run = runWith([
      overdueAt(stage('Open'), [9, 9, 9, 9, 9, 9, 9, 9]),
      overdueAt(stage('pending'), [4]),
      waitAt(stage('Contract Review', 'review'), [100, 100, 100, 100, 100, 100]),
      waitAt(stage('Backlog'), [20]),
    ]);
    const { findings } = detectConcentration(run, WITH_SNAPSHOTS);
    expect(findings).toHaveLength(2);

    const units = findings.map((f) => f.shareOf);
    expect(new Set(units).size).toBe(2);

    const wait = findings.find((f) => f.shareOf === 'item-hours waiting')!;
    expect(wait.subject.stage.name).toBe('Contract Review');
    expect(wait.facts['workspaceMagnitude']).toBe(620);
    expect(wait.facts['stageMagnitude']).toBe(600);

    const overdue = findings.find((f) => f.shareOf === 'item-days overdue')!;
    expect(overdue.facts['workspaceMagnitude']).toBe(76);
  });

  it('is deterministic and ties break by stage name', () => {
    const build = () =>
      runWith([
        overdueAt(stage('bravo'), [10, 10, 10, 10, 10, 10]),
        overdueAt(stage('alpha'), [10, 10, 10, 10, 10, 10]),
        overdueAt(stage('zulu'), [1]),
      ]);
    const a = detectConcentration(build(), WITH_SNAPSHOTS);
    const b = detectConcentration(build(), WITH_SNAPSHOTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('attaches a structural intervention with a declared complexity, never a person', () => {
    const run = runWith([
      overdueAt(stage('Open'), [8, 8, 8, 8, 8, 8, 8, 8]),
      overdueAt(stage('pending'), [4]),
    ]);
    const f = detectConcentration(run, WITH_SNAPSHOTS).findings[0]!;
    expect(f.intervention.primitive).toBe('escalate-on-age');
    expect(f.intervention.complexity).toBe('Low');
    expect(f.intervention.effortClass).toBe('policy');
    expect(f.intervention.stage.name).toBe('Open');
    expect(JSON.stringify(f)).not.toContain('actor');
  });
});

describe('inherited evidence-quality caps (doc 21)', () => {
  const solid = () =>
    runWith([overdueAt(stage('Open'), [8, 8, 8, 8, 8, 8, 8, 8]), overdueAt(stage('pending'), [4])]);

  it('grades A when nothing is inherited', () => {
    expect(detectConcentration(solid(), WITH_SNAPSHOTS).findings[0]!.confidence.tier).toBe('A');
  });

  /**
   * The diagnostic never learns WHY it was capped — it composes what it is
   * handed, exactly as it is blind to why a capability is missing.
   */
  it('composes an inherited cap into the finding, binding constraint named', () => {
    const f = detectConcentration(solid(), WITH_SNAPSHOTS, [
      { tier: 'B', reason: 'transitions were reconstructed, not observed' },
    ]).findings[0]!;
    expect(f.confidence.tier).toBe('B');
    expect(f.confidence.reasons.join(' ')).toContain('reconstructed, not observed');
  });

  it('takes the weakest of inherited and own caps, never the average', () => {
    const outlierDriven = runWith([
      overdueAt(stage('Open'), [90, 2, 2, 2, 2, 2]),
      overdueAt(stage('pending'), [5]),
    ]);
    const f = detectConcentration(outlierDriven, WITH_SNAPSHOTS, [
      { tier: 'C', reason: 'inherited weakest' },
    ]).findings[0]!;
    expect(f.confidence.tier).toBe('C');
    // Both constraints survive; the reader sees every reason, weakest first.
    expect(f.confidence.reasons).toHaveLength(2);
    expect(f.confidence.reasons[0]).toContain('inherited weakest');
  });
});
