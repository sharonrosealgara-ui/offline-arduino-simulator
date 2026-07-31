/**
 * What a student sees when a save genuinely fails.
 *
 * Before this, a failed write resolved to nothing at all: the promise rejected inside a
 * `void controller.saveProject()` handler, the console got an unhandled rejection, and the
 * workbench carried on showing "Unsaved changes" as though the student had simply not
 * pressed Ctrl+S yet. Work can be lost that way — they close the app believing the only
 * thing standing between them and a saved file is a keystroke they already made.
 *
 * Deliberately small: one message, one dismiss. It reuses the modal pattern the Examples
 * and Help dialogs already use rather than introducing a notification framework for a
 * single message. `alertdialog` (not `dialog`) is the correct role — it tells a screen
 * reader this interrupts to report a problem, and it is announced on open.
 */
import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProject, useActions } from '../../state/store';

export function SaveErrorDialog(): JSX.Element | null {
  const { saveError } = useProject();
  const actions = useActions();
  const dismissRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!saveError) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') actions.setSaveError(null);
    };
    document.addEventListener('keydown', onKey);
    // Focus lands on Dismiss so the message can be cleared from the keyboard alone.
    dismissRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [saveError, actions]);

  if (!saveError) return null;

  const dismiss = (): void => actions.setSaveError(null);

  return (
    <div className="modalScrim" role="presentation" onClick={dismiss}>
      <div
        className="modalPanel modalPanel--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-error-title"
        aria-describedby="save-error-message"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modalHeader">
          <h2 className="modalHeader__title" id="save-error-title">
            <AlertTriangle size={18} aria-hidden /> Save failed
          </h2>
        </header>

        <div className="modalBody">
          <p id="save-error-message" style={{ margin: 0, lineHeight: 1.5 }}>
            {saveError}
          </p>
          {/* Says plainly what state their work is in, because the status bar still shows
              "Unsaved changes" and that is easy to misread as "nothing happened". */}
          <p style={{ marginTop: 10, marginBottom: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            Your project is still open and your changes are still here — nothing was written to disk.
          </p>
        </div>

        <footer className="modalFooter">
          <button type="button" ref={dismissRef} className="btn btn--primary" onClick={dismiss}>
            Dismiss
          </button>
        </footer>
      </div>
    </div>
  );
}
