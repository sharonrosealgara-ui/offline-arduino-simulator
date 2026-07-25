import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const repoRoot = resolve(__dirname, '..', '..');

/**
 * Workspace source aliases. We deliberately resolve to `src` so Vite bundles the
 * TypeScript directly (no separate build step for the shared packages) and so the
 * renderer, preload, and main all share one authoritative copy of the contracts.
 */
const alias = {
  '@offline-arduino/contracts': resolve(repoRoot, 'packages/contracts/src'),
  '@offline-arduino/simulator': resolve(repoRoot, 'packages/simulator/src'),
  '@renderer': resolve(__dirname, 'src/renderer'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        // Preload must be CommonJS-safe and a single file so contextIsolation works.
        input: { preload: resolve(__dirname, 'src/preload/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    // All content is local. A custom app protocol / relative base keeps the
    // packaged renderer offline with no absolute host references.
    base: './',
    worker: {
      format: 'es',
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
