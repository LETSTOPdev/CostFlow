import { createHmac } from 'node:crypto';
import type { PseudonymizationContext } from '@costflow/domain';

/**
 * Builds the pseudonymization context at the effectful edge (R-20 rule 11):
 * the salt never enters pure packages, run artifacts, or reports — only the
 * scope id (a label) and the resulting pseudonyms do.
 *
 * HMAC-SHA256(salt, scopeId + raw) — deterministic one-way mapping, NOT
 * reversible encryption. Same (salt, scope, value) → same pseudonym; a
 * different org (different salt and scope) cannot link pseudonyms for the
 * same source value.
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
