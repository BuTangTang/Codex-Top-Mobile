import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import { resolveVitestFeatureTestExcludeGlobs } from '../../scripts/testing/featureTestGating';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('../../apps/cli/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['suites/stress/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    globals: false,
    exclude: [...resolveVitestFeatureTestExcludeGlobs()],
    env: {
      HAPPIER_FEATURE_POLICY_ENV: '',
    },
  },
});
