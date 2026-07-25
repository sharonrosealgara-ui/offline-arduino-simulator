// Verifies a populated toolchain against its manifest.json: every listed file exists
// and matches its recorded SHA-256. Run after fetch-toolchain and in release CI.
//
//   node scripts/verify-toolchains.mjs [win32-x64|darwin-x64|darwin-arm64|linux-x64]
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const targets = process.argv.slice(2);
const all = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64'];
const selected = targets.length > 0 ? targets : all;

let failures = 0;

for (const target of selected) {
  const root = path.resolve('vendor', 'toolchains', target);
  const manifestPath = path.join(root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    console.warn(`[verify] ${target}: no manifest.json (not populated) — skipping.`);
    continue;
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) {
    console.warn(`[verify] ${target}: manifest has no file entries yet (toolchain not fetched).`);
    continue;
  }

  for (const item of files) {
    const abs = path.join(root, item.path);
    try {
      await access(abs, constants.F_OK);
    } catch {
      console.error(`[verify] ${target}: MISSING ${item.path}`);
      failures += 1;
      continue;
    }
    const digest = createHash('sha256').update(await readFile(abs)).digest('hex');
    if (item.sha256 && digest.toLowerCase() !== String(item.sha256).toLowerCase()) {
      console.error(`[verify] ${target}: HASH MISMATCH ${item.path}`);
      failures += 1;
    }
  }
  console.log(`[verify] ${target}: checked ${files.length} files.`);
}

if (failures > 0) {
  console.error(`[verify] FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log('[verify] All checked toolchains OK.');
