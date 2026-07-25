/**
 * contextBridge implementation. Exposes a very small, fully-typed
 * `window.electronAPI` surface — never `ipcRenderer`, a generic `invoke(channel, payload)`,
 * filesystem methods, `child_process`, or raw Electron event objects.
 * Source: setup spec §9.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { CompileRequest } from '@offline-arduino/contracts/compiler';
import { IPC_CHANNELS } from '../main/ipc/channels';
import type { ElectronAPI, ProjectFileDTO } from './electron-api-types';

const electronAPI: Readonly<ElectronAPI> = Object.freeze({
  compile: (request: CompileRequest) => ipcRenderer.invoke(IPC_CHANNELS.compilerCompile, request),
  cancelCompile: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.compilerCancel, requestId),
  saveProject: (project: ProjectFileDTO) => ipcRenderer.invoke(IPC_CHANNELS.projectSave, project),
  saveProjectAs: (project: ProjectFileDTO) => ipcRenderer.invoke(IPC_CHANNELS.projectSaveAs, project),
  openProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectOpen),
  listExamples: () => ipcRenderer.invoke(IPC_CHANNELS.examplesList),
  openExampleCopy: (exampleId: string) => ipcRenderer.invoke(IPC_CHANNELS.examplesOpenCopy, exampleId),
  getInstallGuide: () => ipcRenderer.invoke(IPC_CHANNELS.helpGetInstallGuide),
  getUserGuide: () => ipcRenderer.invoke(IPC_CHANNELS.helpGetUserGuide),
});

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
