/**
 * Dependency boundaries per doc 05 §3, as amended 2026-07-20 (D-10: reporting
 * may import cost-engine so money formatting is never reimplemented outside
 * the engine — reverses D-7). Violations fail the build.
 *
 *   apps/cli ─▶ reporting ─▶ analysis ─▶ friction ─▶ domain
 *                      └────▶ cost-engine ─▶ domain
 *              ingestion ─▶ domain
 *
 * Pure packages (everything under packages/) may not import node builtins;
 * apps/ is the only effectful edge.
 */
const PURE =
  '^packages/(domain|ingestion|friction|cost-engine|analysis|reporting|telemetry|diagnostics|comparison)/';

module.exports = {
  forbidden: [
    {
      name: 'domain-depends-on-nothing-internal',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: '^(packages/(?!domain/)|apps/)' },
    },
    {
      name: 'friction-only-domain',
      severity: 'error',
      from: { path: '^packages/friction/' },
      to: { path: '^(packages/(?!domain/|friction/)|apps/)' },
    },
    {
      name: 'cost-engine-only-domain-and-friction-types',
      severity: 'error',
      from: { path: '^packages/cost-engine/' },
      to: { path: '^(packages/(?!domain/|friction/|cost-engine/)|apps/)' },
    },
    {
      name: 'ingestion-only-domain',
      severity: 'error',
      from: { path: '^packages/ingestion/' },
      to: { path: '^(packages/(?!domain/|ingestion/)|apps/)' },
    },
    {
      name: 'analysis-only-domain-friction-costengine-ingestion',
      severity: 'error',
      from: { path: '^packages/analysis/' },
      to: { path: '^(packages/(?!domain/|friction/|cost-engine/|ingestion/|analysis/)|apps/)' },
    },
    {
      name: 'reporting-only-domain-analysis-costengine',
      severity: 'error',
      from: { path: '^packages/reporting/' },
      to: { path: '^(packages/(?!domain/|analysis/|cost-engine/|reporting/)|apps/)' },
    },
    {
      name: 'telemetry-only-domain-and-analysis',
      comment: 'Telemetry reads the immutable run artifact and nothing else (doc 15 P3).',
      severity: 'error',
      from: { path: '^packages/telemetry/src/' },
      to: { path: '^(packages/(?!domain/|analysis/|telemetry/)|apps/)' },
    },
    {
      name: 'comparison-only-domain-analysis-costengine',
      comment:
        'doc 19 MW1: comparison CONSUMES run artifacts, so it must not live inside analysis, ' +
        'which produces them, and must not reach the store, the web app or a connector. It may ' +
        'import cost-engine so money arithmetic is never reimplemented outside the engine (D-10).',
      severity: 'error',
      from: { path: '^packages/comparison/' },
      to: { path: '^(packages/(?!domain/|analysis/|cost-engine/|comparison/)|apps/)' },
    },
    {
      name: 'analysis-never-imports-comparison',
      comment:
        'The dependency arrow points from consumer to producer and never back: a comparison ' +
        'need must never leak into how a run is produced.',
      severity: 'error',
      from: { path: '^packages/analysis/' },
      to: { path: '^packages/comparison/' },
    },
    {
      name: 'diagnostics-only-domain-analysis-costengine',
      comment:
        'ADR-0006: the diagnostic layer reasons in evidence capabilities only. It reads the ' +
        'immutable run artifact and nothing else — no store, no connector, no app. It may ' +
        'import cost-engine so confidence composition is never reimplemented outside the ' +
        'engine (same rationale as D-10 for reporting).',
      severity: 'error',
      from: { path: '^packages/diagnostics/' },
      to: { path: '^(packages/(?!domain/|analysis/|cost-engine/|diagnostics/)|apps/)' },
    },
    {
      name: 'nothing-imports-telemetry-except-apps',
      comment:
        'P3 proof 1: telemetry is structurally incapable of affecting analysis, pricing, ' +
        'confidence, ranking, or reports - no pure package may import it.',
      severity: 'error',
      from: { path: '^packages/(?!telemetry/)' },
      to: { path: '^packages/telemetry/' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'ui-renders-artifacts-and-nothing-else',
      comment:
        'packages/ui is the layer both deployments share: the design system, the page shell, ' +
        'the report view and the diagnostics on top of a run artifact. It reads the artifact ' +
        'and the pure packages, and nothing else — no store, no connector, no session, no ' +
        'telemetry. That is what lets the marketing site import it without importing the ' +
        'application. `assets.ts` is the one exception and reads the file system, which is why ' +
        'it is reached through its own subpath and never from the package barrel.',
      severity: 'error',
      from: { path: '^packages/ui/', pathNot: '^packages/ui/src/assets\\.ts$' },
      to: {
        pathNot:
          '^(packages/(domain|analysis|cost-engine|reporting|comparison|diagnostics|ui)/|node_modules/)',
      },
    },
    {
      name: 'pure-packages-no-node-builtins',
      comment: 'Pure packages perform no I/O; node builtins are the tell (doc 05 §3 rule 2).',
      severity: 'error',
      from: { path: PURE },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-provider-names-outside-ingestion',
      comment: 'Provider concepts must not leak past the ingestion SPI (doc 06 N4).',
      severity: 'error',
      from: { path: '^packages/(?!ingestion/)' },
      to: { path: 'providers/' },
    },
    {
      name: 'web-provider-modules-only-in-connectors',
      comment:
        'ADR-0005: the web product speaks only the abstract connector contract. Concrete ' +
        'connector modules (connectors/jira, connectors/clickup, …) may be imported only by ' +
        'the composition root (main.ts), the test seam, other connector modules, and ' +
        'demo-live.ts (which synthesizes Jira-shaped demo data by design).',
      severity: 'error',
      from: { path: '^apps/web/src/(?!connectors/|main\\.ts|demo-live\\.ts)' },
      to: { path: '^apps/web/src/connectors/(?!types|registry|suggest)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      mainFields: ['main', 'types'],
    },
  },
};
