// The Universal macOS DMG carries BOTH Darwin toolchains; the app selects the native
// one at runtime by process.arch. Require both folders before packaging. (Spec §21.1)
const fs = require('node:fs');
const path = require('node:path');

for (const id of ['darwin-x64', 'darwin-arm64']) {
  const root = path.resolve('vendor', 'toolchains', id);
  for (const name of ['avr-gcc', 'avr-g++', 'avr-ar', 'avr-objcopy', 'avr-size']) {
    const file = path.join(root, 'bin', name);
    if (!fs.existsSync(file)) throw new Error(`Missing macOS toolchain file: ${file}`);
  }
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    throw new Error(`Missing toolchain manifest for ${id}`);
  }
}

console.log('[verify-darwin-toolchains] OK: darwin-x64 + darwin-arm64 present');
