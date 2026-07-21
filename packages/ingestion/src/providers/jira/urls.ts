/**
 * Pure Jira Cloud request-shape knowledge (doc 15 P4.1): URL builders and
 * raw-page inspection helpers shared by every effectful edge (CLI fetcher,
 * web gateway). No I/O, no node builtins — the HTTP itself stays at edges.
 */

const FIELDS = 'summary,status,assignee,created,updated,duedate';

/**
 * Enhanced JQL search (`/rest/api/3/search/jql`). The legacy
 * `GET /rest/api/3/search` was deprecated and removed on current Jira Cloud
 * (returns 4xx/410), which is what made project import fail after the project
 * list — served by a different, still-live endpoint — succeeded (P4.2 defect
 * 2). This endpoint paginates by an opaque `nextPageToken` cursor, not
 * `startAt`, and returns `{ issues, nextPageToken?, isLast? }`. `fields` must
 * be requested explicitly (it returns only id/key otherwise); `expand`
 * carries the changelog for transition history.
 */
export function jiraSearchUrl(
  site: string,
  projectKey: string,
  pageToken: string | undefined,
  pageSize: number,
): string {
  const jql = encodeURIComponent(`project = "${projectKey}" ORDER BY created ASC`);
  const base = `${site.replace(/\/$/, '')}/rest/api/3/search/jql?jql=${jql}&fields=${FIELDS}&expand=changelog&maxResults=${pageSize}`;
  return pageToken ? `${base}&nextPageToken=${encodeURIComponent(pageToken)}` : base;
}

/** Pure: the cursor for the next search page, or null when the page is last. */
export function jiraSearchNextPageToken(searchPageText: string): string | null {
  const doc = JSON.parse(searchPageText) as { nextPageToken?: string; isLast?: boolean };
  if (doc.isLast === true) return null;
  return doc.nextPageToken ?? null;
}

export function jiraChangelogUrl(
  site: string,
  issueKey: string,
  startAt: number,
  pageSize: number,
): string {
  return `${site.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?maxResults=${pageSize}&startAt=${startAt}`;
}

/** Project discovery for workspace-scope selection (read-only). */
export function jiraProjectsUrl(site: string, startAt: number, pageSize: number): string {
  return `${site.replace(/\/$/, '')}/rest/api/3/project/search?maxResults=${pageSize}&startAt=${startAt}`;
}

/** Pure: which issues on a page need changelog top-ups (J2 input). */
export function issuesNeedingChangelogTopUp(searchPageText: string): string[] {
  const doc = JSON.parse(searchPageText) as {
    issues?: { key?: string; changelog?: { total?: number; histories?: unknown[] } }[];
  };
  return (doc.issues ?? [])
    .filter((issue) => (issue.changelog?.total ?? 0) > (issue.changelog?.histories?.length ?? 0))
    .map((issue) => issue.key ?? '')
    .filter((key) => key !== '');
}

/**
 * Observed vocabulary for the mapping UI: every status name a run could
 * encounter (current statuses + both sides of every changelog transition —
 * the D-13/J3 rules make an unmapped TRANSITION status a hard error, so the
 * mapping form must present all of them) and every assignee display name.
 */
export function observeJiraSearchPages(searchPages: readonly string[]): {
  statuses: string[];
  actors: string[];
} {
  const statuses = new Set<string>();
  const actors = new Set<string>();
  for (const page of searchPages) {
    const doc = JSON.parse(page) as {
      issues?: {
        fields?: {
          status?: { name?: string | null } | null;
          assignee?: { displayName?: string | null } | null;
        };
        changelog?: {
          histories?: {
            items?: { field?: string; fromString?: string | null; toString?: string | null }[];
          }[];
        };
      }[];
    };
    for (const issue of doc.issues ?? []) {
      const current = (issue.fields?.status?.name ?? '').trim();
      if (current !== '') statuses.add(current);
      const assignee = (issue.fields?.assignee?.displayName ?? '').trim();
      if (assignee !== '') actors.add(assignee);
      for (const history of issue.changelog?.histories ?? []) {
        for (const item of history.items ?? []) {
          if (item.field !== 'status') continue;
          const from = (item.fromString ?? '').trim();
          const to = (item.toString ?? '').trim();
          if (from !== '') statuses.add(from);
          if (to !== '') statuses.add(to);
        }
      }
    }
  }
  return { statuses: [...statuses].sort(), actors: [...actors].sort() };
}
