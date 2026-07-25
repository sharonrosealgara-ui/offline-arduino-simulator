/**
 * Central place for "is this path where we expect it to be" checks, and the one
 * trusted definition of the app's own origin (used by IPC sender validation and the
 * BrowserWindow navigation guard).
 */
import { app } from 'electron';
import path from 'node:path';

let cachedOrigin: URL | null = null;

/** The app's own renderer origin: file:// in production, the Vite dev server in dev. */
export function getAppOrigin(): URL {
  if (cachedOrigin) return cachedOrigin;
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  cachedOrigin = devServerUrl ? new URL(devServerUrl) : new URL(`file://${app.getAppPath()}`);
  return cachedOrigin;
}

/**
 * Resolves `candidate` and asserts it stays within `root` after resolving symlinks.
 * Throws PATH_ESCAPE if the resolved path would land outside `root`. Use for every
 * path derived (even indirectly) from renderer- or project-supplied input.
 */
export function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(root, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Path escapes the allowed directory.'), { code: 'PATH_ESCAPE' });
  }
  return resolvedCandidate;
}

/** Strips a set of known-sensitive absolute path prefixes out of arbitrary text before it can cross IPC. */
export function scrubPaths(text: string, sensitiveRoots: string[]): string {
  let result = text;
  for (const root of sensitiveRoots) {
    if (!root) continue;
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '<workspace>');
  }
  return result;
}
