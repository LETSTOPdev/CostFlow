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
const PURE = '^packages/(domain|ingestion|friction|cost-engine|analysis|reporting|telemetry)/';

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
