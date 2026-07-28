import { describe, expect, it } from 'vitest';
import { GATEKEEPING_THRESHOLDS, detectSerialGatekeeping } from '../src/index';
import { evidence, overdueAt, runWith, stage, waitAt, waitOver } from './fixture';

const WITH_TRANSITIONS = evidence('transition-history', 'stage-snapshots');
const review = (name: string) => stage(name, 'review');

describe('D3 — serial gatekeeping', () => {
  it('is unavailable, naming transition history, when it is absent', () => {
    const run = runWith([waitAt(review('Contract Review'), [100]), waitAt(stage('Backlog'), [10])]);
    const result = detectSerialGatekeeping(run, evidence('stage-snapshots'));
    expect(result.findings).toEqual([]);
    expect(result.unavailable?.missing).toEqual(['transition-history']);
    expect(result.unavailable?.reason).toContain('transition-history');
  });

  /**
   * Aggregate time-in-status carries no ordering and no timestamps, so it
   * cannot reconstruct when an item entered a stage and cannot produce wait.
   * Having it is not having transition history, and D3 must say so.
   */
  it('is still unavailable when only status history is present', () => {
    const run = runWith([waitAt(review('Contract Review'), [100]), waitAt(stage('Backlog'), [10])]);
    const result = detectSerialGatekeeping(run, evidence('stage-snapshots', 'status-history'));
    expect(result.findings).toEqual([]);
    expect(result.unavailable?.missing).toEqual(['transition-history']);
  });

  /** The demo-flow shape: one review gate holding just over half of all wait. */
  it('identifies the dominant approval gate and its share of wait', () => {
    const run = runWith([
      waitAt(review('Contract Review'), [368, 368, 368]),
      waitAt(stage('Backlog'), [360, 360, 360]),
    ]);
    const { findings } = detectSerialGatekeeping(run, WITH_TRANSITIONS);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;

    expect(f.subject.stage.name).toBe('Contract Review');
    expect(f.subject.stage.kind).toBe('review');
    expect(f.facts['gateWaitHours']).toBe(1104);
    expect(f.facts['totalWaitHours']).toBe(2184);
    expect(f.sharePercent).toBe(51);
    expect(f.shareOf).toBe('observed waiting time');
    expect(f.intervention.primitive).toBe('add-stage-sla');
    expect(f.intervention.complexity).toBe('Low');
  });

  it('caps confidence at B when the gate is observed on too few items', () => {
    const run = runWith([
      waitAt(review('Contract Review'), [368, 368, 368]),
      waitAt(stage('Backlog'), [360, 360, 360]),
    ]);
    const f = detectSerialGatekeeping(run, WITH_TRANSITIONS).findings[0]!;
    expect(f.facts['itemsThroughGate']).toBe(3);
    expect(f.facts['itemsThroughGate']).toBeLessThan(GATEKEEPING_THRESHOLDS.minItems);
    expect(f.confidence.tier).toBe('B');
    expect(f.confidence.reasons.join(' ')).toContain('too thin');
  });

  it('grades a broad, evenly spread gate as A', () => {
    const run = runWith([
      waitAt(review('Legal review'), [100, 100, 100, 100, 100, 100, 100, 100]),
      waitAt(stage('Backlog'), [50, 50, 50]),
    ]);
    const f = detectSerialGatekeeping(run, WITH_TRANSITIONS).findings[0]!;
    expect(f.confidence.tier).toBe('A');
    expect(f.confidence.reasons).toEqual([]);
  });

  it('caps confidence at B when one item dominates the gate', () => {
    const run = runWith([
      waitAt(review('Legal review'), [900, 20, 20, 20, 20, 20]),
      waitAt(stage('Backlog'), [50, 50, 50]),
    ]);
    const f = detectSerialGatekeeping(run, WITH_TRANSITIONS).findings[0]!;
    expect(f.confidence.tier).toBe('B');
    expect(f.confidence.reasons.join(' ')).toContain('outlier');
  });

  /**
   * A queue-kind stage holding the most wait is a backlog, which is DC's
   * finding. Gatekeeping is specifically about an approval gate.
   */
  it('ignores a dominant queue-kind stage: a backlog is not a gate', () => {
    const run = runWith([
      waitAt(stage('Backlog'), [500, 500, 500, 500, 500, 500]),
      waitAt(review('Contract Review'), [10]),
    ]);
    expect(detectSerialGatekeeping(run, WITH_TRANSITIONS).findings).toEqual([]);
  });

  it('does not fire when the gate holds wait but is off most items paths', () => {
    // 60% of wait, but only 2 of 12 waiting items ever passed through it.
    const run = runWith([
      waitAt(review('Exec sign-off'), [900, 900]),
      waitAt(stage('Backlog'), [120, 120, 120, 120, 120, 120, 120, 120, 120, 120]),
    ]);
    const { findings } = detectSerialGatekeeping(run, WITH_TRANSITIONS);
    expect(findings).toEqual([]);
  });

  it('does not fire below the declared wait-share threshold', () => {
    const run = runWith([
      waitAt(review('Contract Review'), [100, 100, 100, 100, 100, 100]),
      waitAt(stage('Backlog'), [200, 200, 200, 200, 200, 200]),
    ]);
    expect(detectSerialGatekeeping(run, WITH_TRANSITIONS).findings).toEqual([]);
  });

  it('refuses the vacuous claim when only one stage has wait', () => {
    const run = runWith([waitAt(review('Contract Review'), [100, 100, 100, 100, 100, 100])]);
    const result = detectSerialGatekeeping(run, WITH_TRANSITIONS);
    expect(result.findings).toEqual([]);
    expect(result.unavailable).toBeNull();
  });

  it('ignores non-wait frictions entirely', () => {
    const run = runWith([
      overdueAt(review('Contract Review'), [50, 50, 50, 50, 50, 50]),
      overdueAt(stage('Backlog'), [1]),
    ]);
    expect(detectSerialGatekeeping(run, WITH_TRANSITIONS).findings).toEqual([]);
  });

  it('is deterministic and ties break by stage name', () => {
    // The same six items pass through both gates and the backlog.
    const ids = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'];
    const build = () =>
      runWith([
        waitOver(review('bravo'), ids, 300),
        waitOver(review('alpha'), ids, 300),
        waitOver(stage('Backlog'), ids, 10),
      ]);
    const a = detectSerialGatekeeping(build(), WITH_TRANSITIONS);
    const b = detectSerialGatekeeping(build(), WITH_TRANSITIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.findings[0]?.subject.stage.name).toBe('alpha');
  });

  /**
   * The denominator is items that waited ANYWHERE, so an item passing through
   * the backlog and then the gate is counted once, not twice. Without that,
   * a gate every item passes could score below the path threshold.
   */
  it('counts an item once even when it waits in several stages', () => {
    const ids = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8'];
    const run = runWith([
      waitOver(review('Contract Review'), ids, 100),
      waitOver(stage('Backlog'), ids, 40),
    ]);
    const f = detectSerialGatekeeping(run, WITH_TRANSITIONS).findings[0]!;
    expect(f.facts['itemsWaitingAnywhere']).toBe(8);
    expect(f.facts['itemsThroughGate']).toBe(8);
    expect(f.facts['pathSharePercent']).toBe(100);
    expect(f.sharePercent).toBe(71);
  });
});
