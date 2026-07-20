import type { ActorRef, AssumptionSet, DecimalString, Provenance } from '@costflow/domain';
import type { ConfidenceCap } from './confidence';

/**
 * Rate resolution operates on ActorRef only — never on raw identities (R-20
 * rule 8). Each resolution path is distinguishable in traces (rule 10) and an
 * unmapped actor can only ever reach the explicit default rate, loudly, with
 * a confidence cap — never an unrelated role's rate (rule 9).
 *
 * Lives in cost-engine (not domain) because rate fallback is pricing policy;
 * with two cost models consuming it, this is its natural owner (closes R-12).
 */
export interface ResolvedRate {
  readonly hourlyRate: DecimalString;
  readonly provenance: Provenance;
  /** Trace label: rates.<role> | defaultRate:<why>. Never a raw identity. */
  readonly source: string;
  readonly cap: ConfidenceCap | null;
}

/**
 * Report-mode gate (doc 03 P4 as amended): rate refs whose resolved
 * provenance is vendor-suggested, for the given actors. An instance touching
 * any of these is unpriced in report mode — no partial pricing.
 */
export function vendorSuggestedRateRefs(
  assumptions: AssumptionSet,
  actors: readonly ActorRef[],
): string[] {
  const refs = new Set<string>();
  for (const actor of actors) {
    const resolved = resolveActorRate(assumptions, actor);
    if (resolved.provenance === 'vendor-suggested') refs.add(resolved.source);
  }
  return [...refs].sort();
}

export function resolveActorRate(assumptions: AssumptionSet, actor: ActorRef): ResolvedRate {
  const defaultRate = (why: string, reason: string): ResolvedRate => ({
    hourlyRate: assumptions.defaultRate.hourlyRate,
    provenance: assumptions.defaultRate.provenance,
    source: `defaultRate:${why}`,
    cap: { tier: 'C', reason },
  });

  switch (actor.kind) {
    case 'role': {
      const entry = assumptions.rates.find((r) => r.roleRef === actor.roleRef);
      if (entry) {
        return {
          hourlyRate: entry.hourlyRate,
          provenance: entry.provenance,
          source: `rates.${actor.roleRef}`,
          cap:
            entry.provenance === 'vendor-suggested'
              ? {
                  tier: 'C',
                  reason:
                    'Rate-card entry used is a vendor suggestion the customer has not confirmed.',
                }
              : null,
        };
      }
      return defaultRate(
        'role-without-rate',
        'Default hourly rate applied to role(s) without a rate-card entry.',
      );
    }
    case 'unknown':
      return defaultRate(
        'unmapped-actor',
        'Default hourly rate applied to unmapped (pseudonymized) actor(s).',
      );
    case 'missing':
      return defaultRate('missing-actor', 'Default hourly rate applied to item(s) with no actor.');
  }
}
