// Populates vendor/toolchains/<target>/manifest.json with per-file { path, sha256, bytes }
// entries after fetch-toolchain.mjs has extracted a verified archive. This is what
// verify-toolchains.mjs and the first-compiler-use integrity check consume.
//
//   node scripts/populate-toolchain-manifest.mjs win32-x64
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/populate-toolchain-manifest.mjs <win32-x64|darwin-x64|darwin-arm64|linux-x64>');
  process.exit(1);
}

const root = path.resolve('vendor', 'toolchains', target);
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const lock = JSON.parse(await readFile(new URL('../toolchain-lock.json', import.meta.url), 'utf8'));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}

const files = [];
for await (const abs of walk(root)) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (rel === 'manifest.json') continue;
  const buf = await readFile(abs);
  files.push({
    path: rel,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  });
}

// Sanity: required executables must be present.
const exeSuffix = manifest.exeSuffix ?? '';
for (const name of manifest.requiredExecutables ?? []) {
  const relExe = `bin/${name}${exeSuffix}`;
  if (!files.some((f) => f.path === relExe)) {
    console.error(`[populate-manifest] Required executable missing after extraction: ${relExe}`);
    process.exit(1);
  }
}

manifest.toolchainVersion = lock.toolchainVersion;
manifest.files = files.sort((a, b) => a.path.localeCompare(b.path));

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[populate-manifest] ${target}: recorded ${files.length} files (toolchain ${lock.toolchainVersion}).`);
