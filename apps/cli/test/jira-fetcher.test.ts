import { describe, expect, it } from 'vitest';
import {
  issuesNeedingChangelogTopUp,
  jiraAuthHeader,
  jiraChangelogUrl,
  jiraSearchNextPageToken,
  jiraSearchUrl,
} from '../src/fetchers/jira';

describe('jira fetcher pure helpers (HTTP never exercised in tests)', () => {
  it('builds enhanced JQL search URLs (the current /search/jql endpoint, not the removed one)', () => {
    const first = jiraSearchUrl('https://acme.atlassian.net/', 'OPS', undefined, 100);
    // Must target the CURRENT endpoint — the legacy /rest/api/3/search is gone.
    expect(first).toContain('https://acme.atlassian.net/rest/api/3/search/jql?');
    expect(first).not.toContain('/rest/api/3/search?');
    expect(first).toContain(encodeURIComponent('project = "OPS" ORDER BY created ASC'));
    expect(first).toContain('fields=');
    expect(first).toContain('expand=changelog');
    // First page carries no cursor; the legacy startAt param is gone.
    expect(first).not.toContain('nextPageToken');
    expect(first).not.toContain('startAt');
    // Subsequent pages carry the opaque cursor.
    const next = jiraSearchUrl('https://acme.atlassian.net', 'OPS', 'CURSOR/AB+1', 100);
    expect(next).toContain(`nextPageToken=${encodeURIComponent('CURSOR/AB+1')}`);
  });

  it('reads the search cursor (null on the last page)', () => {
    expect(jiraSearchNextPageToken(JSON.stringify({ nextPageToken: 'tok2', isLast: false }))).toBe(
      'tok2',
    );
    expect(jiraSearchNextPageToken(JSON.stringify({ isLast: true }))).toBeNull();
    expect(jiraSearchNextPageToken(JSON.stringify({ issues: [] }))).toBeNull();
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
