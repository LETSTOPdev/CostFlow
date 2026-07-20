import { z } from 'zod';
import type { AssumptionSet } from '@costflow/domain';
import { STAGE_KINDS } from '@costflow/domain';
import type { MappingTemplate } from '@costflow/ingestion';

// Edge validation only (A2, D-3): domain types stay dependency-free; these
// schemas are bound to them via `satisfies`, so drift is a compile error.
// All objects are .strict() so a typo'd key fails loudly instead of being
// silently stripped (R-09).

const stageKind = z.enum(STAGE_KINDS);

export const mappingTemplateSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    columns: z
      .object({
        itemId: z.string().min(1).optional(),
        title: z.string().min(1),
        status: z.string().min(1),
        role: z.string().min(1).optional(),
        createdAt: z.string().min(1).optional(),
        dueAt: z.string().min(1).optional(),
        lastUpdatedAt: z.string().min(1).optional(),
      })
      .strict(),
    statusMap: z.record(z.string(), stageKind),
  })
  .strict() satisfies z.ZodType<MappingTemplate, z.ZodTypeDef, unknown>;

// Money and effort inputs must be non-negative plain decimals (R-10):
// a negative rate or attention range would flow into nonsense negative costs.
const nonNegativeDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string, e.g. "85" or "0.25"');
const provenance = z.enum(['default', 'customer']);
const rangeSpec = z
  .object({ low: nonNegativeDecimal, expected: nonNegativeDecimal, high: nonNegativeDecimal })
  .strict();

export const assumptionSetSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    currency: z.string().length(3),
    rates: z.array(
      z.object({ roleRef: z.string().min(1), hourlyRate: nonNegativeDecimal, provenance }).strict(),
    ),
    defaultRate: z.object({ hourlyRate: nonNegativeDecimal, provenance }).strict(),
    parameters: z
      .object({
        agingThresholdDays: z
          .object({ value: z.number().int().nonnegative(), provenance })
          .strict(),
        attentionHoursPerDay: z.object({ range: rangeSpec, provenance }).strict(),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<AssumptionSet, z.ZodTypeDef, unknown>;
