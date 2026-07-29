import type { Provenance, StageKind } from '@costflow/domain';

/**
 * How the product says the domain's closed vocabularies out loud.
 *
 * The domain owns the SETS — `StageKind`, `Provenance` — because the engine
 * reasons in them. It deliberately owns no prose: a pure package that carried
 * customer-facing sentences would be a presentation layer wearing a domain
 * name. This module is where those sets acquire words, once, for every surface
 * that shows them.
 *
 * Each table is `Record<TheUnion, …>`, so adding a member to a closed
 * vocabulary fails the build here until someone decides what to call it. That
 * is the whole point: these tables previously existed twice each, in
 * `apps/web/src/server.ts` and `apps/marketing/src/pages.ts`, and drifted.
 * `/docs` described five of the six stage kinds correctly and silently dropped
 * the part of `active` that decides whether stale and overdue still count.
 *
 * Where one concept genuinely needs two voices — a form addressing the person
 * setting a value, a report forwarded to someone who never set it — the entry
 * carries both rather than the table being copied. Two voices is a UX fact; two
 * tables was a drift vector.
 */

/**
 * The six stage kinds, as the onboarding step and `/docs` both explain them.
 *
 * `use` answers "when do I pick this one", `changes` answers "what does picking
 * it do to my numbers". The second is the one that matters and the one `/docs`
 * was missing for `active`: mapping a status to `active` still leaves its items
 * counting toward stale and overdue, which a reader deciding between `active`
 * and `done` has to know.
 */
export const STAGE_KIND_GUIDE: Record<
  StageKind,
  { readonly use: string; readonly changes: string }
> = {
  queue: {
    use: 'Nobody has picked the work up yet.',
    changes: 'Time here is priced as <strong>waiting</strong>.',
  },
  review: {
    use: 'Waiting on someone to approve, check or sign off.',
    changes:
      'Also priced as <strong>waiting</strong>. Separate from queue so approval bottlenecks are visible on their own.',
  },
  active: {
    use: 'Someone is working on it right now.',
    changes:
      'Not priced as waiting; this is the work itself. Still counted for stale and overdue items.',
  },
  blocked: {
    use: "Stopped by something outside the team's control.",
    changes:
      '<strong>Not</strong> priced as waiting today. If you want time in this status counted as wait, map it to <em>queue</em> instead.',
  },
  done: { use: 'Finished.', changes: 'Excluded from stale and overdue entirely.' },
  abandoned: { use: 'Dropped without finishing.', changes: 'Excluded, the same as done.' },
};

/** Render order. `STAGE_KINDS` from the domain is the engine's order, not the reader's. */
export const STAGE_KIND_ORDER: readonly StageKind[] = [
  'queue',
  'review',
  'active',
  'blocked',
  'done',
  'abandoned',
];

/**
 * What an assumption's provenance means, in the two places it is shown.
 *
 * `form` addresses the person choosing the value on the assumptions step.
 * `report` describes it to whoever later reads the report, who may not be that
 * person — the printable export is the surface that gets forwarded.
 */
export const PROVENANCE_LABEL: Record<
  Provenance,
  { readonly form: string; readonly report: string }
> = {
  'vendor-suggested': {
    form: 'vendor suggested, not used in pricing until you accept or customize it',
    report: 'vendor-suggested (unconfirmed)',
  },
  'customer-accepted': { form: 'accepted by you', report: 'accepted by customer' },
  'customer-customized': { form: 'customized by you', report: 'customized by customer' },
  'customer-measured': { form: 'measured', report: 'measured by customer' },
};

/**
 * The assumptions a customer sets, in the two lengths the product needs.
 *
 * `field` labels the input on the assumptions step, where the reader needs to
 * know what the number means. `short` names it mid-sentence in a report
 * ("Waiting on the aging threshold"), where the long form would not read.
 *
 * Keyed by the engine's own parameter names so a rename is a compile error at
 * the read site rather than a label silently falling back to the raw key.
 */
export const ASSUMPTION_LABEL: Record<string, { readonly short: string; readonly field: string }> =
  {
    agingThresholdDays: {
      short: 'the aging threshold',
      field: 'Aging threshold (days untouched before an item counts as aging)',
    },
    attentionHoursPerDay: {
      short: 'attention on aging items',
      field: 'Attention on aging items (hours per day: low, expected, high)',
    },
    queueWaitAttentionHoursPerDay: {
      short: 'follow-up attention on queued items',
      field: 'Follow-up attention on queued items (hours/day)',
    },
    overdueAttentionHoursPerDay: {
      short: 'chasing attention on overdue items',
      field: 'Chasing attention on overdue items (hours/day)',
    },
  };

/**
 * The clean-result message, in the three places a run can turn out empty.
 *
 * `04-engineering-principles.md` records what this sentence costs when it
 * drifts: it once told an executive their process was healthy directly above
 * eight measured frictions the run had declined to price, and then reappeared
 * on the empty-import path. The guards at each call site are right; what was
 * still duplicated was the WORDING, three times, so a correction to one left
 * the other two saying something subtly different about the same result.
 *
 * What actually duplicated was the REMEDY — the long "your thresholds may be
 * set conservatively" sentence, identical in both places. That is the piece
 * worth owning here.
 *
 * The claim around it is deliberately NOT unified. The two surfaces have always
 * worded it differently because they are scoped differently: the ranked section
 * is talking about one import, the lead about an analysis across every item it
 * counted. Collapsing them to one string would have been a copy change nobody
 * asked for, dressed as deduplication. Both are the wording that has been in
 * production; neither moves.
 */
export const NOTHING_CROSSED = {
  headline: 'Nothing crossed your thresholds',
  /** Only ever said when nothing was found AND nothing was left unpriced. */
  healthyInImport: "That's a genuinely healthy sign for the work analyzed.",
  healthyInAnalysis: 'That is a genuinely healthy sign for the work covered.',
  hint: 'If you expected findings, your aging and queue thresholds may be set conservatively. Lower them and run again to surface smaller effects.',
} as const;

/**
 * What skipping the roles step costs, stated identically wherever it is
 * mentioned.
 *
 * It is a claim about engine behaviour — an unmapped actor prices at the
 * default rate, which the cost model caps at C — so it must not be paraphrased
 * per surface. It was, in the onboarding step and in `/docs`.
 */
export const ROLES_SKIP_COST =
  'This step is optional and skipping it is the fastest path to your first report. It has one cost: with nobody mapped, every figure is priced at the default rate, which caps the whole report at <strong>confidence C</strong>. Mapping even the few people who do most of the work raises it.';
