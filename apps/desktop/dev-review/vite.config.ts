/**
 * TEMPORARY — post-C4 routing smoke harness. Not committed, not shipped.
 *
 * A standalone Vite dev server whose only job is to put the REAL production routing and wire
 * rendering on screen. It reuses the renderer's own aliases, so every import resolves to
 * exactly the module the application uses — a harness that resolved differently would be
 * evidence about the harness, not about the app.
 *
 * Passed to Vite with `--config`, so nothing in the build graph, `package.json` or any
 * lockfile refers to it. Deleting this directory removes it completely.
 *
 * Bound to 127.0.0.1 only.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const desktopRoot = resolve(__dirname, '..');
const repoRoot = resolve(desktopRoot, '..', '..');

export default defineConfig({
  root: __dirname,
  // Identical to the renderer's aliases in electron.vite.config.ts.
  resolve: {
    alias: {
      '@offline-arduino/contracts': resolve(repoRoot, 'packages/contracts/src'),
      '@offline-arduino/simulator': resolve(repoRoot, 'packages/simulator/src'),
      '@renderer': resolve(desktopRoot, 'src/renderer'),
    },
  },
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5199, strictPort: true, open: false },
});
