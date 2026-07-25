// Build-time ONLY. Downloads a pinned AVR toolchain archive for one target, verifies
// its SHA-256 against toolchain-lock.json, then extracts it into vendor/toolchains/<id>.
//
// Network access is permitted ONLY here, in the controlled build pipeline — never in
// the installed app. (Setup spec §4.2)
//
//   node scripts/fetch-toolchain.mjs win32-x64
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/fetch-toolchain.mjs <win32-x64|darwin-x64|darwin-arm64|linux-x64>');
  process.exit(1);
}

const lock = JSON.parse(await readFile(new URL('../toolchain-lock.json', import.meta.url), 'utf8'));
const entry = lock.targets[target];
if (!entry) {
  console.error(`No lock entry for target "${target}".`);
  process.exit(1);
}
if (!entry.url || entry.url.startsWith('BUILD_TIME_')) {
  console.error(`Lock entry for "${target}" still has a placeholder URL. Fill toolchain-lock.json with audited values first.`);
  process.exit(1);
}

const destDir = path.resolve('vendor', 'toolchains', target);
const archivePath = path.join(tmpdir(), `oas-toolchain-${target}${path.extname(new URL(entry.url).pathname) || '.archive'}`);

console.log(`[fetch-toolchain] Downloading ${entry.url}`);
const response = await fetch(entry.url);
if (!response.ok || !response.body) {
  throw new Error(`Download failed: HTTP ${response.status}`);
}
await pipeline(response.body, createWriteStream(archivePath));

console.log('[fetch-toolchain] Verifying SHA-256…');
const hash = createHash('sha256');
hash.update(await readFile(archivePath));
const digest = hash.digest('hex');
if (digest.toLowerCase() !== String(entry.sha256).toLowerCase()) {
  await rm(archivePath, { force: true });
  throw new Error(`SHA-256 mismatch for ${target}.\n  expected ${entry.sha256}\n  actual   ${digest}`);
}
console.log(`[fetch-toolchain] Hash OK: ${digest}`);

await mkdir(destDir, { recursive: true });

// Extraction: prefer system tar (handles .tar.gz/.tar.xz/.zip on modern Windows too).
console.log(`[fetch-toolchain] Extracting into ${destDir}`);
const res = spawnSync('tar', ['-xf', archivePath, '-C', destDir, '--strip-components=1'], {
  stdio: 'inherit',
});
if (res.status !== 0) {
  throw new Error(
    'Extraction via system `tar` failed. Extract the verified archive manually into ' +
      `${destDir}, preserving the complete toolchain prefix layout.`,
  );
}

await rm(archivePath, { force: true });
console.log(`[fetch-toolchain] Done. Now run: node scripts/verify-toolchains.mjs ${target}`);
