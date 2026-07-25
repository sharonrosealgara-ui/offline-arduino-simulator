/**
 * Ambient declaration for the renderer. Imports only from the dependency-free
 * electron-api-types module — never from preload.ts itself (which imports 'electron')
 * and never from Electron directly, so this file is safe for the renderer's TS program.
 */
import type { ElectronAPI } from './electron-api-types';

declare global {
  interface Window {
    electronAPI: Readonly<ElectronAPI>;
  }
}

export {};
