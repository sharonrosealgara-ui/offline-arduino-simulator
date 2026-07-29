// Build-time ONLY. Downloads the pinned official Arduino AVR core (avr-1.8.3.tar.bz2),
// verifies its SHA-256 against Arduino's published checksum, extracts cores/arduino,
// variants/standard, and the allowlisted bundled libraries into vendor/arduino-avr,
// then records per-file SHA-256 entries in vendor/arduino-avr/manifest.json.
//
// Source of pinned values: arduino/Arduino hardware/package_index_bundled.json
//   url:      https://downloads.arduino.cc/cores/avr-1.8.3.tar.bz2
//   sha256:   de8a9b982477762d3d3e52fc2b682cdd8ff194dc3f1d46f4debdea6a01b33c14
//
//   node scripts/fetch-arduino-core.mjs
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const CORE_URL = 'https://downloads.arduino.cc/cores/avr-1.8.3.tar.bz2';
const CORE_SHA256 = 'de8a9b982477762d3d3e52fc2b682cdd8ff194dc3f1d46f4debdea6a01b33c14';
const CORE_VERSION = '1.8.3';

const destRoot = path.resolve('vendor', 'arduino-avr');
const manifestPath = path.join(destRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const allowedLibraries = manifest.supportedLibraries ?? ['EEPROM', 'SPI', 'Wire', 'LiquidCrystal', 'Servo'];

const archivePath = path.join(tmpdir(), 'oas-arduino-core-avr-1.8.3.tar.bz2');

console.log(`[fetch-arduino-core] Downloading ${CORE_URL}`);
const response = await fetch(CORE_URL);
if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
await pipeline(response.body, createWriteStream(archivePath));

console.log('[fetch-arduino-core] Verifying SHA-256…');
const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
if (digest.toLowerCase() !== CORE_SHA256) {
  await rm(archivePath, { force: true });
  throw new Error(`SHA-256 mismatch.\n  expected ${CORE_SHA256}\n  actual   ${digest}`);
}
console.log(`[fetch-arduino-core] Hash OK: ${digest}`);

// Extract into a temp staging dir, then copy the allowlisted subtrees.
const stage = path.join(tmpdir(), 'oas-arduino-core-stage');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
console.log('[fetch-arduino-core] Extracting…');
// Pass the archive as a bare basename with `cwd` set to its directory.
//
// GNU tar treats an `-f` operand containing a colon as a REMOTE `host:path` spec, so a
// Windows path like `C:\Users\...\oas-core.tar.bz2` fails with
// "tar: Cannot connect to C: resolve failed". `--force-local` fixes GNU tar but is rejected
// by the bsdtar shipped in Windows System32, so it would only move the breakage. Removing
// the colon from the archive operand works with both. `-C <dir>` is unaffected — only the
// archive operand gets host:path treatment.
const res = spawnSync('tar', ['-xf', path.basename(archivePath), '-C', stage, '--strip-components=1'], {
  cwd: path.dirname(archivePath),
  stdio: 'inherit',
});
if (res.status !== 0) throw new Error('Extraction via system `tar` failed.');

// Copy allowlisted subtrees only (spec: cores/arduino, variants/standard, allowlisted libraries).
const copies = [
  ['cores/arduino', 'cores/arduino'],
  ['variants/standard', 'variants/standard'],
  ...allowedLibraries.map((lib) => [`libraries/${lib}`, `libraries/${lib}`]),
];
// Servo ships as a separate library in the IDE, not inside the core archive; tolerate absence.
for (const [from, to] of copies) {
  const src = path.join(stage, from);
  try {
    await cp(src, path.join(destRoot, to), { recursive: true });
    console.log(`[fetch-arduino-core] Copied ${from}`);
  } catch {
    console.warn(`[fetch-arduino-core] NOTE: ${from} not present in core archive (skipped).`);
  }
}
// Snapshot platform.txt + boards.txt for flag provenance.
for (const f of ['platform.txt', 'boards.txt']) {
  try {
    await cp(path.join(stage, f), path.join(destRoot, f));
    console.log(`[fetch-arduino-core] Copied ${f}`);
  } catch {
    console.warn(`[fetch-arduino-core] NOTE: ${f} missing in archive.`);
  }
}

await rm(stage, { recursive: true, force: true });
await rm(archivePath, { force: true });

// Populate per-file hash entries.
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
manifest.coreVersion = CORE_VERSION;
manifest.files = files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[fetch-arduino-core] Done. Recorded ${files.length} files (ArduinoCore-avr ${CORE_VERSION}).`);
