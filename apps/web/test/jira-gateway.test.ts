import { describe, expect, it } from 'vitest';
import { HttpJiraGateway } from '../src/connectors/jira';
import { GatewayError, type ConnectorCredentials } from '../src/connectors/types';

/**
 * HttpJiraGateway against a mocked Jira (P4.2 defect 2). Proves the import
 * targets the CURRENT /rest/api/3/search/jql endpoint (the legacy
 * /rest/api/3/search was removed on Jira Cloud — the root cause), paginates
 * by cursor, and maps failures to sanitized {errorClass, stage, status}.
 */

const CONNECTION: ConnectorCredentials = {
  params: { site: 'https://acme.atlassian.net', email: 'me@acme.example' },
  secret: 'super-secret-jira-token',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function recordingFetch(handler: (url: string) => Response): {
  fetch: typeof globalThis.fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, urls };
}

describe('HttpJiraGateway (mocked Jira)', () => {
  it('imports a real project via the current /search/jql endpoint, by cursor', async () => {
    const { fetch, urls } = recordingFetch((url) => {
      if (url.includes('/rest/api/3/project/search')) {
        return jsonResponse({ values: [{ key: 'KAN', name: 'CostFlow Test' }], isLast: true });
      }
      if (url.includes('/rest/api/3/search/jql')) {
        // Two pages, cursor-paginated, to exercise nextPageToken.
        if (url.includes('nextPageToken=')) {
          return jsonResponse({
            issues: [
              {
                key: 'KAN-2',
                fields: { status: { name: 'Done' } },
                changelog: { total: 0, histories: [] },
              },
            ],
            isLast: true,
          });
        }
        return jsonResponse({
          issues: [
            {
              key: 'KAN-1',
              fields: { status: { name: 'To Do' } },
              changelog: { total: 0, histories: [] },
            },
          ],
          nextPageToken: 'CURSOR-2',
          isLast: false,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const gateway = new HttpJiraGateway(fetch);

    const projects = await gateway.listScopes(CONNECTION);
    expect(projects).toEqual([{ id: 'KAN', name: 'CostFlow Test' }]);

    const result = await gateway.fetchAll(CONNECTION, 'KAN');
    expect(result.searchPages).toHaveLength(2); // followed the cursor
    // The legacy endpoint is never used.
    expect(urls.some((u) => u.includes('/rest/api/3/search/jql'))).toBe(true);
    expect(urls.some((u) => /\/rest\/api\/3\/search\?/.test(u))).toBe(false);
    expect(urls.some((u) => u.includes('nextPageToken=CURSOR-2'))).toBe(true);
  });

  it('maps 401/403 to a sanitized auth-error (search stage)', async () => {
    const { fetch } = recordingFetch((url) =>
      url.includes('/search/jql')
        ? jsonResponse({}, 401)
        : jsonResponse({ values: [], isLast: true }),
    );
    const gateway = new HttpJiraGateway(fetch);
    await expect(gateway.fetchAll(CONNECTION, 'KAN')).rejects.toMatchObject({
      errorClass: 'auth-error',
      stage: 'search',
      status: 401,
    });
  });

  it('maps a removed/errored endpoint (e.g. 410) to fetch-error with the status — the defect signature', async () => {
    const { fetch } = recordingFetch((url) =>
      url.includes('/search/jql')
        ? jsonResponse({ errorMessages: ['gone'] }, 410)
        : jsonResponse({}),
    );
    const gateway = new HttpJiraGateway(fetch);
    try {
      await gateway.fetchAll(CONNECTION, 'KAN');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      const e = error as GatewayError;
      expect(e.errorClass).toBe('fetch-error');
      expect(e.stage).toBe('search');
      expect(e.status).toBe(410);
      expect(e.message).toContain('HTTP 410');
    }
  });

  it('maps a network failure to fetch-error', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED 1.2.3.4:443');
    }) as typeof globalThis.fetch;
    const gateway = new HttpJiraGateway(fetchFn);
    await expect(gateway.fetchAll(CONNECTION, 'KAN')).rejects.toMatchObject({
      errorClass: 'fetch-error',
      stage: 'search',
    });
  });

  it('never leaks the token, email, or URL in the sanitized error', async () => {
    const { fetch } = recordingFetch((url) =>
      url.includes('/search/jql') ? jsonResponse({}, 500) : jsonResponse({}),
    );
    const gateway = new HttpJiraGateway(fetch);
    try {
      await gateway.fetchAll(CONNECTION, 'KAN');
    } catch (error) {
      const e = error as GatewayError;
      const serialized = `${e.message} ${JSON.stringify({ errorClass: e.errorClass, stage: e.stage, status: e.status })}`;
      expect(serialized).not.toContain(CONNECTION.secret);
      expect(serialized).not.toContain('me@acme.example');
      expect(serialized).not.toContain('atlassian.net');
    }
  });
});
