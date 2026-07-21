import { PgStore } from './store/pg';

/**
 * Idempotent migration entry point (doc 09 P4.2 §7/§8). schema.sql uses
 * `create table if not exists` / `create index if not exists`, so this is
 * safe to run on every deploy. Run as the platform's release command:
 *   pnpm --filter @costflow/web migrate
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
