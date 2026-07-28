/**
 * Toolchain integrity verification.
 *
 * Two things are guarded here:
 *
 *  1. A manifest that lists a file which is not on disk must fail with TOOLCHAIN_MISSING.
 *     This is exactly the condition that shipped in the packaged app when the prune step
 *     deleted 516 files without the manifest being regenerated: packaging succeeded and
 *     the first compile failed.
 *  2. The session memoization must not re-hash ~103 MB on every compile, and must NOT
 *     cache a failure — a repaired installation has to recover without an app restart.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureToolchainIntegrity,
  resetToolchainIntegrityCache,
  verifyToolchainIntegrity,
  ToolchainIntegrityError,
  type ToolchainManifest,
} from '../src/main/security/resource-integrity';

let root: string;

const sha = (text: string): string => createHash('sha256').update(Buffer.from(text)).digest('hex');

async function writeFileAt(relative: string, contents: string): Promise<void> {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

function manifestFor(files: Array<{ path: string; sha256?: string }>): ToolchainManifest {
  return {
    schemaVersion: 1,
    target: 'test-target',
    toolchainVersion: 'test-1.0',
    exeSuffix: '',
    requiredExecutables: ['avr-gcc'],
    files,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oas-integrity-'));
  resetToolchainIntegrityCache();
  await writeFileAt('bin/avr-gcc', 'binary');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  resetToolchainIntegrityCache();
});

describe('verifyToolchainIntegrity', () => {
  it('passes when every hashed file is present and matches', async () => {
    await writeFileAt('avr/lib/libc.a', 'library');
    const manifest = manifestFor([{ path: 'avr/lib/libc.a', sha256: sha('library') }]);

    await expect(verifyToolchainIntegrity(root, manifest, '')).resolves.toBeUndefined();
  });

  it('reports TOOLCHAIN_MISSING when a required executable is absent', async () => {
    await rm(path.join(root, 'bin', 'avr-gcc'));
    const manifest = manifestFor([]);

    await expect(verifyToolchainIntegrity(root, manifest, '')).rejects.toMatchObject({
      code: 'TOOLCHAIN_MISSING',
    });
  });

  it('reports TOOLCHAIN_MISSING when the manifest lists a file that was pruned away', async () => {
    const manifest = manifestFor([{ path: 'avr/lib/avr25/crtat86rf401.o', sha256: sha('anything') }]);

    const error = await verifyToolchainIntegrity(root, manifest, '').catch((e) => e);
    expect(error).toBeInstanceOf(ToolchainIntegrityError);
    expect(error.code).toBe('TOOLCHAIN_MISSING');
    expect(error.message).toContain('crtat86rf401.o');
  });

  it('reports TOOLCHAIN_TAMPERED when a file’s content does not match its hash', async () => {
    await writeFileAt('avr/lib/libc.a', 'modified');
    const manifest = manifestFor([{ path: 'avr/lib/libc.a', sha256: sha('original') }]);

    await expect(verifyToolchainIntegrity(root, manifest, '')).rejects.toMatchObject({
      code: 'TOOLCHAIN_TAMPERED',
    });
  });

  it('skips entries with no recorded hash rather than failing a dev toolchain', async () => {
    const manifest = manifestFor([{ path: 'not/on/disk' }]);
    await expect(verifyToolchainIntegrity(root, manifest, '')).resolves.toBeUndefined();
  });
});

describe('ensureToolchainIntegrity memoization', () => {
  it('verifies once and reuses the result for later compiles', async () => {
    await writeFileAt('avr/lib/libc.a', 'library');
    const manifest = manifestFor([{ path: 'avr/lib/libc.a', sha256: sha('library') }]);

    await ensureToolchainIntegrity(root, manifest, '');

    // Removing the file after a successful verification must not fail the second call:
    // that is the memoization doing its job (and is why the first compile is the one that
    // pays the ~1.7 s hashing cost, not every compile).
    await rm(path.join(root, 'avr/lib/libc.a'));
    await expect(ensureToolchainIntegrity(root, manifest, '')).resolves.toBeUndefined();
  });

  it('does not cache a failure, so a repaired installation recovers', async () => {
    const manifest = manifestFor([{ path: 'avr/lib/libc.a', sha256: sha('library') }]);

    await expect(ensureToolchainIntegrity(root, manifest, '')).rejects.toMatchObject({
      code: 'TOOLCHAIN_MISSING',
    });

    await writeFileAt('avr/lib/libc.a', 'library');
    await expect(ensureToolchainIntegrity(root, manifest, '')).resolves.toBeUndefined();
  });
});
