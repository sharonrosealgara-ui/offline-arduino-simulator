/**
 * React hook that mirrors the compiler-store's diagnostics into Monaco markers.
 *
 * Adapted from the provided integration spec to the project's real diagnostic
 * contract (`CompilerDiagnostic` from @offline-arduino/contracts/compiler):
 *  - severities are 'info' | 'warning' | 'error' | 'fatal' (fatal maps to Error)
 *  - the student-facing message is `title` + `explanation` (no `message` field)
 *  - diagnostics may carry an `endColumn` from the parser
 *
 * Marker owner is 'arduino-compiler' — deliberately distinct from the 'compiler'
 * owner used by MonacoSketchEditor's own useAppStore-driven marker pipeline, so the
 * two subsystems never delete each other's findings (spec §17 owner discipline).
 */
import { useEffect } from 'react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { CompilerDiagnostic } from '@offline-arduino/contracts/compiler';
import { useCompilerStore } from '../state/compiler-store';

const MARKER_OWNER = 'arduino-compiler';

function toMarkerSeverity(
  monacoNs: typeof monaco,
  severity: CompilerDiagnostic['severity'],
): monaco.MarkerSeverity {
  switch (severity) {
    case 'error':
    case 'fatal':
      return monacoNs.MarkerSeverity.Error;
    case 'warning':
      return monacoNs.MarkerSeverity.Warning;
    case 'info':
    default:
      return monacoNs.MarkerSeverity.Info;
  }
}

function toMarker(
  monacoNs: typeof monaco,
  model: monaco.editor.ITextModel,
  d: CompilerDiagnostic,
): monaco.editor.IMarkerData {
  const line = Math.min(Math.max(1, d.line ?? 1), model.getLineCount());
  const startColumn = Math.max(1, d.column ?? 1);
  const endColumn =
    d.endColumn != null
      ? Math.max(startColumn + 1, d.endColumn)
      : d.column != null
        ? startColumn + 1
        : model.getLineMaxColumn(line);

  return {
    severity: toMarkerSeverity(monacoNs, d.severity),
    code: d.code,
    message: d.explanation ? `${d.title}\n${d.explanation}` : d.title,
    startLineNumber: line,
    startColumn,
    endLineNumber: line,
    endColumn,
    source: 'Arduino Compiler',
  };
}

export function useMonacoDiagnostics(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  monacoNs: typeof monaco | null,
): void {
  const diagnostics = useCompilerStore((s) => s.diagnostics);

  useEffect(() => {
    if (!editor || !monacoNs) return;
    const model = editor.getModel();
    if (!model) return;

    const markers = diagnostics.map((d) => toMarker(monacoNs, model, d));
    monacoNs.editor.setModelMarkers(model, MARKER_OWNER, markers);

    return () => {
      if (!model.isDisposed()) {
        monacoNs.editor.setModelMarkers(model, MARKER_OWNER, []);
      }
    };
  }, [editor, monacoNs, diagnostics]);
}
