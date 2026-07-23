import type { ImportBatch } from '@costflow/domain';
import {
  JIRA_DESCRIPTOR,
  issuesNeedingChangelogTopUp,
  jiraChangelogUrl,
  jiraProjectsUrl,
  jiraSearchNextPageToken,
  jiraSearchUrl,
  observeJiraSearchPages,
  transformJira,
} from '@costflow/ingestion';
import type { WorkspaceRecord } from '../store/contract';
import {
  GatewayError,
  type Connection,
  type ScopeRef,
  type TransformArgs,
  type WebConnector,
} from './contract';

/**
 * Jira Cloud web connector (doc 18 §4.1): the P4.1 HttpJiraGateway logic,
 * unchanged, behind the uniform connector SPI. Read-only (GET) by
 * construction; raw response documents are returned verbatim for the pure
 * transform; errors are sanitized to class + stage + status — a token can
 * never leak through an error message.
 */

const PAGE_SIZE = 100;

export interface JiraFetchPayload {
  readonly searchPages: string[];
  readonly supplementaryChangelogs: Record<string, string[]>;
}

async function getJson(
  fetchFn: typeof fetch,
  connection: Connection,
  url: string,
  stage: 'list-projects' | 'search' | 'changelog',
): Promise<string> {
  const email = connection.display['email'] ?? '';
  const authHeader = `Basic ${Buffer.from(`${email}:${connection.secret}`).toString('base64')}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
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

export function jiraConnector(fetchFn: typeof fetch = fetch): WebConnector {
  const site = (connection: Connection): string => connection.display['site'] ?? '';

  return {
    descriptor: JIRA_DESCRIPTOR,
    scopeNoun: { singular: 'project', plural: 'projects' },
    pickerHint: 'Jira Cloud — issues, status history, due dates, assignees.',
    credentialFields: [
      {
        name: 'site',
        label: 'Jira site URL',
        type: 'text',
        placeholder: 'https://your-org.atlassian.net',
        attributes: 'autocomplete="url" inputmode="url"',
      },
      {
        name: 'email',
        label: 'Account email',
        type: 'email',
        placeholder: 'you@company.com',
        attributes: 'autocomplete="email"',
      },
      {
        name: 'token',
        label: 'API token',
        type: 'password',
        placeholder: 'paste your Atlassian API token',
        attributes: 'autocomplete="off"',
      },
    ],
    connectionHelpHtml: `<summary>How to get your Jira API token (~60 seconds)</summary>
           <ol class="note">
             <li>Open <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → API tokens</a>.</li>
             <li>Click <strong>Create API token</strong>, name it "CostFlow", and copy it.</li>
             <li>Paste it above along with your Jira site URL and the email for that Atlassian account.</li>
           </ol>`,

    parseCredentials(body) {
      const siteValue = (body['site'] ?? '').trim().replace(/\/$/, '');
      const email = (body['email'] ?? '').trim();
      const token = (body['token'] ?? '').trim();
      if (!/^https:\/\/[^\s]+$/.test(siteValue) || !email || !token) {
        return {
          ok: false,
          error:
            'All three fields are required, and the site must be an https:// URL — for example <code>https://your-org.atlassian.net</code>.',
        };
      }
      return { ok: true, connection: { display: { site: siteValue, email }, secret: token } };
    },

    connectionFrom(workspace, secret) {
      return { display: workspace.connection, secret };
    },

    summaryText(workspace: WorkspaceRecord) {
      return `Jira site ${workspace.connection['site'] ?? ''} · connected as ${workspace.connection['email'] ?? ''}`;
    },

    async listScopes(connection): Promise<ScopeRef[]> {
      const projects: ScopeRef[] = [];
      let startAt = 0;
      for (;;) {
        const text = await getJson(
          fetchFn,
          connection,
          jiraProjectsUrl(site(connection), startAt, PAGE_SIZE),
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
    },

    async fetchAll(connection, scopeKey): Promise<JiraFetchPayload> {
      const searchPages: string[] = [];
      let pageToken: string | undefined;
      for (;;) {
        const text = await getJson(
          fetchFn,
          connection,
          jiraSearchUrl(site(connection), scopeKey, pageToken, PAGE_SIZE),
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
          const text = await getJson(
            fetchFn,
            connection,
            jiraChangelogUrl(site(connection), key, clStart, PAGE_SIZE),
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
    },

    countItems(payload) {
      // `total` is authoritative from Jira's first page; fall back to counting
      // embedded issues if absent (the P4 reliability-guard logic, verbatim).
      const { searchPages } = payload as JiraFetchPayload;
      try {
        const first = JSON.parse(searchPages[0] ?? '{}') as {
          total?: number;
          issues?: unknown[];
        };
        if (typeof first.total === 'number') return first.total;
      } catch {
        /* fall through to counting */
      }
      return searchPages.reduce((acc, p) => {
        try {
          return acc + ((JSON.parse(p) as { issues?: unknown[] }).issues?.length ?? 0);
        } catch {
          return acc;
        }
      }, 0);
    },

    observe(payload) {
      return observeJiraSearchPages((payload as JiraFetchPayload).searchPages);
    },

    transform(payload, args: TransformArgs): ImportBatch {
      const { searchPages, supplementaryChangelogs } = payload as JiraFetchPayload;
      return transformJira({
        batchId: args.batchId,
        searchPages,
        supplementaryChangelogs,
        mapping: {
          id: args.mappingId,
          version: args.mappingVersion,
          statusMap: args.statusMap,
          ...(args.actorRoleMap ? { actorRoleMap: args.actorRoleMap } : {}),
        },
        importedAt: args.importedAt,
        pseudonymization: args.pseudonymization,
      });
    },
  };
}
