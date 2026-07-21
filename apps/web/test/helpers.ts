import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { TelemetryEvent } from '@costflow/telemetry';
import { buildServer, type ServerDeps } from '../src/server';
import { GatewayError, type JiraConnection, type JiraGateway } from '../src/jira-gateway';
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
export class StubJiraGateway implements JiraGateway {
  failListWith: GatewayError | null = null;
  failFetchWith: GatewayError | null = null;
  lastConnection: JiraConnection | null = null;

  async listProjects(connection: JiraConnection) {
    this.lastConnection = connection;
    if (this.failListWith) throw this.failListWith;
    return [
      { key: 'OPS', name: 'Operations' },
      { key: 'MKT', name: 'Marketing Website' },
    ];
  }

  async fetchAll(connection: JiraConnection, projectKey: string) {
    this.lastConnection = connection;
    if (this.failFetchWith) throw this.failFetchWith;
    if (projectKey !== 'OPS') throw new GatewayError('fetch-error', 'Unknown project.');
    return { searchPages: [JIRA_FIXTURE_PAGE], supplementaryChangelogs: {} };
  }
}

export interface TestApp {
  app: FastifyInstance;
  store: MemoryStore;
  gateway: StubJiraGateway;
  events: TelemetryEvent[];
}

export function makeApp(overrides: Partial<ServerDeps> = {}): TestApp {
  const store = new MemoryStore();
  const gateway = new StubJiraGateway();
  const events: TelemetryEvent[] = [];
  const app = buildServer({
    store,
    gateway,
    auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
    telemetry: (event) => events.push(event),
    jobNowFn: () => NOW,
    awaitJobs: true,
    ...overrides,
  });
  return { app, store, gateway, events };
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
