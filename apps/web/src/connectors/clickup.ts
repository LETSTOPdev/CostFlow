import {
  clickupBulkChunks,
  clickupBulkTimeInStatusUrl,
  clickupFolderlessListsUrl,
  clickupFoldersUrl,
  clickupPageInfo,
  clickupSpacesUrl,
  clickupTasksUrl,
  clickupTeamsUrl,
  clickupTimeInStatusUrl,
  observeClickUpPages,
  transformClickUp,
} from '@costflow/ingestion';
import { guessStageKind } from './suggest';
import {
  GatewayError,
  type BuildBatchInput,
  type Connector,
  type ConnectorCredentials,
  type ConnectorDescriptor,
  type ConnectorGateway,
  type ObservedWorkspace,
  type RawFetch,
  type ScopeRef,
} from './types';
import type { ImportBatch, StageKind } from '@costflow/domain';

/**
 * ClickUp connector (ADR-0005): the web app's effectful ClickUp half plus
 * pure adapters over the ingestion transform. Read-only (GET) by
 * construction; raw response documents are returned verbatim for the pure
 * transform. Errors are sanitized to a class + stage + status — the token
 * can never leak through an error message.
 *
 * API notes (ClickUp REST v2, confirmed against the official OpenAPI spec):
 *  - personal tokens go in `Authorization` RAW (no "Bearer" prefix);
 *  - the import scope is a List; Lists live under Space → Folder → List or
 *    directly under a Space (folderless);
 *  - GET /list/{id}/task pages by `page` (100/page) and signals the end with
 *    `last_page: true`;
 *  - status history comes from the Total-Time-in-Status endpoints: bulk
 *    accepts 2–100 task ids per call (`task_ids` repeated), so a lone task
 *    falls back to the single-task endpoint;
 *  - rate limit is 100 req/min on most plans — 429s are retried after the
 *    windowed backoff below rather than failing a long import.
 */

/** Raw ClickUp fetch bundle — the wire shape is private to this module. */
export interface ClickUpRawFetch extends RawFetch {
  readonly provider: 'clickup';
  readonly taskPages: readonly string[];
  readonly timeInStatusPages: readonly string[];
  readonly singleTimeInStatusByTask?: Readonly<Record<string, string>>;
}

const asClickUpRaw = (raw: RawFetch): ClickUpRawFetch => {
  if (raw.provider !== 'clickup') {
    throw new Error(`ClickUp connector received a "${raw.provider}" fetch bundle.`);
  }
  return raw as ClickUpRawFetch;
};

const RATE_LIMIT_RETRIES = 5;
const MAX_BACKOFF_MS = 90_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpClickUpGateway implements ConnectorGateway {
  constructor(private fetchFn: typeof fetch = fetch) {}

  private async getJson(
    credentials: ConnectorCredentials,
    url: string,
    stage: string,
  ): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          headers: { Authorization: credentials.secret, Accept: 'application/json' },
        });
      } catch {
        // Never echo the underlying error — it can embed the request.
        throw new GatewayError('fetch-error', stage, `Could not reach ClickUp (${stage}).`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(
          'auth-error',
          stage,
          `ClickUp rejected the token at ${stage} (HTTP ${response.status}).`,
          response.status,
        );
      }
      if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        // X-RateLimit-Reset is an epoch-seconds instant; fall back to a
        // minute (the documented window) when absent or nonsensical.
        const reset = Number(response.headers.get('x-ratelimit-reset') ?? '');
        const waitMs = Number.isFinite(reset)
          ? Math.min(Math.max(reset * 1000 - Date.now(), 1_000), MAX_BACKOFF_MS)
          : 60_000;
        await sleep(waitMs);
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

  /**
   * Scope discovery walks the hierarchy: workspaces → spaces → folders
   * (lists embedded) + folderless lists. Every List is one selectable scope,
   * labelled with its Space (and Folder) so same-named lists stay tellable.
   */
  async listScopes(credentials: ConnectorCredentials): Promise<ScopeRef[]> {
    const scopes: ScopeRef[] = [];
    const teamsText = await this.getJson(credentials, clickupTeamsUrl(), 'list-scopes');
    const teams = (JSON.parse(teamsText) as { teams?: { id?: string; name?: string }[] }).teams;
    for (const team of teams ?? []) {
      if (!team.id) continue;
      const spacesText = await this.getJson(credentials, clickupSpacesUrl(team.id), 'list-scopes');
      const spaces = (JSON.parse(spacesText) as { spaces?: { id?: string; name?: string }[] })
        .spaces;
      for (const space of spaces ?? []) {
        if (!space.id) continue;
        const spaceName = space.name ?? space.id;
        const foldersText = await this.getJson(
          credentials,
          clickupFoldersUrl(space.id),
          'list-scopes',
        );
        const folders = (
          JSON.parse(foldersText) as {
            folders?: { name?: string; lists?: { id?: string; name?: string }[] }[];
          }
        ).folders;
        for (const folder of folders ?? []) {
          for (const list of folder.lists ?? []) {
            if (!list.id) continue;
            scopes.push({
              id: list.id,
              name: `${list.name ?? list.id} (${spaceName} / ${folder.name ?? 'Folder'})`,
            });
          }
        }
        const listsText = await this.getJson(
          credentials,
          clickupFolderlessListsUrl(space.id),
          'list-scopes',
        );
        const lists = (JSON.parse(listsText) as { lists?: { id?: string; name?: string }[] }).lists;
        for (const list of lists ?? []) {
          if (!list.id) continue;
          scopes.push({ id: list.id, name: `${list.name ?? list.id} (${spaceName})` });
        }
      }
    }
    return scopes;
  }

  async fetchAll(credentials: ConnectorCredentials, scopeId: string): Promise<ClickUpRawFetch> {
    // Task pages: subtasks are work items too, and closed tasks are needed
    // for terminal-stage flow analysis. Home-list tasks only (no cross-list
    // duplicates); the transform still dedupes defensively.
    const taskPages: string[] = [];
    const taskIds: string[] = [];
    for (let page = 0; ; page += 1) {
      const text = await this.getJson(credentials, clickupTasksUrl(scopeId, page), 'tasks');
      taskPages.push(text);
      const info = clickupPageInfo(text);
      taskIds.push(...info.taskIds);
      if (info.lastPage) break;
    }

    // Status residency (Total Time in Status). Bulk needs 2–100 ids per call
    // (chunks rebalanced so none is a singleton); a lone task overall uses
    // the single-task endpoint. A workspace without the Time-in-Status
    // ClickApp (plan-gated — partner run cu01, MC-5) gets no history: the
    // transform then derives arrival-only events (CU2), it is not an error.
    const timeInStatusPages: string[] = [];
    const singleTimeInStatusByTask: Record<string, string> = {};
    const uniqueIds = [...new Set(taskIds)];
    try {
      if (uniqueIds.length === 1) {
        const id = uniqueIds[0] as string;
        singleTimeInStatusByTask[id] = await this.getJson(
          credentials,
          clickupTimeInStatusUrl(id),
          'history',
        );
      } else {
        for (const chunk of clickupBulkChunks(uniqueIds)) {
          timeInStatusPages.push(
            await this.getJson(credentials, clickupBulkTimeInStatusUrl(chunk), 'history'),
          );
        }
      }
    } catch (error) {
      // History is an enrichment: a workspace with the ClickApp disabled
      // answers 4xx here. Auth failures still propagate (the token is bad);
      // anything else degrades to CU2 arrival-only derivation.
      if (error instanceof GatewayError && error.errorClass === 'auth-error') throw error;
      timeInStatusPages.length = 0;
      for (const key of Object.keys(singleTimeInStatusByTask)) {
        delete singleTimeInStatusByTask[key];
      }
    }

    return {
      provider: 'clickup',
      taskPages,
      timeInStatusPages,
      ...(Object.keys(singleTimeInStatusByTask).length > 0 ? { singleTimeInStatusByTask } : {}),
    };
  }
}

const CLICKUP_DESCRIPTOR: ConnectorDescriptor = {
  id: 'clickup',
  name: 'ClickUp',
  connectionNoun: 'ClickUp workspace',
  scopeNoun: { singular: 'List', plural: 'Lists' },
  itemNoun: 'tasks',
  connectLead:
    "CostFlow reads your ClickUp with a personal API token. It's read-only, encrypted at rest, and never displayed after you save it. Setup takes about a minute.",
  fields: [
    {
      name: 'token',
      label: 'Personal API token',
      kind: 'secret',
      placeholder: 'pk_1234567890',
    },
  ],
  helpHtml: `<summary>How to get your ClickUp API token (~60 seconds)</summary>
           <ol class="note">
             <li>In ClickUp, click your avatar → <strong>Settings</strong> → <strong>Apps</strong>.</li>
             <li>Under <strong>API Token</strong>, click <strong>Generate</strong> (or copy the existing token starting with <code>pk_</code>).</li>
             <li>Paste it above. For status-history analysis, ask a Workspace admin to enable the <strong>Total Time in Status</strong> ClickApp.</li>
           </ol>`,
  pickerBlurb: 'ClickUp Lists: tasks, statuses, assignees, due dates, and time-in-status history.',
  // Time-in-Status returns AGGREGATE durations per status, and only when the
  // ClickApp is enabled — so it is status history, gated, and it is not
  // transition history: there is no public ordered-transition endpoint, so the
  // entry time of a stage cannot be reconstructed (partner run cu01, MC-5).
  // Synthesizing transitions from aggregates is explicitly refused.
  provides: {
    canProvide: ['stage-snapshots', 'status-history', 'due-dates'],
    planGated: ['status-history'],
    planGateHint: {
      'status-history':
        'Ask a Workspace admin to enable the Total Time in Status ClickApp, then re-import.',
    },
  },
};

/**
 * Build the ClickUp connector around a gateway (production:
 * HttpClickUpGateway; tests: a stub). Everything except the gateway is pure.
 */
export function buildClickUpConnector(gateway: ConnectorGateway): Connector {
  return {
    descriptor: CLICKUP_DESCRIPTOR,

    gateway,

    parseConnectForm(body) {
      const token = String(body['token'] ?? '').trim();
      if (token.length < 8) {
        return {
          ok: false,
          error:
            'A ClickUp personal API token is required. It starts with <code>pk_</code> and is generated under Settings → Apps.',
        };
      }
      return { ok: true, params: {}, secret: token };
    },

    describeConnection(): string {
      return 'ClickUp workspace (personal API token)';
    },

    observe(raw: RawFetch): ObservedWorkspace {
      const bundle = asClickUpRaw(raw);
      const observed = observeClickUpPages(bundle.taskPages, [
        ...bundle.timeInStatusPages,
        ...Object.values(bundle.singleTimeInStatusByTask ?? {}),
      ]);
      // ClickUp's own status-type metadata (open/done/closed) wins; the
      // generic name heuristic fills in for `custom`-type statuses. Form
      // defaults only — the user approves every mapping (invariant 6).
      const statusHints: Record<string, StageKind> = {};
      for (const status of observed.statuses) {
        const hint = observed.statusHints[status] ?? guessStageKind(status);
        if (hint !== null && hint !== undefined) statusHints[status] = hint;
      }
      return {
        statuses: observed.statuses,
        actors: observed.actors,
        statusHints,
        itemCount: observed.itemCount,
      };
    },

    buildBatch(input: BuildBatchInput): ImportBatch {
      const raw = asClickUpRaw(input.raw);
      return transformClickUp({
        batchId: input.batchId,
        taskPages: raw.taskPages,
        timeInStatusPages: raw.timeInStatusPages,
        singleTimeInStatusByTask: raw.singleTimeInStatusByTask,
        mapping: {
          id: input.mappingId,
          version: input.mappingVersion,
          statusMap: input.statusMap,
          ...(input.actorRoleMap ? { actorRoleMap: input.actorRoleMap } : {}),
        },
        importedAt: input.importedAt,
        pseudonymization: input.pseudonymization,
      });
    },
  };
}
