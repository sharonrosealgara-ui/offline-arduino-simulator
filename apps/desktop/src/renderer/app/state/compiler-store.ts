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

/** Shown when a compile is requested while one is already running. */
export const COMPILER_BUSY_NOTICE = 'Already compiling — please wait for this build to finish.';

interface CompilerStoreState {
  status: CompileStatus;
  diagnostics: CompilerDiagnostic[];
  output: string;
  lastDurationMs: number | null;
  activeRequestId: string | null;
  errorCount: number;
  warningCount: number;
  /**
   * Transient message for a request that was refused because a compile is already running.
   *
   * Deliberately separate from `status`/`output`: those describe the *in-flight* compile and
   * must not be repurposed to report a rejection, or the running build's real outcome would
   * be overwritten by a request that never ran.
   */
  busyNotice: string | null;

  verify: (source: string, options?: VerifyOptions) => Promise<boolean>;
  cancel: () => void;
  reset: () => void;
  dismissBusyNotice: () => void;
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
  busyNotice: null,

  verify: async (source, options = {}) => {
    // ---- Single-flight gate -----------------------------------------------------------
    // A compile requested while one is already running is refused HERE, before a request id
    // is allocated and before any process is spawned.
    //
    // Previously the second request ran the full path: it minted a new id, overwrote
    // `activeRequestId` (and, via the compile callback, the app store's
    // `compiler.requestId`), and only then discovered the main process was busy. The
    // rejection was attributed to the new id, so when the ORIGINAL compile finished
    // successfully its result no longer matched the recorded id and was dropped as stale —
    // leaving "last compile failed" on screen after a build that actually succeeded.
    //
    // Refusing early keeps the running request's identity intact, so its result stays
    // authoritative. Stale-result protection is untouched: ids still have to match.
    if (get().status === 'compiling') {
      set({ busyNotice: COMPILER_BUSY_NOTICE });
      return false;
    }

    const { boardId = 'uno', sourceRevision = 0, compile = defaultCompile } = options;
    const requestId = nextRequestId();

    set({
      status: 'compiling',
      activeRequestId: requestId,
      output: 'Verifying…',
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
      busyNotice: null,
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
        ? { status: 'idle', activeRequestId: null, output: 'Verification cancelled.', busyNotice: null }
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
      busyNotice: null,
    }),

  dismissBusyNotice: () => set({ busyNotice: null }),
}));

export const useCompileStatus = (): CompileStatus => useCompilerStore((s) => s.status);
export const useCompileOutput = (): string => useCompilerStore((s) => s.output);
