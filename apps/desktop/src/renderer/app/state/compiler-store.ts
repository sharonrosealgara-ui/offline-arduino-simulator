/**
 * Focused Verify pipeline store. Wraps `window.electronAPI.compile` behind a small,
 * predictable state machine: idle -> compiling -> success | error.
 *
 * This slice is intentionally independent of the central app store (state/store.ts):
 * it owns ONLY the Verify UX state (status, output line, diagnostic counts). The
 * authoritative compile artifacts (last valid HEX, flash/SRAM usage, Monaco markers)
 * continue to flow through useAppStore via workbench-controller.verify().
 *
 * Adapted from the provided integration spec to the project's real IPC contract:
 * `CompileRequest` requires `sourceRevision`, and `CompileResult` is the
 * discriminated union from @offline-arduino/contracts/compiler (failure carries
 * `errorCode` + `message` rather than an `ok:false` result with hex).
 */
import { create } from 'zustand';
import type {
  BoardId,
  CompileRequest,
  CompileResult,
  CompilerDiagnostic,
} from '@offline-arduino/contracts/compiler';

export type CompileStatus = 'idle' | 'compiling' | 'success' | 'error';

export type CompileFn = (request: CompileRequest) => Promise<CompileResult>;

const defaultCompile: CompileFn = async (request) => {
  if (!window.electronAPI?.compile) {
    throw new Error('Compiler bridge (electronAPI.compile) is unavailable.');
  }
  return window.electronAPI.compile(request);
};

export interface VerifyOptions {
  boardId?: BoardId;
  sourceRevision?: number;
  compile?: CompileFn;
}

interface CompilerStoreState {
  status: CompileStatus;
  diagnostics: CompilerDiagnostic[];
  output: string;
  lastDurationMs: number | null;
  activeRequestId: string | null;
  errorCount: number;
  warningCount: number;

  verify: (source: string, options?: VerifyOptions) => Promise<boolean>;
  cancel: () => void;
  reset: () => void;
}

let counter = 0;
const nextRequestId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${counter++}`;

export const useCompilerStore = create<CompilerStoreState>((set, get) => ({
  status: 'idle',
  diagnostics: [],
  output: 'Ready.',
  lastDurationMs: null,
  activeRequestId: null,
  errorCount: 0,
  warningCount: 0,

  verify: async (source, options = {}) => {
    const { boardId = 'uno', sourceRevision = 0, compile = defaultCompile } = options;
    const requestId = nextRequestId();

    set({
      status: 'compiling',
      activeRequestId: requestId,
      output: 'Verifying…',
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
    });

    const isStale = (): boolean => get().activeRequestId !== requestId;

    try {
      const result = await compile({
        requestId,
        boardId,
        source,
        sourceRevision,
        sketchName: 'Sketch.ino',
      });
      if (isStale()) return result.ok;

      const errorCount = result.diagnostics.filter(
        (d) => d.severity === 'error' || d.severity === 'fatal',
      ).length;
      const warningCount = result.diagnostics.filter((d) => d.severity === 'warning').length;

      set({
        status: result.ok && errorCount === 0 ? 'success' : 'error',
        diagnostics: result.diagnostics,
        errorCount,
        warningCount,
        lastDurationMs: result.durationMs,
        output: result.ok
          ? `Done compiling in ${result.durationMs} ms.`
          : `Compilation failed — ${
              errorCount > 0
                ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
                : result.message
            }.`,
        activeRequestId: null,
      });
      return result.ok && errorCount === 0;
    } catch (err) {
      if (isStale()) return false;
      const message = err instanceof Error ? err.message : String(err);
      set({
        status: 'error',
        diagnostics: [],
        errorCount: 1,
        warningCount: 0,
        output: `Compiler error: ${message}`,
        activeRequestId: null,
      });
      return false;
    }
  },

  cancel: () =>
    set((s) =>
      s.status === 'compiling'
        ? { status: 'idle', activeRequestId: null, output: 'Verification cancelled.' }
        : s,
    ),

  reset: () =>
    set({
      status: 'idle',
      diagnostics: [],
      output: 'Ready.',
      lastDurationMs: null,
      activeRequestId: null,
      errorCount: 0,
      warningCount: 0,
    }),
}));

export const useCompileStatus = (): CompileStatus => useCompilerStore((s) => s.status);
export const useCompileOutput = (): string => useCompilerStore((s) => s.output);
