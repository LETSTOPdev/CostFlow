import { requireKey } from './crypto';
import { buildServer } from './server';
import { HttpJiraGateway } from './jira-gateway';
import { MemoryStore } from './store/memory';
import { PgStore } from './store/pg';
import { fileTelemetrySink } from './telemetry-web';
import type { AuthConfig } from './auth';
import type { Store } from './store/contract';

/**
 * Boot (doc 09 P4.1 plan §7): misconfiguration refuses to start with a named
 * message — the server never limps. Store: Postgres via DATABASE_URL, or the
 * in-memory store ONLY when explicitly demanded (demo/dev).
 */
async function main(): Promise<void> {
  const sessionKey = requireKey(process.env['COSTFLOW_SESSION_KEY'], 'COSTFLOW_SESSION_KEY');
  const credentialKey = requireKey(
    process.env['COSTFLOW_CREDENTIAL_KEY'],
    'COSTFLOW_CREDENTIAL_KEY',
  );

  const authMode = process.env['COSTFLOW_AUTH'];
  let auth: AuthConfig;
  if (authMode === 'dev') {
    console.error('WARNING: COSTFLOW_AUTH=dev — email-only sign-in, local development only.');
    auth = { mode: 'dev', sessionKey, credentialKey };
  } else if (authMode === 'oidc') {
    const issuer = process.env['COSTFLOW_OIDC_ISSUER'];
    const clientId = process.env['COSTFLOW_OIDC_CLIENT_ID'];
    const clientSecret = process.env['COSTFLOW_OIDC_CLIENT_SECRET'];
    const redirectUri = process.env['COSTFLOW_OIDC_REDIRECT_URI'];
    if (!issuer || !clientId || !clientSecret || !redirectUri) {
      throw new Error(
        'COSTFLOW_AUTH=oidc requires COSTFLOW_OIDC_ISSUER, _CLIENT_ID, _CLIENT_SECRET, _REDIRECT_URI.',
      );
    }
    auth = {
      mode: 'oidc',
      sessionKey,
      credentialKey,
      oidc: { issuer, clientId, clientSecret, redirectUri },
    };
  } else {
    throw new Error('COSTFLOW_AUTH must be "oidc" (managed identity provider) or "dev".');
  }

  let store: Store;
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl) {
    const pgStore = new PgStore(databaseUrl);
    await pgStore.migrate();
    store = pgStore;
  } else if (process.env['COSTFLOW_STORE'] === 'memory') {
    console.error('WARNING: COSTFLOW_STORE=memory — nothing is persisted across restarts.');
    store = new MemoryStore();
  } else {
    throw new Error('DATABASE_URL is required (or COSTFLOW_STORE=memory for a throwaway demo).');
  }

  const interrupted = await store.markInterruptedJobs(new Date(Date.now()).toISOString());
  if (interrupted > 0) {
    console.error(`Recovered ${interrupted} job(s) interrupted by the previous shutdown.`);
  }

  const app = buildServer({
    store,
    gateway: new HttpJiraGateway(),
    auth,
    telemetry: fileTelemetrySink(),
  });
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '127.0.0.1' });
  console.error(`CostFlow web listening on http://127.0.0.1:${port}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
