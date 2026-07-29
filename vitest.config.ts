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
  // The renderer tsconfig uses "jsx": "react-jsx" (the automatic runtime). Vitest's
  // esbuild transform defaults to the CLASSIC runtime, which expects a React binding
  // in scope and fails component suites with "React is not defined". Match the app.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      // `.tsx` matters: React component suites live here too, and a bare `*.test.ts`
      // glob silently skips them (this is how the Inspector control tests went
      // uncollected while the suite total still looked healthy).
      'apps/desktop/tests/**/*.test.{ts,tsx}',
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
