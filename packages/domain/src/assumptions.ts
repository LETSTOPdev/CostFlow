/**
 * Customer-owned assumptions (doc 02 §2.5, doc 03 P4). Money never exists as a
 * scalar float anywhere in the model: decimal strings at rest, exact decimal
 * arithmetic in the cost engine, rounding only at display (NFR-3).
 */
export type DecimalString = string;

/** Uncertainty originates in assumptions and flows outward as ranges (doc 03 P2). */
export interface RangeSpec {
  readonly low: DecimalString;
  readonly expected: DecimalString;
  readonly high: DecimalString;
}

/** Provenance drives confidence: defaults cap the tier until confirmed (doc 03 P4). */
export type Provenance = 'default' | 'customer';

export interface RateCardEntry {
  readonly roleRef: string;
  readonly hourlyRate: DecimalString;
  readonly provenance: Provenance;
}

export interface AssumptionSet {
  readonly id: string;
  readonly version: string;
  /** ISO 4217 code; single currency per org in M0 (Q1 default). */
  readonly currency: string;
  readonly rates: readonly RateCardEntry[];
  /** Applied when an item's role has no rate-card entry (or no role at all). */
  readonly defaultRate: {
    readonly hourlyRate: DecimalString;
    readonly provenance: Provenance;
  };
  readonly parameters: {
    readonly agingThresholdDays: {
      readonly value: number;
      readonly provenance: Provenance;
    };
    /** Estimated attention/carrying effort an aging item consumes per day. */
    readonly attentionHoursPerDay: {
      readonly range: RangeSpec;
      readonly provenance: Provenance;
    };
    /**
     * Follow-up/chasing effort a queued item consumes per day of waiting.
     * Optional: when absent, the queue-wait cost model is skipped with a
     * visible reason (FR-13) — never a fabricated default.
     */
    readonly queueWaitAttentionHoursPerDay?:
      | {
          readonly range: RangeSpec;
          readonly provenance: Provenance;
        }
      | undefined;
  };
}
