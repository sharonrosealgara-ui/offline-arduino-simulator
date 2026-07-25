/**
 * Compilation orchestrator: preprocess -> compile core (cached) -> compile sketch ->
 * link -> objcopy -> validate HEX -> enforce memory limits. Source: setup spec §8.
 *
 * One compile job at a time for MVP (spec §5.4). Every stage invokes the resolved
 * bundled executable directly via `runProcess` (argv array, shell:false, bounded
 * output/time, isolated temp cwd, minimal env). Never falls back to a system compiler.
 */
import { app } from 'electron';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { CompileErrorCode, CompileRequest, CompileResult, CompilerDiagnostic } from '@offline-arduino/contracts/compiler';
import { BOARD_PROFILES, type BoardProfile } from '@offline-arduino/contracts/board-profiles';
import { resolveToolchain, type ToolchainLayout } from './toolchain-paths';
import { loadToolchainManifest, verifyToolchainIntegrity, ToolchainIntegrityError } from '../security/resource-integrity';
import { runProcess, createCompilerEnv, ProcessRunError } from './process-runner';
import { preprocessIno } from './ino-preprocessor';
import {
  makeAsmCompileArgs,
  makeArchiveArgs,
  makeCCompileArgs,
  makeCppCompileArgs,
  makeLinkArgs,
  makeObjcopyArgs,
  makeSizeArgs,
} from './build-recipe';
import { validateIntelHex, IntelHexValidationError } from './intel-hex';
import { computeCoreCacheKey, getCachedCoreArchive, publishCoreArchive } from './core-cache';
import { parseCompilerOutput } from './diagnostics-parser';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOURCE_BYTES = 1_048_576;
const COMPILE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

async function listSourceFiles(root: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) results.push(full);
    }
  }
  await walk(root);
  return results.sort();
}

function parseSizeOutput(sizeStdout: string): { flash: number; sram: number } {
  // avr-size -A output: one "section  size  addr" line per section, plus a Total line.
  // We sum the sections that make up flash (.text/.data/.bootloader) and SRAM
  // (.data/.bss/.noinit) per spec §5.3. Missing sections count as 0.
  const wanted = { flash: ['.text', '.data', '.bootloader'], sram: ['.data', '.bss', '.noinit'] };
  const sizes = new Map<string, number>();
  for (const line of sizeStdout.split('\n')) {
    const match = line.trim().match(/^(\.\S+)\s+(\d+)/);
    if (match) sizes.set(match[1], Number(match[2]));
  }
  const sum = (names: string[]) => names.reduce((total, name) => total + (sizes.get(name) ?? 0), 0);
  return { flash: sum(wanted.flash), sram: sum(wanted.sram) };
}

export class CompilerService {
  private readonly active = new Map<string, AbortController>();
  private busy = false;

  cancel(requestId: string): boolean {
    const controller = this.active.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const started = performance.now();
    const profile = BOARD_PROFILES[request.boardId];

    if (
      !profile ||
      !REQUEST_ID_PATTERN.test(request.requestId) ||
      Buffer.byteLength(request.source, 'utf8') > MAX_SOURCE_BYTES ||
      this.active.has(request.requestId)
    ) {
      return this.failure(request, 'INVALID_REQUEST', 'The compilation request is invalid.', started, []);
    }
    if (this.busy) {
      return this.failure(request, 'INVALID_REQUEST', 'Compiler is busy; try again shortly.', started, []);
    }

    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    this.busy = true;
    let workspace: string | undefined;

    try {
      workspace = await mkdtemp(path.join(app.getPath('temp'), 'oas-build-'));
      const sensitiveRoots = [workspace, app.getAppPath(), app.getPath('userData')];

      const layout = await resolveToolchain().catch((error) => {
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { code: 'TOOLCHAIN_MISSING' });
      });
      const manifest = await loadToolchainManifest(layout.root);
      await verifyToolchainIntegrity(layout.root, manifest, process.platform === 'win32' ? '.exe' : '');

      const { cpp: generatedCpp, lineOffset } = preprocessIno(request.source, request.sketchName ?? 'Sketch.ino');

      const sketchDir = path.join(workspace, 'sketch');
      await mkdir(sketchDir, { recursive: true });
      const cppPath = path.join(sketchDir, 'Sketch.cpp');
      const sketchObject = path.join(sketchDir, 'Sketch.cpp.o');
      await writeFile(cppPath, generatedCpp, { encoding: 'utf8', mode: 0o600 });

      const env = createCompilerEnv(path.join(layout.root, 'bin'), workspace);
      const coreDir = path.join(layout.arduinoRoot, 'cores', profile.core);
      const variantDir = path.join(layout.arduinoRoot, 'variants', profile.variant);

      const diagnosticOptions = { lineOffset, sourceRevision: request.sourceRevision, sensitiveRoots };

      // --- Sketch compile -----------------------------------------------------------
      try {
        await runProcess(
          layout.gpp,
          makeCppCompileArgs(profile, layout, coreDir, variantDir, cppPath, sketchObject),
          { cwd: workspace, env, signal: controller.signal, timeoutMs: COMPILE_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES },
        );
      } catch (error) {
        return this.compileFailureFromProcessError(request, error, 'compile', diagnosticOptions, started, 'avr-g++');
      }

      // --- Core archive (cached) ------------------------------------------------------
      const coreArchive = await this.obtainCoreArchive(layout, profile, coreDir, variantDir, env, controller.signal, request, diagnosticOptions, started);
      if ('errorResult' in coreArchive) return coreArchive.errorResult;

      // --- Link -------------------------------------------------------------------------
      const elfPath = path.join(workspace, 'firmware.elf');
      try {
        await runProcess(layout.gcc, makeLinkArgs(profile, workspace, [sketchObject], coreArchive.path, elfPath), {
          cwd: workspace,
          env,
          signal: controller.signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
      } catch (error) {
        return this.compileFailureFromProcessError(request, error, 'link', diagnosticOptions, started, 'linker');
      }

      // --- objcopy -> HEX -----------------------------------------------------------------
      const hexPath = path.join(workspace, 'firmware.hex');
      try {
        await runProcess(layout.objcopy, makeObjcopyArgs(elfPath, hexPath), {
          cwd: workspace,
          env,
          signal: controller.signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
      } catch (error) {
        return this.compileFailureFromProcessError(request, error, 'objcopy', diagnosticOptions, started, 'avr-objcopy');
      }

      // --- size -------------------------------------------------------------------------
      let sizeStdout = '';
      try {
        const sizeResult = await runProcess(layout.size, makeSizeArgs(elfPath), {
          cwd: workspace,
          env,
          signal: controller.signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
        sizeStdout = sizeResult.stdout;
      } catch (error) {
        return this.compileFailureFromProcessError(request, error, 'size', diagnosticOptions, started, 'avr-size');
      }

      const hexText = await readFile(hexPath, 'utf8');
      let validated;
      try {
        validated = validateIntelHex(hexText, profile);
      } catch (error) {
        const message = error instanceof IntelHexValidationError ? error.message : 'Compiler produced an invalid HEX file.';
        return this.failure(request, 'COMPILE_FAILED', message, started, []);
      }

      const usage = parseSizeOutput(sizeStdout);
      if (usage.flash > profile.flashMaxBytes) {
        return this.failure(request, 'COMPILE_FAILED', 'The sketch is too large for Uno program memory.', started, [
          this.limitDiagnostic('FLASH_OVERFLOW', 'The sketch is too large for Uno program memory.', request.sourceRevision),
        ]);
      }
      if (usage.sram > profile.sramMaxBytes) {
        return this.failure(request, 'COMPILE_FAILED', 'Global data is too large for Uno memory.', started, [
          this.limitDiagnostic('SRAM_OVERFLOW', 'Global data is too large for Uno memory.', request.sourceRevision),
        ]);
      }

      return {
        ok: true,
        requestId: request.requestId,
        sourceRevision: request.sourceRevision,
        boardId: request.boardId,
        hex: validated.normalizedHex,
        flashBytes: usage.flash || validated.flashBytesUsed,
        flashMaxBytes: profile.flashMaxBytes,
        sramBytes: usage.sram,
        sramMaxBytes: profile.sramMaxBytes,
        diagnostics: [],
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return this.mapUnexpectedError(request, error, started);
    } finally {
      this.active.delete(request.requestId);
      this.busy = false;
      if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async obtainCoreArchive(
    layout: ToolchainLayout,
    profile: BoardProfile,
    coreDir: string,
    variantDir: string,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    request: CompileRequest,
    diagnosticOptions: Parameters<typeof parseCompilerOutput>[2],
    started: number,
  ): Promise<{ path: string } | { errorResult: CompileResult }> {
    const cacheKey = computeCoreCacheKey({
      toolchainId: layout.id,
      // The suffix bumps the cache namespace so any core.a produced by the earlier
      // plain-`avr-ar` archiver (which broke LTO symbol resolution) is not reused.
      toolchainVersion: 'pinned+ltoar',
      coreVersion: profile.core,
      boardId: profile.id,
      flagsSnapshot: JSON.stringify(makeCppCompileArgs(profile, layout, coreDir, variantDir, 'x', 'y')),
    });

    const cached = await getCachedCoreArchive(cacheKey);
    if (cached) return { path: cached };

    const buildDir = path.join(path.dirname(coreDir), '..', '..', 'oas-core-build');
    await mkdir(buildDir, { recursive: true }).catch(() => undefined);
    const workDir = await mkdtemp(path.join(app.getPath('temp'), 'oas-core-'));

    try {
      const cSources = await listSourceFiles(coreDir, ['.c']);
      const cppSources = await listSourceFiles(coreDir, ['.cpp']);
      const asmSources = await listSourceFiles(coreDir, ['.S']);
      const objects: string[] = [];

      for (const source of cSources) {
        const objectPath = path.join(workDir, `${path.basename(source)}.o`);
        await runProcess(layout.gcc, makeCCompileArgs(profile, layout, coreDir, variantDir, source, objectPath), {
          cwd: workDir,
          env,
          signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
        objects.push(objectPath);
      }
      for (const source of cppSources) {
        const objectPath = path.join(workDir, `${path.basename(source)}.o`);
        await runProcess(layout.gpp, makeCppCompileArgs(profile, layout, coreDir, variantDir, source, objectPath), {
          cwd: workDir,
          env,
          signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
        objects.push(objectPath);
      }
      for (const source of asmSources) {
        const objectPath = path.join(workDir, `${path.basename(source)}.o`);
        await runProcess(layout.gcc, makeAsmCompileArgs(profile, layout, coreDir, variantDir, source, objectPath), {
          cwd: workDir,
          env,
          signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
        objects.push(objectPath);
      }

      if (objects.length === 0) {
        return {
          errorResult: this.failure(
            request,
            'TOOLCHAIN_MISSING',
            'The Arduino core sources are not installed. This offline build is missing its bundled core.',
            started,
            [],
          ),
        };
      }

      const archivePath = path.join(workDir, 'core.a');
      // Use the LTO-aware archiver (avr-gcc-ar), NOT plain avr-ar: the core is built with
      // -flto, so the archive symbol index must include LTO symbols or the link fails with
      // `undefined reference to 'pinMode'` (etc.). See ToolchainLayout.gccAr.
      const arExecutable = layout.gccAr;
      for (const objectPath of objects) {
        await runProcess(arExecutable, makeArchiveArgs(archivePath, objectPath), {
          cwd: workDir,
          env,
          signal,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
      }

      const published = await publishCoreArchive(cacheKey, archivePath);
      return { path: published };
    } catch (error) {
      return { errorResult: this.compileFailureFromProcessError(request, error, 'compile', diagnosticOptions, started, 'avr-gcc') };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private compileFailureFromProcessError(
    request: CompileRequest,
    error: unknown,
    phase: 'compile' | 'archive' | 'link' | 'objcopy' | 'size',
    options: Parameters<typeof parseCompilerOutput>[2],
    started: number,
    tool: 'avr-gcc' | 'avr-g++' | 'avr-ar' | 'avr-objcopy' | 'avr-size' | 'linker',
  ): CompileResult {
    if (error instanceof ProcessRunError) {
      if (error.code === 'CANCELLED') return this.failure(request, 'CANCELLED', 'Compilation was cancelled.', started, []);
      if (error.code === 'COMPILE_TIMEOUT') return this.failure(request, 'COMPILE_TIMEOUT', 'Compilation took too long and was stopped.', started, []);
      const combined = `${error.stdout}\n${error.stderr}`;
      const diagnostics = parseCompilerOutput(combined, tool, options);
      return this.failure(request, 'COMPILE_FAILED', `The ${phase} step failed.`, started, diagnostics);
    }
    return this.mapUnexpectedError(request, error, started);
  }

  private mapUnexpectedError(request: CompileRequest, error: unknown, started: number): CompileResult {
    if (error instanceof ToolchainIntegrityError) {
      return this.failure(request, error.code, error.message, started, []);
    }
    const message = error instanceof Error ? error.message : 'An internal error occurred.';
    const code = (error as { code?: string })?.code;
    if (code === 'TOOLCHAIN_MISSING' || code === 'TOOLCHAIN_TAMPERED') {
      return this.failure(request, code, message, started, []);
    }
    return this.failure(request, 'INTERNAL_ERROR', 'An internal error occurred while compiling.', started, []);
  }

  private limitDiagnostic(code: string, message: string, sourceRevision: number): CompilerDiagnostic {
    return {
      id: `${code}:0`,
      phase: 'link',
      severity: 'error',
      code,
      title: message,
      explanation: message,
      suggestedActions: [],
      sourceRevision,
    };
  }

  private failure(
    request: CompileRequest,
    errorCode: CompileErrorCode,
    message: string,
    started: number,
    diagnostics: CompilerDiagnostic[],
  ): CompileResult {
    return {
      ok: false,
      requestId: request.requestId,
      sourceRevision: request.sourceRevision,
      boardId: request.boardId,
      errorCode,
      message,
      diagnostics,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
