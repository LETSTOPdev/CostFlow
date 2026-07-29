/**
 * Operational Intelligence render surface (OI1, ADR-0006).
 *
 * Pure presentation over `DiagnosticFinding`s and the evidence assessment. No
 * number is derived here: shares and counts come from the finding's `facts`,
 * complexity comes from the declared intervention table, and confidence comes
 * from the engine's own composition.
 *
 * Three rules this module exists to enforce visually:
 *
 *  1. Impact and complexity are SEPARATE AXES. There is no composite score, and
 *     complexity never reorders the list (ADR-0006 §5).
 *  2. The ordering is labelled as what it is. A list sorted by concentration is
 *     not a recommended sequence, and saying so is the difference between
 *     informing an executive and pretending to decide for them.
 *  3. A diagnostic that could not run is SHOWN, with the capability it needed
 *     and what would unlock it. That is the product surface, not a gap in it.
 */
import type { DiagnosticFinding, DiagnosticUnavailable } from '@costflow/diagnostics';
import { byStrongestConfidence, type ConfidenceTier } from '@costflow/cost-engine';
import { esc } from './html';
import { CAPABILITY_LABELS, type CapabilityStatus, type EvidenceAssessment } from './evidence';

export interface DiagnosticsView {
  readonly findings: readonly DiagnosticFinding[];
  readonly unavailable: readonly DiagnosticUnavailable[];
  readonly assessment: EvidenceAssessment;
  /**
   * Origin id → the name the customer knows it by, from the run's own batch. A
   * finding carries the id because the diagnostics layer must stay free of
   * customer content; the label is resolved here, at the render edge, where
   * customer content already lives.
   */
  readonly originLabels: Readonly<Record<string, string>>;
}

/**
 * Findings that share a subject stage AND an intervention are one action, not
 * two. Doc 07 §1.4: several findings about the same subject are presented as a
 * ranked SET, never forced into a single culprit and never duplicated into two
 * cards that say the same thing.
 */
export interface ActionCard {
  readonly stageName: string;
  readonly stageKind: string;
  readonly originScopeId: string | null;
  readonly recommendation: string;
  readonly complexity: string;
  readonly effortClass: string;
  readonly findings: DiagnosticFinding[];
  /** The strongest share among this card's findings. Secondary ordering key. */
  readonly topShare: number;
  /** The best confidence tier among this card's findings. PRIMARY ordering key. */
  readonly bestTier: ConfidenceTier;
}

export function buildActionCards(findings: readonly DiagnosticFinding[]): ActionCard[] {
  const byAction = new Map<string, ActionCard & { findings: DiagnosticFinding[] }>();
  for (const f of findings) {
    // Two teams' review queues are two actions even when the intervention is
    // the same, so the origin is part of the identity of a card.
    const key = `${f.subject.originScopeId ?? ''}\u0000${f.subject.stage.name}\u0000${f.intervention.primitive}`;
    const existing = byAction.get(key);
    if (existing) {
      existing.findings.push(f);
      continue;
    }
    byAction.set(key, {
      stageName: f.subject.stage.name,
      stageKind: f.subject.stage.kind,
      originScopeId: f.subject.originScopeId,
      recommendation: f.intervention.recommendation,
      complexity: f.intervention.complexity,
      effortClass: f.intervention.effortClass,
      findings: [f],
      topShare: 0,
      bestTier: 'C',
    });
  }
  return (
    [...byAction.values()]
      .map((card) => ({
        ...card,
        // Within a card, strongest evidence first.
        findings: card.findings.sort(
          (a, b) =>
            byStrongestConfidence(a.confidence.tier, b.confidence.tier) ||
            b.sharePercent - a.sharePercent ||
            a.signalId.localeCompare(b.signalId),
        ),
        topShare: card.findings.reduce((m, f) => Math.max(m, f.sharePercent), 0),
        bestTier: card.findings
          .map((f) => f.confidence.tier)
          .sort(byStrongestConfidence)
          .at(0) as ConfidenceTier,
      }))
      /**
       * Confidence gates before magnitude (doc 07 §1.4): a finding never outranks
       * one of a strictly higher grade regardless of how large its share is.
       * Sorting by share alone would put a flashy 76%-of-one-item outlier above a
       * solid, broadly evidenced result — which doc 07 names as exactly how
       * diagnostic credibility dies.
       */
      .sort(
        (a, b) =>
          byStrongestConfidence(a.bestTier, b.bestTier) ||
          b.topShare - a.topShare ||
          a.stageName.localeCompare(b.stageName) ||
          a.recommendation.localeCompare(b.recommendation),
      )
  );
}

/**
 * What a confidence letter MEANS, in words. The letter alone makes the reader
 * infer, and the executive should never have to infer why CostFlow reached its
 * conclusion.
 */
export const CONFIDENCE_NOTE: Record<string, string> = {
  A: 'Demonstrated pattern',
  B: 'Supported hypothesis',
  C: 'Consistent with',
};

const SUBHEAD =
  'margin:0 0 .3rem;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;font-weight:640';

/**
 * The card is deliberately in two parts, and the split is a claim about
 * epistemics rather than layout (doc 07 §2.1).
 *
 * The FINDING is measured: it is arithmetic over the customer's own artifact,
 * and it would be the same for anyone. The INTERVENTION is selected: a curated
 * playbook pattern matched deterministically to that finding. CostFlow knows
 * the concentration exists; it does not know that an escalation policy is
 * objectively the right answer. Presenting them as one block would let the
 * second borrow the authority of the first.
 */
/**
 * The epistemic boundary, stated wherever a recommendation appears (doc 07
 * §2.1, a founder-set UX rule). CostFlow MEASURES that the pattern exists; it
 * does not derive that this intervention is objectively right. Presenting them
 * as one block lets the second borrow the authority of the first — so the line
 * travels with the recommendation, including onto the report hero.
 */
export const INTERVENTION_PROVENANCE =
  'Selected from the Operational Intelligence playbook for this pattern. The finding above is measured from your data; the intervention is a curated recommendation matched to it, not a conclusion derived from it.';

const renderCard = (card: ActionCard, originLabels: Readonly<Record<string, string>>): string => {
  const lead = card.findings[0];
  if (!lead) return '';
  const tier = lead.confidence.tier;
  const evidence = card.findings
    .map(
      (f) => `<li style="margin:0 0 .4rem">
        <p style="margin:0">${esc(f.statement)}</p>
        <p class="note" style="margin:.25rem 0 0">${esc(f.signalName)} · confidence ${esc(f.confidence.tier)}${
          f.confidence.reasons.length > 0
            ? // Reasons already carry their tier as a "B: " prefix; repeating it
              // after "confidence B" reads as a stutter.
              ` · limited by: ${esc((f.confidence.reasons[0] as string).replace(/^[ABC]:\s*/, ''))}`
            : ''
        }</p>
      </li>`,
    )
    .join('');
  return `<article class="card" style="margin:0 0 .9rem">
    <div class="meta" style="margin:0 0 .6rem">
      ${
        // Named first, because in a workspace spanning several teams the first
        // question an executive asks of a recommendation is whose it is.
        card.originScopeId !== null && originLabels[card.originScopeId] !== undefined
          ? `<span class="chip">${esc(originLabels[card.originScopeId] as string)}</span>`
          : ''
      }
      <span class="chip">Stage: ${esc(card.stageName)} (${esc(card.stageKind)})</span>
      <span class="chip">Operational impact: ${card.topShare}% concentrated</span>
      <span class="chip">Confidence ${esc(tier)} — ${esc(CONFIDENCE_NOTE[tier] ?? '')}</span>
    </div>

    <p class="note" style="${SUBHEAD};color:var(--primary)">Finding</p>
    <ul style="margin:0 0 .9rem;padding-left:1.1rem">${evidence}</ul>

    <p class="note" style="${SUBHEAD}">Suggested intervention</p>
    <p style="margin:0 0 .35rem">${esc(card.recommendation)}</p>
    <div class="meta" style="margin:0 0 .35rem">
      <span class="chip">Implementation complexity: ${esc(card.complexity)} (${esc(card.effortClass)})</span>
    </div>
    <p class="note" style="margin:0">${INTERVENTION_PROVENANCE}</p>
  </article>`;
};

/**
 * One named place to begin.
 *
 * The section is titled "Where to act first" and used to open with "this is not
 * a recommended sequence" — a heading and a disclaimer that cancel each other,
 * in the one section the North Star depends on. An executive reading both
 * leaves with less confidence than they arrived with.
 *
 * The disclaimer was right about what it was defending: ADR-0006 §5 forbids a
 * composite priority score, and a ranked list does not become a work order just
 * because it is ordered. But "there is no optimal sequence" and "here is where
 * to start" are different claims, and only the first was ever in question.
 * This names the strongest-evidenced finding and says that is the basis, which
 * fuses nothing: complexity still never reorders anything, and the disclaimer
 * below still scopes the ordering of the remainder.
 */
export const startHere = (
  card: ActionCard,
  originLabels: Readonly<Record<string, string>>,
): string => {
  const where =
    card.originScopeId !== null && originLabels[card.originScopeId] !== undefined
      ? `${esc(originLabels[card.originScopeId] as string)}, stage “${esc(card.stageName)}”`
      : `stage “${esc(card.stageName)}”`;
  return `<div class="info" style="margin:0 0 .9rem">
    <p style="margin:0 0 .25rem"><strong>Start here: ${where}.</strong></p>
    <p style="margin:0 0 .35rem">${esc(card.recommendation)}</p>
    <p class="note" style="margin:0">Chosen as the finding this run has the strongest evidence for (confidence ${esc(card.bestTier)}), not as the most expensive one. Implementation complexity: ${esc(card.complexity)}.</p>
  </div>`;
};

const renderUnavailable = (
  unavailable: readonly DiagnosticUnavailable[],
  assessment: EvidenceAssessment,
): string => {
  if (unavailable.length === 0) return '';
  const explain = (capability: string): string =>
    assessment.statuses.find((s: CapabilityStatus) => s.capability === capability)?.explanation ??
    '';
  const rows = unavailable
    .map((u) => {
      const reasons = u.missing
        .map((m) => {
          const why = explain(m);
          return `<li><strong>${esc(CAPABILITY_LABELS[m] ?? m)}</strong>${why ? ` — ${esc(why)}` : ''}</li>`;
        })
        .join('');
      return `<li style="margin:0 0 .5rem">
        <p style="margin:0">${esc(u.signalName)} could not be assessed.</p>
        <ul class="note" style="margin:.2rem 0 0;padding-left:1.1rem">${reasons}</ul>
      </li>`;
    })
    .join('');
  return `<section>
    <h3 style="margin:1.2rem 0 .4rem">What this data cannot tell you yet</h3>
    <p class="note" style="margin:0 0 .5rem">Each of these needs evidence this workspace does not currently provide. Where that is something you can change, it says so.</p>
    <ul style="margin:0;padding-left:1.1rem">${rows}</ul>
  </section>`;
};

export interface DiagnosticsOptions {
  /**
   * What to say when no diagnostic cleared its evidence gate but the run priced
   * real money. Supplied by the report, which is the layer that knows the
   * ranked frictions.
   *
   * Without it this section says "no findings" at the top of a report with
   * thousands of dollars ranked below it — the single worst thing the primary
   * artifact can tell an executive, and the exact opposite of what promoting
   * the section to the top was for. The fallback does NOT relax the evidence
   * gate: the diagnostic stays suppressed and no intervention is fitted. It
   * names the largest MEASURED cost, which is arithmetic the report is already
   * showing further down, and says which of the two it is.
   */
  /** True when the report hero already rendered the strongest finding. */
  readonly omitTop?: boolean;
  /**
   * True on `/demo` and `/try/report`. The recommendations are the strongest
   * thing the product does, so they belong on a public surface — but a
   * recommendation is a claim about someone's organisation, and a visitor must
   * never be able to mistake one computed from generated data for one computed
   * from theirs. The banner at the top of those pages says the report is a
   * sample; this says it again where the claim actually is.
   */
  readonly demo?: boolean;
  /**
   * True on `/try/report` only: a company generated fresh for this visit, as
   * opposed to the fixed sample behind `/demo`.
   *
   * `/demo` is three items, so the size floors bind and "smaller than the
   * evidence threshold" is literally what happened. A generated company carries
   * roughly a hundred items and clears those floors, so telling that visitor
   * their company is too small is a false statement about their own data, on
   * the one screen where the product argues it never makes those. See
   * `04-engineering-principles.md`, "A refusal must never read as a pass".
   *
   * The generated wording deliberately names no specific gate. A refusal
   * renders only when ALL THREE diagnostics return nothing, and they have at
   * least ten silent-zero paths between them: concentration alone exits on
   * `minStages` (friction in one stage), `sharePercent` (spread across stages),
   * `minItems` (pooled but thin) and an unmapped intervention, while ownership
   * can exit because items ARE owned and gatekeeping because no review-kind
   * stage exists. `sharePercent` dominates in practice but does not bind
   * always: across 150 seeds, 83 refused and `minItems` bound once. Naming it
   * would state the opposite of what happened in that case, since the friction
   * had pooled.
   *
   * Stating the actual gate is not available here. A detector that finds
   * nothing returns `{findings: []}` with no reason attached, so the view would
   * have to reimplement the gate order outside the engine, which
   * `04-engineering-principles.md` forbids under "Never re-derive engine law at
   * the edges". The copy therefore asserts only the CLASS of evidence a
   * recommendation needs, which holds on every path. Widening the vocabulary so
   * a detector reports its binding gate would let this say more, and is the
   * trigger that would make that change worth it.
   */
  readonly generated?: boolean;
}

/**
 * Everything about the operational layer EXCEPT the headline action.
 *
 * Since the report became an executive briefing (D22), the single
 * highest-leverage action is the hero and this section carries the remainder:
 * the other findings, and — always — the diagnostics that could not run and
 * what would unlock them. That last part is product surface, not a gap in it,
 * so this section renders whenever there is anything to say even when there is
 * no finding at all.
 */
export function renderDiagnostics(view: DiagnosticsView, options: DiagnosticsOptions = {}): string {
  const cards = buildActionCards(view.findings);
  // The hero already showed the strongest one; repeating it here would read as
  // two recommendations where the product is making one.
  const rest = options.omitTop === true ? cards.slice(1) : cards;
  const unavailable = renderUnavailable(view.unavailable, view.assessment);
  const provenance = options.demo
    ? `<p class="note" style="margin:0 0 .6rem"><strong>Generated from demonstration data.</strong> These recommendations were computed by the real engine from a simulated company, not from any real organisation.</p>`
    : '';

  const findings =
    rest.length === 0
      ? cards.length > 0
        ? // The hero carried the only one. Saying "no other findings" is worth
          // more than silence: it tells the reader the list is complete.
          `<p class="note" style="margin:0">No other finding cleared the evidence threshold in this analysis.</p>`
        : options.demo
          ? options.generated === true
            ? `<p class="note" style="margin:0">No pattern in this company cleared the evidence CostFlow requires before it will recommend an action. A recommendation needs friction that concentrates somewhere specific, with enough items behind it to call the pattern systemic, and nothing here met that bar. That refusal is the product working: a confident-sounding action the evidence does not support is exactly what costs an executive their trust. <a href="/try">Generate another company</a> to see one where a pattern does emerge.</p>`
            : `<p class="note" style="margin:0">This sample is smaller than the evidence threshold CostFlow requires before it will recommend anything, so it recommends nothing. That refusal is the product working: a confident-sounding action drawn from a handful of items is exactly what costs an executive their trust. <a href="/try">See the recommendations on a full-size organisation →</a></p>`
          : `<p class="note" style="margin:0">No operational findings above the declared thresholds for this analysis. That is a result, not an omission: the evidence did not support a recommendation.</p>`
      : `<p class="note" style="margin:0 0 .6rem">Ordered by strength of evidence, then by how concentrated each one is — not by cost, and not as a sequence to work through. Implementation complexity is a property of each action and never changes that order; weighing impact against effort is your call.</p>
         ${rest.map((c) => renderCard(c, view.originLabels)).join('')}`;

  return `<section>
    <h2 style="margin:1.8rem 0 .5rem">${rest.length === 0 && cards.length > 0 ? 'Other findings' : 'Findings and limits'}</h2>
    ${provenance}
    ${findings}
    ${unavailable}
  </section>`;
}
