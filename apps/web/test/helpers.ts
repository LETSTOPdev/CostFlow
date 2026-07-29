import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { TelemetryEvent } from '@costflow/telemetry';
import { buildServer, type ServerDeps } from '../src/server';
import {
  GatewayError,
  type ConnectorCredentials,
  type ConnectorGateway,
  type ScopeRef,
} from '../src/connectors/types';
import { buildJiraConnector, type JiraRawFetch } from '../src/connectors/jira';
import { buildClickUpConnector, type ClickUpRawFetch } from '../src/connectors/clickup';
import { buildConnectorRegistry } from '../src/connectors/registry';
import { MemoryStore } from '../src/store/memory';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const NOW = '2026-07-20T00:00:00Z';
export const SESSION_KEY = Buffer.alloc(32, 1);
export const CREDENTIAL_KEY = Buffer.alloc(32, 2);
export const TOKEN = 'secret-jira-token-abc123';

export const JIRA_FIXTURE_PAGE = readFileSync(
  join(ROOT, 'tools/golden/fixtures/jira/raw/search-page-0.json'),
  'utf8',
);

/** Fixture-backed stub gateway (doc 09 P4.1 plan §8): golden Jira raw pages. */
export class StubJiraGateway implements ConnectorGateway {
  failListWith: GatewayError | null = null;
  failFetchWith: GatewayError | null = null;
  lastCredentials: ConnectorCredentials | null = null;
  lastFetchScopeId: string | null = null;
  projects: ScopeRef[] = [
    { id: 'OPS', name: 'Operations', kind: 'project', parentId: null, fetchable: true },
    { id: 'MKT', name: 'Marketing Website', kind: 'project', parentId: null, fetchable: true },
  ];

  async listScopes(credentials: ConnectorCredentials): Promise<ScopeRef[]> {
    this.lastCredentials = credentials;
    if (this.failListWith) throw this.failListWith;
    return this.projects;
  }

  async fetchAll(credentials: ConnectorCredentials, scopeId: string): Promise<JiraRawFetch> {
    this.lastCredentials = credentials;
    this.lastFetchScopeId = scopeId;
    if (this.failFetchWith) throw this.failFetchWith;
    if (scopeId !== 'OPS') throw new GatewayError('fetch-error', 'search', 'Unknown project.');
    return { provider: 'jira', searchPages: [JIRA_FIXTURE_PAGE], supplementaryChangelogs: {} };
  }
}

export const CLICKUP_FIXTURE_PAGE = readFileSync(
  join(ROOT, 'tools/golden/fixtures/clickup/raw/tasks-page-0.json'),
  'utf8',
);
export const CLICKUP_FIXTURE_HISTORY = readFileSync(
  join(ROOT, 'tools/golden/fixtures/clickup/raw/time-in-status-0.json'),
  'utf8',
);

/**
 * A second ClickUp List, defined here rather than as a fixture file: it exists
 * only to be the OTHER origin in a multi-scope run, and its whole point is
 * carrying no status history so the merged capability is an intersection.
 */
export const CLICKUP_SECOND_LIST_PAGE = JSON.stringify({
  tasks: [
    {
      id: '86dzz01',
      name: 'Renew vendor contracts',
      status: {
        status: 'backlog',
        type: 'open',
        orderindex: 0,
      },
      date_created: '1781913600000',
      date_updated: '1784073600000',
      due_date: '1783641600000',
      assignees: [
        {
          id: 191,
          username: 'Dan Ops',
          email: 'dan@example.test',
        },
      ],
      list: {
        id: '902',
        name: 'Backlog',
      },
      space: {
        id: '790',
      },
    },
    {
      id: '86dzz02',
      name: 'Archive closed audits',
      status: {
        status: 'done',
        type: 'closed',
        orderindex: 3,
      },
      date_created: '1781913600000',
      date_updated: '1784073600000',
      due_date: null,
      assignees: [
        {
          id: 183,
          username: 'Noa Legal',
          email: 'noa@example.test',
        },
      ],
      list: {
        id: '902',
        name: 'Backlog',
      },
      space: {
        id: '790',
      },
    },
  ],
  last_page: true,
});

/** Fixture-backed ClickUp stub: golden ClickUp raw pages. */
export class StubClickUpGateway implements ConnectorGateway {
  failListWith: GatewayError | null = null;
  failFetchWith: GatewayError | null = null;
  lastCredentials: ConnectorCredentials | null = null;
  lastFetchScopeId: string | null = null;
  /**
   * A real ClickUp shape: a Space holding a Folder, the Folder holding a List,
   * and a second List sitting directly under the Space. Container selection and
   * path-aware search only mean anything against a hierarchy, so the stub has
   * one.
   */
  lists: ScopeRef[] = [
    { id: '790', name: 'Delivery', kind: 'Space', parentId: null, fetchable: false },
    { id: '457', name: 'Sprints', kind: 'Folder', parentId: '790', fetchable: false },
    { id: '901', name: 'Sprint Board', kind: 'List', parentId: '457', fetchable: true },
    { id: '902', name: 'Backlog', kind: 'List', parentId: '790', fetchable: true },
  ];
  /** Scope ids fetched during the last multi-scope pass, in call order. */
  fetched: string[] = [];

  async listScopes(credentials: ConnectorCredentials): Promise<ScopeRef[]> {
    this.lastCredentials = credentials;
    if (this.failListWith) throw this.failListWith;
    return this.lists;
  }

  async fetchAll(credentials: ConnectorCredentials, scopeId: string): Promise<ClickUpRawFetch> {
    this.lastCredentials = credentials;
    this.lastFetchScopeId = scopeId;
    this.fetched.push(scopeId);
    if (this.failFetchWith) throw this.failFetchWith;
    if (scopeId === '902') {
      // A second List with its own tasks and NO status history — the mixed
      // capability case a single-scope stub cannot produce.
      return { provider: 'clickup', taskPages: [CLICKUP_SECOND_LIST_PAGE], timeInStatusPages: [] };
    }
    if (scopeId !== '901') throw new GatewayError('fetch-error', 'tasks', 'Unknown list.');
    return {
      provider: 'clickup',
      taskPages: [CLICKUP_FIXTURE_PAGE],
      timeInStatusPages: [CLICKUP_FIXTURE_HISTORY],
    };
  }
}

/** Registry over stub gateways — for tests calling buildServer directly. */
export function stubConnectors(
  gateway: ConnectorGateway = new StubJiraGateway(),
  clickup: ConnectorGateway = new StubClickUpGateway(),
) {
  return buildConnectorRegistry([buildJiraConnector(gateway), buildClickUpConnector(clickup)]);
}

export interface TestApp {
  app: FastifyInstance;
  store: MemoryStore;
  gateway: StubJiraGateway;
  clickup: StubClickUpGateway;
  events: TelemetryEvent[];
  logs: Record<string, unknown>[];
}

export function makeApp(overrides: Partial<ServerDeps> = {}): TestApp {
  const store = new MemoryStore();
  const gateway = new StubJiraGateway();
  const clickup = new StubClickUpGateway();
  const events: TelemetryEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const app = buildServer({
    store,
    connectors: buildConnectorRegistry([
      buildJiraConnector(gateway),
      buildClickUpConnector(clickup),
    ]),
    auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
    telemetry: (event) => events.push(event),
    logSink: (line) => logs.push(line),
    jobNowFn: () => NOW,
    awaitJobs: true,
    ...overrides,
  });
  return { app, store, gateway, clickup, events, logs };
}

export function cookieOf(response: { headers: Record<string, unknown> }, name: string): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw as string];
  const match = list.find((c) => typeof c === 'string' && c.startsWith(`${name}=`));
  if (!match) throw new Error(`No ${name} cookie set.`);
  return (match as string).split(';')[0] as string;
}

export async function signIn(t: TestApp, email: string): Promise<string> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `email=${encodeURIComponent(email)}`,
  });
  return cookieOf(response, 'cf_session');
}

export function csrfOf(cookie: string): string {
  const value = cookie.split('=').slice(1).join('=');
  const body = value.split('.')[0] as string;
  const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { csrf: string };
  return session.csrf;
}

/** An array value becomes a repeated field, exactly as a browser sends checkboxes. */
export function form(fields: Record<string, string | string[]>): string {
  return Object.entries(fields)
    .flatMap(([k, v]) =>
      (Array.isArray(v) ? v : [v]).map(
        (one) => `${encodeURIComponent(k)}=${encodeURIComponent(one)}`,
      ),
    )
    .join('&');
}

export async function post(
  t: TestApp,
  cookie: string,
  url: string,
  fields: Record<string, string | string[]>,
) {
  return t.app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    payload: form({ csrf: csrfOf(cookie), ...fields }),
  });
}

export async function get(t: TestApp, cookie: string, url: string) {
  return t.app.inject({ method: 'GET', url, headers: { cookie } });
}
