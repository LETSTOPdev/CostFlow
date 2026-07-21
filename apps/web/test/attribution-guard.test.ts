import { describe, expect, it } from 'vitest';
import {
  AttributionGuardError,
  assertNoIndividualAttribution,
  findIndividualAttribution,
} from '../src/attribution';
import { get, makeApp, signIn, type TestApp } from './helpers';

/**
 * FR-17 (doc 04; doc 06 §15): no response ranks or scores an individual.
 * The guard is the reporting-layer choke point — enforced, not UI convention.
 * Individuals are pseudonymized at ingestion; the guard proves it on the
 * actual rendered bytes and fails closed if a raw identity ever survives.
 */

describe('FR-17 attribution guard (pure)', () => {
  it('flags a raw individual identity that leaks verbatim into the body', () => {
    expect(findIndividualAttribution('cost by Dan Ops: 5h', ['Dan Ops', 'Noa Legal'])).toEqual([
      'Dan Ops',
    ]);
  });

  it('ignores empty/whitespace actor values and a clean pseudonymized body', () => {
    expect(findIndividualAttribution('attributed to anon-3', ['', '   ', 'Dan Ops'])).toEqual([]);
  });

  it('assert throws AttributionGuardError carrying a count only — never the value', () => {
    try {
      assertNoIndividualAttribution('billed to Dan Ops', ['Dan Ops']);
      throw new Error('guard did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AttributionGuardError);
      expect((error as AttributionGuardError).leakedCount).toBe(1);
      expect((error as Error).message).not.toContain('Dan Ops');
    }
  });
});

describe('FR-17 attribution guard at the reporting layer (route, fail-closed)', () => {
  async function seedRun(
    t: TestApp,
    tenantId: string,
    reportMd: string,
    observedActors: string[],
  ): Promise<void> {
    const workspace = await t.store.createWorkspace(tenantId, {
      provider: 'jira',
      site: 'https://x.example',
      email: 'x@x.example',
      tokenCiphertext: 'tok',
    });
    await t.store.updateWorkspace(tenantId, workspace.id, { observedActors });
    await t.store.createRun({
      id: 'run-guard',
      tenantId,
      workspaceId: workspace.id,
      createdAt: '2026-07-20T00:00:00Z',
      runJson: '{}',
      reportMd,
      telemetryJsonl: '',
    });
  }

  it('withholds a report that would name an individual (500), logs a count only, records no view', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'guard@acme.example');
    const tenantId = (await t.store.findUserByEmail('guard@acme.example'))!.tenantId;
    await seedRun(t, tenantId, '# Report\n\nCost attributed to **Dan Ops**: 5h.', ['Dan Ops']);

    const res = await get(t, cookie, '/reports/run-guard');
    expect(res.statusCode).toBe(500);
    // The leaking body is withheld entirely.
    expect(res.body).not.toContain('Dan Ops');
    expect(res.body).toContain('withheld');
    // Not counted as a view — the first-view marker is still available.
    expect(t.events.some((e) => e.event === 'tm-web-report-viewed')).toBe(false);
    expect(await t.store.markRunViewed(tenantId, 'run-guard', '2026-07-20T01:00:00Z')).toBe(true);
    // Sanitized log: surface + count only, never the raw identity.
    const blocked = t.logs.find((l) => l['msg'] === 'attribution-guard-blocked');
    expect(blocked).toMatchObject({ surface: 'report', leaked: 1 });
    expect(JSON.stringify(t.logs)).not.toContain('Dan Ops');
  });

  it('renders a clean pseudonymized report (guard passes, 200, view recorded)', async () => {
    const t = makeApp();
    const cookie = await signIn(t, 'clean@acme.example');
    const tenantId = (await t.store.findUserByEmail('clean@acme.example'))!.tenantId;
    // Same workspace vocabulary, but the report names only a pseudonym.
    await seedRun(t, tenantId, '# Report\n\nCost attributed to **anon-7**: 5h.', ['Dan Ops']);

    const res = await get(t, cookie, '/reports/run-guard');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('anon-7');
    expect(t.events.some((e) => e.event === 'tm-web-report-viewed')).toBe(true);
  });
});
