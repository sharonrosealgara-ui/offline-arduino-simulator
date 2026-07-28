/**
 * Applying an externally-loaded sketch (Examples, Open Project) to the editor.
 *
 * Split out of MonacoSketchEditor so the ordering rules below can be tested without
 * standing up a real Monaco instance — the test environment is `node`, and importing
 * monaco-editor there is not worth the weight for four lines of logic.
 *
 * WHY THIS EXISTS AT ALL
 * The editor is created with `automaticLayout: false` (per the UI spec, so layout work is
 * driven by a throttled ResizeObserver rather than Monaco's own polling loop). That is fine
 * while the user is typing, because typing already drives rendering. It is NOT fine when the
 * document is replaced from outside: nothing schedules a re-measure, so the view could keep
 * painting the previous document for seconds until an unrelated event — a compile finishing,
 * a pane resize — happened to force a render. Loading Blink appeared to leave stale or blank
 * text on screen even though the store and the compiler both had the new source. This module
 * makes the repaint explicit instead.
 */

/** The editor operations this sync needs, so the logic can be tested with a fake. */
export interface SketchSyncTarget {
  /** Current document text. */
  getValue(): string;
  /** True once the underlying model/editor has been torn down. */
  isDisposed(): boolean;
  /**
   * Replaces the whole document. Implementations should keep this undoable rather than
   * destroying the undo stack.
   */
  replaceAll(text: string): void;
  /**
   * Re-measures and repaints, then puts the viewport and caret at the start of the
   * document. A freshly loaded example is a *different* document, so restoring the previous
   * cursor position would be meaningless and could land past the end of the new file.
   */
  revealStart(): void;
}

/**
 * Pushes `nextSketch` into the editor if — and only if — it differs from what is displayed.
 *
 * Returns true when the document was replaced. The equality guard is what prevents a
 * repaint loop: the editor's own change event writes back to the store, which notifies this
 * sync again, and at that point the text already matches so nothing further happens.
 *
 * @param target editor adapter
 * @param nextSketch authoritative source text from the store
 */
export function syncExternalSketch(target: SketchSyncTarget, nextSketch: string): boolean {
  if (target.isDisposed()) return false;
  // Same text means the change originated in this editor (or has already been applied);
  // rewriting it would clobber the caret and could re-trigger this path indefinitely.
  if (target.getValue() === nextSketch) return false;

  target.replaceAll(nextSketch);
  // Order matters: replace first, then reveal. Revealing before the replacement would
  // scroll the *old* document and be undone by the edit.
  target.revealStart();
  return true;
}
