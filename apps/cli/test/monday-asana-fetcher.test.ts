import { describe, expect, it } from 'vitest';
import {
  mondayActivityPageIsEmpty,
  mondayActivityQuery,
  mondayItemsQuery,
  mondayNextCursor,
} from '../src/fetchers/monday';
import {
  asanaAuthHeader,
  asanaNextOffset,
  asanaSectionsUrl,
  asanaStoriesUrl,
  asanaTaskGids,
  asanaTasksUrl,
} from '../src/fetchers/asana';

describe('monday fetcher pure helpers (HTTP never exercised in tests)', () => {
  it('M5/N5: query documents are read-only — no mutation, ever', () => {
    for (const q of [
      mondayItemsQuery('4412', 100, null),
      mondayItemsQuery('4412', 100, 'cursor-abc'),
      mondayActivityQuery('4412', 100, 1),
    ]) {
      expect(q.query).not.toContain('mutation');
      expect(q.query.trimStart().startsWith('query')).toBe(true);
    }
  });

  it('first items page queries the board; continuations use next_items_page', () => {
    expect(mondayItemsQuery('4412', 100, null).query).toContain('items_page');
    const cont = mondayItemsQuery('4412', 100, 'cur');
    expect(cont.query).toContain('next_items_page');
    expect(cont.variables['cursor']).toBe('cur');
  });

  it('extracts the pagination cursor from either response shape', () => {
    expect(
      mondayNextCursor(
        JSON.stringify({ data: { boards: [{ items_page: { cursor: 'abc', items: [] } }] } }),
      ),
    ).toBe('abc');
    expect(
      mondayNextCursor(JSON.stringify({ data: { next_items_page: { cursor: null, items: [] } } })),
    ).toBeNull();
  });

  it('detects an empty activity page (pagination stop)', () => {
    expect(
      mondayActivityPageIsEmpty(JSON.stringify({ data: { boards: [{ activity_logs: [] }] } })),
    ).toBe(true);
    expect(
      mondayActivityPageIsEmpty(
        JSON.stringify({ data: { boards: [{ activity_logs: [{ id: '1' }] }] } }),
      ),
    ).toBe(false);
  });
});

describe('asana fetcher pure helpers (HTTP never exercised in tests)', () => {
  it('builds scoped, field-explicit URLs with offset pagination', () => {
    expect(asanaSectionsUrl('555', 100)).toBe(
      'https://app.asana.com/api/1.0/projects/555/sections?opt_fields=name&limit=100',
    );
    expect(asanaTasksUrl('555', 100)).toContain('/projects/555/tasks?opt_fields=');
    expect(asanaTasksUrl('555', 100, 'off1')).toContain('&offset=off1');
    expect(asanaStoriesUrl('9001', 100)).toContain('/tasks/9001/stories?opt_fields=');
    expect(asanaStoriesUrl('9001', 100)).toContain('old_section.name');
  });

  it('bearer auth header carries the token only in the header value', () => {
    expect(asanaAuthHeader('tok-123').startsWith('Bearer ')).toBe(true);
  });

  it('extracts pagination offsets and task gids from raw pages', () => {
    expect(asanaNextOffset(JSON.stringify({ next_page: { offset: 'o2' } }))).toBe('o2');
    expect(asanaNextOffset(JSON.stringify({ next_page: null }))).toBeUndefined();
    expect(asanaTaskGids(JSON.stringify({ data: [{ gid: '9001' }, { gid: '9002' }, {}] }))).toEqual(
      ['9001', '9002'],
    );
  });
});
