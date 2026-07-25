/**
 * The complete, exhaustive list of IPC channel names the main process registers.
 * Keeping this as a const enum-like object (not a free-form string) means a typo in a
 * handler registration is a compile error, not a silent no-op security gap.
 */
export const IPC_CHANNELS = {
  compilerCompile: 'compiler:compile',
  compilerCancel: 'compiler:cancel',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  projectOpen: 'project:open',
  examplesList: 'examples:list',
  examplesOpenCopy: 'examples:open-copy',
  helpGetInstallGuide: 'help:get-install-guide',
  helpGetUserGuide: 'help:get-user-guide',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
