/**
 * Side-effect-only Monaco feature + language allowlist.
 *
 * Import this exactly ONCE in the renderer (MonacoSketchEditor does). Because the app
 * imports the editor from `editor.api` (NOT the `monaco-editor` barrel = `editor.main`),
 * nothing is registered implicitly — this file is the entire surface:
 *
 *   1. editor.all  → editor UI features we rely on (find, folding, bracket matching,
 *                    hover, suggest, etc.) — but NO languages.
 *   2. cpp         → C/C++ Monarch syntax (Arduino sketches).
 *   3. json        → JSON language service (circuit/project files).
 *
 * Everything else — ~65 other basic-languages plus the TS/CSS/HTML language services —
 * is excluded from the bundle.
 */
import 'monaco-editor/esm/vs/editor/editor.all';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
