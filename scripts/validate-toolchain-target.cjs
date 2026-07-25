// Prebuild guard: reject an absent or mismatched TOOLCHAIN_ID before electron-builder
// selects a native payload. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §22.
const fs = require('node:fs');
const path = require('node:path');

const platform = process.env.BUILD_PLATFORM;
const id = process.env.TOOLCHAIN_ID;

const expected = {
  win32: 'win32-x64',
  linux: 'linux-x64',
};

if (!(platform in expected)) {
  throw new Error(`BUILD_PLATFORM must be one of: ${Object.keys(expected).join(', ')}`);
}
if (id !== expected[platform]) {
  throw new Error(`TOOLCHAIN_ID must be ${expected[platform]} for ${platform}`);
}

const root = path.resolve('vendor', 'toolchains', id);
const suffix = platform === 'win32' ? '.exe' : '';

for (const name of ['avr-gcc', 'avr-g++', 'avr-ar', 'avr-objcopy', 'avr-size']) {
  const file = path.join(root, 'bin', `${name}${suffix}`);
  if (!fs.existsSync(file)) throw new Error(`Missing toolchain file: ${file}`);
}
if (!fs.existsSync(path.join(root, 'manifest.json'))) {
  throw new Error(`Missing toolchain manifest for ${id}`);
}

console.log(`[validate-toolchain-target] OK: ${platform} -> ${id}`);
