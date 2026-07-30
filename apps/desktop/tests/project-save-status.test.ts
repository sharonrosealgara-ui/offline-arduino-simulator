/**
 * What the status bar is allowed to call "Saved".
 *
 * The bug: the status read `dirty ? 'Unsaved changes' : 'Saved'`. A fresh Untitled Sketch
 * is not dirty, so the app told every student their never-written work was "Saved" — and
 * kept saying it after they dismissed the save dialog. These tests pin the whole path that
 * makes the claim true: the pure status rule, the store action that records a path, and the
 * save/open flows that are the only things allowed to call it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  projectSaveStatus,
  projectSaveStatusDisplay,
} from '../src/renderer/app/project-save-status';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import { useAppStore } from '../src/renderer/state/store';
import type { ProjectFileDTO } from '../src/preload/electron-api-types';

const SAVED_PATH = 'C:\\Users\\student\\Documents\\Blink.oasproj.json';

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

function resetProject(): void {
  useAppStore.setState((s) => ({
    project: { ...s.project, name: 'Untitled Sketch', sourcePath: null, dirty: false },
  }));
}

beforeEach(resetProject);

describe('projectSaveStatus', () => {
  it('does not call a never-written project "saved" just because it is clean', () => {
    // The exact state of a freshly launched app. This is the regression.
    expect(projectSaveStatus({ sourcePath: null, dirty: false })).toBe('not-saved-yet');
  });

  it('reports saved only once a file backs the project', () => {
    expect(projectSaveStatus({ sourcePath: SAVED_PATH, dirty: false })).toBe('saved');
  });

  it('reports unsaved changes after an edit to a saved project', () => {
    expect(projectSaveStatus({ sourcePath: SAVED_PATH, dirty: true })).toBe('unsaved-changes');
  });

  it('prefers unsaved changes over not-saved-yet when a fresh project is edited', () => {
    // Both are true; "Unsaved changes" is the one that tells them to press Ctrl+S about
    // work they can see, so dirty wins.
    expect(projectSaveStatus({ sourcePath: null, dirty: true })).toBe('unsaved-changes');
  });
});

describe('status bar display', () => {
  it('never shows a reassuring tone for work that is not on disk', () => {
    for (const state of [
      { sourcePath: null, dirty: false },
      { sourcePath: null, dirty: true },
      { sourcePath: SAVED_PATH, dirty: true },
    ]) {
      expect(projectSaveStatusDisplay(state).tone).toBe('warn');
    }
    expect(projectSaveStatusDisplay({ sourcePath: SAVED_PATH, dirty: false }).tone).toBe('good');
  });

  it('says plainly that a fresh project has never been written', () => {
    const display = projectSaveStatusDisplay({ sourcePath: null, dirty: false });
    expect(display.value).toBe('Not saved yet');
    expect(display.title).toMatch(/never been written/i);
  });

  it('tells a dirty project how to save', () => {
    expect(projectSaveStatusDisplay({ sourcePath: SAVED_PATH, dirty: true }).title).toMatch(/Ctrl\+S/);
  });
});

describe('markProjectSaved', () => {
  it('records the path and clears dirty', () => {
    useAppStore.setState((s) => ({ project: { ...s.project, dirty: true } }));

    useAppStore.getState().actions.markProjectSaved(SAVED_PATH);

    const project = useAppStore.getState().project;
    expect(project.sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project)).toBe('saved');
  });

  it('leaves the sketch and project identity alone', () => {
    const before = useAppStore.getState().project;
    useAppStore.getState().actions.markProjectSaved(SAVED_PATH);

    const after = useAppStore.getState().project;
    expect(after.sketch).toBe(before.sketch);
    expect(after.projectId).toBe(before.projectId);
    expect(after.sourceRevision).toBe(before.sourceRevision);
  });
});

describe('loadProjectIntoStore', () => {
  it('treats a project with no path as never saved', () => {
    // Examples and starter templates: real content, no file behind it.
    loadProjectIntoStore(projectFile());

    expect(projectSaveStatus(useAppStore.getState().project)).toBe('not-saved-yet');
  });

  it('does not inherit the previous project\'s path', () => {
    // Open a real file, then load an example over it. The example is not that file.
    loadProjectIntoStore(projectFile('Saved Work'), SAVED_PATH);
    loadProjectIntoStore(projectFile('Example Copy'));

    const project = useAppStore.getState().project;
    expect(project.sourcePath).toBeNull();
    expect(projectSaveStatus(project)).toBe('not-saved-yet');
  });

  it('marks an opened file as saved', () => {
    loadProjectIntoStore(projectFile(), SAVED_PATH);

    const project = useAppStore.getState().project;
    expect(project.sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project)).toBe('saved');
  });
});

describe('the save flow', () => {
  const electronAPI = {
    saveProject: vi.fn(),
    openProject: vi.fn(),
  };

  beforeEach(() => {
    electronAPI.saveProject.mockReset();
    electronAPI.openProject.mockReset();
    vi.stubGlobal('window', { electronAPI });
    vi.stubGlobal('crypto', globalThis.crypto);
  });

  async function controller(): Promise<typeof import('../src/renderer/app/workbench-controller')> {
    return await import('../src/renderer/app/workbench-controller');
  }

  it('reports saved after a write actually happened', async () => {
    electronAPI.saveProject.mockResolvedValue({ path: SAVED_PATH });
    useAppStore.setState((s) => ({ project: { ...s.project, dirty: true } }));

    const saved = await (await controller()).saveProject();

    expect(saved).toBe(true);
    expect(projectSaveStatus(useAppStore.getState().project)).toBe('saved');
  });

  it('stays "not saved yet" when the student dismisses the dialog', async () => {
    // The whole point of the null return: a cancelled save must not look like a save.
    electronAPI.saveProject.mockResolvedValue(null);

    const saved = await (await controller()).saveProject();

    expect(saved).toBe(false);
    expect(useAppStore.getState().project.sourcePath).toBeNull();
    expect(projectSaveStatus(useAppStore.getState().project)).toBe('not-saved-yet');
  });

  it('keeps unsaved changes visible when the save fails outright', async () => {
    electronAPI.saveProject.mockRejectedValue(new Error('EACCES: permission denied'));
    useAppStore.setState((s) => ({ project: { ...s.project, dirty: true } }));

    await expect((await controller()).saveProject()).rejects.toThrow(/EACCES/);

    // A failed write leaves the work exactly where it was: in memory only.
    expect(useAppStore.getState().project.sourcePath).toBeNull();
    expect(projectSaveStatus(useAppStore.getState().project)).toBe('unsaved-changes');
  });

  it('records the path the file was opened from', async () => {
    electronAPI.openProject.mockResolvedValue({ path: SAVED_PATH, project: projectFile() });

    await (await controller()).openProject();

    expect(useAppStore.getState().project.sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(useAppStore.getState().project)).toBe('saved');
  });

  it('leaves the project untouched when the open dialog is dismissed', async () => {
    loadProjectIntoStore(projectFile('Work In Progress'), SAVED_PATH);
    electronAPI.openProject.mockResolvedValue(null);

    await (await controller()).openProject();

    expect(useAppStore.getState().project.name).toBe('Work In Progress');
    expect(useAppStore.getState().project.sourcePath).toBe(SAVED_PATH);
  });
});
