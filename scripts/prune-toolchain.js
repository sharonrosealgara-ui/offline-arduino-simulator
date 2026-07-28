#!/usr/bin/env node
/**
 * scripts/prune-toolchain.js — shrink a bundled AVR-GNU toolchain for a Uno-only build.
 *
 * SAFETY MODEL
 *   - Dry-run by default; pass --apply to delete, --multilib to also drop non-avr5 multilibs.
 *   - Allowlist deletion only (docs/i18n, debug-only binaries, .la + binutils dev libs,
 *     opt-in unused multilibs). Everything else is left untouched.
 *   - PROTECT guard: never deletes anything whose basename contains an LTO/link/runtime
 *     internal (lto1, lto-wrapper, liblto_plugin, cc1, cc1plus, collect2, libgcc, crt),
 *     so `-flto -fuse-linker-plugin` linking never breaks.
 *   - Re-verifies required executables survive.
 *
 * Usage:
 *   node scripts/prune-toolchain.js vendor/toolchains/win32-x64                 # dry run
 *   node scripts/prune-toolchain.js vendor/toolchains/win32-x64 --apply --multilib
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '');
const APPLY = process.argv.includes('--apply');
const PRUNE_MULTILIB = process.argv.includes('--multilib');
const EXE = process.platform === 'win32' ? '.exe' : '';

if (!root || !fs.existsSync(path.join(root, 'bin'))) {
  console.error(`Toolchain root not found or missing bin/: ${root}`);
  console.error('Populate it first with: node scripts/fetch-toolchain.mjs <target>');
  process.exit(1);
}

// --- must survive: compile -> link -> objcopy -> size, including -flto plugin ---------
const REQUIRED_BINS = ['avr-gcc', 'avr-g++', 'avr-ar', 'avr-objcopy', 'avr-size', 'avr-as', 'avr-ld'].map((n) => n + EXE);
const PROTECT_SUBSTR = ['lto1', 'lto-wrapper', 'liblto_plugin', 'cc1', 'cc1plus', 'collect2', 'libgcc', 'crt'];

// --- category A: docs / man / info / locale ------------------------------------------
const DOC_DIRS = ['share/doc', 'share/man', 'share/info', 'share/locale', 'share/gcc-doc'];

// --- category B: debug/analysis binaries not needed to produce a .hex ----------------
const REMOVABLE_BIN = new Set(
  ['avr-gdb', 'avr-gdbserver', 'avr-objdump', 'avr-readelf', 'avr-addr2line', 'avr-c++filt',
   'avr-elfedit', 'avr-gprof', 'avr-gcov', 'avr-gcov-dump', 'avr-gcov-tool', 'avr-strings',
   'avr-lto-dump', 'avr-dwp'].map((n) => n + EXE),
);

// --- category C: multilibs to drop for a Uno-only build (keep avr5) -------------------
const MULTILIB_KEEP = new Set(['avr5']); // atmega328p -> avr5
const MULTILIB_KNOWN = new Set([
  'avr2', 'avr25', 'avr3', 'avr31', 'avr35', 'avr4', 'avr51', 'avr6',
  'avrxmega2', 'avrxmega3', 'avrxmega4', 'avrxmega5', 'avrxmega6', 'avrxmega7',
  'avrtiny', 'tiny-stack',
]);

// --- category D: libtool archives + binutils DEV static libs (build-only) ------------
const DEV_LIB_NAMES = new Set(['libbfd.a', 'libopcodes.a', 'libctf.a', 'libctf-nobfd.a', 'libsframe.a']);

let removedBytes = 0;
const actions = [];

const sizeOf = (p) => {
  const st = fs.statSync(p);
  if (st.isFile()) return st.size;
  return fs.readdirSync(p).reduce((s, e) => s + sizeOf(path.join(p, e)), 0);
};
const isProtected = (p) => PROTECT_SUBSTR.some((s) => path.basename(p).toLowerCase().includes(s));
const underRuntimeLibs = (p) => {
  const rel = path.relative(root, p).split(path.sep).join('/');
  return rel.startsWith('avr/lib/') || rel.startsWith('lib/gcc/');
};

function remove(p, reason) {
  if (!fs.existsSync(p) || isProtected(p)) return;
  const bytes = sizeOf(p);
  removedBytes += bytes;
  actions.push({ p: path.relative(root, p), mb: (bytes / 1e6).toFixed(2), reason });
  if (APPLY) fs.rmSync(p, { recursive: true, force: true });
}

// A) docs / i18n — but NEVER the redistribution license texts. avr-gcc/binutils ship
// COPYING, COPYING3, COPYING.RUNTIME, COPYING.LIB etc. under share/doc; these are the
// verbatim GPL/LGPL texts we are legally obliged to redistribute alongside the binaries.
// Blanket-deleting share/doc silently strips them, so walk and keep license-ish files.
const LICENSE_FILE_RE = /^(copying|licen[cs]e|notice|authors|copyright)[0-9]*([.\-_].*)?$/i;
function removeDocsPreservingLicenses(dir, reason) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeDocsPreservingLicenses(full, reason);
      // Drop the directory only once it holds nothing we chose to keep.
      if (APPLY && fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (!LICENSE_FILE_RE.test(entry.name)) {
      remove(full, reason);
    }
  }
}
for (const d of DOC_DIRS) removeDocsPreservingLicenses(path.join(root, d), 'docs/i18n');

// B) debug binaries
for (const f of fs.readdirSync(path.join(root, 'bin'))) {
  if (REMOVABLE_BIN.has(f)) remove(path.join(root, 'bin', f), 'debug/analysis binary');
}

// D) .la everywhere (safe) + dev static libs outside the runtime lib trees
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (e.name.endsWith('.la')) remove(full, 'libtool .la');
    else if (DEV_LIB_NAMES.has(e.name) && !underRuntimeLibs(full)) remove(full, 'binutils dev static lib');
  }
})(root);

// C) multilibs (opt-in) under avr/lib and lib/gcc/avr/<version>
if (PRUNE_MULTILIB) {
  const parents = [path.join(root, 'avr', 'lib')];
  const gccAvr = path.join(root, 'lib', 'gcc', 'avr');
  if (fs.existsSync(gccAvr)) for (const ver of fs.readdirSync(gccAvr)) parents.push(path.join(gccAvr, ver));
  for (const parent of parents) {
    if (!fs.existsSync(parent)) continue;
    for (const name of fs.readdirSync(parent)) {
      if (MULTILIB_KNOWN.has(name) && !MULTILIB_KEEP.has(name)) remove(path.join(parent, name), `unused multilib (${name})`);
    }
  }
}

// --- report + verification ------------------------------------------------------------
actions.sort((a, b) => Number(b.mb) - Number(a.mb));
for (const a of actions) console.log(`  ${APPLY ? 'removed' : 'would remove'}  ${String(a.mb).padStart(7)} MB  ${a.p}   [${a.reason}]`);
console.log(`\n${APPLY ? 'Reclaimed' : 'Reclaimable'}: ${(removedBytes / 1e6).toFixed(1)} MB across ${actions.length} paths.`);

if (APPLY) {
  const missing = REQUIRED_BINS.filter((b) => !fs.existsSync(path.join(root, 'bin', b)));
  if (missing.length) {
    console.error(`\n✗ FATAL: required binaries missing after prune: ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log('\n✓ Required binaries intact. Now run: node scripts/smoke-compile.mjs');
} else {
  console.log('\nDry run. Re-run with --apply --multilib once the report looks right.');
}
