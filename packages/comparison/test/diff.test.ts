import { describe, expect, it } from 'vitest';
import { diffRuns } from '../src/index';
import { estimate, priced, run } from './fixture';

const withPriced = (specs: [string, string, string][]) =>
  run({
    frictions: specs.map(([id, signal, cost]) => priced(id, signal, cost)),
    estimates: specs.map(([id, , cost]) => estimate(id, cost)),
  });

describe('run diff (doc 19 MW1)', () => {
  it('matches instances by their stable id and reports the direction of change', () => {
    const before = withPriced([['f1', 'f3-overdue', '100']]);
    const after = withPriced([['f1', 'f3-overdue', '150']]);
    const d = diffRuns(before, after);

    expect(d.instances).toHaveLength(1);
    expect(d.instances[0]!.direction).toBe('increased');
    expect(d.instances[0]!.expectedDelta).toBe('50');
  });

  it('labels an instance that only exists now as new, and one that vanished as resolved', () => {
    const before = withPriced([['f1', 'f3-overdue', '100']]);
    const after = withPriced([['f2', 'f3-overdue', '40']]);
    const d = diffRuns(before, after);

    expect(d.instances.map((i) => [i.instanceId, i.direction])).toEqual([
      ['f1', 'resolved'],
      ['f2', 'new'],
    ]);
    expect(d.instances.find((i) => i.instanceId === 'f1')!.expectedDelta).toBe('-100');
    expect(d.instances.find((i) => i.instanceId === 'f2')!.expectedDelta).toBe('40');
  });

  it('calls an unchanged cost unchanged rather than a zero-sized move', () => {
    const d = diffRuns(
      withPriced([['f1', 'f3-overdue', '100']]),
      withPriced([['f1', 'f3-overdue', '100']]),
    );
    expect(d.instances[0]!.direction).toBe('unchanged');
    expect(d.instances[0]!.expectedDelta).toBe('0');
  });

  /** An unpriced friction has no cost, so there is nothing to compare. */
  it('ignores frictions that were never priced', () => {
    const before = run({ frictions: [priced('f1', 'f3-overdue', '100')], estimates: [] });
    expect(diffRuns(before, before).instances).toEqual([]);
    expect(diffRuns(before, before).baselineTotal.expected).toBe('0');
  });

  it('aggregates per signal alongside the per-instance detail', () => {
    const before = withPriced([
      ['f1', 'f3-overdue', '100'],
      ['f2', 'f2-aging', '30'],
    ]);
    const after = withPriced([
      ['f1', 'f3-overdue', '120'],
      ['f2', 'f2-aging', '10'],
    ]);
    const d = diffRuns(before, after);

    const overdue = d.signals.find((s) => s.signalId === 'f3-overdue')!;
    expect(overdue.expectedDelta).toBe('20');
    expect(overdue.baselineInstances).toBe(1);
    const aging = d.signals.find((s) => s.signalId === 'f2-aging')!;
    expect(aging.expectedDelta).toBe('-20');
  });

  it('totals the whole run and reports the movement', () => {
    const before = withPriced([
      ['f1', 'f3-overdue', '100'],
      ['f2', 'f2-aging', '30'],
    ]);
    const after = withPriced([['f1', 'f3-overdue', '100']]);
    const d = diffRuns(before, after);

    expect(d.baselineTotal.expected).toBe('130');
    expect(d.currentTotal.expected).toBe('100');
    expect(d.expectedDelta).toBe('-30');
  });

  /**
   * Money is decimal at rest and exact in arithmetic (NFR-3). A float would
   * turn 0.1 + 0.2 into a number a CFO can dismiss.
   */
  it('subtracts in exact decimal, never floating point', () => {
    const before = withPriced([['f1', 'f3-overdue', '0.3']]);
    const after = withPriced([['f1', 'f3-overdue', '0.1']]);
    expect(diffRuns(before, after).expectedDelta).toBe('-0.2');
  });

  it('is deterministic, ordering instances by id rather than by insertion', () => {
    const before = withPriced([
      ['zulu', 'f3-overdue', '1'],
      ['alpha', 'f3-overdue', '1'],
    ]);
    const after = withPriced([
      ['alpha', 'f3-overdue', '2'],
      ['zulu', 'f3-overdue', '2'],
    ]);
    expect(diffRuns(before, after).instances.map((i) => i.instanceId)).toEqual(['alpha', 'zulu']);
    expect(JSON.stringify(diffRuns(before, after))).toBe(JSON.stringify(diffRuns(before, after)));
  });

  it('handles two runs with nothing priced at all', () => {
    const empty = run({ frictions: [], estimates: [] });
    const d = diffRuns(empty, empty);
    expect(d.instances).toEqual([]);
    expect(d.signals).toEqual([]);
    expect(d.expectedDelta).toBe('0');
  });
});
