/**
 * What the status bar says about the project's relationship to disk.
 *
 * The status used to be `dirty ? 'Unsaved changes' : 'Saved'`. A brand-new Untitled Sketch
 * starts with dirty = false, so the app greeted every student with "Saved" for work that
 * had never been written anywhere — the one piece of status they might actually rely on
 * before closing the app.
 *
 * `dirty` alone cannot answer the question. It says whether there are changes since the
 * last commit point; it says nothing about whether a file exists. `sourcePath` is the
 * authoritative signal for that: it is null until a save or open genuinely succeeds.
 */

export type ProjectSaveStatus = 'not-saved-yet' | 'unsaved-changes' | 'saved';

export interface ProjectSaveState {
  /** Absolute path of the file this project is backed by, or null if it has never been written. */
  sourcePath: string | null;
  /** True when there are edits since the project was last saved or opened. */
  dirty: boolean;
}

export function projectSaveStatus({ sourcePath, dirty }: ProjectSaveState): ProjectSaveStatus {
  if (dirty) return 'unsaved-changes';
  // Not dirty is NOT the same as "on disk". Without a path there is nothing to have saved to.
  return sourcePath === null ? 'not-saved-yet' : 'saved';
}

export interface ProjectSaveStatusDisplay {
  value: string;
  tone: 'good' | 'warn';
  title: string;
}

/** Label, tone and tooltip for the status bar. */
export function projectSaveStatusDisplay(state: ProjectSaveState): ProjectSaveStatusDisplay {
  switch (projectSaveStatus(state)) {
    case 'saved':
      return { value: 'Saved', tone: 'good', title: 'All changes written to disk' };
    case 'unsaved-changes':
      return { value: 'Unsaved changes', tone: 'warn', title: 'Press Ctrl+S to save' };
    case 'not-saved-yet':
      return {
        value: 'Not saved yet',
        tone: 'warn',
        // Deliberately not reassuring: this project exists only in memory.
        title: 'This project has never been written to disk. Press Ctrl+S to save it.',
      };
  }
}
