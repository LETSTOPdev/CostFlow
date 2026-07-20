/**
 * Confidence tiers (doc 03 P2) with the system-wide composition rule
 * (doc 07 §4.4): grades compose by minimum, the binding constraint is named,
 * and nothing downstream may display higher confidence than any input.
 */
export type ConfidenceTier = 'A' | 'B' | 'C';

const ORDER: Record<ConfidenceTier, number> = { A: 3, B: 2, C: 1 };

export interface ConfidenceCap {
  readonly tier: ConfidenceTier;
  readonly reason: string;
}

export interface Confidence {
  readonly tier: ConfidenceTier;
  /** Every cap that applied, binding constraint first. */
  readonly reasons: readonly string[];
}

export function composeConfidence(caps: readonly ConfidenceCap[]): Confidence {
  if (caps.length === 0) return { tier: 'A', reasons: [] };
  const sorted = [...caps].sort(
    (a, b) => ORDER[a.tier] - ORDER[b.tier] || a.reason.localeCompare(b.reason),
  );
  const binding = sorted[0] as ConfidenceCap;
  return { tier: binding.tier, reasons: sorted.map((c) => `${c.tier}: ${c.reason}`) };
}
