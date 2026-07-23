import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clickupFolderlessListsUrl,
  clickupFoldersUrl,
  clickupListsFrom,
  clickupTasksPageIsLast,
  clickupTasksUrl,
} from '@costflow/ingestion';
import { CliError } from '../io';

/**
 * ClickUp fetcher (doc 18 §5) — the effectful half of the connector: REST v2
 * GETs over one Space (folders → lists → paginated task pages, subtasks and
 * closed tasks included per CU6/CU7). Raw responses land verbatim on disk;
 * URL builders and page inspectors are the pure helpers in
 * @costflow/ingestion, shared with the web connector.
 */

export interface ClickUpFetchConfig {
  readonly token: string;
  readonly spaceId: string;
}

async function getJson(url: string, token: string): Promise<string> {
  // Personal API tokens are sent bare (no Bearer prefix).
  const response = await fetch(url, {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new CliError(`ClickUp API request failed (${response.status} ${response.statusText}).`);
  }
  return response.text();
}

/**
 * Fetches everything into outDir/raw/: folders.json, folderless-lists.json,
 * and tasks-<listId>-page-<n>.json, plus manifest.json (provenance record).
 */
export async function fetchClickUp(config: ClickUpFetchConfig, outDir: string): Promise<void> {
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const foldersText = await getJson(clickupFoldersUrl(config.spaceId), config.token);
  writeFileSync(join(rawDir, 'folders.json'), foldersText);
  const folderlessText = await getJson(clickupFolderlessListsUrl(config.spaceId), config.token);
  writeFileSync(join(rawDir, 'folderless-lists.json'), folderlessText);

  const lists = clickupListsFrom(foldersText, folderlessText);
  let taskPageCount = 0;
  for (const list of lists) {
    for (let page = 0; ; page += 1) {
      const text = await getJson(clickupTasksUrl(list.id, page), config.token);
      writeFileSync(join(rawDir, `tasks-${list.id}-page-${page}.json`), text);
      taskPageCount += 1;
      // A page that does not declare continuation is terminal; the pure
      // transform (CU2) re-verifies completeness from the raw documents.
      if (clickupTasksPageIsLast(text) !== false) break;
    }
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        provider: 'clickup',
        spaceId: config.spaceId,
        lists: lists.length,
        taskPages: taskPageCount,
        fetchedAt: new Date(Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(`Fetched ${lists.length} list(s), ${taskPageCount} task page(s) → ${rawDir}`);
}
