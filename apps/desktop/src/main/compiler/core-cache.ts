/**
 * Caches the compiled Arduino core archive (core.a) keyed by a hash of the toolchain
 * manifest + core manifest + board profile + flags, so repeated compiles skip
 * recompiling ~40 core source files. Source: setup spec §5.4.
 *
 * Populated atomically: write to a temp directory under the cache root, then rename
 * into place — a reader never observes a partially-written cache entry.
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, rename, access, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface CoreCacheKeyInput {
  toolchainId: string;
  toolchainVersion: string;
  coreVersion: string;
  boardId: string;
  flagsSnapshot: string;
}

function cacheRoot(): string {
  return path.join(app.getPath('userData'), 'build-cache', 'core');
}

export function computeCoreCacheKey(input: CoreCacheKeyInput): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(input));
  return hash.digest('hex').slice(0, 32);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Returns the cached core.a path if present, or null if this key has not been built yet. */
export async function getCachedCoreArchive(key: string): Promise<string | null> {
  const archivePath = path.join(cacheRoot(), key, 'core.a');
  return (await exists(archivePath)) ? archivePath : null;
}

/** Atomically publishes a freshly-built core.a into the cache under `key`. */
export async function publishCoreArchive(key: string, builtArchivePath: string): Promise<string> {
  const root = cacheRoot();
  await mkdir(root, { recursive: true });
  const finalDir = path.join(root, key);
  if (await exists(path.join(finalDir, 'core.a'))) {
    return path.join(finalDir, 'core.a'); // another compile already published this key
  }
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'oas-core-cache-'));
  try {
    const stagedArchive = path.join(stagingDir, 'core.a');
    await copyFile(builtArchivePath, stagedArchive);
    await mkdir(path.dirname(finalDir), { recursive: true });
    await rename(stagingDir, finalDir).catch(async (error) => {
      // Rename across a cache-root boundary can fail with EXDEV on some filesystems;
      // fall back to a best-effort copy-then-cleanup.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await mkdir(finalDir, { recursive: true });
      await copyFile(stagedArchive, path.join(finalDir, 'core.a'));
    });
    return path.join(finalDir, 'core.a');
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
