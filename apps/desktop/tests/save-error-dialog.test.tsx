// @vitest-environment jsdom
/**
 * The save-failure notice, rendered.
 *
 * The controller suite proves a failed save records a message; this proves the student
 * actually sees it, can dismiss it, and can carry on — and that a cancelled dialog never
 * puts it on screen. Renders the real component against the real store, driven through the
 * same controller commands the toolbar and Ctrl+S use.
 *
 * The per-file jsdom pragma is required: the project default environment is `node`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SaveErrorDialog } from '../src/renderer/app/dialogs/SaveErrorDialog';
import { useAppStore } from '../src/renderer/state/store';
import { projectSaveStatus } from '../src/renderer/app/project-save-status';
import { SAVE_FAILURE_MESSAGE } from '../src/renderer/app/save-failure-message';
import * as controller from '../src/renderer/app/workbench-controller';

const SAVED_PATH = 'C:\\Users\\student\\Documents\\Blink.oasproj.json';

const saveProject = vi.fn();
const saveProjectAs = vi.fn();

const project = () => useAppStore.getState().project;

beforeEach(() => {
  saveProject.mockReset();
  saveProjectAs.mockReset();
  vi.stubGlobal('electronAPI', { saveProject, saveProjectAs });
  window.electronAPI = { saveProject, saveProjectAs } as unknown as typeof window.electronAPI;
  useAppStore.setState((s) => ({
    project: { ...s.project, sourcePath: SAVED_PATH, dirty: true, saveError: null },
  }));
});

afterEach(cleanup);

describe('when nothing has failed', () => {
  it('shows nothing at all', () => {
    render(<SaveErrorDialog />);

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('stays hidden when the student simply cancels the dialog', async () => {
    saveProject.mockResolvedValue({ status: 'cancelled' });
    render(<SaveErrorDialog />);

    await controller.saveProject();

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(SAVE_FAILURE_MESSAGE)).toBeNull();
  });
});

describe('when a save genuinely fails', () => {
  beforeEach(() => {
    saveProject.mockRejectedValue(new Error('EACCES: permission denied, open \'D:\\readonly\\x.json\''));
  });

  it('tells the student, in the words they were promised', async () => {
    render(<SaveErrorDialog />);

    await controller.saveProject();

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(screen.getByText(SAVE_FAILURE_MESSAGE)).toBeTruthy();
  });

  it('is announced as an alert dialog and names itself', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Labelled and described, so a screen reader reads both the heading and the message.
    expect(dialog.getAttribute('aria-labelledby')).toBe('save-error-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('save-error-message');
  });

  it('says the work is still there, because the status bar alone is easy to misread', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();

    await screen.findByRole('alertdialog');
    expect(screen.getByText(/nothing was written to disk/i)).toBeTruthy();
  });

  it('never shows the underlying error, its path, or a stack', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent ?? '').not.toMatch(/EACCES|D:\\|readonly|Error:|at /);
  });

  it('can be dismissed, leaving the project open and still unsaved', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // Dismissing acknowledges the problem; it does not pretend the save happened.
    expect(project().sourcePath).toBe(SAVED_PATH);
    expect(projectSaveStatus(project())).toBe('unsaved-changes');
  });

  it('can be dismissed from the keyboard alone', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('goes away by itself once a later save succeeds', async () => {
    render(<SaveErrorDialog />);
    await controller.saveProject();
    await screen.findByRole('alertdialog');

    saveProject.mockResolvedValue({ status: 'saved', path: SAVED_PATH });
    await controller.saveProject();

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(projectSaveStatus(project())).toBe('saved');
  });
});
