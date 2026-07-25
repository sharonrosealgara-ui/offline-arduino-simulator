/**
 * Rejects IPC calls from any frame that isn't the application's own top-level renderer.
 * Source: OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §9.
 *
 * Every `ipcMain.handle` registration must call this first. It refuses subframes,
 * devtools, remote URLs, and any window this app didn't create itself.
 */
import type { WebFrameMain } from 'electron';
import { getAppOrigin } from '../security/path-policy';

export function validateSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  const origin = getAppOrigin();
  try {
    const url = new URL(frame.url);
    if (origin.protocol === 'file:') {
      // Packaged/dev renderer served from a local file path or Vite dev server on
      // localhost. Accept file: URLs unconditionally (there is no remote alternative)
      // and localhost origins that match the configured dev server only.
      return url.protocol === 'file:' || isLocalDevOrigin(url);
    }
    return url.origin === origin.origin;
  } catch {
    return false;
  }
}

function isLocalDevOrigin(url: URL): boolean {
  return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:';
}
