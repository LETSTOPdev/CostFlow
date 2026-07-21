import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../io';

/**
 * Asana fetcher (doc 15 P2) — the effectful half of the connector: project
 * sections + offset-paginated task pages + per-task stories pages, all to
 * exhaustion (A5: the transform hard-errors on any unconsumed next_page).
 * Read-only by construction (N5): GET requests only.
 */

export interface AsanaFetchConfig {
  readonly token: string;
  readonly projectGid: string;
  readonly pageSize?: number;
}

const API = 'https://app.asana.com/api/1.0';
const TASK_FIELDS =
  'name,created_at,modified_at,due_on,completed,completed_at,assignee.name,' +
  'memberships.project.gid,memberships.section.gid,memberships.section.name';
const STORY_FIELDS =
  'created_at,resource_subtype,old_section.gid,old_section.name,new_section.gid,new_section.name';

/** Pure: URL builders are unit-testable without HTTP. */
export function asanaSectionsUrl(projectGid: string, pageSize: number): string {
  return `${API}/projects/${encodeURIComponent(projectGid)}/sections?opt_fields=name&limit=${pageSize}`;
}

export function asanaTasksUrl(projectGid: string, pageSize: number, offset?: string): string {
  const base = `${API}/projects/${encodeURIComponent(projectGid)}/tasks?opt_fields=${TASK_FIELDS}&limit=${pageSize}`;
  return offset === undefined ? base : `${base}&offset=${encodeURIComponent(offset)}`;
}

export function asanaStoriesUrl(taskGid: string, pageSize: number, offset?: string): string {
  const base = `${API}/tasks/${encodeURIComponent(taskGid)}/stories?opt_fields=${STORY_FIELDS}&limit=${pageSize}`;
  return offset === undefined ? base : `${base}&offset=${encodeURIComponent(offset)}`;
}

export function asanaAuthHeader(token: string): string {
  return `Bearer ${token}`;
}

/** Pure: pagination offset extraction from a raw page. */
export function asanaNextOffset(pageText: string): string | undefined {
  const doc = JSON.parse(pageText) as { next_page?: { offset?: string } | null };
  return doc.next_page?.offset;
}

/** Pure: task gids on a raw task page (stories fan-out). */
export function asanaTaskGids(pageText: string): string[] {
  const doc = JSON.parse(pageText) as { data?: { gid?: string }[] };
  return (doc.data ?? []).map((t) => t.gid ?? '').filter((gid) => gid !== '');
}

async function getJson(url: string, authHeader: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new CliError(
      `Asana API request failed (${response.status} ${response.statusText}) for ${url.split('?')[0]}`,
    );
  }
  return response.text();
}

/**
 * Fetches everything into outDir/raw/: sections.json, tasks-page-<n>.json,
 * stories-<gid>-<n>.json, plus manifest.json (provenance record).
 */
export async function fetchAsana(config: AsanaFetchConfig, outDir: string): Promise<void> {
  const pageSize = config.pageSize ?? 100;
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const authHeader = asanaAuthHeader(config.token);

  const sectionsText = await getJson(asanaSectionsUrl(config.projectGid, pageSize), authHeader);
  if (asanaNextOffset(sectionsText) !== undefined) {
    throw new CliError(
      `Project ${config.projectGid} has more than ${pageSize} sections — not supported yet.`,
    );
  }
  writeFileSync(join(rawDir, 'sections.json'), sectionsText);

  const taskGids: string[] = [];
  let taskPageCount = 0;
  let offset: string | undefined;
  for (;;) {
    const text = await getJson(asanaTasksUrl(config.projectGid, pageSize, offset), authHeader);
    writeFileSync(join(rawDir, `tasks-page-${taskPageCount}.json`), text);
    taskPageCount += 1;
    taskGids.push(...asanaTaskGids(text));
    offset = asanaNextOffset(text);
    if (offset === undefined) break;
  }

  for (const gid of taskGids) {
    let storyOffset: string | undefined;
    let pageIndex = 0;
    for (;;) {
      const text = await getJson(asanaStoriesUrl(gid, pageSize, storyOffset), authHeader);
      writeFileSync(join(rawDir, `stories-${gid}-${pageIndex}.json`), text);
      pageIndex += 1;
      storyOffset = asanaNextOffset(text);
      if (storyOffset === undefined) break;
    }
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        provider: 'asana',
        projectGid: config.projectGid,
        taskPages: taskPageCount,
        tasks: taskGids.length,
        fetchedAt: new Date(Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    `Fetched ${taskPageCount} task page(s), stories for ${taskGids.length} task(s) → ${rawDir}`,
  );
}
