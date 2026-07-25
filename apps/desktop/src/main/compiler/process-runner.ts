/**
 * Safe process runner: argv array (never a shell string), bounded output, timeout,
 * and cancellation via AbortSignal. Source: OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §7.
 *
 * Every bundled compiler stage is invoked directly and is expected not to create a
 * persistent child tree. `shell: false` always — never build a command string.
 */
import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export class ProcessRunError extends Error {
  constructor(
    message: string,
    public readonly code: 'COMPILE_TIMEOUT' | 'OUTPUT_LIMIT' | 'CANCELLED' | 'PROCESS_FAILED' | 'SPAWN_FAILED',
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode?: number | null,
  ) {
    super(message);
  }
}

export async function runProcess(executable: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const cap = options.maxOutputBytes ?? 2 * 1024 * 1024;

  return await new Promise<RunResult>((resolve, reject) => {
    let settled = false;

    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });

    let stdout = '';
    let stderr = '';
    let bytes = 0;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      child.kill();
      settle(() => reject(new ProcessRunError('Compiler timed out', 'COMPILE_TIMEOUT', stdout, stderr)));
    }, timeoutMs);

    const append = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      bytes += chunk.byteLength;
      if (bytes > cap) {
        child.kill();
        settle(() => reject(new ProcessRunError('Compiler output exceeded limit', 'OUTPUT_LIMIT', stdout, stderr)));
        return;
      }
      if (kind === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

    child.once('error', (error) => {
      settle(() => reject(new ProcessRunError(error.message, 'SPAWN_FAILED', stdout, stderr)));
    });

    child.once('close', (code, signal) => {
      settle(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const cancelled = Boolean(options.signal?.aborted);
          reject(
            new ProcessRunError(
              `Compiler exited with code ${code}`,
              cancelled ? 'CANCELLED' : 'PROCESS_FAILED',
              stdout,
              stderr,
              code,
            ),
          );
          void signal;
        }
      });
    });
  });
}

/**
 * A minimal, deterministic compiler environment. Never pass the renderer's environment,
 * user-defined variables, arbitrary include paths, or arbitrary executable names.
 */
export function createCompilerEnv(binDir: string, workspace: string): NodeJS.ProcessEnv {
  return {
    PATH: binDir,
    TMPDIR: workspace,
    TEMP: workspace,
    TMP: workspace,
    LC_ALL: 'C',
    LANG: 'C',
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
  };
}
