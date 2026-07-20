import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@costflow/domain': p('./packages/domain/src/index.ts'),
      '@costflow/ingestion': p('./packages/ingestion/src/index.ts'),
      '@costflow/friction': p('./packages/friction/src/index.ts'),
      '@costflow/cost-engine': p('./packages/cost-engine/src/index.ts'),
      '@costflow/analysis': p('./packages/analysis/src/index.ts'),
      '@costflow/reporting': p('./packages/reporting/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
  },
});
