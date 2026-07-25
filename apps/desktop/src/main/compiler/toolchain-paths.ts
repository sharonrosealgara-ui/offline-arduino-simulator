/**
 * Runtime resource resolver. ONLY Electron main imports this module.
 * Source: UI_CANVAS_AND_PACKAGING_SPEC.md §23 (supersedes the earlier draft in the
 * setup spec §4.5 — this is the version with realpath-based path-escape protection).
 *
 * Resolves the native toolchain for the CURRENT host (`${process.platform}-${process.arch}`)
 * from `process.resourcesPath` when packaged, or `vendor/` in development. Never falls
 * back to a system-installed compiler.
 */
import { app } from 'electron';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const SUPPORTED = new Set(['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64']);

export interface ToolchainLayout {
  id: string;
  root: string;
  arduinoRoot: string;
  gcc: string;
  gpp: string;
  ar: string;
  /**
   * LTO-plugin-aware archiver (`avr-gcc-ar`). MUST be used to build core.a because the
   * core is compiled with -flto: plain `avr-ar` writes a symbol index that omits LTO
   * (GIMPLE) symbols, so the final link fails with `undefined reference to 'pinMode'`
   * even though the symbol is inside the archive. `gcc-ar` passes `--plugin liblto_plugin`
   * to ar so the index includes those symbols.
   */
  gccAr: string;
  objcopy: string;
  size: string;
}

function executable(root: string, name: string): string {
  return path.join(root, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
}

export class UnsupportedHostError extends Error {
  constructor(public readonly hostId: string) {
    super(`Unsupported host platform/architecture: ${hostId}`);
  }
}

export async function resolveToolchain(): Promise<ToolchainLayout> {
  const id = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.has(id)) throw new UnsupportedHostError(id);

  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), '..', '..');

  const root = app.isPackaged
    ? path.join(resourcesRoot, 'runtime', 'toolchains', id)
    : path.join(resourcesRoot, 'vendor', 'toolchains', id);
  const arduinoRoot = app.isPackaged
    ? path.join(resourcesRoot, 'runtime', 'arduino-avr')
    : path.join(resourcesRoot, 'vendor', 'arduino-avr');

  const canonicalRoot = await realpath(root).catch(() => root);
  const canonicalArduinoRoot = await realpath(arduinoRoot).catch(() => arduinoRoot);

  const layout: ToolchainLayout = {
    id,
    root: canonicalRoot,
    arduinoRoot: canonicalArduinoRoot,
    gcc: executable(canonicalRoot, 'avr-gcc'),
    gpp: executable(canonicalRoot, 'avr-g++'),
    ar: executable(canonicalRoot, 'avr-ar'),
    gccAr: executable(canonicalRoot, 'avr-gcc-ar'),
    objcopy: executable(canonicalRoot, 'avr-objcopy'),
    size: executable(canonicalRoot, 'avr-size'),
  };

  for (const candidate of [layout.gcc, layout.gpp, layout.ar, layout.gccAr, layout.objcopy, layout.size]) {
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch {
      throw Object.assign(new Error(`Missing bundled compiler executable: ${candidate}`), { code: 'TOOLCHAIN_MISSING' });
    }
    const relative = path.relative(canonicalRoot, canonical);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw Object.assign(new Error('TOOLCHAIN_PATH_ESCAPE'), { code: 'TOOLCHAIN_TAMPERED' });
    }
    await access(canonical, process.platform === 'win32' ? constants.F_OK : constants.X_OK).catch(() => {
      throw Object.assign(new Error(`Compiler executable is not accessible: ${candidate}`), { code: 'TOOLCHAIN_MISSING' });
    });
  }

  return layout;
}

/** Absolute path to the bundled examples/help/schemas root (extraResources `runtime/`). */
export function resolveRuntimeResourcesRoot(): string {
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), '..', '..');
  return app.isPackaged ? path.join(resourcesRoot, 'runtime') : path.join(resourcesRoot, 'resources');
}
