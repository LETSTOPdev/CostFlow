import { createHmac } from 'node:crypto';
import type { PseudonymizationContext } from '@costflow/domain';

/**
 * Same construction as the CLI and application edges (R-20):
 * HMAC-SHA256(salt, scope + value) → anon-<12hex>. Duplicated here for the same
 * reason it is duplicated there — pure packages may not hold crypto and apps may
 * not import apps — and the conformance suite pins the shape.
 *
 * The demo's salt is a constant, not a secret: the "company" being pseudonymized
 * is synthesized by the generator two files over. What matters is that the demo
 * runs through the identical code path as a real import, so the report a
 * prospect reads is produced the way their own would be.
 */
export function buildPseudonymizationContext(
  scopeId: string,
  salt: string,
): PseudonymizationContext {
  return {
    scopeId,
    pseudonymFor: (rawValue: string) =>
      `anon-${createHmac('sha256', salt).update(`${scopeId}\n${rawValue}`).digest('hex').slice(0, 12)}`,
  };
}
