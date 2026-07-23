import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { TelemetryEvent } from '@costflow/telemetry';
import { buildServer, type ServerDeps } from '../src/server';
import {
  GatewayError,
  jiraConnector,
  type Connection,
  type ScopeRef,
  type WebConnector,
} from '../src/connectors';
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

/**
 * Fixture-backed stub connector (doc 09 P4.1 plan §8, doc 18 §4.1): the REAL
 * jira connector's pure surface (credential parsing, counting, observation,
 * transform) with only the two HTTP halves stubbed to golden raw pages — so
 * a passing web suite still exercises the real edge logic.
 */
export class StubJiraConnector implements WebConnector {
  private real = jiraConnector();
  failListWith: GatewayError | null = null;
  failFetchWith: GatewayError | null = null;
  lastConnection: Connection | null = null;
  lastFetchProjectKey: string | null = null;
  projects: ScopeRef[] = [
    { key: 'OPS', name: 'Operations' },
    { key: 'MKT', name: 'Marketing Website' },
  ];

  descriptor = this.real.descriptor;
  scopeNoun = this.real.scopeNoun;
  pickerHint = this.real.pickerHint;
  credentialFields = this.real.credentialFields;
  connectionHelpHtml = this.real.connectionHelpHtml;
  parseCredentials: WebConnector['parseCredentials'] = (body) => this.real.parseCredentials(body);
  connectionFrom: WebConnector['connectionFrom'] = (workspace, secret) =>
    this.real.connectionFrom(workspace, secret);
  summaryText: WebConnector['summaryText'] = (workspace) => this.real.summaryText(workspace);
  countItems: WebConnector['countItems'] = (payload) => this.real.countItems(payload);
  observe: WebConnector['observe'] = (payload) => this.real.observe(payload);
  transform: WebConnector['transform'] = (payload, args) => this.real.transform(payload, args);

  async listScopes(connection: Connection): Promise<ScopeRef[]> {
    this.lastConnection = connection;
    if (this.failListWith) throw this.failListWith;
    return this.projects;
  }

  async fetchAll(connection: Connection, scopeKey: string) {
    this.lastConnection = connection;
    this.lastFetchProjectKey = scopeKey;
    if (this.failFetchWith) throw this.failFetchWith;
    if (scopeKey !== 'OPS') throw new GatewayError('fetch-error', 'search', 'Unknown project.');
    return { searchPages: [JIRA_FIXTURE_PAGE], supplementaryChangelogs: {} };
  }
}

export interface TestApp {
  app: FastifyInstance;
  store: MemoryStore;
  gateway: StubJiraConnector;
  events: TelemetryEvent[];
  logs: Record<string, unknown>[];
}

export function makeApp(overrides: Partial<ServerDeps> = {}): TestApp {
  const store = new MemoryStore();
  const gateway = new StubJiraConnector();
  const events: TelemetryEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const app = buildServer({
    store,
    connectors: { jira: gateway },
    auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
    telemetry: (event) => events.push(event),
    logSink: (line) => logs.push(line),
    jobNowFn: () => NOW,
    awaitJobs: true,
    ...overrides,
  });
  return { app, store, gateway, events, logs };
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

export function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function post(
  t: TestApp,
  cookie: string,
  url: string,
  fields: Record<string, string>,
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
