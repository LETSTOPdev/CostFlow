import { describe, expect, it } from 'vitest';
import { esc } from '../src/html';
import { toIso } from '../src/store/pg';
import { MemoryStore } from '../src/store/memory';
import type { RunRecord } from '../src/store/contract';
import { get, makeApp, signIn } from './helpers';

/**
 * P4.2 defect 2: node-postgres returns timestamptz columns as Date objects,
 * which crashed GET /runs with `value.replaceAll is not a function`. Root fix
 * = coerce timestamps to ISO strings at the store boundary (toIso); defense =
 * esc tolerates a non-string. Both are covered here without needing Postgres.
 */

describe('timestamp coercion (root cause)', () => {
  it('toIso converts a Date to ISO, passes strings through, and preserves null', () => {
    expect(toIso(new Date('2026-07-20T00:00:00.000Z'))).toBe('2026-07-20T00:00:00.000Z');
    expect(toIso('2026-07-20T00:00:00Z')).toBe('2026-07-20T00:00:00Z');
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
});

describe('esc hardening (defense in depth)', () => {
  it('never throws on a non-string value (e.g. a stray Date)', () => {
    expect(() => esc(new Date('2026-07-20T00:00:00Z') as unknown as string)).not.toThrow();
    expect(typeof esc(new Date() as unknown as string)).toBe('string');
    expect(esc(null as unknown as string)).toBe('');
    // Still escapes normal strings correctly.
    expect(esc('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

/** Simulates the production driver: createdAt arrives as a Date, not a string. */
class DateRunStore extends MemoryStore {
  override async listRuns(tenantId: string): Promise<RunRecord[]> {
    const runs = await super.listRuns(tenantId);
    return runs.map((r) => ({ ...r, createdAt: new Date(r.createdAt) as unknown as string }));
  }
}

describe('GET /runs renders even when a Date leaks from the store (defect 2 repro)', () => {
  it('returns 200 and lists the run instead of 500', async () => {
    const store = new DateRunStore();
    const t = makeApp({ store });
    const cookie = await signIn(t, 'date@acme.example');
    const tenantId = (await store.findUserByEmail('date@acme.example'))!.tenantId;
    const ws = await store.createWorkspace(tenantId, {
      provider: 'jira',
      connectionParams: { site: 'https://acme.atlassian.net', email: 'date@acme.example' },
      tokenCiphertext: 'ct',
    });
    await store.createRun({
      id: 'run-date-1',
      tenantId,
      workspaceId: ws.id,
      createdAt: '2026-07-20T00:00:00.000Z', // stored ISO; the override reads it back as a Date
      runJson: '{}',
      reportMd: '# report',
      telemetryJsonl: '',
    });

    const res = await get(t, cookie, '/runs');
    expect(res.statusCode).toBe(200); // was HTTP 500 before the fix
    expect(res.body).toContain('run-date-1'); // old run still renders
  });
});
