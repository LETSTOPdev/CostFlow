/**
 * Evidence quality (doc 21). A batch-level record of what is WEAK about the
 * observations an import contains, so that downstream confidence can compose
 * against it without any layer having to know which platform produced the data.
 *
 * The concept is deliberately about the data and never about conclusions drawn
 * from it: `ImportBatch` describes what was observed, and the moment a
 * conclusion-shaped fact is allowed onto it, it stops being a record of an
 * import. Sample size and outlier skew are therefore NOT evidence weaknesses —
 * the observations are fine, the inference is thin — and stay with whoever draws
 * the inference. Assumption ownership is likewise separate; doc 03 P4 already
 * models it on the assumption set, because it describes who owns an input
 * rather than what was seen.
 */

/**
 * CLOSED, and intended to stay very small and stable for years.
 *
 * A new member is warranted only when it names a genuinely different
 * EPISTEMOLOGICAL PROBLEM — never a different MECHANISM that produces a problem
 * already named. "The source platform collapses repeat visits to a status" is a
 * mechanism; the problem it produces is that the sequence had to be derived
 * rather than read, which `derived-not-observed` already covers. Modelling
 * mechanisms would grow this vocabulary once per platform quirk, which is the
 * same failure as putting provider names in the domain (doc 06 N4).
 *
 * Extending it is a domain decision requiring an ADR — deliberately unlike
 * `EventType`, which is open precisely so analytics never needs a migration.
 * Analytics vocabulary should be cheap to extend; the language the engine
 * reasons in should not be.
 *
 * The four are orthogonal. Each answers a different question about an
 * observation:
 *
 *   derived-not-observed  Is the value real, or did we compute it?
 *   partial-coverage      Is the population complete?
 *   open-interval         Is the measurement finished?
 *   ambiguous-semantics   Does it mean what we think it means?
 *
 * `open-interval` earns separation from `derived-not-observed` on that test and
 * not by convention: an open interval's end IS imputed, so the value is partly
 * computed — but the two imply opposite futures. A derived value never improves,
 * because the source did not record what was missing. An open interval is
 * correct as of now and becomes MORE correct on the next run, because it is
 * censored by the present rather than by absence.
 */
export const EVIDENCE_WEAKNESSES = [
  /** We did not see it; we computed it. */
  'derived-not-observed',
  /** We saw some subjects, not all of them. */
  'partial-coverage',
  /** We saw the start; the end has not happened yet. */
  'open-interval',
  /** We saw it accurately, but it may not mean what we treat it as. */
  'ambiguous-semantics',
] as const;

export type EvidenceWeakness = (typeof EVIDENCE_WEAKNESSES)[number];

/**
 * The canonical concept whose OBSERVATIONS are weak — never the inference that
 * later suffers from it. A reconstructed transition chain is `events` (the
 * sequence is what had to be derived), not `stages` (which is merely what gets
 * misattributed downstream); a consumer already knows that per-stage wait
 * derives from events, and connecting the two is its job.
 *
 * Also CLOSED, and it grows only when the canonical model gains a concept —
 * never when a connector gains a capability. That is what distinguishes it from
 * a list of field names.
 */
export const EVIDENCE_SUBJECTS = [
  'events',
  'items',
  'actors',
  /** The customer's own delivery commitments: due dates today, SLAs later. */
  'commitments',
] as const;

export type EvidenceSubject = (typeof EVIDENCE_SUBJECTS)[number];

/**
 * One weakness of one subject. The PROBLEM is machine-readable so a consumer can
 * cap confidence on it; the MECHANISM lives in `detail`, where it explains
 * itself to a reader without entering the engine's vocabulary. A future platform
 * whose quirk produces the same problem writes a different sentence and adds no
 * member.
 */
export interface EvidenceNote {
  readonly weakness: EvidenceWeakness;
  readonly subject: EvidenceSubject;
  /**
   * Values-safe and human-readable; rendered directly as a confidence reason.
   * Describes the data, never a customer's people or content.
   */
  readonly detail: string;
}
