/**
 * Comparability verdict (doc 19 MW1).
 *
 * A trend line is a CLAIM: that a number moved because the work changed. Between
 * two runs of the same workspace a number can move for several other reasons —
 * the configuration changed, the engine changed, a detector that used to skip
 * now runs — and a chart that silently mixes them turns a settings edit into a
 * confident false claim that the team improved.
 *
 * So the first thing computed is not a chart. It is a verdict, and when the
 * verdict is `not-comparable` the product renders no trend at all.
 */
import type { AnalysisRun } from '@costflow/analysis';
import type { AssumptionSet, EvidenceNote, WorkItem } from '@costflow/domain';
import { isCustomerOwned } from '@costflow/domain';

export type Comparability = 'comparable' | 'comparable-with-note' | 'not-comparable';

/**
 * CLOSED. Each member earns its place from a case that is actually computable
 * from two stored artifacts — no member exists for a problem we can only guess
 * at. (See §"what is deliberately absent" at the foot of this file.)
 */
export const COMPARABILITY_ASPECTS = [
  /** Detector or cost-model versions moved, so identical input prices differently. */
  'engine',
  /** A detector that ran in one run skipped in the other, so totals cover different ground. */
  'detectors',
  /** Customer-owned inputs changed: rates, thresholds, attention hours, provenance. */
  'assumptions',
  /** The selection changed: a different provider, template, or status-to-stage mapping. */
  'scope',
  /** How the observations were obtained changed (doc 21 evidence quality). */
  'evidence',
  /** One run priced vendor-suggested assumptions and the other did not. */
  'policy',
] as const;

export type ComparabilityAspect = (typeof COMPARABILITY_ASPECTS)[number];

export interface ComparabilityFinding {
  readonly aspect: ComparabilityAspect;
  /**
   * `blocking` means the comparison is meaningless, not merely caveated. A note
   * says "this moved for a reason other than the work, and here it is"; a
   * blocker says "these two numbers are not measuring the same thing".
   */
  readonly severity: 'note' | 'blocking';
  /** Values-safe and human-readable: names what changed, in the customer's terms. */
  readonly detail: string;
  /** What the customer can do about it, when there is anything. */
  readonly remedy?: string;
}

export interface ComparabilityVerdict {
  readonly verdict: Comparability;
  readonly findings: readonly ComparabilityFinding[];
}

const sortedEntries = (o: Readonly<Record<string, string>>): string =>
  JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Ran-detector ids, sorted. The set that actually contributed to the totals. */
const ranDetectors = (run: AnalysisRun): string[] =>
  run.detectors
    .filter((d) => d.status === 'ran')
    .map((d) => d.signalId)
    .sort();

/**
 * The EFFECTIVE status-to-stage mapping, recovered from the items themselves.
 *
 * The batch declares `mappingTemplateId` and `mappingTemplateVersion` but does
 * NOT carry the status map, and the web app sets both to constants — so the
 * declared identity cannot detect a remap. `items[].stage` carries the
 * customer's own status name alongside the kind it resolved to, which means the
 * mapping actually used is recoverable per run, and a remap can be named rather
 * than merely detected.
 *
 * Limit, stated because it matters: a status present in only one run is
 * indistinguishable from one that was remapped and no longer appears. Only
 * statuses in both runs can be compared.
 */
const effectiveStageMap = (run: AnalysisRun): Map<string, string> => {
  const map = new Map<string, string>();
  for (const item of run.batch.items as readonly WorkItem[]) {
    map.set(item.stage.name, item.stage.kind);
  }
  return map;
};

/** Parameters that decide WHICH items are frictions, not merely what they cost. */
function populationDefiningChange(a: AssumptionSet, b: AssumptionSet): string | null {
  if (a.parameters.agingThresholdDays.value !== b.parameters.agingThresholdDays.value) {
    return `the aging threshold moved from ${a.parameters.agingThresholdDays.value} to ${b.parameters.agingThresholdDays.value} days, which changes which items count as aging at all`;
  }
  return null;
}

/** Parameters that change the price of the same work. */
function priceDefiningChanges(a: AssumptionSet, b: AssumptionSet): string[] {
  const changed: string[] = [];
  if (JSON.stringify(a.rates) !== JSON.stringify(b.rates)) changed.push('the rate card');
  if (JSON.stringify(a.defaultRate) !== JSON.stringify(b.defaultRate)) {
    changed.push('the default rate');
  }
  const params = [
    'attentionHoursPerDay',
    'queueWaitAttentionHoursPerDay',
    'overdueAttentionHoursPerDay',
  ] as const;
  for (const key of params) {
    const before = a.parameters[key];
    const after = b.parameters[key];
    if (JSON.stringify(before?.range) !== JSON.stringify(after?.range)) {
      changed.push(`the ${key} assumption`);
    }
  }
  return changed;
}

/**
 * A provenance move across the customer-owned line changes what report mode is
 * willing to price at all, so instances appear or vanish from the priced total
 * without any work changing.
 */
function pricingEligibilityChange(a: AssumptionSet, b: AssumptionSet): string | null {
  const flipped = (
    x: { provenance: AssumptionSet['defaultRate']['provenance'] } | undefined,
    y: { provenance: AssumptionSet['defaultRate']['provenance'] } | undefined,
  ): boolean =>
    x !== undefined &&
    y !== undefined &&
    isCustomerOwned(x.provenance) !== isCustomerOwned(y.provenance);

  if (flipped(a.defaultRate, b.defaultRate)) return 'the default rate';
  for (const key of [
    'attentionHoursPerDay',
    'queueWaitAttentionHoursPerDay',
    'overdueAttentionHoursPerDay',
  ] as const) {
    if (flipped(a.parameters[key], b.parameters[key])) return `the ${key} assumption`;
  }
  return null;
}

/**
 * Compare two run artifacts for whether a trend between them would mean
 * anything. Pure: same two artifacts always produce the same verdict.
 */
export function assessComparability(
  baseline: AnalysisRun,
  current: AnalysisRun,
): ComparabilityVerdict {
  const findings: ComparabilityFinding[] = [];

  // ── engine ────────────────────────────────────────────────────────────────
  const engineOf = (r: AnalysisRun) =>
    JSON.stringify([
      r.engineVersions.analysis,
      sortedEntries(r.engineVersions.signals),
      sortedEntries(r.engineVersions.contextSignals),
      sortedEntries(r.engineVersions.costModels),
    ]);
  if (engineOf(baseline) !== engineOf(current)) {
    findings.push({
      aspect: 'engine',
      severity: 'blocking',
      detail:
        'These runs were produced by different engine versions, so the same input would price differently. The change is ours, not yours.',
      remedy: 'Run the analysis again so both sides use the current engine.',
    });
  }

  // ── detectors ─────────────────────────────────────────────────────────────
  // The case MC-5 made reachable: enabling a status-history setting makes queue
  // wait run for the first time, and wait appears from nothing.
  const ranBefore = ranDetectors(baseline);
  const ranNow = ranDetectors(current);
  if (JSON.stringify(ranBefore) !== JSON.stringify(ranNow)) {
    const gained = ranNow.filter((d) => !ranBefore.includes(d));
    const lost = ranBefore.filter((d) => !ranNow.includes(d));
    findings.push({
      aspect: 'detectors',
      severity: 'blocking',
      detail:
        `The two runs did not measure the same things: ` +
        [
          gained.length > 0 ? `${gained.join(', ')} ran only in the newer run` : '',
          lost.length > 0 ? `${lost.join(', ')} ran only in the older run` : '',
        ]
          .filter(Boolean)
          .join(' and ') +
        '. A total that gains a whole category has not grown, it has widened.',
      remedy:
        'Once both runs have the same data available, comparisons from that point on will line up.',
    });
  }

  // ── assumptions ───────────────────────────────────────────────────────────
  if (baseline.assumptions.currency !== current.assumptions.currency) {
    findings.push({
      aspect: 'assumptions',
      severity: 'blocking',
      detail: `The currency changed from ${baseline.assumptions.currency} to ${current.assumptions.currency}.`,
    });
  }
  const population = populationDefiningChange(baseline.assumptions, current.assumptions);
  if (population) {
    findings.push({
      aspect: 'assumptions',
      severity: 'blocking',
      detail: `A setting changed that decides which work counts: ${population}.`,
      remedy: 'Comparisons will line up again once both runs use the current threshold.',
    });
  }
  const eligibility = pricingEligibilityChange(baseline.assumptions, current.assumptions);
  if (eligibility) {
    findings.push({
      aspect: 'assumptions',
      severity: 'blocking',
      detail: `${eligibility} moved between vendor-suggested and customer-owned, so a different set of frictions was eligible to be priced.`,
    });
  }
  const prices = priceDefiningChanges(baseline.assumptions, current.assumptions);
  if (prices.length > 0) {
    findings.push({
      aspect: 'assumptions',
      severity: 'note',
      detail: `${prices.join(' and ')} changed between these runs, so cost can move even where the underlying hours did not.`,
    });
  }

  // ── scope ─────────────────────────────────────────────────────────────────
  if (baseline.batch.provider !== current.batch.provider) {
    findings.push({
      aspect: 'scope',
      severity: 'blocking',
      detail: 'These runs came from different connected platforms.',
    });
  } else if (baseline.batch.mappingTemplateId !== current.batch.mappingTemplateId) {
    findings.push({
      aspect: 'scope',
      severity: 'blocking',
      detail: 'These runs used different import templates, so they may not cover the same work.',
    });
  }
  const before = effectiveStageMap(baseline);
  const now = effectiveStageMap(current);
  const remapped = [...now.entries()]
    .filter(([status, kind]) => before.has(status) && before.get(status) !== kind)
    .map(([status, kind]) => `"${status}" (${before.get(status) as string} → ${kind})`)
    .sort();
  if (remapped.length > 0) {
    findings.push({
      aspect: 'scope',
      severity: 'blocking',
      detail: `The workflow mapping changed for ${remapped.join(', ')}. Items moved between stage kinds, so different detectors saw them.`,
      remedy: 'Comparisons from the next run onward will use the current mapping consistently.',
    });
  }

  // ── evidence (doc 21) ─────────────────────────────────────────────────────
  // A run written before evidence quality was recorded has no `evidence` at
  // runtime despite the type, so absent and empty must be told apart: absent
  // means "unknown", empty means "we looked and found nothing weak". Comparing
  // one of each is a genuine difference in what we know.
  const evidenceOf = (r: AnalysisRun): string => {
    const notes = r.batch.evidence as readonly EvidenceNote[] | undefined;
    if (notes === undefined) return 'unknown';
    return JSON.stringify(notes.map((n) => `${n.weakness}/${n.subject}`).sort());
  };
  if (evidenceOf(baseline) !== evidenceOf(current)) {
    findings.push({
      aspect: 'evidence',
      severity: 'note',
      detail:
        'The quality of the underlying observations differs between these runs, so part of the change may reflect what could be measured rather than what happened.',
    });
  }

  // ── policy ────────────────────────────────────────────────────────────────
  if (baseline.pricingPolicy !== current.pricingPolicy) {
    findings.push({
      aspect: 'policy',
      severity: 'blocking',
      detail:
        'One of these runs priced unconfirmed vendor-suggested assumptions and the other did not, so their totals are not the same kind of number.',
    });
  }

  const verdict: Comparability = findings.some((f) => f.severity === 'blocking')
    ? 'not-comparable'
    : findings.length > 0
      ? 'comparable-with-note'
      : 'comparable';

  return { verdict, findings };
}

/**
 * What is deliberately ABSENT, so nobody adds it back without a reason:
 *
 * There is no `window` aspect. Doc 19 §3 lists a changed input window as a
 * fourth way a number can move, and it is real — but two artifacts cannot
 * distinguish "fewer items because the team did less" from "fewer items because
 * the import was narrower". `importedAt` is a point, not a range, and
 * `counts.totalRows` moves for both reasons. The only way to add it would be a
 * threshold on how much the item count may change, which would be a fabricated
 * number of exactly the kind the product refuses everywhere else. If a real
 * signal appears — an explicit date range on the batch, say — the aspect can be
 * added then, deliberately.
 */
