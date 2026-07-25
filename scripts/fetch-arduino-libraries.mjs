// Build-time ONLY. Downloads the two allowlisted Arduino libraries that ship
// separately from the AVR core archive — LiquidCrystal and Servo — from Arduino's
// official library mirror (downloads.arduino.cc/libraries/github.com/arduino-libraries),
// verifies pinned SHA-256 hashes, extracts them into vendor/arduino-avr/libraries/,
// and refreshes the per-file hash entries in vendor/arduino-avr/manifest.json.
//
//   node scripts/fetch-arduino-libraries.mjs
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

// Pinned from Arduino's official library_index.json (downloads.arduino.cc mirror).
const LIBRARIES = [
  {
    name: 'LiquidCrystal',
    version: '1.0.7',
    url: 'https://downloads.arduino.cc/libraries/github.com/arduino-libraries/LiquidCrystal-1.0.7.zip',
    sha256: 'f7b14c42afbbdcfbe66073e6ef1e4cbaa03f5d11f52f9ab91c916b6ccac38434',
  },
  {
    name: 'Servo',
    version: '1.2.2',
    url: 'https://downloads.arduino.cc/libraries/github.com/arduino-libraries/Servo-1.2.2.zip',
    sha256: '60850b4c644aa4239706fa50ca09a49c99fb98b0e0f2fb84b30022b82428908b',
  },
];

const destRoot = path.resolve('vendor', 'arduino-avr');
const manifestPath = path.join(destRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const lib of LIBRARIES) {
  const archivePath = path.join(tmpdir(), `oas-lib-${lib.name}-${lib.version}.zip`);
  console.log(`[fetch-libraries] Downloading ${lib.url}`);
  const response = await fetch(lib.url);
  if (!response.ok || !response.body) throw new Error(`Download failed for ${lib.name}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(archivePath));

  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (lib.sha256 && digest.toLowerCase() !== lib.sha256.toLowerCase()) {
    await rm(archivePath, { force: true });
    throw new Error(`SHA-256 mismatch for ${lib.name}.\n  expected ${lib.sha256}\n  actual ${digest}`);
  }
  console.log(`[fetch-libraries] ${lib.name}@${lib.version} sha256=${digest}`);

  const stage = path.join(tmpdir(), `oas-lib-stage-${lib.name}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const res = spawnSync('tar', ['-xf', archivePath, '-C', stage], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`Extraction failed for ${lib.name}.`);

  // Archive root folder is e.g. LiquidCrystal-1.0.7/ — locate it.
  const [rootEntry] = await readdir(stage);
  const src = path.join(stage, rootEntry);
  const dest = path.join(destRoot, 'libraries', lib.name);
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
  console.log(`[fetch-libraries] Installed libraries/${lib.name}`);

  await rm(stage, { recursive: true, force: true });
  await rm(archivePath, { force: true });
}

// Refresh manifest per-file hashes.
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}
const files = [];
for await (const abs of walk(destRoot)) {
  const rel = path.relative(destRoot, abs).split(path.sep).join('/');
  if (rel === 'manifest.json') continue;
  const buf = await readFile(abs);
  files.push({ path: rel, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
}
manifest.files = files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[fetch-libraries] Done. Manifest now records ${files.length} files.`);
