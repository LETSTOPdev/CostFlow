/**
 * ClickUp REST v2 URL builders and raw-document inspectors (doc 18 §5).
 * Pure — shared by both effectful edges (CLI fetcher and web connector), the
 * same P4.1 pattern as providers/jira/urls.ts. Raw response documents are
 * always inspected as verbatim strings; nothing here derives analysis data.
 */

export const CLICKUP_API_URL = 'https://api.clickup.com/api/v2';

export function clickupTeamsUrl(): string {
  return `${CLICKUP_API_URL}/team`;
}

export function clickupSpacesUrl(teamId: string): string {
  return `${CLICKUP_API_URL}/team/${encodeURIComponent(teamId)}/space?archived=false`;
}

export function clickupFoldersUrl(spaceId: string): string {
  return `${CLICKUP_API_URL}/space/${encodeURIComponent(spaceId)}/folder?archived=false`;
}

export function clickupFolderlessListsUrl(spaceId: string): string {
  return `${CLICKUP_API_URL}/space/${encodeURIComponent(spaceId)}/list?archived=false`;
}

/**
 * Task pages for one list. Subtasks are first-class work items (CU6) and
 * closed tasks are imported as terminal stages (CU7), so both are always
 * requested — the transform decides what the canonical model consumes.
 */
export function clickupTasksUrl(listId: string, page: number): string {
  return (
    `${CLICKUP_API_URL}/list/${encodeURIComponent(listId)}/task` +
    `?archived=false&subtasks=true&include_closed=true&page=${page}`
  );
}

interface ClickUpTeamsDoc {
  readonly teams?: readonly { readonly id?: string | number; readonly name?: string }[];
}
interface ClickUpSpacesDoc {
  readonly spaces?: readonly { readonly id?: string | number; readonly name?: string }[];
}
interface ClickUpListRef {
  readonly id?: string | number;
  readonly name?: string;
}
interface ClickUpFoldersDoc {
  readonly folders?: readonly {
    readonly name?: string;
    readonly lists?: readonly ClickUpListRef[];
  }[];
}
interface ClickUpListsDoc {
  readonly lists?: readonly ClickUpListRef[];
}
interface ClickUpAssignee {
  readonly id?: string | number;
  readonly username?: string | null;
}
interface ClickUpTask {
  readonly id?: string | number;
  readonly status?: { readonly status?: string | null } | null;
  readonly assignees?: readonly ClickUpAssignee[];
}
interface ClickUpTasksDoc {
  readonly tasks?: readonly ClickUpTask[];
  readonly last_page?: boolean;
}

/** Pure parse of GET /team — workspaces visible to the token. */
export function clickupTeamsFrom(text: string): { id: string; name: string }[] {
  const doc = JSON.parse(text) as ClickUpTeamsDoc;
  return (doc.teams ?? [])
    .filter((t) => t.id !== undefined && t.id !== null)
    .map((t) => ({ id: String(t.id), name: t.name ?? String(t.id) }));
}

/** Pure parse of GET /team/{id}/space. */
export function clickupSpacesFrom(text: string): { id: string; name: string }[] {
  const doc = JSON.parse(text) as ClickUpSpacesDoc;
  return (doc.spaces ?? [])
    .filter((s) => s.id !== undefined && s.id !== null)
    .map((s) => ({ id: String(s.id), name: s.name ?? String(s.id) }));
}

/**
 * Pure parse of a Space's lists: every list inside its folders plus the
 * folderless lists, deduplicated by id, in document order.
 */
export function clickupListsFrom(
  foldersDocText: string,
  folderlessDocText: string,
): { id: string; name: string }[] {
  const folders = (JSON.parse(foldersDocText) as ClickUpFoldersDoc).folders ?? [];
  const folderless = (JSON.parse(folderlessDocText) as ClickUpListsDoc).lists ?? [];
  const lists: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  const push = (ref: ClickUpListRef, folderName?: string): void => {
    if (ref.id === undefined || ref.id === null) return;
    const id = String(ref.id);
    if (seen.has(id)) return;
    seen.add(id);
    const name = ref.name ?? id;
    lists.push({ id, name: folderName ? `${folderName} / ${name}` : name });
  };
  for (const folder of folders) for (const ref of folder.lists ?? []) push(ref, folder.name);
  for (const ref of folderless) push(ref);
  return lists;
}

/** Whether a raw task page declares itself final (`last_page`); null if absent. */
export function clickupTasksPageIsLast(pageText: string): boolean | null {
  const doc = JSON.parse(pageText) as ClickUpTasksDoc;
  return typeof doc.last_page === 'boolean' ? doc.last_page : null;
}

const tasksOf = (pageText: string): readonly ClickUpTask[] =>
  (JSON.parse(pageText) as ClickUpTasksDoc).tasks ?? [];

/**
 * Distinct task count across raw pages (a task in multiple lists counts once,
 * CU8) — the web edge's reliability-ceiling guard, before any transform.
 */
export function countClickUpTasks(
  taskPagesByList: Readonly<Record<string, readonly string[]>>,
): number {
  const seen = new Set<string>();
  for (const pages of Object.values(taskPagesByList)) {
    for (const page of pages) {
      for (const task of tasksOf(page)) {
        if (task.id !== undefined && task.id !== null) seen.add(String(task.id));
      }
    }
  }
  return seen.size;
}

/**
 * Observed mapping vocabulary from raw task pages: every current status, and
 * every assignee username — ALL assignees, not just the CU3 primary, so the
 * attribution guard's corpus covers every identity present in the raw data.
 */
export function observeClickUpTaskPages(
  taskPagesByList: Readonly<Record<string, readonly string[]>>,
): { statuses: string[]; actors: string[] } {
  const statuses = new Set<string>();
  const actors = new Set<string>();
  for (const pages of Object.values(taskPagesByList)) {
    for (const page of pages) {
      for (const task of tasksOf(page)) {
        const status = (task.status?.status ?? '').trim();
        if (status !== '') statuses.add(status);
        for (const assignee of task.assignees ?? []) {
          const username = (assignee.username ?? '').trim();
          if (username !== '') actors.add(username);
        }
      }
    }
  }
  return { statuses: [...statuses].sort(), actors: [...actors].sort() };
}
