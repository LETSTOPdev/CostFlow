/**
 * Everything CostFlow renders that both deployments need: the two-host model,
 * the design system and page shell, the report view, and the diagnostics that
 * sit on top of a run artifact.
 *
 * It holds no store, no connector and no session — those belong to the
 * application. It reaches the file system only through the `@costflow/ui/assets`
 * subpath, which is not re-exported here on purpose (see that module).
 */
export * from './site';
export * from './html';
export * from './evidence';
export * from './oi-view';
export * from './report-view';
export * from './diagnostics-view';
