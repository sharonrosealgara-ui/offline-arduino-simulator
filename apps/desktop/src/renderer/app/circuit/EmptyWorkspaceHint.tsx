/**
 * Empty-state guidance shown when the board is on the bench but no parts are placed yet.
 *
 * Non-interactive (`pointer-events: none`) so it never steals an orbit drag from the
 * canvas underneath it.
 */
import { MousePointerClick } from 'lucide-react';

export function EmptyWorkspaceHint(): JSX.Element {
  return (
    <div className="workspaceHint" role="status">
      <div className="workspaceHint__card">
        <MousePointerClick size={18} aria-hidden />
        <div>
          <p className="workspaceHint__title">The board is ready — add a component</p>
          <ol className="workspaceHint__steps">
            <li>Pick a part from the Component Library on the left.</li>
            <li>Click a board pin, then a part terminal, to wire them.</li>
            <li>
              Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to compile and run.
            </li>
          </ol>
          <p className="workspaceHint__aside">
            Running the Blink example needs no wiring at all — the board&apos;s built-in
            <strong> L </strong> LED follows pin 13.
          </p>
        </div>
      </div>
    </div>
  );
}
