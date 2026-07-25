/**
 * Monaco editor pane. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §5, §17.
 *
 * - Stable model URI: offline-arduino://project/<projectId>/<relativePath>
 * - Minimap OFF by default (low-spec hardware)
 * - Compile markers flow exclusively through useMonacoDiagnostics (marker owner
 *   "arduino-compiler", fed by the compiler-store); circuit/runtime markers would use
 *   a different owner so subsystems never delete each other's findings.
 */
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import './monaco-languages'; // side-effect: registers editor features + cpp + json ONLY
import { configureMonacoEnvironment } from './monaco-setup';
import { useAppStore } from '../state/store';
import { useMonacoDiagnostics } from '../app/editor/useMonacoDiagnostics';

let arduinoLanguageRegistered = false;
function registerArduinoLanguage(): void {
  if (arduinoLanguageRegistered) return;
  arduinoLanguageRegistered = true;
  monaco.languages.register({ id: 'arduino' });
  // Minimal local tokenizer — reuses Monaco's C++ concepts without any language server.
  monaco.languages.setMonarchTokensProvider('arduino', {
    keywords: [
      'void', 'int', 'long', 'byte', 'boolean', 'bool', 'char', 'float', 'double', 'const', 'static', 'if', 'else',
      'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'true', 'false',
      'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
    ],
    builtins: ['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'delay', 'delayMicroseconds', 'millis', 'micros', 'Serial'],
    tokenizer: {
      root: [
        [/#\s*\w+/, 'keyword.directive'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\b\d+\b/, 'number'],
        [
          /[a-zA-Z_]\w*/,
          { cases: { '@keywords': 'keyword', '@builtins': 'type.identifier', '@default': 'identifier' } },
        ],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });
}

export function MonacoSketchEditor(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  // State (not just a ref) so useMonacoDiagnostics re-runs once the editor mounts.
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    configureMonacoEnvironment();
    registerArduinoLanguage();

    const projectId = useAppStore.getState().project.projectId;
    const uri = monaco.Uri.parse(`offline-arduino://project/${projectId}/Sketch.ino`);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(useAppStore.getState().project.sketch, 'arduino', uri);
    modelRef.current = model;

    const editor = monaco.editor.create(hostRef.current!, {
      model,
      automaticLayout: false,
      minimap: { enabled: false },
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 14,
      lineHeight: 21,
      tabSize: 2,
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
    });
    editorRef.current = editor;
    setEditorInstance(editor);

    const sub = model.onDidChangeContent(() => {
      useAppStore.getState().actions.setSketch(model.getValue());
    });

    // Throttled layout on container resize (spec §2.2: editor.layout only after a
    // throttled resize notification).
    let raf = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => editor.layout());
    });
    if (hostRef.current) resizeObserver.observe(hostRef.current);

    return () => {
      sub.dispose();
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      setEditorInstance(null);
      editor.dispose();
    };
  }, []);

  // Single source of truth for compile error squiggles: the compiler-store diagnostics
  // mirrored into Monaco markers under the standardized 'arduino-compiler' owner.
  // (The previous inline useAppStore.subscribe + setModelMarkers pipeline was removed
  // in favor of this hook so the two subsystems cannot fight over markers.)
  useMonacoDiagnostics(editorInstance, monaco);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} data-testid="monaco-host" />;
}
