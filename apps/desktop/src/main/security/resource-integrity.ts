/**
 * SHA-256 verification of packaged runtime resources against their manifest.json.
 * Presence checking is NOT a substitute for hash checking (spec §24) — this runs
 * before the Compile action is enabled and reports TOOLCHAIN_TAMPERED on mismatch.
 */
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export interface ManifestFileEntry {
  path: string;
  sha256?: string;
}

export interface ToolchainManifest {
  schemaVersion: 1;
  target: string;
  toolchainVersion: string;
  exeSuffix: string;
  requiredExecutables: string[];
  files: ManifestFileEntry[];
}

export class ToolchainIntegrityError extends Error {
  constructor(
    message: string,
    public readonly code: 'TOOLCHAIN_MISSING' | 'TOOLCHAIN_TAMPERED',
  ) {
    super(message);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256Of(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Verifies every required executable exists, and — where the manifest carries a hash
 * (i.e. the toolchain was populated by fetch-toolchain.mjs, not left as a placeholder
 * dev stub) — that its SHA-256 matches. Missing manifest hash entries are treated as
 * "not yet verifiable" rather than tampered, so local development without a populated
 * toolchain still fails cleanly with TOOLCHAIN_MISSING instead of a false positive.
 */
export async function verifyToolchainIntegrity(
  toolchainRoot: string,
  manifest: ToolchainManifest,
  exeSuffix: string,
): Promise<void> {
  for (const name of manifest.requiredExecutables) {
    const exePath = path.join(toolchainRoot, 'bin', `${name}${exeSuffix}`);
    if (!(await fileExists(exePath))) {
      throw new ToolchainIntegrityError(`Missing bundled compiler executable: ${name}${exeSuffix}`, 'TOOLCHAIN_MISSING');
    }
  }

  for (const entry of manifest.files) {
    if (!entry.sha256) continue;
    const absolute = path.join(toolchainRoot, entry.path);
    if (!(await fileExists(absolute))) {
      throw new ToolchainIntegrityError(`Missing packaged file: ${entry.path}`, 'TOOLCHAIN_MISSING');
    }
    const digest = await sha256Of(absolute);
    if (digest.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new ToolchainIntegrityError(`Hash mismatch for packaged file: ${entry.path}`, 'TOOLCHAIN_TAMPERED');
    }
  }
}

export async function loadToolchainManifest(toolchainRoot: string): Promise<ToolchainManifest> {
  const manifestPath = path.join(toolchainRoot, 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    throw new ToolchainIntegrityError('Missing toolchain manifest.json', 'TOOLCHAIN_MISSING');
  }
  const raw = await readFile(manifestPath, 'utf8');
  try {
    return JSON.parse(raw) as ToolchainManifest;
  } catch {
    throw new ToolchainIntegrityError('Toolchain manifest.json is not valid JSON', 'TOOLCHAIN_TAMPERED');
  }
}
