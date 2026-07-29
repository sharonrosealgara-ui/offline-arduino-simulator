/**
 * Compiler single-flight and request-identity guarantees.
 *
 * Regression cover for a defect found during packaged-app acceptance testing: pressing Run
 * while a Verify was still compiling produced "last compile failed" even though the build
 * had succeeded.
 *
 * The mechanism was request-id takeover. The second request ran the whole path before
 * discovering the compiler was busy: it minted a new id, overwrote the active id in both
 * stores, and the busy rejection was then recorded against that new id. When the ORIGINAL
 * compile finished, its id no longer matched, so the stale-result filter correctly — but
 * disastrously — discarded a successful build.
 *
 * The invariants asserted here:
 *   1. a refused request never allocates or replaces an active request id;
 *   2. a refused request never spawns a compiler process;
 *   3. the first result stays authoritative;
 *   4. genuinely stale results are STILL rejected (the guard is not weakened);
 *   5. genuine failures still report failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompileRequest, CompileResult } from '@offline-arduino/contracts/compiler';
import { useCompilerStore, COMPILER_BUSY_NOTICE } from '../src/renderer/app/state/compiler-store';
import { useAppStore } from '../src/renderer/state/store';

const SOURCE = 'void setup() {}\nvoid loop() {}\n';

function successResult(request: CompileRequest, hex = ':00000001FF\n'): CompileResult {
  return {
    ok: true,
    requestId: request.requestId,
    sourceRevision: request.sourceRevision,
    boardId: request.boardId,
    hex,
    flashBytes: 924,
    flashMaxBytes: 32256,
    sramBytes: 9,
    sramMaxBytes: 2048,
    diagnostics: [],
    durationMs: 1234,
  };
}

function failureResult(request: CompileRequest, message = 'The compile step failed.'): CompileResult {
  return {
    ok: false,
    requestId: request.requestId,
    sourceRevision: request.sourceRevision,
    boardId: request.boardId,
    errorCode: 'COMPILE_FAILED',
    message,
    diagnostics: [
      {
        id: 'E1:1',
        phase: 'compile',
        severity: 'error',
        code: 'E1',
        title: 'expected \';\'',
        explanation: 'A statement is missing a semicolon.',
        suggestedActions: [],
        sourceRevision: request.sourceRevision,
      },
    ],
    durationMs: 50,
  };
}

/** A deferred compile so a second request can arrive while the first is still in flight. */
function deferredCompile() {
  const calls: CompileRequest[] = [];
  let resolveWith: ((result: CompileResult) => void) | null = null;

  const compile = vi.fn((request: CompileRequest) => {
    calls.push(request);
    return new Promise<CompileResult>((resolve) => {
      resolveWith = (result) => resolve(result);
    });
  });

  return {
    compile,
    calls,
    finish(result: CompileResult) {
      resolveWith?.(result);
    },
  };
}

/** Mirrors the real CompileFn in workbench-controller: it tees results into the app store. */
function teeIntoAppStore(inner: (r: CompileRequest) => Promise<CompileResult>) {
  return async (request: CompileRequest): Promise<CompileResult> => {
    useAppStore.getState().actions.markCompileQueued(request.requestId);
    const result = await inner(request);
    useAppStore.getState().actions.applyCompileResult(result);
    return result;
  };
}

beforeEach(() => {
  useCompilerStore.getState().reset();
  useAppStore.setState((state) => ({
    compiler: {
      ...state.compiler,
      phase: 'idle',
      requestId: null,
      lastValidHex: null,
      lastValidRevision: null,
      diagnostics: [],
    },
  }));
});

describe('a single successful compile', () => {
  it('reports success and records the firmware', async () => {
    const d = deferredCompile();
    const promise = useCompilerStore.getState().verify(SOURCE, {
      sourceRevision: 1,
      compile: teeIntoAppStore(d.compile),
    });

    expect(useCompilerStore.getState().status).toBe('compiling');
    d.finish(successResult(d.calls[0]!));

    await expect(promise).resolves.toBe(true);
    expect(useCompilerStore.getState().status).toBe('success');
    expect(useAppStore.getState().compiler.lastValidHex).toBe(':00000001FF\n');
    expect(useAppStore.getState().compiler.phase).toBe('done');
  });
});

describe('a second request while the first is still running', () => {
  it('is refused without spawning a second compiler process', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    const second = await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    expect(second).toBe(false);
    // The compiler was invoked exactly once — the refusal never reached a process.
    expect(d.compile).toHaveBeenCalledTimes(1);

    d.finish(successResult(d.calls[0]!));
    await first;
  });

  it('surfaces a student-friendly busy notice', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    expect(useCompilerStore.getState().busyNotice).toBe(COMPILER_BUSY_NOTICE);
    // The running build still owns status/output; the refusal did not overwrite them.
    expect(useCompilerStore.getState().status).toBe('compiling');
    expect(useCompilerStore.getState().output).toBe('Verifying…');

    d.finish(successResult(d.calls[0]!));
    await first;
  });

  it('leaves the active request id untouched in BOTH stores', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    const compilerStoreId = useCompilerStore.getState().activeRequestId;
    const appStoreId = useAppStore.getState().compiler.requestId;
    expect(compilerStoreId).toBeTruthy();
    expect(appStoreId).toBe(compilerStoreId);

    await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    // This is the heart of the defect: the refused request must not take over the id.
    expect(useCompilerStore.getState().activeRequestId).toBe(compilerStoreId);
    expect(useAppStore.getState().compiler.requestId).toBe(appStoreId);

    d.finish(successResult(d.calls[0]!));
    await first;
  });

  it('accepts the first result when it completes and reports success', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });
    await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    d.finish(successResult(d.calls[0]!));

    await expect(first).resolves.toBe(true);
    expect(useCompilerStore.getState().status).toBe('success');
    expect(useCompilerStore.getState().output).toContain('Done compiling');
    // The regression itself: the app store must NOT be sitting in an error state, and the
    // firmware from the successful build must have been kept.
    expect(useAppStore.getState().compiler.phase).toBe('done');
    expect(useAppStore.getState().compiler.lastValidHex).toBe(':00000001FF\n');
  });

  it('never reports "last compile failed" after a successful build', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });
    await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });
    d.finish(successResult(d.calls[0]!));
    await first;

    // StatusBar derives "verified" from lastValidHex and "last compile failed" from
    // phase === 'error'; assert the exact inputs it reads.
    const compiler = useAppStore.getState().compiler;
    expect(compiler.lastValidHex).not.toBeNull();
    expect(compiler.phase).not.toBe('error');
  });
});

describe('rapid repeated Verify actions', () => {
  it('start exactly one compiler process no matter how many times they fire', async () => {
    const d = deferredCompile();
    const first = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });

    const extras = await Promise.all(
      Array.from({ length: 8 }, () =>
        useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) }),
      ),
    );

    expect(extras.every((r) => r === false)).toBe(true);
    expect(d.compile).toHaveBeenCalledTimes(1);

    d.finish(successResult(d.calls[0]!));
    await expect(first).resolves.toBe(true);
  });

  it('allows a new compile once the previous one has finished', async () => {
    const first = deferredCompile();
    const p1 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(first.compile) });
    first.finish(successResult(first.calls[0]!));
    await p1;

    const second = deferredCompile();
    const p2 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 2, compile: teeIntoAppStore(second.compile) });
    expect(second.compile).toHaveBeenCalledTimes(1);
    second.finish(successResult(second.calls[0]!, ':00000001AA\n'));

    await expect(p2).resolves.toBe(true);
    expect(useAppStore.getState().compiler.lastValidHex).toBe(':00000001AA\n');
  });
});

describe('stale-result protection is not weakened', () => {
  it('still ignores a result whose request id does not match the active one', () => {
    const actions = useAppStore.getState().actions;
    actions.markCompileQueued('current-request');

    actions.applyCompileResult({
      ok: true,
      requestId: 'some-older-request',
      sourceRevision: 1,
      diagnostics: [],
      hex: ':DEADBEEF\n',
      flashBytes: 100,
    });

    expect(useAppStore.getState().compiler.lastValidHex).toBeNull();
    expect(useAppStore.getState().compiler.phase).toBe('queued');
  });

  it('accepts a result whose request id does match', () => {
    const actions = useAppStore.getState().actions;
    actions.markCompileQueued('current-request');

    actions.applyCompileResult({
      ok: true,
      requestId: 'current-request',
      sourceRevision: 1,
      diagnostics: [],
      hex: ':GOOD\n',
      flashBytes: 100,
    });

    expect(useAppStore.getState().compiler.lastValidHex).toBe(':GOOD\n');
    expect(useAppStore.getState().compiler.phase).toBe('done');
  });

  it('drops a late result from a superseded compile', async () => {
    const slow = deferredCompile();
    const p1 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(slow.compile) });
    slow.finish(successResult(slow.calls[0]!));
    await p1;

    const supersededRequest = slow.calls[0]!;

    // A newer compile takes over, then the older one reports in late.
    const fresh = deferredCompile();
    const p2 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 2, compile: teeIntoAppStore(fresh.compile) });
    fresh.finish(successResult(fresh.calls[0]!, ':NEWER\n'));
    await p2;

    useAppStore.getState().actions.applyCompileResult(failureResult(supersededRequest));

    // The late failure from the superseded request must not clobber the newer success.
    expect(useAppStore.getState().compiler.lastValidHex).toBe(':NEWER\n');
    expect(useAppStore.getState().compiler.phase).toBe('done');
  });
});

describe('genuine compiler failures', () => {
  it('still report failure', async () => {
    const d = deferredCompile();
    const promise = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });
    d.finish(failureResult(d.calls[0]!));

    await expect(promise).resolves.toBe(false);
    expect(useCompilerStore.getState().status).toBe('error');
    expect(useCompilerStore.getState().errorCount).toBe(1);
    expect(useAppStore.getState().compiler.phase).toBe('error');
    expect(useAppStore.getState().compiler.lastValidHex).toBeNull();
  });

  it('do not leave the gate stuck closed', async () => {
    const d = deferredCompile();
    const p1 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: teeIntoAppStore(d.compile) });
    d.finish(failureResult(d.calls[0]!));
    await p1;

    // A failed build must not permanently block the next attempt.
    const d2 = deferredCompile();
    const p2 = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 2, compile: teeIntoAppStore(d2.compile) });
    expect(d2.compile).toHaveBeenCalledTimes(1);
    d2.finish(successResult(d2.calls[0]!));
    await expect(p2).resolves.toBe(true);
  });

  it('release the gate when the compile bridge throws', async () => {
    const throwing = vi.fn(() => Promise.reject(new Error('electronAPI.compile is not available')));
    await useCompilerStore.getState().verify(SOURCE, { sourceRevision: 1, compile: throwing });

    expect(useCompilerStore.getState().status).toBe('error');

    const ok = deferredCompile();
    const p = useCompilerStore.getState().verify(SOURCE, { sourceRevision: 2, compile: teeIntoAppStore(ok.compile) });
    expect(ok.compile).toHaveBeenCalledTimes(1);
    ok.finish(successResult(ok.calls[0]!));
    await expect(p).resolves.toBe(true);
  });
});
