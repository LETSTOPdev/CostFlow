/**
 * FR-17 attribution guard (doc 04 FR-17; doc 06 §"attribution guard").
 *
 * The product law: no screen, export, or API response ever ranks or scores an
 * individual. Attribution is to process / stage / role / work-type only.
 * Individual identities are pseudonymized at ingestion (NFR-5), so a correct
 * report never names a person. This module is the STRUCTURAL choke point that
 * proves that invariant on the actual response bytes at the reporting layer —
 * enforcement, not UI convention (doc 06 §15: "the reporting layer's
 * attribution guard is the single choke point").
 *
 * The check is deterministic and heuristic-free: a raw observed-actor value
 * (the customer's own person identifier, captured during onboarding) must not
 * appear verbatim in a rendered report/run response. Empty/whitespace actor
 * values cannot identify anyone and are ignored. No AI, no fuzzy matching —
 * exact substring, so the guard's behavior is fully predictable and testable.
 */

/** Raised when a rendered attribution surface would name an individual. */
export class AttributionGuardError extends Error {
  /** Count only — the leaking value is never carried on the error (privacy). */
  readonly leakedCount: number;
  constructor(leakedCount: number) {
    super('Attribution guard: response would attribute to a named individual.');
    this.name = 'AttributionGuardError';
    this.leakedCount = leakedCount;
  }
}

/**
 * Returns the raw observed-actor values that leaked verbatim into `body`.
 * Empty result = clean. The returned values are the caller's own data (used
 * only for the count / a caller-side assertion); they are never logged.
 */
export function findIndividualAttribution(
  body: string,
  observedActors: readonly string[],
): string[] {
  const leaked: string[] = [];
  for (const actor of observedActors) {
    if (actor.trim() === '') continue;
    if (body.includes(actor)) leaked.push(actor);
  }
  return leaked;
}

/**
 * Fail-closed assertion for the reporting layer: throws AttributionGuardError
 * (carrying only a count) if any raw individual identity survived into the
 * rendered body. Callers withhold the response rather than emit it.
 */
export function assertNoIndividualAttribution(
  body: string,
  observedActors: readonly string[],
): void {
  const leaked = findIndividualAttribution(body, observedActors);
  if (leaked.length > 0) throw new AttributionGuardError(leaked.length);
}
