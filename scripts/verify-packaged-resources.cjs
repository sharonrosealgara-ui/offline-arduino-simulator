// electron-builder afterPack hook. Verifies the packaged resources tree before the
// installer is produced. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §24.
//
// Presence checking does NOT replace SHA-256 checking; hash verification is a separate
// mandatory step run before packaging and at first compiler use.
const fs = require('node:fs');
const path = require('node:path');

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function verifyPackagedResources(context) {
  const { appOutDir, packager, arch } = context;
  const platform = packager.platform.nodeName; // 'win32' | 'darwin' | 'linux'

  const resourcesDir =
    platform === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');

  const runtime = path.join(resourcesDir, 'runtime');

  const requiredDirs = [
    path.join(runtime, 'arduino-avr', 'cores', 'arduino'),
    path.join(runtime, 'arduino-avr', 'variants', 'standard'),
    path.join(runtime, 'examples'),
    path.join(runtime, 'help'),
    path.join(runtime, 'schemas'),
    path.join(runtime, 'licenses'),
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      throw new Error(`[afterPack] Required packaged resource missing: ${dir}`);
    }
  }

  // Toolchain expectations differ per platform.
  const exeSuffix = platform === 'win32' ? '.exe' : '';
  const requiredExes = ['avr-gcc', 'avr-g++', 'avr-ar', 'avr-objcopy', 'avr-size'];
  const toolchainIds =
    platform === 'darwin' ? ['darwin-x64', 'darwin-arm64'] : [process.env.TOOLCHAIN_ID];

  for (const id of toolchainIds) {
    if (!id) throw new Error('[afterPack] TOOLCHAIN_ID is not set for a non-macOS build.');
    const bin = path.join(runtime, 'toolchains', id, 'bin');
    for (const name of requiredExes) {
      const exe = path.join(bin, `${name}${exeSuffix}`);
      if (!fs.existsSync(exe)) {
        throw new Error(`[afterPack] Missing bundled compiler executable: ${exe}`);
      }
      // Ensure the executable bit is set on Unix before signing/distribution.
      if (platform !== 'win32') {
        fs.chmodSync(exe, 0o755);
      }
    }
    if (!fs.existsSync(path.join(runtime, 'toolchains', id, 'manifest.json'))) {
      throw new Error(`[afterPack] Missing toolchain manifest for ${id}`);
    }
  }

  console.log(
    `[afterPack] Packaged-resource verification OK (${platform}/${arch}); runtime tree complete.`,
  );
};
