import { describe, expect, it } from 'vitest';
import { makeApp, signIn, post, get, csrfOf, stubConnectors } from './helpers';
import {
  GatewayError,
  type ConnectorCredentials,
  type ConnectorGateway,
} from '../src/connectors/types';
import type { JiraRawFetch } from '../src/connectors/jira';

/**
 * QA regression (adversarial audit): a single friction can aggregate tens of
 * thousands of work items on a large Jira project. The report drill-down must
 * cap the itemized table so the HTML stays bounded (pre-fix: ~27MB at 100k
 * issues), while the full breakdown stays available in the raw export.
 */

const iso = (d: string): string => `${d}T00:00:00.000+0000`;
function agingIssues(n: number): string[] {
  const issues = Array.from({ length: n }, (_, i) => ({
    key: `AGE-${i + 1}`,
    fields: {
      summary: `Aging task ${i + 1}`,
      status: { name: 'In Progress' },
      assignee: { displayName: `Person ${i % 7}` },
      created: iso('2026-01-05'), // ~6 months before NOW → well beyond threshold
      updated: iso('2026-01-10'),
      duedate: null,
    },
  }));
  const pages: string[] = [];
  for (let p = 0; p < issues.length; p += 100) {
    pages.push(
      JSON.stringify({ startAt: p, maxResults: 100, total: n, issues: issues.slice(p, p + 100) }),
    );
  }
  return pages;
}

class BulkGateway implements ConnectorGateway {
  constructor(private readonly pages: string[]) {}
  async listScopes() {
    return [{ id: 'AGE', name: 'Aging Project' }];
  }
  async fetchAll(_c: ConnectorCredentials, scopeId: string): Promise<JiraRawFetch> {
    if (scopeId !== 'AGE') throw new GatewayError('fetch-error', 'search', 'unknown');
    return { provider: 'jira', searchPages: this.pages, supplementaryChangelogs: {} };
  }
}

describe('report drill-down scale cap', () => {
  it('caps a huge friction breakdown and states how many items are hidden', async () => {
    const gateway = new BulkGateway(agingIssues(200));
    const t = makeApp({ connectors: stubConnectors(gateway) });
    const cookie = await signIn(t, 'scale@example.com');
    const csrf = csrfOf(cookie);

    await post(t, cookie, '/connect', {
      provider: 'jira',
      site: 'https://acme.atlassian.net',
      email: 'ops@acme.example',
      token: 'secret-token',
    });
    await post(t, cookie, '/scope', { project: '0' });
    const statuses = await get(t, cookie, '/mapping/statuses');
    const idx = [...statuses.body.matchAll(/name="s(\d+)"/g)].map((m) => m[1]);
    const smap: Record<string, string> = { csrf };
    idx.forEach((i) => (smap[`s${i}`] = 'active'));
    await post(t, cookie, '/mapping/statuses', smap);
    await post(t, cookie, '/mapping/actors', {});
    await post(t, cookie, '/assumptions', {
      accept_all: 'on',
      rate0: '95',
      defaultRate: '95',
      agingThresholdDays: '14',
      attention_low: '0.25',
      attention_expected: '0.5',
      attention_high: '1',
      queueWait_low: '0.1',
      queueWait_expected: '0.25',
      queueWait_high: '0.5',
      overdue_low: '0.25',
      overdue_expected: '0.5',
      overdue_high: '1',
    });
    await post(t, cookie, '/runs', {});

    const runs = await t.store.listRuns(
      (await t.store.findUserByEmail('scale@example.com'))!.tenantId,
    );
    expect(runs.length).toBe(1);
    const report = await get(t, cookie, `/reports/${runs[0]!.id}`);
    expect(report.statusCode).toBe(200);

    // The itemized table is bounded (50 rows/friction) even with 200 items…
    const dataRows = (report.body.match(/<td>Aging task/g) ?? []).length;
    expect(dataRows).toBeLessThanOrEqual(50);
    // …and the report truthfully accounts for the remainder.
    expect(report.body).toContain('more items contributing to this figure');
    // Bounded HTML: pre-fix this exceeded a megabyte for large projects.
    expect(report.body.length).toBeLessThan(400_000);
  });
});
