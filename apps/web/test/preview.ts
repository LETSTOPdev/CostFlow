/**
 * The product, running locally, as a customer sees it.
 *
 * Every milestone starts by looking at the rendered UI, the exported report,
 * onboarding and the dashboard before reading any architecture
 * (`docs/09-ai-context.md` §3). This is how to do that.
 *
 *     pnpm preview        → http://127.0.0.1:3901
 *
 * It is the REAL server — the same `buildServer`, routes, templates and CSP that
 * production runs — with the test stub gateways in place of the HTTP ones. That
 * substitution is the whole point: the dev server in `.claude/launch.json` wires
 * the real Jira and ClickUp gateways, so without a live provider token you
 * cannot get past `/connect`, which is exactly where looking at the product
 * stops being possible.
 *
 * Not a test, despite living beside them: it needs the stub gateways and the
 * fixture keys, which live here. The filename has no `.test.` segment, so
 * vitest does not collect it.
 *
 * Sign in at /login with any email (dev auth), then connect ClickUp with any
 * token starting `pk_` and at least 8 characters long. The ClickUp stub serves a
 * Space → Folder → List hierarchy so container selection, path-aware search and
 * per-origin attribution all have something real to act on.
 */
import { buildJiraConnector } from '../src/connectors/jira';
import { buildClickUpConnector } from '../src/connectors/clickup';
import { buildConnectorRegistry } from '../src/connectors/registry';
import { buildServer } from '../src/server';
import { APP_SITE, siteWith } from '@costflow/ui';
import { MemoryStore } from '../src/store/memory';
import {
  CLICKUP_FIXTURE_HISTORY,
  CLICKUP_FIXTURE_PAGE,
  CLICKUP_SECOND_LIST_PAGE,
  CREDENTIAL_KEY,
  SESSION_KEY,
  StubClickUpGateway,
  StubJiraGateway,
} from './helpers';
import type { ConnectorCredentials } from '../src/connectors/types';

const PORT = Number(process.env['PORT'] ?? 3901);

const clickup = new StubClickUpGateway();
// The shared stub serves data for two Lists and rejects the rest, which is a
// deliberate test behaviour. A walkthrough needs every List to work, or
// selecting a Space dead-ends at the first one with no fixture.
clickup.fetchAll = async (_credentials: ConnectorCredentials, scopeId: string) => {
  clickup.fetched.push(scopeId);
  // Alternate the two fixtures so origins differ from each other, and so one of
  // them carries no status history — the mixed-capability case is what a real
  // multi-team workspace looks like.
  return Number(scopeId) % 2 === 1
    ? {
        provider: 'clickup',
        taskPages: [CLICKUP_FIXTURE_PAGE],
        timeInStatusPages: [CLICKUP_FIXTURE_HISTORY],
      }
    : { provider: 'clickup', taskPages: [CLICKUP_SECOND_LIST_PAGE], timeInStatusPages: [] };
};
// Wider than the stub's default, so the scope step has enough to exercise
// search, select-all, and friction attributed across several teams.
clickup.lists = [
  { id: '790', name: 'Delivery', kind: 'Space', parentId: null, fetchable: false },
  { id: '457', name: 'Sprints', kind: 'Folder', parentId: '790', fetchable: false },
  { id: '901', name: 'Sprint Board', kind: 'List', parentId: '457', fetchable: true },
  { id: '902', name: 'Backlog', kind: 'List', parentId: '790', fetchable: true },
  { id: '800', name: 'Legal', kind: 'Space', parentId: null, fetchable: false },
  { id: '801', name: 'Contract review', kind: 'List', parentId: '800', fetchable: true },
  { id: '810', name: 'Design', kind: 'Space', parentId: null, fetchable: false },
  { id: '811', name: 'Brand', kind: 'List', parentId: '810', fetchable: true },
];

/**
 * Marketing links point at production `fbx1.com` unless a local marketing site
 * is running:
 *
 *     pnpm --filter @costflow/marketing build
 *     pnpm --filter @costflow/marketing serve
 *     COSTFLOW_MARKETING_URL=http://localhost:4321 pnpm preview
 *
 * With both up, the whole customer path — landing, sample report, sign in,
 * connect, run, report, sign out — is walkable end to end across the two hosts,
 * which is what the cold-start ritual asks for.
 */
const marketing = process.env['COSTFLOW_MARKETING_URL'];
const site = marketing
  ? siteWith(APP_SITE, {
      marketingOrigin: new URL(marketing).origin,
      canonicalOrigin: new URL(marketing).origin,
    })
  : APP_SITE;

const app = buildServer({
  site,
  store: new MemoryStore(),
  connectors: buildConnectorRegistry([
    buildJiraConnector(new StubJiraGateway()),
    buildClickUpConnector(clickup),
  ]),
  // Both are required and both throw obscurely if absent: telemetry is invoked
  // unconditionally on sign-in, and the keys must be Buffers rather than the
  // base64 strings the real config parses.
  telemetry: () => {},
  awaitJobs: true,
  auth: { mode: 'dev', sessionKey: SESSION_KEY, credentialKey: CREDENTIAL_KEY },
});

void app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  process.stdout.write(
    `\nCostFlow preview on http://127.0.0.1:${PORT}\n` +
      `  /login            any email\n` +
      `  /demo /try        public sample reports\n` +
      `  connect ClickUp   any token starting pk_\n\n`,
  );
});
