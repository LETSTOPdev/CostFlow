import type { AnalysisRun, CostEstimate, FrictionInstance } from '@costflow/analysis';
import type {
  AssumptionSet,
  EvidenceNote,
  ImportBatch,
  StageKind,
  WorkItem,
} from '@costflow/domain';

export const assumptions = (over: Partial<AssumptionSet> = {}): AssumptionSet => ({
  id: 'a',
  version: '1',
  currency: 'USD',
  rates: [{ roleRef: 'Engineer', hourlyRate: '100', provenance: 'customer-customized' }],
  defaultRate: { hourlyRate: '80', provenance: 'customer-customized' },
  parameters: {
    agingThresholdDays: { value: 14, provenance: 'customer-customized' },
    attentionHoursPerDay: {
      range: { low: '0.1', expected: '0.2', high: '0.4' },
      provenance: 'customer-customized',
    },
  },
  ...over,
});

export const item = (id: string, statusName: string, kind: StageKind): WorkItem => ({
  id,
  sourceId: id,
  title: '',
  stage: { name: statusName, kind },
  actor: { kind: 'missing' },
  createdAt: '2026-06-01',
  dueAt: '2026-07-01',
  lastUpdatedAt: '2026-07-10',
});

export const priced = (id: string, signalId: string, expected: string): FrictionInstance => ({
  id,
  signalId,
  signalVersion: '1.0.0',
  frictionType: 'overdue',
  location: { stage: { name: 'Open', kind: 'queue' } },
  magnitude: { unit: 'item-days-overdue', value: Number(expected) },
  evidence: [
    {
      workItemId: `${id}-i`,
      title: '',
      actor: { kind: 'missing' },
      dueAt: '2026-07-01',
      overdueDays: 1,
      dueBeforeCreated: false,
      sharedDueDateCohortSize: 0,
    },
  ],
});

export const estimate = (frictionInstanceId: string, expected: string): CostEstimate =>
  ({
    frictionInstanceId,
    costModelId: 'c3-overdue-attention',
    costModelVersion: '1.0.0',
    cost: { low: expected, expected, high: expected },
    currency: 'USD',
    confidence: { tier: 'A', reasons: [] },
    assumptionSetId: 'a',
    assumptionSetVersion: '1',
    trace: {
      claim: '',
      formula: '',
      terms: [],
      assumptionsUsed: [],
      inputs: { workItemIds: [] },
    },
  }) as unknown as CostEstimate;

interface RunOver {
  frictions?: readonly FrictionInstance[];
  estimates?: readonly CostEstimate[];
  items?: readonly WorkItem[];
  assumptions?: AssumptionSet;
  detectorsRan?: readonly string[];
  detectorsSkipped?: readonly string[];
  engine?: Partial<AnalysisRun['engineVersions']>;
  provider?: string;
  mappingTemplateId?: string;
  pricingPolicy?: AnalysisRun['pricingPolicy'];
  evidence?: readonly EvidenceNote[] | undefined;
  /** Simulates a run written before evidence quality existed. */
  legacyNoEvidence?: boolean;
}

export function run(over: RunOver = {}): AnalysisRun {
  const batch = {
    id: 'b',
    provider: over.provider ?? 'jira',
    mappingTemplateId: over.mappingTemplateId ?? 'tpl',
    mappingTemplateVersion: '1',
    importedAt: '2026-07-20T00:00:00Z',
    counts: { totalRows: 1, imported: 1, dropped: 0 },
    diagnostics: [],
    capability: {
      hasEventHistory: true,
      hasDueDates: true,
      hasLastUpdated: true,
      hasActors: true,
    },
    evidence: over.evidence ?? [],
    scopes: [],
    pseudonymizationScope: null,
    items: over.items ?? [item('i1', 'Open', 'queue')],
    events: [],
  } as ImportBatch;

  if (over.legacyNoEvidence) delete (batch as { evidence?: unknown }).evidence;

  return {
    runId: 'r',
    engineVersions: {
      analysis: '0.4.0',
      signals: { 'f3-overdue': '1.0.0' },
      contextSignals: {},
      costModels: { 'f3-overdue': '1.0.0' },
      ...over.engine,
    },
    now: '2026-07-20T00:00:00Z',
    pricingPolicy: over.pricingPolicy ?? 'report',
    batch,
    assumptions: over.assumptions ?? assumptions(),
    detectors: [
      ...(over.detectorsRan ?? ['f3-overdue']).map((signalId) => ({
        signalId,
        signalVersion: '1.0.0',
        signalName: signalId,
        status: 'ran' as const,
        instanceCount: 1,
      })),
      ...(over.detectorsSkipped ?? []).map((signalId) => ({
        signalId,
        signalVersion: '1.0.0',
        signalName: signalId,
        status: 'skipped' as const,
        reason: 'not available',
        instanceCount: 0,
      })),
    ],
    frictions: over.frictions ?? [priced('f1', 'f3-overdue', '100')],
    pricing: [],
    estimates: over.estimates ?? [estimate('f1', '100')],
    context: [],
  };
}
