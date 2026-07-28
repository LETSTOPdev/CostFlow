import type { AnalysisRun, FrictionInstance } from '@costflow/analysis';
import type { ImportBatch, StageKind, StageRef, WorkItem } from '@costflow/domain';
import { EVIDENCE_CAPABILITIES, type EvidenceCapability, type EvidenceProfile } from '../src/index';

export const stage = (name: string, kind: StageKind = 'queue'): StageRef => ({ name, kind });

/** An evidence profile with exactly the named capabilities present. */
export const evidence = (...present: EvidenceCapability[]): EvidenceProfile =>
  Object.fromEntries(EVIDENCE_CAPABILITIES.map((c) => [c, present.includes(c)])) as Record<
    EvidenceCapability,
    boolean
  >;

/** One overdue instance at `stage`, with the given per-item overdue days. */
export const overdueAt = (at: StageRef, days: readonly number[]): FrictionInstance => ({
  id: `f3-overdue:${at.name}`,
  signalId: 'f3-overdue',
  signalVersion: '1.0.0',
  frictionType: 'overdue',
  location: { stage: at },
  magnitude: { unit: 'item-days-overdue', value: days.reduce((s, d) => s + d, 0) },
  evidence: days.map((overdueDays, i) => ({
    workItemId: `${at.name}-${i}`,
    title: '',
    actor: { kind: 'missing' as const },
    dueAt: '2026-07-01',
    overdueDays,
    dueBeforeCreated: false,
    sharedDueDateCohortSize: 0,
  })),
});

/** An overdue instance at `at` whose evidence points at specific item ids. */
export const overdueOver = (at: StageRef, ids: readonly string[], days = 5): FrictionInstance => ({
  id: `f3-overdue:${at.name}`,
  signalId: 'f3-overdue',
  signalVersion: '1.0.0',
  frictionType: 'overdue',
  location: { stage: at },
  magnitude: { unit: 'item-days-overdue', value: ids.length * days },
  evidence: ids.map((workItemId) => ({
    workItemId,
    title: '',
    actor: { kind: 'missing' as const },
    dueAt: '2026-07-01',
    overdueDays: days,
    dueBeforeCreated: false,
    sharedDueDateCohortSize: 0,
  })),
});

/** One queue-wait instance at `stage`, with the given per-item wait hours. */
export const waitAt = (at: StageRef, hours: readonly number[]): FrictionInstance => ({
  id: `f1-queue-wait:${at.name}`,
  signalId: 'f1-queue-wait',
  signalVersion: '1.0.0',
  frictionType: 'queue-wait',
  location: { stage: at },
  magnitude: { unit: 'item-hours-waiting', value: hours.reduce((s, h) => s + h, 0) },
  evidence: hours.map((waitHours, i) => ({
    workItemId: `${at.name}-w${i}`,
    title: '',
    actor: { kind: 'missing' as const },
    waitHours,
    visits: 1,
    openAtAnalysisTime: false,
  })),
});

/**
 * A queue-wait instance at `at` over specific item ids. Use this when a test
 * needs the same item to wait in several stages, which is what real lifecycles
 * look like and what makes the "share of items through this gate" denominator
 * meaningful.
 */
export const waitOver = (
  at: StageRef,
  ids: readonly string[],
  hours: number,
): FrictionInstance => ({
  id: `f1-queue-wait:${at.name}`,
  signalId: 'f1-queue-wait',
  signalVersion: '1.0.0',
  frictionType: 'queue-wait',
  location: { stage: at },
  magnitude: { unit: 'item-hours-waiting', value: ids.length * hours },
  evidence: ids.map((workItemId) => ({
    workItemId,
    title: '',
    actor: { kind: 'missing' as const },
    waitHours: hours,
    visits: 1,
    openAtAnalysisTime: false,
  })),
});

export const item = (id: string, at: StageRef, actor: WorkItem['actor']): WorkItem => ({
  id,
  sourceId: id,
  title: '',
  stage: at,
  actor,
  createdAt: '2026-06-01',
  dueAt: '2026-07-01',
  lastUpdatedAt: '2026-07-10',
});

const batch = (items: readonly WorkItem[]): ImportBatch => ({
  id: 'batch-1',
  provider: 'test',
  mappingTemplateId: 't',
  mappingTemplateVersion: '1',
  importedAt: '2026-07-20T00:00:00Z',
  counts: { totalRows: items.length, imported: items.length, dropped: 0 },
  diagnostics: [],
  capability: {
    hasEventHistory: false,
    hasDueDates: true,
    hasLastUpdated: true,
    hasActors: true,
  },
  evidence: [],
  pseudonymizationScope: null,
  items,
  events: [],
});

/**
 * A minimal AnalysisRun carrying the given frictions and items. Only the fields
 * the diagnostics actually read are meaningful; the rest exist because the
 * artifact type is total.
 */
export const runWith = (
  frictions: readonly FrictionInstance[],
  items: readonly WorkItem[] = [],
): AnalysisRun => ({
  runId: 'run-1',
  engineVersions: { analysis: '0.4.0', signals: {}, contextSignals: {}, costModels: {} },
  now: '2026-07-20T00:00:00Z',
  pricingPolicy: 'report',
  batch: batch(items),
  assumptions: {
    id: 'a',
    version: '1',
    currency: 'USD',
    rates: [],
    parameters: {},
  } as unknown as AnalysisRun['assumptions'],
  detectors: [],
  frictions,
  pricing: [],
  estimates: [],
  context: [],
});
