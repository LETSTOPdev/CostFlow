import { PgStore } from './store/pg';

/**
 * Idempotent migration entry point (doc 09 P4.2 §7/§8). schema.sql uses
 * `create ... if not exists` / `add column if not exists`, so this is safe to
 * run on every deploy. Run as Railway's PRE-DEPLOY command (a separate one-off
 * phase), NOT chained into the server start:
 *   pnpm --filter @costflow/web migrate
 *
 * It MUST terminate the process explicitly on both paths. A lingering pg pool
 * handle (or the runner keeping the loop alive) once left the process hanging
 * after a successful migration; when this was chained as `migrate && start`,
 * `start` never fired, no server bound, and the Railway healthcheck timed out
 * — failing every deploy. `process.exit` guarantees a clean, prompt exit so
 * the pre-deploy phase completes and the deploy proceeds to `start`.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required to migrate.');
  const store = new PgStore(databaseUrl);
  await store.migrate();
  await store.ping();
  await store.close();
  console.error('Migration applied and database reachable.');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
