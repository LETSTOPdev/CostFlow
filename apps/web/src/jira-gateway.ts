import {
  issuesNeedingChangelogTopUp,
  jiraChangelogUrl,
  jiraProjectsUrl,
  jiraSearchNextPageToken,
  jiraSearchUrl,
} from '@costflow/ingestion';

/**
 * Jira gateway (doc 09 P4.1 plan §3/§7): the web app's effectful Jira half.
 * Read-only (GET) by construction; raw response documents are returned
 * verbatim for the pure transform. Errors are sanitized to a class + status
 * — a token can never leak through an error message (plan §2).
 */

export interface JiraConnection {
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

export interface JiraProjectRef {
  readonly key: string;
  readonly name: string;
}

export interface JiraFetchResult {
  readonly searchPages: string[];
  readonly supplementaryChangelogs: Record<string, string[]>;
}

/**
 * Sanitized gateway failure (P4.2 defect 2 diagnostics). Carries the STAGE
 * that failed (`list-projects` | `search` | `changelog`) and, when the server
 * answered, the HTTP status — but never the URL, credentials, or any customer
 * data. This is what lets a live retest identify the failing stage/status
 * from a screenshot without leaking secrets.
 */
export type JiraStage = 'list-projects' | 'search' | 'changelog';

export class GatewayError extends Error {
  constructor(
    readonly errorClass: 'auth-error' | 'fetch-error',
    readonly stage: JiraStage,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface JiraGateway {
  listProjects(connection: JiraConnection): Promise<JiraProjectRef[]>;
  fetchAll(connection: JiraConnection, projectKey: string): Promise<JiraFetchResult>;
}

const PAGE_SIZE = 100;

export class HttpJiraGateway implements JiraGateway {
  constructor(private fetchFn: typeof fetch = fetch) {}

  private async getJson(
    connection: JiraConnection,
    url: string,
    stage: JiraStage,
  ): Promise<string> {
    const authHeader = `Basic ${Buffer.from(`${connection.email}:${connection.token}`).toString('base64')}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
    } catch {
      // Never echo the underlying error — it can embed the request (plan §2).
      throw new GatewayError('fetch-error', stage, `Could not reach Jira (${stage}).`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new GatewayError(
        'auth-error',
        stage,
        `Jira rejected the credentials at ${stage} (HTTP ${response.status}).`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new GatewayError(
        'fetch-error',
        stage,
        `Jira request failed at ${stage} (HTTP ${response.status}).`,
        response.status,
      );
    }
    return response.text();
  }

  async listProjects(connection: JiraConnection): Promise<JiraProjectRef[]> {
    const projects: JiraProjectRef[] = [];
    let startAt = 0;
    for (;;) {
      const text = await this.getJson(
        connection,
        jiraProjectsUrl(connection.site, startAt, PAGE_SIZE),
        'list-projects',
      );
      const doc = JSON.parse(text) as {
        values?: { key?: string; name?: string }[];
        isLast?: boolean;
        total?: number;
      };
      const values = doc.values ?? [];
      for (const value of values) {
        if (value.key) projects.push({ key: value.key, name: value.name ?? value.key });
      }
      startAt += values.length;
      if (doc.isLast === true || values.length === 0 || startAt >= (doc.total ?? startAt)) break;
    }
    return projects;
  }

  async fetchAll(connection: JiraConnection, projectKey: string): Promise<JiraFetchResult> {
    const searchPages: string[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const text = await this.getJson(
        connection,
        jiraSearchUrl(connection.site, projectKey, pageToken, PAGE_SIZE),
        'search',
      );
      searchPages.push(text);
      const next = jiraSearchNextPageToken(text);
      if (next === null) break;
      pageToken = next;
    }

    const supplementaryChangelogs: Record<string, string[]> = {};
    const topUps = new Set<string>();
    for (const page of searchPages) {
      for (const key of issuesNeedingChangelogTopUp(page)) topUps.add(key);
    }
    for (const key of [...topUps].sort()) {
      let clStart = 0;
      for (;;) {
        const text = await this.getJson(
          connection,
          jiraChangelogUrl(connection.site, key, clStart, PAGE_SIZE),
          'changelog',
        );
        (supplementaryChangelogs[key] ??= []).push(text);
        const doc = JSON.parse(text) as { values?: unknown[]; total?: number; isLast?: boolean };
        clStart += doc.values?.length ?? 0;
        if (
          doc.isLast === true ||
          (doc.values?.length ?? 0) === 0 ||
          clStart >= (doc.total ?? clStart)
        )
          break;
      }
    }
    return { searchPages, supplementaryChangelogs };
  }
}
