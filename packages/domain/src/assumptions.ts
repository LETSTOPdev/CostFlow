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

/**
 * Provenance is a ladder, not a boolean (doc 03 P4 as amended 2026-07-20):
 *  - 'vendor-suggested'    — a value WE brought; never acceptable in report-mode pricing
 *  - 'customer-accepted'   — the customer explicitly accepted a suggested value
 *  - 'customer-customized' — the customer supplied their own value
 *  - 'customer-measured'   — the value derives from the customer's measured data
 * The states are recorded per assumption; pricing policy decides which states
 * each mode admits (report: customer-owned only; simulation/dev: any).
 */
export type Provenance =
  'vendor-suggested' | 'customer-accepted' | 'customer-customized' | 'customer-measured';

export function isCustomerOwned(provenance: Provenance): boolean {
  return provenance !== 'vendor-suggested';
}

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
    /**
     * Chasing/escalation effort an overdue item consumes per day past due
     * (doc 12 §3). Optional, same FR-13 semantics; deliberately separate from
     * the aging parameter — breached commitments and stale cards are chased
     * differently.
     */
    readonly overdueAttentionHoursPerDay?:
      | {
          readonly range: RangeSpec;
          readonly provenance: Provenance;
        }
      | undefined;
  };
}
