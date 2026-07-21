import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../io';
import { issuesNeedingChangelogTopUp, jiraChangelogUrl, jiraSearchUrl } from '@costflow/ingestion';

// Re-exported for existing consumers/tests; the pure halves now live in the
// ingestion package so every effectful edge shares one request shape (P4.1).
export { issuesNeedingChangelogTopUp, jiraChangelogUrl, jiraSearchUrl };

export function jiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

/**
 * Jira Cloud fetcher (doc 15 P1) — the effectful half of the connector:
 * paginated /rest/api/3/search with embedded changelogs, plus per-issue
 * changelog top-ups whenever the embedded history is truncated (J2). Raw
 * responses land verbatim on disk; transformation is the pure half's job.
 * Read-only by construction (N5): GET requests only.
 */

export interface JiraFetchConfig {
  readonly site: string;
  readonly email: string;
  readonly token: string;
  readonly projectKey: string;
  readonly pageSize?: number;
}

async function getJson(url: string, authHeader: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new CliError(
      `Jira API request failed (${response.status} ${response.statusText}) for ${url.split('?')[0]}`,
    );
  }
  return response.text();
}

/**
 * Fetches everything into outDir/raw/: search-page-<n>.json and
 * changelog-<KEY>-<n>.json, plus manifest.json (provenance record).
 */
export async function fetchJira(config: JiraFetchConfig, outDir: string): Promise<void> {
  const pageSize = config.pageSize ?? 100;
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const authHeader = jiraAuthHeader(config.email, config.token);

  const searchPages: string[] = [];
  let startAt = 0;
  for (;;) {
    const text = await getJson(
      jiraSearchUrl(config.site, config.projectKey, startAt, pageSize),
      authHeader,
    );
    const pageIndex = searchPages.length;
    writeFileSync(join(rawDir, `search-page-${pageIndex}.json`), text);
    searchPages.push(text);
    const doc = JSON.parse(text) as { issues?: unknown[]; total?: number };
    const fetched = startAt + (doc.issues?.length ?? 0);
    if ((doc.issues?.length ?? 0) === 0 || fetched >= (doc.total ?? fetched)) break;
    startAt = fetched;
  }

  const topUps = new Set<string>();
  for (const page of searchPages) {
    for (const key of issuesNeedingChangelogTopUp(page)) topUps.add(key);
  }
  for (const key of [...topUps].sort()) {
    let clStart = 0;
    let pageIndex = 0;
    for (;;) {
      const text = await getJson(jiraChangelogUrl(config.site, key, clStart, pageSize), authHeader);
      writeFileSync(join(rawDir, `changelog-${key}-${pageIndex}.json`), text);
      const doc = JSON.parse(text) as { values?: unknown[]; total?: number; isLast?: boolean };
      clStart += doc.values?.length ?? 0;
      pageIndex += 1;
      if (
        doc.isLast === true ||
        (doc.values?.length ?? 0) === 0 ||
        clStart >= (doc.total ?? clStart)
      )
        break;
    }
  }

  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        provider: 'jira',
        site: config.site,
        projectKey: config.projectKey,
        searchPages: searchPages.length,
        changelogTopUps: [...topUps].sort(),
        fetchedAt: new Date(Date.now()).toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    `Fetched ${searchPages.length} search page(s), ${topUps.size} changelog top-up(s) → ${rawDir}`,
  );
}
