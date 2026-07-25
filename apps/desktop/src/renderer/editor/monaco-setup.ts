/**
 * Bundles Monaco and its language workers through Vite — no CDN, no remote font.
 * Source: UI_CANVAS_AND_PACKAGING_SPEC.md §5.
 *
 * Narrowed build: only the core editor worker and the JSON language-service worker are
 * bundled (see monaco-languages.ts for the language allowlist). Both workers are local
 * `?worker` imports — zero network.
 *
 * Call `configureMonacoEnvironment()` once before creating any editor instance.
 */
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

let configured = false;

export function configureMonacoEnvironment(): void {
  if (configured) return;
  configured = true;
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      // C/C++ (and our custom 'arduino' language) are Monarch tokenizers with no worker.
      // Only JSON has a language-service worker for validation/formatting/completion.
      if (label === 'json') return new JsonWorker();
      return new EditorWorker();
    },
  };
}
