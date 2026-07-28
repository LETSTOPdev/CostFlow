import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityProfile, ImportBatch } from '@costflow/domain';
import { ROOT } from './helpers';
import { EVIDENCE_CAPABILITIES } from '@costflow/diagnostics';
import { NOT_BUILT, actionableGaps, assessEvidence, type ConnectorEvidence } from '../src/evidence';
import { buildJiraConnector } from '../src/connectors/jira';
import { buildClickUpConnector } from '../src/connectors/clickup';
import type { ConnectorGateway } from '../src/connectors/types';

// Descriptors are static data; the gateway is irrelevant to what a platform
// advertises, so a stub is enough to reach it.
const NO_GATEWAY = {} as ConnectorGateway;
const connectorFor = (id: string) =>
  id === 'jira' ? buildJiraConnector(NO_GATEWAY) : buildClickUpConnector(NO_GATEWAY);

type Batch = Pick<ImportBatch, 'items' | 'events' | 'capability'>;

const capability = (over: Partial<CapabilityProfile> = {}): CapabilityProfile => ({
  hasEventHistory: false,
  hasDueDates: false,
  hasLastUpdated: false,
  hasActors: false,
  ...over,
});

const batch = (over: Partial<Batch> = {}): Batch => ({
  items: [],
  events: [],
  capability: capability(),
  ...over,
});

const someItems = [{ id: 'a' }] as unknown as ImportBatch['items'];
const someEvents = [{ workItemId: 'a' }] as unknown as ImportBatch['events'];

const ANY_PLATFORM: ConnectorEvidence = {
  canProvide: ['stage-snapshots', 'status-history', 'transition-history', 'due-dates'],
  planGated: [],
  planGateHint: {},
};

const statusOf = (a: ReturnType<typeof assessEvidence>, c: string) =>
  a.statuses.find((s) => s.capability === c)!;

describe('evidence translation', () => {
  /**
   * `NOT_BUILT` and the derivation in `realized()` are two lists that must
   * agree. If someone teaches the derivation to detect assignment history but
   * forgets to remove it from NOT_BUILT, the customer is told "CostFlow does not
   * read this yet" about something it now reads — a wrong message with no test
   * to catch it. This asserts the two cannot drift apart, from the richest
   * possible import.
   */
  it('never claims a capability is unbuilt while also deriving it as present', () => {
    const richest = assessEvidence(
      { name: 'Test', provides: ANY_PLATFORM },
      batch({
        items: someItems,
        events: someEvents,
        capability: capability({
          hasEventHistory: true,
          hasDueDates: true,
          hasLastUpdated: true,
          hasActors: true,
        }),
      }),
    );
    for (const capability of NOT_BUILT) {
      expect(
        richest.profile[capability],
        `${capability} is listed NOT_BUILT but derives true`,
      ).toBe(false);
    }
  });

  it('answers every capability in the vocabulary, with no gaps', () => {
    const a = assessEvidence({ name: 'Test', provides: ANY_PLATFORM }, batch());
    expect(a.statuses.map((s) => s.capability).sort()).toEqual([...EVIDENCE_CAPABILITIES].sort());
    for (const c of EVIDENCE_CAPABILITIES) expect(typeof a.profile[c]).toBe('boolean');
  });

  it('reports what the import actually contained, not what the platform could supply', () => {
    const a = assessEvidence(
      { name: 'Test', provides: ANY_PLATFORM },
      batch({
        items: someItems,
        events: someEvents,
        capability: capability({ hasEventHistory: true, hasDueDates: true }),
      }),
    );
    expect(a.profile['stage-snapshots']).toBe(true);
    expect(a.profile['transition-history']).toBe(true);
    expect(a.profile['due-dates']).toBe(true);
  });

  it('treats status history as implied by transition history, never the reverse', () => {
    const withTransitions = assessEvidence(
      { name: 'Test', provides: ANY_PLATFORM },
      batch({
        items: someItems,
        events: someEvents,
        capability: capability({ hasEventHistory: true }),
      }),
    );
    expect(withTransitions.profile['status-history']).toBe(true);
    expect(withTransitions.profile['transition-history']).toBe(true);
  });

  describe('the four absence reasons are distinguished', () => {
    it('platform-cannot: the platform has no way to expose it', () => {
      const a = assessEvidence(
        {
          name: 'Aggregates Only',
          provides: { canProvide: ['stage-snapshots'], planGated: [], planGateHint: {} },
        },
        batch({ items: someItems }),
      );
      const s = statusOf(a, 'transition-history');
      expect(s.reason).toBe('platform-cannot');
      expect(s.explanation).toBe('Aggregates Only does not expose transition history.');
    });

    it('plan-gated: the platform can, this workspace does not, and it names the fix', () => {
      const a = assessEvidence(
        {
          name: 'Gated',
          provides: {
            canProvide: ['stage-snapshots', 'status-history'],
            planGated: ['status-history'],
            planGateHint: { 'status-history': 'Ask an admin to enable it, then re-import.' },
          },
        },
        batch({ items: someItems }),
      );
      const s = statusOf(a, 'status-history');
      expect(s.reason).toBe('plan-gated');
      expect(s.explanation).toContain('can expose status history, but this workspace does not');
      expect(s.explanation).toContain('Ask an admin to enable it');
    });

    it('import-lacked: the platform supplies it, this import did not carry it', () => {
      const a = assessEvidence(
        { name: 'Test', provides: ANY_PLATFORM },
        batch({ items: someItems }),
      );
      const s = statusOf(a, 'transition-history');
      expect(s.reason).toBe('import-lacked');
      expect(s.explanation).toBe(
        'Test exposes transition history, but this import did not include it.',
      );
    });

    it('not-built: CostFlow reads it from nowhere yet, so it is not the platform’s fault', () => {
      const a = assessEvidence(
        {
          name: 'Test',
          provides: {
            ...ANY_PLATFORM,
            canProvide: [...ANY_PLATFORM.canProvide, 'dependency-graph'],
          },
        },
        batch({ items: someItems }),
      );
      const s = statusOf(a, 'dependency-graph');
      expect(s.reason).toBe('not-built');
      expect(s.explanation).toContain(
        'does not read dependency graph from any connected platform yet',
      );
      expect(s.explanation).not.toContain('Test');
    });
  });

  it('ranks gaps the customer can act on first', () => {
    const a = assessEvidence(
      {
        name: 'Gated',
        provides: {
          canProvide: ['stage-snapshots', 'status-history', 'due-dates'],
          planGated: ['status-history'],
          planGateHint: {},
        },
      },
      batch({ items: someItems }),
    );
    const reasons = actionableGaps(a).map((s) => s.reason);
    expect(reasons[0]).toBe('plan-gated');
    expect(reasons.indexOf('plan-gated')).toBeLessThan(reasons.indexOf('platform-cannot'));
    expect(reasons.indexOf('import-lacked')).toBeLessThan(reasons.indexOf('not-built'));
  });

  it('never reports a present capability as a gap', () => {
    const a = assessEvidence(
      { name: 'Test', provides: ANY_PLATFORM },
      batch({
        items: someItems,
        events: someEvents,
        capability: capability({ hasEventHistory: true }),
      }),
    );
    for (const gap of actionableGaps(a)) expect(gap.present).toBe(false);
    expect(actionableGaps(a).map((s) => s.capability)).not.toContain('transition-history');
  });

  describe('the real connectors advertise honestly', () => {
    it('the changelog platform provides transition history ungated', () => {
      const jira = connectorFor('jira');
      expect(jira.descriptor.provides.canProvide).toContain('transition-history');
      expect(jira.descriptor.provides.planGated).toEqual([]);
    });

    /**
     * The time-in-status platform DOES yield ordered transitions: each status
     * entry carries `total_time.since`, the instant the task entered it, which
     * the ingestion transform reconstructs into a real event chain (CU1). The
     * demo-clickup golden is the proof — queue wait runs on it.
     *
     * Both capabilities sit behind the same ClickApp, so both are declared
     * gated. Declaring them unavailable instead would tell a workspace that its
     * platform is incapable when the truth is that a setting is off, which is
     * the one message here a customer can actually act on.
     */
    it('the time-in-status platform claims both histories, and gates both', () => {
      const clickup = connectorFor('clickup');
      expect(clickup.descriptor.provides.canProvide).toContain('status-history');
      expect(clickup.descriptor.provides.canProvide).toContain('transition-history');
      expect(clickup.descriptor.provides.planGated).toContain('status-history');
      expect(clickup.descriptor.provides.planGated).toContain('transition-history');
      expect(clickup.descriptor.provides.planGateHint['transition-history']).toBeTruthy();
    });

    it('produces the actionable message for a workspace without the gated ClickApp', () => {
      const clickup = connectorFor('clickup');
      const a = assessEvidence(clickup.descriptor, batch({ items: someItems }));
      for (const capability of ['status-history', 'transition-history'] as const) {
        expect(statusOf(a, capability).reason).toBe('plan-gated');
        expect(statusOf(a, capability).explanation).toContain('Total Time in Status');
      }
    });

    /**
     * The golden is the standing proof that the claim above is not aspirational:
     * if the transform ever stopped reconstructing transitions, this connector
     * would be advertising a capability it cannot deliver.
     */
    it('is backed by a golden in which the reconstruction actually produced events', () => {
      const golden = JSON.parse(
        readFileSync(join(ROOT, 'tools/golden/expected/demo-clickup/run.json'), 'utf8'),
      ) as {
        batch: {
          events: { from: unknown; to: unknown; at: string }[];
          capability: Record<string, boolean>;
        };
        detectors: { signalId: string; status: string }[];
      };
      expect(golden.batch.capability['hasEventHistory']).toBe(true);
      expect(golden.batch.events.length).toBeGreaterThan(0);
      expect(golden.batch.events.some((e) => e.from !== null)).toBe(true);
      expect(golden.detectors.find((d) => d.signalId === 'f1-queue-wait')?.status).toBe('ran');
    });
  });
});
