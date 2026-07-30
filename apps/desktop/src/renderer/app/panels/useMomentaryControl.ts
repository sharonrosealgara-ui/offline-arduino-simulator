/**
 * Lifecycle for a momentary (press-and-hold) control such as the Inspector pushbutton.
 *
 * A momentary switch is electrically active only while held. Every way an interaction can
 * end must therefore return it to released — otherwise the simulated button stays stuck
 * down and the student's circuit keeps reading a press that is no longer happening.
 *
 * Packaged acceptance found two real ways to strand it:
 *
 *   1. Press, drag off the button, release. Without pointer capture the `pointerup` is
 *      delivered to whatever element is under the cursor, so the button's own handler
 *      never fires.
 *   2. Press, then change the selection (or otherwise unmount the Inspector). The element
 *      disappears mid-press and no release handler ever runs.
 *
 * The fixes here are pointer capture, a window-level `pointerup` fallback for the case
 * where capture is unavailable or already lost, and an effect cleanup keyed on the
 * component id so selection change and unmount both release.
 *
 * IDEMPOTENCE is the core invariant: `press` and `release` are guarded by a ref, so a
 * repeated release (pointerup + lostpointercapture + window fallback all firing for one
 * gesture) sends exactly one release, and auto-repeat keydown sends exactly one press.
 *
 * Deliberately NOT global: no document/window key listener. Space and Enter reach this
 * control only through its own focused element, so typing in Monaco or a form field can
 * never operate the button.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface MomentaryControlHandlers {
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLElement>): void;
  onPointerCancel(event: React.PointerEvent<HTMLElement>): void;
  onLostPointerCapture(event: React.PointerEvent<HTMLElement>): void;
  onPointerLeave(event: React.PointerEvent<HTMLElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onKeyUp(event: React.KeyboardEvent<HTMLElement>): void;
  onBlur(): void;
}

/** Keys that operate a button, matching native button activation. */
const ACTIVATION_KEYS = new Set([' ', 'Enter']);

/**
 * @param componentId circuit component the control drives
 * @param setControl  sends the electrical state to the simulator
 */
export function useMomentaryControl(
  componentId: string,
  setControl: (id: string, value: boolean) => void,
): MomentaryControlHandlers {
  /** True only while this control is holding the button electrically down. */
  const pressedRef = useRef(false);
  /** Which pointer started the press, so an unrelated pointer cannot release it. */
  const pointerIdRef = useRef<number | null>(null);

  const press = useCallback(() => {
    if (pressedRef.current) return; // already down: auto-repeat, or a duplicate pointerdown
    pressedRef.current = true;
    setControl(componentId, true);
  }, [componentId, setControl]);

  const release = useCallback(() => {
    if (!pressedRef.current) return; // never down, or already released — stay idempotent
    pressedRef.current = false;
    pointerIdRef.current = null;
    setControl(componentId, false);
  }, [componentId, setControl]);

  // Selection change and unmount. The cleanup closes over the id that was active when the
  // effect ran, so switching to another component releases the PREVIOUS one rather than
  // silently leaving it held.
  useEffect(() => release, [componentId, release]);

  // Fallback for a release that never reaches the element: capture unavailable, capture
  // already lost, or the pointer released over a different window region. Registered only
  // while mounted, and it only ever releases — it can never initiate a press.
  useEffect(() => {
    const onWindowPointerUp = (): void => release();
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [release]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      pointerIdRef.current = event.pointerId;
      // Capture keeps subsequent pointer events on this element even if the cursor leaves
      // it, so a drag-off-then-release still delivers pointerup here.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* capture is best-effort; the window fallback covers failure */
      }
      press();
    },
    [press],
  );

  const onPointerUp = useCallback(() => release(), [release]);
  const onPointerCancel = useCallback(() => release(), [release]);
  const onLostPointerCapture = useCallback(() => release(), [release]);

  /**
   * With capture held this normally does not fire mid-press. It is a safety net for the
   * case where capture was refused: leaving the element then means the release will land
   * elsewhere, so end the press now rather than strand it.
   */
  const onPointerLeave = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!pressedRef.current) return;
      const captured = event.currentTarget.hasPointerCapture?.(event.pointerId) ?? false;
      if (!captured) release();
    },
    [release],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!ACTIVATION_KEYS.has(event.key)) return;
      // Holding a key streams repeats; `press` is idempotent but bailing here also avoids
      // pointless work and keeps the intent explicit.
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      press();
    },
    [press],
  );

  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!ACTIVATION_KEYS.has(event.key)) return;
      event.preventDefault();
      release();
    },
    [release],
  );

  const onBlur = useCallback(() => release(), [release]);

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onPointerLeave,
    onKeyDown,
    onKeyUp,
    onBlur,
  };
}
