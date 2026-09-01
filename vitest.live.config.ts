import { defineConfig } from 'vitest/config';
import { resolveVitestStateDir } from './vitest.state.js';

const stateDir = resolveVitestStateDir('german-legal-mcp-live-');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: process.env.CI ? 1 : 0,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      GLMCP_STATE_DIR: stateDir,
    },
  },
});
