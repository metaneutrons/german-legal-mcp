import { defineConfig } from 'vitest/config';
import { resolveVitestStateDir } from './vitest.state.js';

const stateDir = resolveVitestStateDir('german-legal-mcp-vitest-');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      GLMCP_STATE_DIR: stateDir,
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/providers/arxiv/index.ts',
        'src/providers/dip/index.ts',
        'src/providers/eul/index.ts',
        'src/providers/icu/index.ts',
        'src/providers/nautos/index.ts',
        'src/providers/rii/index.ts',
      ],
      thresholds: {
        lines: 85,
        statements: 82,
        functions: 80,
        branches: 68,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    alias: {
      './converter.js': './converter.ts',
      '../src/converter.js': '../src/converter.ts',
    },
  },
});
