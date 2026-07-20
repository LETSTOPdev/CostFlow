/**
 * Actor representation in the canonical model (R-20, NFR-5).
 *
 * Raw actor identifiers (names, emails, usernames, team aliases) never enter
 * the analytical model. At ingestion each actor value becomes exactly one of:
 *  - 'role'    — explicitly mapped to a business role via the template's
 *                actorRoleMap; rate cards resolve against roleRef only.
 *  - 'unknown' — present but unmapped; replaced by a deterministic, one-way,
 *                org-scoped pseudonym. Never silently inherits a role.
 *  - 'missing' — the source had no actor value.
 */
export type ActorRef =
  | { readonly kind: 'role'; readonly roleRef: string }
  | { readonly kind: 'unknown'; readonly pseudonym: string }
  | { readonly kind: 'missing' };

/**
 * Explicit pseudonymization input for pure packages (doc 05 §3: no env, no
 * secrets in the core). The mapper is built at the effectful edge from a
 * secret salt (HMAC — one-way, not reversible encryption) and must be
 * deterministic: same (scope, raw value) → same pseudonym; different scopes
 * must be unlinkable.
 */
export interface PseudonymizationContext {
  /** Org-scoped label recorded on the batch for auditability. Not a secret. */
  readonly scopeId: string;
  /** Deterministic one-way mapper. Output must never reveal the raw value. */
  readonly pseudonymFor: (rawValue: string) => string;
}
