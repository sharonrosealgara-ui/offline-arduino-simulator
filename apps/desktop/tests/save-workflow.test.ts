/**
 * The save workflow as the student experiences it: which command shows a dialog, what the
 * status bar says afterwards, and what happens when a write fails.
 *
 * The service suite (project-save-service.test.ts) proves main does the right thing with a
 * path. This one drives the renderer command boundary — the same functions Ctrl+S and the
 * toolbar buttons call — so the store's status and the failure notice are observed end to
 * end, with only the IPC bridge stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../src/renderer/state/store';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import { projectSaveStatus } from '../src/renderer/app/project-save-status';
import { SAVE_FAILURE_MESSAGE } from '../src/renderer/app/save-failure-message';
import * as controller from '../src/renderer/app/workbench-controller';
import type { ProjectFileDTO } from '../src/preload/electron-api-types';

const SAVED_PATH = 'C:\\Users\\student\\Documents\\Blink.oasproj.json';
const OTHER_PATH = 'C:\\Users\\student\\Documents\\Blink-copy.oasproj.json';

const saveProject = vi.fn();
const saveProjectAs = vi.fn();

function projectFile(name = 'Blink'): ProjectFileDTO {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: '11111111-2222-3333-4444-555555555555',
    name,
    createdAt: now,
    updatedAt: now,
    boardId: 'uno',
    sources: { 'Sketch.ino': 'void setup() {}\nvoid loop() {}\n' },
    circuit: { schemaVersion: 1, components: [], wires: [], junctions: [] },
  } as ProjectFileDTO;
}

/** A fresh Untitled Sketch: never written anywhere, no edits yet. */
function untitled(): void {
  useAppStore.setState((s) => ({
    project: { ...s.project, name: 'Untitled Sketch', sourcePath: null, dirty: false, saveError: null },
  }));
}

/** A project that has been saved once and then edited. */
function savedThenEdited(path = SAVED_PATH): void {
  useAppStore.setState((s) => ({
    project: { ...s.project, sourcePath: path, dirty: true, saveError: null },
  }));
}

const project = () => useAppStore.getState().project;

beforeEach(() => {
  saveProject.mockReset();
  saveProjectAs.mockReset();
  vi.stubGlobal('window', { electronAPI: { saveProject, saveProjectAs } });
  untitled();
});

// --- 1-5: which command asks for a destination -----------------------------------------

describe('choosing a destination', () => {
  it('Save on an untitled project goes through the dialog path', async () => {
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProject();

    // Main decides dialog-vs-direct from the path it is handed; an untitled project hands
    // it null, which is what forces the dialog.
    expect(saveProject).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('Save As on an untitled project goes through the dialog path', async () => {
    saveProjectAs.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProjectAs();

    expect(saveProjectAs).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('Save on an existing project asks main to write to that project’s path', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProject();

    expect(saveProject).toHaveBeenCalledWith(expect.anything(), SAVED_PATH);
  });

  it('Save on an existing project never routes through Save As', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProject();

    // The regression: Save used to be Save As, so every Ctrl+S reopened the dialog.
    expect(saveProjectAs).not.toHaveBeenCalled();
  });

  it('Save As on an existing project still asks, and carries the current path as the starting point', async () => {
    savedThenEdited();
    saveProjectAs.mockResolvedValue({ status: 'saved', path: OTHER_PATH });

    await controller.saveProjectAs();

    expect(saveProjectAs).toHaveBeenCalledWith(expect.anything(), SAVED_PATH);
    expect(saveProject).not.toHaveBeenCalled();
  });
});

// --- 6-8: what a success does to the project -------------------------------------------

describe('a successful save', () => {
  it('Save As adopts the newly chosen path', async () => {
    savedThenEdited();
    saveProjectAs.mockResolvedValue({ status: 'saved', path: OTHER_PATH });

    await controller.saveProjectAs();

    expect(project().sourcePath).toBe(OTHER_PATH);
  });

  it('ordinary Save keeps the path it already had', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProject();

    expect(project().sourcePath).toBe(SAVED_PATH);
  });

  it('clears the unsaved-changes state either way', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });
    await controller.saveProject();
    expect(projectSaveStatus(project())).toBe('saved');

    savedThenEdited();
    saveProjectAs.mockResolvedValue({ status: 'saved', path: OTHER_PATH });
    await controller.saveProjectAs();
    expect(projectSaveStatus(project())).toBe('saved');
  });
});

// --- 9-11: cancellation is not a failure ------------------------------------------------

describe('cancelling', () => {
  it('leaves a cancelled Save exactly as it was', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'cancelled' });

    const result = await controller.saveProject();

    expect(result).toBe('cancelled');
    expect(project().sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project())).toBe('unsaved-changes');
  });

  it('leaves a cancelled Save As exactly as it was', async () => {
    savedThenEdited();
    saveProjectAs.mockResolvedValue({ status: 'cancelled' });

    const result = await controller.saveProjectAs();

    expect(result).toBe('cancelled');
    expect(project().sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project())).toBe('unsaved-changes');
  });

  it('shows no error notice and rejects nothing', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    saveProject.mockResolvedValue({ status: 'cancelled' });
    saveProjectAs.mockResolvedValue({ status: 'cancelled' });

    // Exactly how the toolbar and the shortcut call these: fire-and-forget.
    void controller.saveProject();
    await controller.saveProjectAs();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);

    expect(project().saveError).toBeNull();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('an untitled project that cancels is still "not saved yet"', async () => {
    saveProject.mockResolvedValue({ status: 'cancelled' });

    await controller.saveProject();

    expect(projectSaveStatus(project())).toBe('not-saved-yet');
  });
});

// --- 12-15: genuine failures -------------------------------------------------------------

describe('a failed write', () => {
  it('keeps a direct Save’s path and unsaved changes', async () => {
    savedThenEdited();
    saveProject.mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await controller.saveProject();

    expect(result).toBe('failed');
    expect(project().sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project())).toBe('unsaved-changes');
  });

  it('keeps a failed Save As from adopting the path it could not write', async () => {
    savedThenEdited();
    saveProjectAs.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const result = await controller.saveProjectAs();

    expect(result).toBe('failed');
    expect(project().sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project())).toBe('unsaved-changes');
  });

  it('shows the student the same plain message on both paths', async () => {
    savedThenEdited();
    saveProject.mockRejectedValue(new Error('EACCES: permission denied'));
    await controller.saveProject();
    expect(project().saveError).toBe(SAVE_FAILURE_MESSAGE);

    useAppStore.getState().actions.setSaveError(null);
    saveProjectAs.mockRejectedValue(new Error('EACCES: permission denied'));
    await controller.saveProjectAs();
    expect(project().saveError).toBe(SAVE_FAILURE_MESSAGE);
  });

  it('never puts the underlying error in front of the student', async () => {
    savedThenEdited();
    saveProjectAs.mockRejectedValue(
      new Error('EACCES: permission denied, open \'C:\\Users\\student\\secret\\notes.txt\''),
    );

    await controller.saveProjectAs();

    const shown = project().saveError ?? '';
    expect(shown).not.toMatch(/EACCES|C:\\|at Object|Error:/);
  });

  it('does not reject into the fire-and-forget callers', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    saveProject.mockRejectedValue(new Error('EACCES: permission denied'));

    void controller.saveProject();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });

  it('lets a retry succeed and clears the notice', async () => {
    savedThenEdited();
    saveProject.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    expect(await controller.saveProject()).toBe('failed');
    expect(project().saveError).toBe(SAVE_FAILURE_MESSAGE);

    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    expect(await controller.saveProject()).toBe('saved');
    expect(project().saveError).toBeNull();
    expect(projectSaveStatus(project())).toBe('saved');
  });
});

// --- 16-17: the rest of the status contract still holds ----------------------------------

describe('the status bar contract that already existed', () => {
  it('loading an example clears the path and reads "not saved yet"', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });
    await controller.saveProject();
    expect(projectSaveStatus(project())).toBe('saved');

    loadProjectIntoStore(projectFile('Blink Example'));

    expect(project().sourcePath).toBeNull();
    expect(projectSaveStatus(project())).toBe('not-saved-yet');
  });

  it('an opened, unedited project reads "saved"', () => {
    loadProjectIntoStore(projectFile(), SAVED_PATH);

    expect(projectSaveStatus(project())).toBe('saved');
  });
});

// --- repeated presses ---------------------------------------------------------------------

describe('repeated Save presses', () => {
  it('does not start a second write while one is in flight', async () => {
    savedThenEdited();
    let release: (value: { status: 'saved'; path: string }) => void = () => undefined;
    saveProject.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = controller.saveProject();
    const second = controller.saveProject(); // the impatient second Ctrl+S

    await expect(second).resolves.toBe('busy');
    expect(saveProject).toHaveBeenCalledTimes(1);

    release({ status: 'saved', path: SAVED_PATH });
    await expect(first).resolves.toBe('saved');
    expect(projectSaveStatus(project())).toBe('saved');
  });

  it('a Save As cannot overlap an in-flight Save and overwrite its outcome', async () => {
    savedThenEdited();
    let release: (value: { status: 'saved'; path: string }) => void = () => undefined;
    saveProject.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const save = controller.saveProject();
    await expect(controller.saveProjectAs()).resolves.toBe('busy');
    expect(saveProjectAs).not.toHaveBeenCalled();

    release({ status: 'saved', path: SAVED_PATH });
    await save;
    // The path is the one the completed write reported, not a half-applied second command.
    expect(project().sourcePath).toBe(SAVED_PATH);
  });

  it('accepts the next save once the first has finished', async () => {
    savedThenEdited();
    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });

    await controller.saveProject();
    savedThenEdited();
    await controller.saveProject();

    expect(saveProject).toHaveBeenCalledTimes(2);
    expect(projectSaveStatus(project())).toBe('saved');
  });
});
