/**
 * Serves the structured "Offline Installation & Security" content (spec §26-31). Both
 * the embedded (Help menu) and standalone (INSTALLATION_GUIDE.html shipped beside the
 * installer) copies render from this ONE source of truth, generated at release time
 * into `runtime/help/installation-guide.json`.
 *
 * The renderer must never accept arbitrary HTML for this content — it renders the
 * structured JSON through trusted React components.
 */
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OfflineInstallGuide } from '@offline-arduino/contracts/help';
import { resolveRuntimeResourcesRoot } from '../compiler/toolchain-paths';

/**
 * Serves the bundled universal user guide markdown (`resources/docs/USER_GUIDE.md`
 * in development, `runtime/docs/USER_GUIDE.md` when packaged). The renderer renders
 * this markdown through a trusted, sanitizing renderer component — never innerHTML.
 */
export async function getUserGuideContent(): Promise<string> {
  const guidePath = path.join(resolveRuntimeResourcesRoot(), 'docs', 'USER_GUIDE.md');
  try {
    return await readFile(guidePath, 'utf8');
  } catch {
    return '# User Guide\n\nThe bundled user guide could not be found. Re-install the application to restore documentation.';
  }
}

export async function getInstallGuideContent(): Promise<OfflineInstallGuide> {
  const guidePath = path.join(resolveRuntimeResourcesRoot(), 'help', 'installation-guide.json');
  try {
    const raw = await readFile(guidePath, 'utf8');
    return JSON.parse(raw) as OfflineInstallGuide;
  } catch {
    // Development fallback before a release manifest exists. All fields are clearly
    // placeholders — release CI must overwrite this file with real artifact hashes
    // before packaging (spec §27: never invent a real filename/hash pairing).
    return {
      version: app.getVersion(),
      artifacts: [
        { platform: 'windows', fileName: 'DEV-BUILD-NOT-RELEASED-Setup.exe', sha256: '0'.repeat(64), signed: false },
        { platform: 'macos', fileName: 'DEV-BUILD-NOT-RELEASED-Universal.dmg', sha256: '0'.repeat(64), signed: false },
        { platform: 'linux', fileName: 'DEV-BUILD-NOT-RELEASED.AppImage', sha256: '0'.repeat(64), signed: false },
      ],
    };
  }
}
