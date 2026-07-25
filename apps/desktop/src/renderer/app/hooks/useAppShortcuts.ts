/**
 * Global keyboard shortcuts:
 *   Ctrl/Cmd + S      → Save project
 *   Ctrl/Cmd + Enter  → Verify & Run
 *
 * Bound once at the app shell. Both handlers are fire-and-forget and swallow their own
 * errors (the controller resolves every failure path), so a shortcut can never throw
 * into React's event system.
 */
import { useEffect } from 'react';
import * as controller from '../workbench-controller';

export function useAppShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void controller.saveProject();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void controller.run();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
