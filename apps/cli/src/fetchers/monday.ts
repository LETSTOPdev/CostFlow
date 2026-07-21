import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../io';

/**
 * monday.com fetcher (doc 15 P2) — the effectful half of the connector:
 * GraphQL items_page pagination (root next_items_page for continuations) plus
 * board activity_logs pages. Raw responses land verbatim on disk.
 *
 * N5 pressure point M5: monday's GraphQL API is POST-only even for reads, so
 * "GET requests only" was never the real read-only invariant. The invariant
 * is: the query documents below contain NO mutation — they are static
 * constants, and a test asserts it.
 */

export interface MondayFetchConfig {
  readonly token: string;
  readonly boardId: string;
  readonly pageSize?: number;
}

export const MONDAY_API_URL = 'https://api.monday.com/v2';

const ITEM_FIELDS = 'id name created_at updated_at column_values { id text }';

/** Pure: static query builders — read-only by construction (no mutation). */
export function mondayItemsQuery(
  boardId: string,
  pageSize: number,
  cursor: string | null,
): { query: string; variables: Record<string, unknown> } {
  if (cursor === null) {
    return {
      query: `query ($boardId: [ID!], $limit: Int) { boards(ids: $boardId) { items_page(limit: $limit) { cursor items { ${ITEM_FIELDS} } } } }`,
      variables: { boardId: [boardId], limit: pageSize },
    };
  }
  return {
    query: `query ($cursor: String!, $limit: Int) { next_items_page(cursor: $cursor, limit: $limit) { cursor items { ${ITEM_FIELDS} } } }`,
    variables: { cursor, limit: pageSize },
  };
}

export function mondayActivityQuery(
  boardId: string,
  pageSize: number,
  page: number,
): { query: string; variables: Record<string, unknown> } {
  return {
    query: `query ($boardId: [ID!], $limit: Int, $page: Int) { boards(ids: $boardId) { activity_logs(limit: $limit, page: $page) { id event data created_at } } }`,
    variables: { boardId: [boardId], limit: pageSize, page },
  };
}

/** Pure: cursor extraction from a raw items page (either query shape). */
export function mondayNextCursor(pageText: string): string | null {
  const doc = JSON.parse(pageText) as {
    data?: {
      boards?: { items_page?: { cursor?: string | null } }[];
      next_items_page?: { cursor?: string | null };
    };
  };
  const fromBoards = doc.data?.boards?.[0]?.items_page?.cursor;
  const fromNext = doc.data?.next_items_page?.cursor;
  return fromBoards ?? fromNext ?? null;
}

/** Pure: whether an activity page carries any entries (pagination stop test). */
export function mondayActivityPageIsEmpty(pageText: string): boolean {
  const doc = JSON.parse(pageText) as {
    data?: { boards?: { activity_logs?: unknown[] }[] };
  };
  return (doc.data?.boards ?? []).every((b) => (b.activity_logs ?? []).length === 0);
}

async function postQuery(
  body: { query: string; variables: Record<string, unknown> },
  token: string,
): Promise<string> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new CliError(`monday API request failed (${response.status} ${response.statusText}).`);
  }
  const text = await response.text();
  const doc = JSON.parse(text) as { errors?: { message?: string }[] };
  if (doc.errors && doc.errors.length > 0) {
    throw new CliError(`monday API returned errors: ${doc.errors[0]?.message ?? 'unknown'}`);
  }
  return text;
}

/**
 * Fetches everything into outDir/raw/: items-page-<n>.json and
 * activity-page-<n>.json, plus manifest.json (provenance record).
 */
export async function fetchMonday(config: MondayFetchConfig, outDir: string): Promise<void> {
  const pageSize = config.pageSize ?? 100;
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  let itemsPageCount = 0;
  let cursor: string | null = null;
  for (;;) {
    const text = await postQuery(mondayItemsQuery(config.boardId, pageSize, cursor), config.token);
    writeFileSync(join(rawDir, `items-page-${itemsPageCount}.json`), text);
    itemsPageCount += 1;
    cursor = mondayNextCursor(text);
    if (cursor === null) break;
  }

  let activityPageCount = 0;
  for (let page = 1; ; page += 1) {
    const text = await postQuery(mondayActivityQuery(config.boardId, pageSize, page), config.token);
    if (mondayActivityPageIsEmpty(text)) break;
    writeFileSync(join(rawDir, `activity-page-${activityPageCount}.json`), text);
    activityPageCount += 1;
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        provider: 'monday',
        boardId: config.boardId,
        itemsPages: itemsPageCount,
        activityPages: activityPageCount,
        fetchedAt: new Date(Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    `Fetched ${itemsPageCount} items page(s), ${activityPageCount} activity page(s) → ${rawDir}`,
  );
}
