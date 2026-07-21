import { describe, expect, it } from 'vitest';
import {
  issuesNeedingChangelogTopUp,
  jiraAuthHeader,
  jiraChangelogUrl,
  jiraSearchUrl,
} from '../src/fetchers/jira';

describe('jira fetcher pure helpers (HTTP never exercised in tests)', () => {
  it('builds search URLs with ordered JQL, fields, changelog expansion, and pagination', () => {
    const url = jiraSearchUrl('https://acme.atlassian.net/', 'OPS', 100, 100);
    expect(url).toContain('https://acme.atlassian.net/rest/api/3/search?');
    expect(url).toContain(encodeURIComponent('project = "OPS" ORDER BY created ASC'));
    expect(url).toContain('expand=changelog');
    expect(url).toContain('startAt=100');
  });

  it('builds changelog top-up URLs with escaped issue keys', () => {
    expect(jiraChangelogUrl('https://acme.atlassian.net', 'OPS-1', 0, 100)).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/OPS-1/changelog?maxResults=100&startAt=0',
    );
  });

  it('encodes basic auth without leaking the token in cleartext', () => {
    const header = jiraAuthHeader('me@example.com', 'secret-token');
    expect(header.startsWith('Basic ')).toBe(true);
    expect(header).not.toContain('secret-token');
  });

  it('detects which issues need changelog top-ups (J2 input)', () => {
    const page = JSON.stringify({
      issues: [
        { key: 'A-1', changelog: { total: 2, histories: [{}, {}] } },
        { key: 'A-2', changelog: { total: 150, histories: new Array(100).fill({}) } },
        { key: 'A-3', changelog: { total: 0, histories: [] } },
      ],
    });
    expect(issuesNeedingChangelogTopUp(page)).toEqual(['A-2']);
  });
});
