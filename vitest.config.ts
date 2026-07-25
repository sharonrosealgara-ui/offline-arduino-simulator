import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@offline-arduino/contracts': resolve(repoRoot, 'packages/contracts/src'),
      '@offline-arduino/simulator': resolve(repoRoot, 'packages/simulator/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'apps/desktop/tests/**/*.test.ts',
    ],
    // Renderer/React tests opt into jsdom via a per-file
    //   // @vitest-environment jsdom
    // pragma so the default fast node environment stays the norm.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/**/src/**/*.ts', 'apps/desktop/src/**/*.ts'],
    },
  },
});
