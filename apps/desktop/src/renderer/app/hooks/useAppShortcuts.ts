/**
 * Global keyboard shortcuts.
 *
 *   Ctrl/Cmd + S       → Save project (to its own file once it has one)
 *   Ctrl/Cmd + Shift+S → Save As (always asks for a destination)
 *   Ctrl/Cmd + Enter   → Verify & Run
 *   Ctrl/Cmd + Z       → Undo circuit edit
 *   Ctrl/Cmd + Shift+Z → Redo circuit edit
 *   Ctrl/Cmd + Y       → Redo circuit edit
 *   R                  → Rotate the selected component
 *   Delete / Backspace → Remove the selected components and wires
 *   Escape             → Cancel wiring / disarm placement / clear selection
 *
 * Bound once at the app shell. Handlers are fire-and-forget and swallow their own errors
 * (the controller resolves every failure path), so a shortcut can never throw into React's
 * event system.
 *
 * Unmodified keys (R, Delete, Escape) are ignored while focus is inside a text field or
 * Monaco — otherwise typing `r` in the editor would silently rotate a component.
 */
import { useEffect } from 'react';
import * as controller from '../workbench-controller';
import { useAppStore } from '../../state/store';

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Monaco renders its own focusable surface rather than a plain <textarea> wrapper.
  return element.closest('.monaco-editor') !== null;
}

export function useAppShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const actions = useAppStore.getState().actions;

      if (mod) {
        const key = e.key.toLowerCase();
        if (key === 's') {
          e.preventDefault();
          // Shift makes it Save As: always choose a destination, even for a saved project.
          if (e.shiftKey) void controller.saveProjectAs();
          else void controller.saveProject();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          void controller.run();
        } else if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          actions.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          actions.redo();
        }
        return;
      }

      if (isTextEntryTarget(e.target)) return;

      const circuit = useAppStore.getState().circuit;

      if (e.key === 'Escape') {
        if (circuit.pendingWireFrom) actions.cancelWire();
        else if (circuit.placementKind) actions.armPlacement(null);
        else actions.selectIds([]);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        const [first] = circuit.selectedIds;
        if (!first) return;
        // Wires are not rotatable; only rotate when the selection is a component.
        if (!circuit.components.some((c) => c.id === first)) return;
        e.preventDefault();
        actions.rotateComponent(first);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (circuit.selectedIds.length === 0) return;
        e.preventDefault();
        actions.deleteWires(circuit.selectedIds);
        actions.deleteComponents(circuit.selectedIds);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
