import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    alias: {
      // Map .js imports to .ts source files for vitest
      './converter.js': './converter.ts',
      '../src/converter.js': '../src/converter.ts',
    },
  },
});
