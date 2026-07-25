/**
 * Typed IPC contract for the compiler service.
 *
 * Sources:
 *  - OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §6 (request/result/progress + error codes)
 *  - UI_CANVAS_AND_PACKAGING_SPEC.md §14 (the richer, student-facing diagnostic that
 *    actually crosses IPC to the renderer)
 *
 * The renderer receives ONLY structured diagnostics with stable project URIs. Absolute
 * temporary directories, user names, install paths, executable paths, environment
 * values, and raw child-process objects never cross IPC.
 */
import type { BoardId } from './board-profiles';

export type { BoardId };

export interface CompileRequest {
  /** UUID created in the renderer. */
  requestId: string;
  boardId: BoardId;
  source: string;
  /** Monaco model version this source was captured at; a result is current only if it matches. */
  sourceRevision: number;
  /** Display only; never used as a path. */
  sketchName?: string;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'fatal';

export type DiagnosticPhase =
  | 'preprocess'
  | 'compile'
  | 'archive'
  | 'link'
  | 'objcopy'
  | 'size'
  | 'system';

/**
 * The student-facing diagnostic the renderer maps into Monaco markers and the Problems
 * view. `fileUri` uses the stable virtual sketch URI (offline-arduino://…), never a
 * temporary or executable path.
 */
export interface CompilerDiagnostic {
  id: string;
  phase: DiagnosticPhase;
  severity: DiagnosticSeverity;
  code: string;
  fileUri?: string;
  line?: number;
  column?: number;
  endColumn?: number;
  title: string;
  explanation: string;
  suggestedActions: string[];
  related?: Array<{ fileUri?: string; line?: number; message: string }>;
  /** Sanitized raw compiler text for the collapsed "Technical details" disclosure. */
  technicalDetail?: string;
  sourceRevision: number;
}

export type CompileErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_BOARD'
  | 'UNSUPPORTED_LIBRARY'
  | 'TOOLCHAIN_MISSING'
  | 'TOOLCHAIN_TAMPERED'
  | 'COMPILE_FAILED'
  | 'COMPILE_TIMEOUT'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export interface CompileSuccess {
  ok: true;
  requestId: string;
  sourceRevision: number;
  boardId: BoardId;
  /** Normalized, validated Intel HEX (uppercase hex, \n line endings). */
  hex: string;
  flashBytes: number;
  flashMaxBytes: number;
  sramBytes: number;
  sramMaxBytes: number;
  diagnostics: CompilerDiagnostic[];
  durationMs: number;
}

export interface CompileFailure {
  ok: false;
  requestId: string;
  sourceRevision: number;
  boardId: BoardId;
  errorCode: CompileErrorCode;
  message: string;
  diagnostics: CompilerDiagnostic[];
  durationMs: number;
}

export type CompileResult = CompileSuccess | CompileFailure;

export interface CompileProgress {
  requestId: string;
  phase: 'queued' | 'preprocess' | 'compile' | 'link' | 'hex' | 'done';
  message: string;
}
