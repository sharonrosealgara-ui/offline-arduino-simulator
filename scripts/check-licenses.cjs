// Verifies the redistribution-license tree before an installer is produced.
//
// Two distinct checks, because they carry different weight:
//
//   1. ATTRIBUTION (hard failure). Every redistributed component must have a NOTICE.md
//      recording what it is and which license governs it. This is cheap to keep correct
//      and there is no excuse for it being absent.
//
//   2. VERBATIM LICENSE TEXT (failure, overridable). GPL-3.0 and LGPL-2.1 oblige us to
//      ship the actual license text with the binaries. Those texts live in the upstream
//      toolchain archive under share/doc/**; if the toolchain in this tree was pruned by
//      an older prune-toolchain.js they were deleted. Re-fetching needs network, which is
//      allowed on a build machine but not always available, so an internal/demo build can
//      proceed with ALLOW_MISSING_LICENSE_TEXTS=1 — and the build log then says loudly
//      that the artifact is not fit for external distribution.
//
// Usage: node scripts/check-licenses.cjs [licensesDir]
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_COMPONENTS = ['avr-gcc', 'avr-libc', 'arduino-core-avr', 'app-3d-assets'];

// Components whose license obliges us to ship verbatim text with the binaries.
const TEXT_REQUIRED = {
  'avr-gcc': 'GPL-3.0-or-later (+ GCC Runtime Library Exception)',
  'avr-libc': 'Modified BSD',
  'arduino-core-avr': 'LGPL-2.1-or-later',
};

// GNU projects genuinely ship files named COPYING3 (GPLv3) and COPYING.LIB (LGPL), so the
// optional digit run matters — without it a correctly-named upstream COPYING3 is rejected.
const LICENSE_TEXT_RE = /^(copying|licen[cs]e|copyright)[0-9]*([.\-_].*)?$/i;

function hasVerbatimText(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .some((e) => e.isFile() && LICENSE_TEXT_RE.test(e.name));
}

function checkLicenses(licensesDir) {
  if (!fs.existsSync(licensesDir)) {
    throw new Error(`[check-licenses] Licenses directory missing: ${licensesDir}`);
  }

  const missingNotice = [];
  const missingText = [];

  for (const component of REQUIRED_COMPONENTS) {
    const dir = path.join(licensesDir, component);
    if (!fs.existsSync(path.join(dir, 'NOTICE.md'))) missingNotice.push(component);
    if (TEXT_REQUIRED[component] && !hasVerbatimText(dir)) missingText.push(component);
  }

  if (missingNotice.length > 0) {
    throw new Error(
      `[check-licenses] Missing attribution record NOTICE.md for: ${missingNotice.join(', ')}`,
    );
  }

  if (missingText.length === 0) {
    console.log(`[check-licenses] OK: attribution + verbatim license text present for all components.`);
    return { ok: true, missingText };
  }

  const detail = missingText.map((c) => `  - ${c}: needs the ${TEXT_REQUIRED[c]} text`).join('\n');
  const remedy =
    'Restore them on a network-enabled build machine:\n' +
    '  node scripts/fetch-toolchain.mjs win32-x64 && npm run prune:toolchain && npm run manifest:win';

  if (process.env.ALLOW_MISSING_LICENSE_TEXTS === '1') {
    console.warn(
      `\n[check-licenses] ================= DISTRIBUTION BLOCKER =================\n` +
        `Verbatim license texts are MISSING for:\n${detail}\n\n${remedy}\n\n` +
        `ALLOW_MISSING_LICENSE_TEXTS=1 is set, so this build continues.\n` +
        `The resulting artifact is for INTERNAL REVIEW ONLY and must not be\n` +
        `distributed externally until the texts above are shipped with it.\n` +
        `========================================================\n`,
    );
    return { ok: false, missingText };
  }

  throw new Error(
    `[check-licenses] Verbatim license texts are missing for:\n${detail}\n\n${remedy}\n\n` +
      `Set ALLOW_MISSING_LICENSE_TEXTS=1 to produce an internal-review build anyway.`,
  );
}

module.exports = { checkLicenses, REQUIRED_COMPONENTS, TEXT_REQUIRED };

if (require.main === module) {
  const dir = process.argv[2] || path.resolve('vendor', 'licenses');
  try {
    checkLicenses(dir);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
