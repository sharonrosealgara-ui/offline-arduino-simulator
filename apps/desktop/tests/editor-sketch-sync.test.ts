/**
 * Editor <-> store sketch synchronisation.
 *
 * Guards the defect found during packaged-app acceptance testing: loading an example
 * updated the store and compiled the correct source, but the editor kept displaying the
 * previous (or blank) document because nothing forced Monaco to re-measure and repaint.
 *
 * The invariant that actually matters for a teaching tool is the last group here: **what
 * the editor shows and what gets compiled must never diverge.** If they can, a student
 * sees one program and runs another.
 *
 * The real Monaco instance is not exercised — the test environment is `node`. Instead the
 * component's editor adapter is modelled by a fake that reproduces Monaco's important
 * behaviour: replacing the document fires a change event, which is what writes back to the
 * store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncExternalSketch, type SketchSyncTarget } from '../src/renderer/editor/external-sketch-sync';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import { STARTER_TEMPLATES, templateToProjectFile } from '../src/renderer/app/dialogs/examples-data';
import { useAppStore } from '../src/renderer/state/store';

const DEFAULT_SKETCH = 'void setup() {\n\n}\n\nvoid loop() {\n\n}\n';

/**
 * Stands in for the Monaco model + editor pair wired up in MonacoSketchEditor.
 *
 * `replaceAll` echoes a change event the way Monaco's `onDidChangeContent` does, and the
 * component's suppression flag is modelled by `applyingExternal`, so the store write-back
 * loop is reproduced faithfully rather than assumed away.
 */
function createFakeEditor(initial: string) {
  let value = initial;
  let disposed = false;
  let applyingExternal = false;

  const revealStart = vi.fn();
  const onChange = vi.fn(() => {
    if (applyingExternal) return;
    useAppStore.getState().actions.setSketch(value);
  });

  const target: SketchSyncTarget = {
    getValue: () => value,
    isDisposed: () => disposed,
    replaceAll: (text) => {
      applyingExternal = true;
      try {
        value = text;
        onChange();
      } finally {
        applyingExternal = false;
      }
    },
    revealStart,
  };

  return {
    target,
    revealStart,
    onChange,
    get value() {
      return value;
    },
    typeInEditor(text: string) {
      value = text;
      onChange();
    },
    dispose() {
      disposed = true;
    },
  };
}

function resetStore(): void {
  useAppStore.setState((state) => ({
    project: { ...state.project, projectId: 'draft', name: 'Untitled Sketch', sketch: DEFAULT_SKETCH, sourceRevision: 0, dirty: false },
  }));
}

const blink = STARTER_TEMPLATES.find((t) => t.id === 'blink')!;
const potPwm = STARTER_TEMPLATES.find((t) => t.id === 'pot-pwm')!;

beforeEach(resetStore);

describe('syncExternalSketch', () => {
  it('replaces the document and reveals the start when the source changed', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);

    const applied = syncExternalSketch(editor.target, blink.ino);

    expect(applied).toBe(true);
    expect(editor.value).toBe(blink.ino);
    expect(editor.revealStart).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the text already matches — this is the repaint-loop guard', () => {
    const editor = createFakeEditor(blink.ino);

    const applied = syncExternalSketch(editor.target, blink.ino);

    expect(applied).toBe(false);
    expect(editor.revealStart).not.toHaveBeenCalled();
  });

  it('does nothing once the editor has been disposed', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    editor.dispose();

    expect(syncExternalSketch(editor.target, blink.ino)).toBe(false);
    expect(editor.value).toBe(DEFAULT_SKETCH);
    expect(editor.revealStart).not.toHaveBeenCalled();
  });

  it('does not write the store back while applying an external sketch', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const revisionBefore = useAppStore.getState().project.sourceRevision;

    syncExternalSketch(editor.target, blink.ino);

    // The echo must be suppressed: a freshly loaded example is not a user edit, so it must
    // not bump the revision or mark the project dirty.
    expect(useAppStore.getState().project.sourceRevision).toBe(revisionBefore);
    expect(useAppStore.getState().project.dirty).toBe(false);
  });

  it('still records genuine user edits', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);

    editor.typeInEditor('void setup() {}\n');

    expect(useAppStore.getState().project.sketch).toBe('void setup() {}\n');
    expect(useAppStore.getState().project.dirty).toBe(true);
  });
});

describe('loading examples end to end', () => {
  /** Wires the fake editor to the store exactly as MonacoSketchEditor does. */
  function attach(editor: ReturnType<typeof createFakeEditor>) {
    return useAppStore.subscribe((state, previous) => {
      if (state.project.sketch === previous.project.sketch) return;
      syncExternalSketch(editor.target, state.project.sketch);
    });
  }

  it('shows the newly selected example after loading a different one', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const unsubscribe = attach(editor);

    loadProjectIntoStore(templateToProjectFile(blink));
    expect(editor.value).toBe(blink.ino);

    loadProjectIntoStore(templateToProjectFile(potPwm));
    expect(editor.value).toBe(potPwm.ino);
    expect(editor.value).not.toBe(blink.ino);

    unsubscribe();
  });

  it('resets the viewport to the top for each newly loaded example', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const unsubscribe = attach(editor);

    loadProjectIntoStore(templateToProjectFile(blink));
    loadProjectIntoStore(templateToProjectFile(potPwm));

    // Once per load — a different document should never inherit the old scroll position.
    expect(editor.revealStart).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('does not repaint when the same example is loaded twice', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const unsubscribe = attach(editor);

    loadProjectIntoStore(templateToProjectFile(blink));
    loadProjectIntoStore(templateToProjectFile(blink));

    expect(editor.revealStart).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

describe('the displayed source and the compiled source cannot diverge', () => {
  function attach(editor: ReturnType<typeof createFakeEditor>) {
    return useAppStore.subscribe((state, previous) => {
      if (state.project.sketch === previous.project.sketch) return;
      syncExternalSketch(editor.target, state.project.sketch);
    });
  }

  /** What workbench-controller sends to the compiler is the store's sketch, verbatim. */
  const sourceSentToCompiler = () => useAppStore.getState().project.sketch;

  it('holds across example loads and user edits', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const unsubscribe = attach(editor);

    expect(editor.value).toBe(sourceSentToCompiler());

    loadProjectIntoStore(templateToProjectFile(blink));
    expect(editor.value).toBe(sourceSentToCompiler());

    editor.typeInEditor(`${blink.ino}\n// student edit\n`);
    expect(editor.value).toBe(sourceSentToCompiler());

    loadProjectIntoStore(templateToProjectFile(potPwm));
    expect(editor.value).toBe(sourceSentToCompiler());

    loadProjectIntoStore(templateToProjectFile(blink));
    expect(editor.value).toBe(sourceSentToCompiler());

    unsubscribe();
  });

  it('holds for every bundled example', () => {
    const editor = createFakeEditor(DEFAULT_SKETCH);
    const unsubscribe = attach(editor);

    for (const template of STARTER_TEMPLATES) {
      loadProjectIntoStore(templateToProjectFile(template));
      expect(editor.value, `after loading ${template.id}`).toBe(template.ino);
      expect(editor.value, `compiler divergence after ${template.id}`).toBe(sourceSentToCompiler());
    }

    unsubscribe();
  });
});
