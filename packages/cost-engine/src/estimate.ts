import type { DecimalString, RangeSpec } from '@costflow/domain';
import type { Confidence } from './confidence';

/**
 * Trace terms are discriminated per cost model (R-11): a term's shape is part
 * of the model's contract, and renderers narrow on `kind` — no model can emit
 * another model's term shape without failing the type checker.
 */
export interface AgingTraceTerm {
  readonly kind: 'aging-attention';
  readonly workItemId: string;
  readonly excessDays: number;
  readonly attentionHoursPerDay: RangeSpec;
  readonly hourlyRate: DecimalString;
  readonly rateSource: string;
  readonly subtotal: RangeSpec;
}

export interface QueueWaitTraceTerm {
  readonly kind: 'queue-wait-attention';
  readonly workItemId: string;
  readonly waitHours: number;
  /** waitHours ÷ 24, exact decimal string — the value the formula multiplies. */
  readonly waitDays: DecimalString;
  readonly visits: number;
  readonly openAtAnalysisTime: boolean;
  readonly attentionHoursPerDay: RangeSpec;
  readonly hourlyRate: DecimalString;
  readonly rateSource: string;
  readonly subtotal: RangeSpec;
}

export interface OverdueTraceTerm {
  readonly kind: 'overdue-attention';
  readonly workItemId: string;
  readonly overdueDays: number;
  /** "Overdue relative to what?" is an auditor's first question — answered inline. */
  readonly dueAt: string;
  readonly attentionHoursPerDay: RangeSpec;
  readonly hourlyRate: DecimalString;
  readonly rateSource: string;
  readonly subtotal: RangeSpec;
}

export type TraceTerm = AgingTraceTerm | QueueWaitTraceTerm | OverdueTraceTerm;

export interface FormulaTrace {
  readonly claim: string;
  readonly formula: string;
  readonly terms: readonly TraceTerm[];
  readonly assumptionsUsed: readonly {
    readonly ref: string;
    readonly value: string;
    readonly provenance: string;
  }[];
  readonly inputs: { readonly workItemIds: readonly string[] };
}

export interface CostEstimate {
  readonly frictionInstanceId: string;
  readonly costModelId: string;
  readonly costModelVersion: string;
  readonly cost: RangeSpec;
  readonly currency: string;
  readonly confidence: Confidence;
  readonly assumptionSetId: string;
  readonly assumptionSetVersion: string;
  readonly trace: FormulaTrace;
}
