import { describe, expect, it } from 'vitest';
import { clickupConnector, type ClickUpFetchPayload, type Connection } from '../src/connectors';

/**
 * The ClickUp web connector against a mocked ClickUp (doc 18 §5): team→Space
 * scope discovery, folder + folderless list enumeration, task pagination to
 * last_page, bounded 429 retry honoring Retry-After, and sanitized failures.
 */

const CONNECTION: Connection = { display: {}, secret: 'pk_secret_clickup_token' };

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, ...(headers ? { headers } : {}) });
}

function recordingFetch(handler: (url: string, call: number) => Response): {
  fetch: typeof globalThis.fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return handler(url, urls.length);
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, urls };
}

const task = (id: string, status = 'to do'): Record<string, unknown> => ({
  id,
  name: `Task ${id}`,
  status: { status },
  assignees: [],
  date_created: '1780272000000',
  date_updated: '1782864000000',
  due_date: null,
});

describe('clickup connector (mocked ClickUp)', () => {
  it('lists Spaces across teams, prefixing team names only when several exist', async () => {
    const { fetch } = recordingFetch((url) => {
      if (url.endsWith('/team')) {
        return jsonResponse({
          teams: [
            { id: '1', name: 'Acme' },
            { id: '2', name: 'Beta Co' },
          ],
        });
      }
      if (url.includes('/team/1/space')) {
        return jsonResponse({ spaces: [{ id: '10', name: 'Engineering' }] });
      }
      if (url.includes('/team/2/space')) {
        return jsonResponse({ spaces: [{ id: '20', name: 'Ops' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const connector = clickupConnector(fetch);
    expect(await connector.listScopes(CONNECTION)).toEqual([
      { key: '10', name: 'Acme / Engineering' },
      { key: '20', name: 'Beta Co / Ops' },
    ]);
  });

  it('fetches folder + folderless lists and paginates each list to last_page', async () => {
    const { fetch, urls } = recordingFetch((url) => {
      if (url.includes('/space/10/folder')) {
        return jsonResponse({
          folders: [{ id: 'f1', name: 'Sprints', lists: [{ id: '901', name: 'Sprint 1' }] }],
        });
      }
      if (url.includes('/space/10/list')) {
        return jsonResponse({ lists: [{ id: '902', name: 'Backlog' }] });
      }
      if (url.includes('/list/901/task')) {
        // Two pages for list 901 to exercise pagination.
        if (url.includes('page=0')) {
          return jsonResponse({ tasks: [task('a-1')], last_page: false });
        }
        return jsonResponse({ tasks: [task('a-2')], last_page: true });
      }
      if (url.includes('/list/902/task')) {
        return jsonResponse({ tasks: [task('b-1', 'complete')], last_page: true });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const connector = clickupConnector(fetch);
    const payload = (await connector.fetchAll(CONNECTION, '10')) as ClickUpFetchPayload;
    expect(Object.keys(payload.taskPagesByList).sort()).toEqual(['901', '902']);
    expect(payload.taskPagesByList['901']).toHaveLength(2);
    expect(connector.countItems(payload)).toBe(3);
    // Subtasks and closed tasks are always requested (CU6/CU7).
    expect(urls.filter((u) => u.includes('/task')).every((u) => u.includes('subtasks=true'))).toBe(
      true,
    );
    expect(
      urls.filter((u) => u.includes('/task')).every((u) => u.includes('include_closed=true')),
    ).toBe(true);
  });

  it('retries 429 honoring Retry-After (capped), then succeeds — no failed import', async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    const { fetch } = recordingFetch((url) => {
      if (url.endsWith('/team')) {
        attempt += 1;
        if (attempt <= 2) {
          return jsonResponse({ err: 'rate limit' }, 429, { 'retry-after': '2' });
        }
        return jsonResponse({ teams: [{ id: '1', name: 'Acme' }] });
      }
      if (url.includes('/space')) {
        return jsonResponse({ spaces: [{ id: '10', name: 'Engineering' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const connector = clickupConnector(fetch, async (ms) => {
      sleeps.push(ms);
    });
    expect(await connector.listScopes(CONNECTION)).toEqual([{ key: '10', name: 'Engineering' }]);
    expect(sleeps).toEqual([2000, 2000]); // two waits, Retry-After honored
  });

  it('gives up after bounded 429 retries with a sanitized fetch-error', async () => {
    const sleeps: number[] = [];
    const { fetch } = recordingFetch(() =>
      jsonResponse({ err: 'rate limit' }, 429, { 'retry-after': '999' }),
    );
    const connector = clickupConnector(fetch, async (ms) => {
      sleeps.push(ms);
    });
    await expect(connector.listScopes(CONNECTION)).rejects.toMatchObject({
      errorClass: 'fetch-error',
      status: 429,
    });
    // Bounded: 3 retries max, Retry-After capped to 60s.
    expect(sleeps).toEqual([60000, 60000, 60000]);
  });

  it('maps 401 to a sanitized auth-error that never leaks the token', async () => {
    const { fetch } = recordingFetch(() => jsonResponse({}, 401));
    const connector = clickupConnector(fetch);
    try {
      await connector.listScopes(CONNECTION);
      throw new Error('should have thrown');
    } catch (error) {
      const e = error as { errorClass: string; status?: number; message: string };
      expect(e.errorClass).toBe('auth-error');
      expect(e.status).toBe(401);
      expect(e.message).not.toContain(CONNECTION.secret);
      expect(e.message).not.toContain('clickup.com');
    }
  });

  it('rejects credentials shorter than a plausible token', () => {
    const connector = clickupConnector();
    const parsed = connector.parseCredentials({ token: 'x' });
    expect(parsed.ok).toBe(false);
    const good = connector.parseCredentials({ token: '  pk_12345678  ' });
    expect(good).toEqual({
      ok: true,
      connection: { display: {}, secret: 'pk_12345678' },
    });
  });

  it('an unreadable task page is a sanitized fetch-error, not a crash', async () => {
    const { fetch } = recordingFetch((url) => {
      if (url.includes('/folder')) return jsonResponse({ folders: [] });
      if (url.includes('/space/10/list'))
        return jsonResponse({ lists: [{ id: '901', name: 'L' }] });
      return new Response('<html>gateway error</html>', { status: 200 });
    });
    const connector = clickupConnector(fetch);
    await expect(connector.fetchAll(CONNECTION, '10')).rejects.toMatchObject({
      errorClass: 'fetch-error',
      stage: 'tasks',
    });
  });
});
