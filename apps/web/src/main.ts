import { pathToFileURL } from 'node:url';
import { loadConfig } from './config';
import { buildServer } from './server';
import { buildJiraConnector, HttpJiraGateway } from './connectors/jira';
import { buildClickUpConnector, HttpClickUpGateway } from './connectors/clickup';
import { buildConnectorRegistry } from './connectors/registry';
import { MemoryStore } from './store/memory';
import { PgStore } from './store/pg';
import { fileTelemetrySink } from './telemetry-web';
import type { Store } from './store/contract';

/**
 * Graceful shutdown (P4.2 incident: authenticated POSTs — sign-out especially —
 * intermittently "did nothing" or returned an edge 503 in production).
 *
 * Railway sends SIGTERM on every redeploy. Without a handler, Node terminates
 * immediately: keep-alive connections are severed mid-flight with no HTTP/2
 * GOAWAY and in-flight requests are dropped. A browser transparently retries an
 * idempotent GET on a fresh connection (so navigation recovered), but never
 * retries a non-idempotent POST — so the sign-out POST on a connection whose
 * replica just vanished either failed silently ("did nothing") or surfaced as a
 * 503, only in production and only around deploys.
 *
 * `app.close()` drains cleanly: stop accepting new connections, finish in-flight
 * requests, and close idle keep-alive connections with a GOAWAY so the client
 * reconnects to the healthy new replica for its next request. Railway waits for
 * the process to exit (its grace period) before SIGKILL, so this completes.
 */
export async function gracefulShutdown(
  app: { close: () => Promise<unknown> },
  store: Store,
  exit: (code: number) => void,
  log: (line: string) => void = (l) => console.error(l),
): Promise<void> {
  try {
    await app.close();
    if ('close' in store && typeof (store as { close?: unknown }).close === 'function') {
      await (store as unknown as { close: () => Promise<void> }).close();
    }
  } catch (error) {
    log(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    exit(0);
  }
}

/**
 * Boot (doc 09 P4.2 §1): loadConfig refuses to start on any misconfiguration
 * with a named message — the server never limps. Production requires managed
 * OIDC, a real database, and enables secure cookies + trusted proxy.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);

  let store: Store;
  if (config.databaseUrl) {
    const pgStore = new PgStore(config.databaseUrl);
    await pgStore.migrate();
    await pgStore.ping(); // fail fast if the database is unreachable at boot
    store = pgStore;
  } else {
    console.error('WARNING: COSTFLOW_STORE=memory — nothing is persisted across restarts.');
    store = new MemoryStore();
  }

  const interrupted = await store.markInterruptedJobs(new Date(Date.now()).toISOString());
  if (interrupted > 0) {
    console.error(`Recovered ${interrupted} job(s) interrupted by the previous shutdown.`);
  }

  // The connector registry is the ONLY place production platform gateways are
  // wired (ADR-0005). Adding a platform = one connector module + one line here.
  const connectors = buildConnectorRegistry([
    buildJiraConnector(new HttpJiraGateway()),
    buildClickUpConnector(new HttpClickUpGateway()),
  ]);

  const app = buildServer({
    store,
    connectors,
    auth: config.auth,
    telemetry: fileTelemetrySink(),
    production: config.production,
    trustProxy: config.trustProxy,
    adminEmails: config.adminEmails,
    ...(config.maxIssues !== undefined ? { maxIssues: config.maxIssues } : {}),
  });
  // Bind all interfaces in production (the platform proxies in); localhost otherwise.
  const host = config.production ? '0.0.0.0' : '127.0.0.1';
  await app.listen({ port: config.port, host });
  console.error(
    `CostFlow web listening on ${host}:${config.port} (production=${config.production})`,
  );

  // Drain on the platform's stop signal so a redeploy never severs a live
  // connection mid-request (see gracefulShutdown). `once` so a second signal
  // during drain still hard-exits.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.error(`Received ${signal}; draining connections before exit.`);
      void gracefulShutdown(app, store, (code) => process.exit(code));
    });
  }
}

// Run only when executed as the entrypoint (`tsx src/main.ts`), never when a
// test imports this module for `gracefulShutdown` — importing must not boot a
// server or connect to a database.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
