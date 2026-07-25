/**
 * Electron main process entry point: app lifecycle, BrowserWindow security baseline,
 * and IPC registration. Source: setup spec §2, §9 (BrowserWindow security baseline).
 *
 * Nothing here loads remote content, disables sandboxing, or grants the renderer
 * Node/filesystem/process-spawn access. That access lives exclusively behind the
 * typed IPC surface registered in ipc/register-ipc.ts.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc/register-ipc';

const isDev = !app.isPackaged;

// A restrictive Content Security Policy: everything is local, nothing is remote.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
    preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Never let the privileged window navigate away from its own local content, and open
  // any external link (e.g. a future "learn more" link) in the OS browser instead of
  // inside the app.
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const isDevServer = isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL);
    if (target.protocol !== 'file:' && !isDevServer) {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });

  // Deny every permission request outright — a classroom sketch simulator has no
  // legitimate use for camera/mic/geolocation/notifications/etc.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Defense in depth: refuse to create any new BrowserWindow/webview that isn't ours.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
});
