import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clickupBulkChunks,
  clickupBulkTimeInStatusUrl,
  clickupPageInfo,
  clickupTasksUrl,
  clickupTimeInStatusUrl,
} from '@costflow/ingestion';
import { CliError } from '../io';

/**
 * ClickUp fetcher (ADR-0005) — the effectful half of the connector: task
 * pages for one List (100/page until `last_page`) plus Total-Time-in-Status
 * residency via the bulk endpoint (2–100 ids per call; a lone task uses the
 * single-task endpoint). URL shapes and chunking live in the pure ingestion
 * helpers, shared with the web gateway. Read-only by construction (N5): GET
 * requests only. Personal tokens go in the Authorization header RAW (no
 * "Bearer").
 */

export interface ClickUpFetchConfig {
  readonly token: string;
  /** The List id (the import scope). */
  readonly listId: string;
}

async function getJson(url: string, token: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new CliError(
      `ClickUp API request failed (${response.status} ${response.statusText}) for ${url.split('?')[0]}`,
    );
  }
  return response.text();
}

/**
 * Fetches everything into outDir/raw/: tasks-page-<n>.json,
 * time-in-status-<n>.json (bulk pages) or time-in-status-single-<id>.json,
 * plus manifest.json (provenance record). Residency fetch failures are
 * survivable — the Time-in-Status ClickApp is plan-gated (cu01 MC-5) and the
 * transform derives arrival-only events (CU2) — but are reported, never
 * silent.
 */
export async function fetchClickUp(config: ClickUpFetchConfig, outDir: string): Promise<void> {
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const taskIds: string[] = [];
  let pageCount = 0;
  for (;;) {
    const text = await getJson(clickupTasksUrl(config.listId, pageCount), config.token);
    writeFileSync(join(rawDir, `tasks-page-${pageCount}.json`), text);
    pageCount += 1;
    const info = clickupPageInfo(text);
    taskIds.push(...info.taskIds);
    if (info.lastPage) break;
  }

  let residencyPages = 0;
  let residencyFailed = false;
  try {
    const unique = [...new Set(taskIds)];
    if (unique.length === 1) {
      const id = unique[0] as string;
      const text = await getJson(clickupTimeInStatusUrl(id), config.token);
      writeFileSync(join(rawDir, `time-in-status-single-${id}.json`), text);
      residencyPages = 1;
    } else {
      for (const chunk of clickupBulkChunks(unique)) {
        const text = await getJson(clickupBulkTimeInStatusUrl(chunk), config.token);
        writeFileSync(join(rawDir, `time-in-status-${residencyPages}.json`), text);
        residencyPages += 1;
      }
    }
  } catch {
    // Plan-gated ClickApp: analysis proceeds on arrival-only derivation
    // (CU2). Reported below, never silent.
    residencyFailed = true;
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        provider: 'clickup',
        listId: config.listId,
        taskPages: pageCount,
        tasks: taskIds.length,
        timeInStatusPages: residencyPages,
        timeInStatusUnavailable: residencyFailed,
        fetchedAt: new Date(Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    `Fetched ${pageCount} task page(s) (${taskIds.length} task(s)), ` +
      (residencyFailed
        ? 'time-in-status UNAVAILABLE (enable the Total Time in Status ClickApp for history) '
        : `${residencyPages} time-in-status page(s) `) +
      `→ ${rawDir}`,
  );
}
