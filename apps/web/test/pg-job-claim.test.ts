import { describe, expect, it } from 'vitest';
import { PgStore } from '../src/store/pg';

/**
 * The Postgres half of the double-submit guard, driven through a scripted pool.
 *
 * The shared store contract covers the BEHAVIOUR both adapters must agree on.
 * It cannot cover this, because the failure is specific to how Postgres claims
 * the slot: the insert conflicts on a partial unique index, and the recovery
 * read happens afterwards, in a separate statement. Between those two, the job
 * that caused the conflict can finish.
 *
 * That window is not hypothetical. It is the concurrent case the guard exists
 * for, and before the retry loop the method returned `undefined` cast as a
 * JobRecord — which POST /runs dereferences immediately as `job.id`, turning a
 * race into a 500 on a customer's run submission. Confirmed against real
 * PostgreSQL (PGlite, real schema.sql, real partial index) before it was fixed.
 *
 * A scripted pool is used rather than a live database so the regression is
 * pinned in the normal test run, on every machine, with no new dependency.
 */

type Call = { text: string; params: readonly unknown[] };

const uniqueViolation = (): Error & { code: string } =>
  Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

const jobRow = (id: string, status: string) => ({
  id,
  tenant_id: 't1',
  workspace_id: 'w1',
  status,
  error_class: null,
  error_message: null,
  run_id: null,
  created_at: '2026-07-28T00:00:00.000Z',
  finished_at: null,
});

/** Answers by statement shape, and records what it was asked. */
function scriptedPool(script: {
  insert: (n: number) => { ok: true } | { ok: false };
  activeJobs: (n: number) => Record<string, unknown>[];
}) {
  const calls: Call[] = [];
  let inserts = 0;
  let selects = 0;
  let lastInsertedId = '';
  const query = async (text: string, params: readonly unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes('insert into jobs')) {
      inserts += 1;
      if (!script.insert(inserts).ok) throw uniqueViolation();
      lastInsertedId = params[0] as string;
      return { rows: [] };
    }
    if (text.includes('where tenant_id = $1 and workspace_id = $2')) {
      selects += 1;
      return { rows: script.activeJobs(selects) };
    }
    if (text.includes('where tenant_id = $1 and id = $2')) {
      return { rows: [jobRow(lastInsertedId, 'queued')] };
    }
    throw new Error(`unscripted query: ${text}`);
  };
  return { pool: { query }, calls };
}

const storeWith = (pool: unknown): PgStore => {
  const store = new PgStore('postgres://unused');
  (store as unknown as { pool: unknown }).pool = pool;
  return store;
};

describe('PgStore.createJobIfNoneActive — claiming the slot', () => {
  it('returns the created job when the insert wins the slot', async () => {
    const { pool, calls } = scriptedPool({ insert: () => ({ ok: true }), activeJobs: () => [] });
    const result = await storeWith(pool).createJobIfNoneActive('t1', 'w1');
    expect(result.created).toBe(true);
    expect(result.job.status).toBe('queued');
    expect(calls.filter((c) => c.text.includes('insert into jobs'))).toHaveLength(1);
  });

  it('returns the holder, uncreated, when the slot is genuinely taken', async () => {
    const { pool } = scriptedPool({
      insert: () => ({ ok: false }),
      activeJobs: () => [jobRow('held', 'running')],
    });
    const result = await storeWith(pool).createJobIfNoneActive('t1', 'w1');
    expect(result.created).toBe(false);
    expect(result.job.id).toBe('held');
    expect(result.job.status).toBe('running');
  });

  /**
   * The regression. Insert conflicts, then the holder finishes before the
   * recovery read, so there is no active job to hand back. The slot is free
   * again, so the honest outcome is to claim it — never to return nothing.
   */
  it('claims the slot when the holder finishes between the conflict and the recovery read', async () => {
    const { pool, calls } = scriptedPool({
      insert: (n) => ({ ok: n > 1 }), // first attempt loses, second wins
      activeJobs: () => [], // holder already finished
    });
    const result = await storeWith(pool).createJobIfNoneActive('t1', 'w1');

    expect(result.job).toBeDefined();
    expect(result.job.id).toBeTruthy();
    expect(result.created).toBe(true);
    expect(calls.filter((c) => c.text.includes('insert into jobs'))).toHaveLength(2);
  });

  it('never returns a job-shaped hole, whatever the sequence', async () => {
    for (const insert of [() => ({ ok: true }), (n: number) => ({ ok: n > 1 })]) {
      const { pool } = scriptedPool({ insert, activeJobs: () => [] });
      const result = await storeWith(pool).createJobIfNoneActive('t1', 'w1');
      expect(result.job, 'a JobRecord-typed undefined must never escape').toBeTruthy();
    }
  });

  /** A real error is a bug, not contention, and must not be swallowed by the retry. */
  it('rethrows anything that is not a unique violation', async () => {
    const pool = {
      query: async () => {
        throw Object.assign(new Error('connection terminated'), { code: '57P01' });
      },
    };
    await expect(storeWith(pool).createJobIfNoneActive('t1', 'w1')).rejects.toThrow(
      'connection terminated',
    );
  });

  /** Bounded, so pathological churn cannot spin forever inside a request. */
  it('gives up with a clear error rather than looping when the slot keeps flapping', async () => {
    const { pool, calls } = scriptedPool({
      insert: () => ({ ok: false }), // always conflicts…
      activeJobs: () => [], // …yet never has a holder to report
    });
    await expect(storeWith(pool).createJobIfNoneActive('t1', 'w1')).rejects.toThrow(
      /could not claim/i,
    );
    expect(calls.filter((c) => c.text.includes('insert into jobs')).length).toBeLessThanOrEqual(5);
  });
});
