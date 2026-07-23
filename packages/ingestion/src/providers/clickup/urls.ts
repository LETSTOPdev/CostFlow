/**
 * Pure ClickUp REST v2 request-shape knowledge (ADR-0005): URL builders and
 * raw-page inspection helpers shared by every effectful edge (CLI fetcher,
 * web gateway). No I/O, no node builtins — the HTTP itself stays at edges.
 * Confirmed against the official OpenAPI spec: tasks page by `page` (fixed
 * 100/page, `last_page` terminal signal); bulk time-in-status takes 2–100
 * `task_ids` repeated params.
 */

const API = 'https://api.clickup.com/api/v2';
export const CLICKUP_PAGE_SIZE = 100;
const BULK_LIMIT = 100;

export function clickupTeamsUrl(): string {
  return `${API}/team`;
}

export function clickupSpacesUrl(teamId: string): string {
  return `${API}/team/${encodeURIComponent(teamId)}/space?archived=false`;
}

export function clickupFoldersUrl(spaceId: string): string {
  return `${API}/space/${encodeURIComponent(spaceId)}/folder?archived=false`;
}

export function clickupFolderlessListsUrl(spaceId: string): string {
  return `${API}/space/${encodeURIComponent(spaceId)}/list?archived=false`;
}

/** Subtasks are work items too; closed tasks are needed for terminal-stage flow analysis. */
export function clickupTasksUrl(listId: string, page: number): string {
  return `${API}/list/${encodeURIComponent(listId)}/task?page=${page}&subtasks=true&include_closed=true`;
}

export function clickupBulkTimeInStatusUrl(taskIds: readonly string[]): string {
  const query = taskIds.map((id) => `task_ids=${encodeURIComponent(id)}`).join('&');
  return `${API}/task/bulk_time_in_status/task_ids?${query}`;
}

export function clickupTimeInStatusUrl(taskId: string): string {
  return `${API}/task/${encodeURIComponent(taskId)}/time_in_status`;
}

/** Pure: task ids on a raw page + whether it is the last page. */
export function clickupPageInfo(pageText: string): { taskIds: string[]; lastPage: boolean } {
  const doc = JSON.parse(pageText) as { tasks?: { id?: string }[]; last_page?: boolean };
  const tasks = doc.tasks ?? [];
  return {
    taskIds: tasks.map((t) => t.id ?? '').filter((id) => id !== ''),
    lastPage: doc.last_page === true || tasks.length < CLICKUP_PAGE_SIZE,
  };
}

/**
 * Pure: bulk chunking with the 2-id minimum — the last chunk borrows one id
 * from its predecessor rather than going out as a singleton. Exactly one id
 * overall yields no chunks: callers use the single-task endpoint instead.
 */
export function clickupBulkChunks(taskIds: readonly string[]): string[][] {
  const unique = [...new Set(taskIds)];
  if (unique.length < 2) return [];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += BULK_LIMIT) {
    chunks.push(unique.slice(start, start + BULK_LIMIT));
  }
  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (last && previous && last.length === 1) {
    last.unshift(previous.pop() as string);
  }
  return chunks;
}
