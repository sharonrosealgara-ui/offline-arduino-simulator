/**
 * Save vs Save As in the main process — where the dialog is actually shown and the file is
 * actually written.
 *
 * The bug this pins: `projectSave` and `projectSaveAs` were two IPC handlers calling one
 * function that always prompted, so Ctrl+S on an already-saved project asked the student
 * where to put it every single time, and the answer was always the same place.
 *
 * These tests drive the real service against a real temp directory with only Electron's
 * `dialog`/`app`/`BrowserWindow` mocked, so "was the dialog shown" and "what landed on disk"
 * are both observed rather than assumed.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const showSaveDialog = vi.fn();
const showOpenDialog = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: () => documentsRoot },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
  },
  // No focused window in tests: the service takes the single-argument dialog path.
  BrowserWindow: { getFocusedWindow: () => null },
}));

let documentsRoot: string;
let workDir: string;

const { saveProject, saveProjectAs, openProjectDialog } = await import(
  '../src/main/projects/project-service'
);

/**
 * A current-format project. Saves emit schemaVersion 2 and `writeProjectFile` validates
 * against v2 specifically, so a v1 fixture here would be testing a file the app can no
 * longer produce. Backward compatibility is covered where it belongs — in the schema
 * migration suite, against real v1 input.
 */
function project(name = 'Blink') {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2 as const,
    projectId: '11111111-2222-3333-4444-555555555555',
    name,
    createdAt: now,
    updatedAt: now,
    boardId: 'uno' as const,
    sources: { 'Sketch.ino': 'void setup() {}\nvoid loop() {}\n' },
    circuit: { schemaVersion: 2 as const, components: [], wires: [], junctions: [] },
  };
}

/** A destination inside the temp dir. Unique per call, so no test can inherit another's grant. */
let counter = 0;
function destination(): string {
  counter += 1;
  return path.join(workDir, `project-${counter}.oasproj.json`);
}

beforeEach(async () => {
  documentsRoot = await mkdtemp(path.join(tmpdir(), 'oas-docs-'));
  workDir = await mkdtemp(path.join(tmpdir(), 'oas-work-'));
  showSaveDialog.mockReset();
  showOpenDialog.mockReset();
});

afterAll(async () => {
  await rm(documentsRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('Save on a project with no file', () => {
  it('asks where to put it, then writes there', async () => {
    const target = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });

    const outcome = await saveProject(project(), null);

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'saved', path: target });
    const written = JSON.parse(await readFile(target, 'utf8'));
    expect(written.sources['Sketch.ino']).toContain('void setup()');
  });

  it('reports cancellation without writing anything', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    await expect(saveProject(project(), null)).resolves.toEqual({ status: 'cancelled' });
  });
});

describe('Save on a project that already has a file', () => {
  it('writes straight to its path without showing a dialog', async () => {
    const target = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    await saveProject(project(), null); // first save: the student picks the file
    showSaveDialog.mockClear();

    const outcome = await saveProject(project('Blink v2'), target);

    // The whole point: no second dialog for a project that already knows where it lives.
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'saved', path: target });
    expect(JSON.parse(await readFile(target, 'utf8')).name).toBe('Blink v2');
  });

  it('saves an opened project back over itself', async () => {
    const target = destination();
    await writeFile(target, JSON.stringify(project('From Disk')), 'utf8');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });

    const opened = await openProjectDialog();
    expect(opened?.path).toBe(target);

    const outcome = await saveProject(project('Edited'), opened!.path);

    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'saved', path: target });
  });
});

describe('Save As', () => {
  it('asks for a destination even when the project already has one', async () => {
    const first = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: first });
    await saveProject(project(), null);

    const second = destination();
    showSaveDialog.mockClear();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: second });

    const outcome = await saveProjectAs(project(), first);

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'saved', path: second });
  });

  it('offers the current file as the starting point', async () => {
    const first = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: first });
    await saveProject(project(), null);

    showSaveDialog.mockClear();
    showSaveDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await saveProjectAs(project(), first);

    expect(showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: first });
  });

  it('reports cancellation without writing anything', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    await expect(saveProjectAs(project(), null)).resolves.toEqual({ status: 'cancelled' });
  });
});

describe('the renderer cannot choose an arbitrary destination', () => {
  it('falls back to the dialog for a path this session never granted', async () => {
    // A renderer that made a path up — or replayed one from a previous session — must not
    // get a silent write to it. The student is asked, exactly as for an untitled project.
    const invented = path.join(workDir, 'never-granted.oasproj.json');
    const chosen = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen });

    const outcome = await saveProject(project(), invented);

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'saved', path: chosen });
  });

  it('does not write to an ungranted path even when the dialog is cancelled', async () => {
    const invented = path.join(workDir, 'also-never-granted.oasproj.json');
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    await expect(saveProject(project(), invented)).resolves.toEqual({ status: 'cancelled' });
    await expect(readFile(invented, 'utf8')).rejects.toThrow();
  });
});

describe('genuine failures', () => {
  it('rejects when the destination cannot be written', async () => {
    // A directory that does not exist: a real ENOENT from the real fs, not a stubbed throw.
    const unwritable = path.join(workDir, 'no-such-dir', 'project.oasproj.json');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: unwritable });

    await expect(saveProjectAs(project(), null)).rejects.toThrow();
  });

  it('rejects a project that does not satisfy the on-disk schema', async () => {
    const target = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const broken = { ...project(), boardId: 'mega' } as unknown as ReturnType<typeof project>;

    await expect(saveProjectAs(broken, null)).rejects.toThrow();
  });

  it('can succeed on a retry after a failed write', async () => {
    const unwritable = path.join(workDir, 'still-no-dir', 'project.oasproj.json');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: unwritable });
    await expect(saveProjectAs(project(), null)).rejects.toThrow();

    const good = destination();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: good });

    await expect(saveProjectAs(project(), null)).resolves.toEqual({ status: 'saved', path: good });
  });
});
