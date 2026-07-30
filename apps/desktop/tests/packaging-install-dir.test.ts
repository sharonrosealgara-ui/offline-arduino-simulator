/**
 * The Windows install directory must stay client-facing.
 *
 * Clients installed to %LOCALAPPDATA%\Programs\@offline-arduinodesktop, because the NSIS
 * per-user install path is derived from the PACKAGE name rather than productName:
 *
 *   app-builder-lib/out/targets/targetUtil.js
 *     getWindowsInstallationDirName(appInfo, isTryToUseProductName) {
 *       return isTryToUseProductName && /^[-_+0-9a-zA-Z .]+$/.test(appInfo.productFilename)
 *         ? appInfo.productFilename
 *         : appInfo.sanitizedName          // <- sanitizeFileName(metadata.name)
 *     }
 *
 * called as getWindowsInstallationDirName(appInfo, !oneClick || isPerMachine). This app is
 * oneClick and per-user, so that flag is false and productName is never consulted.
 *
 * These tests reproduce that resolution against the real electron-builder.yml, so the
 * install path cannot silently regress to the scoped npm package name — which is easy to
 * do, since simply removing `extraMetadata` restores the old broken path with no other
 * visible symptom until someone installs the build.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
// The exact sanitiser electron-builder applies to the package name.
import { sanitizeFileName } from 'app-builder-lib/out/util/filename';

const repoRoot = path.resolve(__dirname, '../../..');

const config = yaml.load(readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8')) as {
  productName?: string;
  extraMetadata?: { name?: string };
  nsis?: { oneClick?: boolean; perMachine?: boolean; artifactName?: string };
  portable?: { artifactName?: string };
};

const desktopPkg = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
) as { name: string; productName?: string; version: string };

/** The metadata name electron-builder ends up using (extraMetadata is deep-assigned over it). */
const effectiveName = config.extraMetadata?.name ?? desktopPkg.name;

/** Mirrors app-builder-lib's getWindowsInstallationDirName. */
function windowsInstallDirName(): string {
  const oneClick = config.nsis?.oneClick ?? true;
  const perMachine = config.nsis?.perMachine ?? false;
  const tryProductName = !oneClick || perMachine;
  const productFilename = sanitizeFileName(config.productName ?? '');
  return tryProductName && /^[-_+0-9a-zA-Z .]+$/.test(productFilename)
    ? productFilename
    : sanitizeFileName(effectiveName);
}

describe('Windows installation directory', () => {
  it('is the client-facing product name', () => {
    expect(windowsInstallDirName()).toBe('Offline Arduino Simulator');
  });

  it('never falls back to the scoped npm package name', () => {
    const dir = windowsInstallDirName();
    expect(dir).not.toContain('@');
    expect(dir.toLowerCase()).not.toContain('desktop');
    expect(dir).not.toBe(sanitizeFileName(desktopPkg.name));
  });

  it('would still be wrong without the override — proving the override is what fixes it', () => {
    // Guards against someone deleting extraMetadata because it "looks redundant" next to
    // productName. Without it the resolution lands back on the scoped name.
    expect(sanitizeFileName(desktopPkg.name)).toBe('@offline-arduinodesktop');
    expect(config.extraMetadata?.name).toBe('Offline Arduino Simulator');
  });

  it('installs per-user with a one-click installer', () => {
    // These two are what force the package-name branch; if either changes, the resolution
    // above changes with it and this suite must be revisited rather than silently drift.
    expect(config.nsis?.oneClick).toBe(true);
    expect(config.nsis?.perMachine).toBe(false);
  });
});

describe('the override does not disturb the rest of the packaging identity', () => {
  it('keeps the display name', () => {
    expect(config.productName).toBe('Offline Arduino Simulator');
    expect(desktopPkg.productName).toBe('Offline Arduino Simulator');
  });

  it('keeps the workspace package name untouched', () => {
    // Renaming the workspace package would ripple through imports and dependencies; the
    // fix is deliberately confined to packaged metadata.
    expect(desktopPkg.name).toBe('@offline-arduino/desktop');
  });

  it('keeps version 0.1.0', () => {
    expect(desktopPkg.version).toBe('0.1.0');
  });

  it('keeps artifact filenames driven by productName, so they do not change', () => {
    expect(config.nsis?.artifactName).toBe('${productName}-${version}-Windows-x64-Setup.${ext}');
    expect(config.portable?.artifactName).toBe('${productName}-${version}-Windows-x64-Portable.${ext}');
  });

  it('leaves userData keyed to productName, which Electron prefers over name', () => {
    // app.getName() returns productName when package.json defines it, so overriding `name`
    // cannot move %APPDATA%\Offline Arduino Simulator.
    expect(desktopPkg.productName).toBeTruthy();
  });
});
