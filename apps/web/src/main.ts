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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
