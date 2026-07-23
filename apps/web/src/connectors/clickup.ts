import type { ImportBatch } from '@costflow/domain';
import {
  CLICKUP_DESCRIPTOR,
  clickupFolderlessListsUrl,
  clickupFoldersUrl,
  clickupListsFrom,
  clickupSpacesFrom,
  clickupSpacesUrl,
  clickupTasksPageIsLast,
  clickupTasksUrl,
  clickupTeamsFrom,
  clickupTeamsUrl,
  countClickUpTasks,
  observeClickUpTaskPages,
  transformClickUp,
} from '@costflow/ingestion';
import {
  GatewayError,
  type Connection,
  type ScopeRef,
  type TransformArgs,
  type WebConnector,
} from './contract';

/**
 * ClickUp web connector (doc 18 §5): personal API token auth, one Space as
 * the import scope, raw REST v2 documents fetched verbatim for the pure
 * transform (CU1–CU8). Read-only (GET) by construction; errors sanitized to
 * class + stage + status.
 *
 * ClickUp rate-limits at ~100 requests/minute per token; a Space with many
 * lists can brush that ceiling, so a 429 is retried a bounded number of times
 * honoring Retry-After (capped) instead of failing the whole import. The
 * sleep is injectable so tests never wait.
 */

export interface ClickUpFetchPayload {
  readonly taskPagesByList: Readonly<Record<string, readonly string[]>>;
}

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 60;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function clickupConnector(
  fetchFn: typeof fetch = fetch,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
): WebConnector {
  async function getJson(connection: Connection, url: string, stage: string): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchFn(url, {
          // Personal API tokens are sent bare (no Bearer prefix).
          headers: { Authorization: connection.secret, Accept: 'application/json' },
        });
      } catch {
        // Never echo the underlying error — it can embed the request.
        throw new GatewayError('fetch-error', stage, `Could not reach ClickUp (${stage}).`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(
          'auth-error',
          stage,
          `ClickUp rejected the credentials at ${stage} (HTTP ${response.status}).`,
          response.status,
        );
      }
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '1');
        const seconds = Number.isFinite(retryAfter)
          ? Math.min(Math.max(retryAfter, 1), MAX_RETRY_AFTER_SECONDS)
          : 1;
        await sleepFn(seconds * 1000);
        continue;
      }
      if (!response.ok) {
        throw new GatewayError(
          'fetch-error',
          stage,
          `ClickUp request failed at ${stage} (HTTP ${response.status}).`,
          response.status,
        );
      }
      return response.text();
    }
  }

  return {
    descriptor: CLICKUP_DESCRIPTOR,
    scopeNoun: { singular: 'Space', plural: 'Spaces' },
    pickerHint: 'ClickUp — tasks, statuses, due dates, assignees across a Space.',
    credentialFields: [
      {
        name: 'token',
        label: 'Personal API token',
        type: 'password',
        placeholder: 'paste your ClickUp personal token (pk_…)',
        attributes: 'autocomplete="off"',
      },
    ],
    connectionHelpHtml: `<summary>How to get your ClickUp personal token (~60 seconds)</summary>
           <ol class="note">
             <li>In ClickUp, open your avatar → <strong>Settings</strong> → <strong>Apps</strong>.</li>
             <li>Under <strong>API Token</strong>, click <strong>Generate</strong> (or copy the existing token — it starts with <code>pk_</code>).</li>
             <li>Paste it above. CostFlow only ever reads your workspace.</li>
           </ol>`,

    parseCredentials(body) {
      const token = (body['token'] ?? '').trim();
      if (token.length < 8) {
        return {
          ok: false,
          error:
            'A ClickUp personal API token is required — copy it from ClickUp → Settings → Apps.',
        };
      }
      return { ok: true, connection: { display: {}, secret: token } };
    },

    connectionFrom(workspace, secret) {
      return { display: workspace.connection, secret };
    },

    summaryText() {
      return 'ClickUp · connected with a personal API token';
    },

    async listScopes(connection): Promise<ScopeRef[]> {
      const teamsText = await getJson(connection, clickupTeamsUrl(), 'list-teams');
      const teams = clickupTeamsFrom(teamsText);
      if (teams.length === 0) {
        throw new GatewayError(
          'fetch-error',
          'list-teams',
          'This token can see no ClickUp Workspaces.',
        );
      }
      const scopes: ScopeRef[] = [];
      for (const team of teams) {
        const spacesText = await getJson(connection, clickupSpacesUrl(team.id), 'list-spaces');
        for (const space of clickupSpacesFrom(spacesText)) {
          scopes.push({
            key: space.id,
            name: teams.length > 1 ? `${team.name} / ${space.name}` : space.name,
          });
        }
      }
      return scopes;
    },

    async fetchAll(connection, scopeKey): Promise<ClickUpFetchPayload> {
      const foldersText = await getJson(connection, clickupFoldersUrl(scopeKey), 'list-folders');
      const folderlessText = await getJson(
        connection,
        clickupFolderlessListsUrl(scopeKey),
        'list-lists',
      );
      const lists = clickupListsFrom(foldersText, folderlessText);
      const taskPagesByList: Record<string, string[]> = {};
      for (const list of lists) {
        const pages: string[] = [];
        for (let page = 0; ; page += 1) {
          const text = await getJson(connection, clickupTasksUrl(list.id, page), 'tasks');
          pages.push(text);
          let isLast: boolean | null;
          try {
            isLast = clickupTasksPageIsLast(text);
          } catch {
            throw new GatewayError(
              'fetch-error',
              'tasks',
              'ClickUp returned an unreadable task page.',
            );
          }
          // A page that does not declare continuation is terminal: the pure
          // transform (CU2) re-verifies completeness from the raw documents.
          if (isLast !== false) break;
        }
        taskPagesByList[list.id] = pages;
      }
      return { taskPagesByList };
    },

    countItems(payload) {
      return countClickUpTasks((payload as ClickUpFetchPayload).taskPagesByList);
    },

    observe(payload) {
      return observeClickUpTaskPages((payload as ClickUpFetchPayload).taskPagesByList);
    },

    transform(payload, args: TransformArgs): ImportBatch {
      return transformClickUp({
        batchId: args.batchId,
        taskPagesByList: (payload as ClickUpFetchPayload).taskPagesByList,
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
