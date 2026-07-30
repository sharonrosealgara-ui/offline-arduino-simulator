// @vitest-environment jsdom
/**
 * The momentary pushbutton must never stay electrically active.
 *
 * Packaged acceptance found two ways to strand it down:
 *   1. press -> move off the control -> release elsewhere (`pointerup` never reaches it);
 *   2. press -> change selection, or unmount the Inspector (no release handler ever runs).
 *
 * These assert the ELECTRICAL calls made to the simulator rather than styling: a stuck
 * button means the student's circuit keeps reading a press that is not happening, which is
 * a wrong-answer bug, not a cosmetic one.
 *
 * The invariant under test throughout: every termination path leaves the control released,
 * having sent exactly one release for the gesture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Inspector } from '../src/renderer/app/panels/Inspector';
import { useAppStore } from '../src/renderer/state/store';
import { simulationClient } from '../src/renderer/simulation/simulation-client';

const pushbutton = (id: string) => ({ id, kind: 'pushbutton', x: 0, y: 0, rotation: 0, label: 'PB', properties: {} });
const potentiometer = (id: string) => ({
  id, kind: 'potentiometer', x: 0, y: 0, rotation: 0, label: 'POT', properties: { initialPosition: 0.5 },
});

/** Replaces the workspace with `components` and selects `selectedIds`. */
function selectOnly(components: Array<Record<string, unknown>>, selectedIds: string[]): void {
  useAppStore.setState((s) => ({
    circuit: { ...s.circuit, components: components as never, selectedIds },
    simulation: { ...s.simulation, components: {} },
  }));
}

const calls = () => (simulationClient.setControl as unknown as ReturnType<typeof vi.fn>).mock.calls;
const forId = (id: string) => calls().filter((c) => c[0] === id);
const presses = (id: string) => forId(id).filter((c) => c[1] === true).length;
const releases = (id: string) => forId(id).filter((c) => c[1] === false).length;
/** The electrical state the simulator was last told to hold for this component. */
const isHeldDown = (id: string) => (forId(id).at(-1)?.[1] ?? false) === true;
const btn = (id: string) => document.getElementById(`pb-${id}`) as HTMLButtonElement;

beforeEach(() => {
  vi.spyOn(simulationClient, 'setControl').mockImplementation(() => undefined);
  // jsdom has no real pointer-capture implementation, and the hook treats capture as
  // best-effort. Stubbing both lets us assert capture is requested, and exercises the
  // "capture was refused" path that onPointerLeave exists to cover.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, configurable: true, writable: true });
  selectOnly([pushbutton('pb1')], ['pb1']);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pointer termination paths', () => {
  it('pointer down presses exactly once', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });

    expect(presses('pb1')).toBe(1);
    expect(isHeldDown('pb1')).toBe(true);
  });

  it('pointer up releases', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerUp(btn('pb1'), { pointerId: 1 });

    expect(releases('pb1')).toBe(1);
    expect(isHeldDown('pb1')).toBe(false);
  });

  it('requests pointer capture, so a release outside still reaches the control', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 7 });

    // Only that capture was requested: jsdom has no PointerEvent, so the synthesised event
    // carries no pointerId to assert on. The id round-trip is a browser concern; what
    // matters here is that the control asks to keep the gesture.
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledTimes(1);
  });

  it('releasing OUTSIDE the control still releases it — the drag-off defect', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    expect(isHeldDown('pb1')).toBe(true);

    // The pointerup lands on the window, never on the button.
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('pointer cancel releases', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerCancel(btn('pb1'), { pointerId: 1 });

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('lost pointer capture releases', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.lostPointerCapture(btn('pb1'), { pointerId: 1 });

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('leaving the control while capture is not held releases', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerLeave(btn('pb1'), { pointerId: 1 });

    expect(isHeldDown('pb1')).toBe(false);
  });

  it('leaving the control before any press sends nothing', () => {
    render(<Inspector />);
    fireEvent.pointerLeave(btn('pb1'), { pointerId: 1 });

    expect(forId('pb1')).toHaveLength(0);
  });

  it('repeated release events are harmless — exactly one release is sent', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });

    // A single real gesture can fire several of these; they must collapse to one release.
    fireEvent.pointerUp(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerUp(btn('pb1'), { pointerId: 1 });
    fireEvent.lostPointerCapture(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerCancel(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerLeave(btn('pb1'), { pointerId: 1 });
    fireEvent.blur(btn('pb1'));

    expect(presses('pb1')).toBe(1);
    expect(releases('pb1')).toBe(1);
    expect(isHeldDown('pb1')).toBe(false);
  });

  it('a second press after a completed gesture works normally', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerUp(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerDown(btn('pb1'), { pointerId: 2 });
    fireEvent.pointerUp(btn('pb1'), { pointerId: 2 });

    expect(presses('pb1')).toBe(2);
    expect(releases('pb1')).toBe(2);
    expect(isHeldDown('pb1')).toBe(false);
  });
});

describe('focus and lifecycle termination paths', () => {
  it('blur releases an active press', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: ' ', repeat: false });
    expect(isHeldDown('pb1')).toBe(true);

    fireEvent.blur(btn('pb1'));

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('changing selection while pressed releases — the selection-change defect', () => {
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    expect(isHeldDown('pb1')).toBe(true);

    // The student clicks a different part while still holding the button down.
    selectOnly([pushbutton('pb1'), potentiometer('pot1')], ['pot1']);
    view.rerender(<Inspector />);

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('switching to another pushbutton releases the first and never touches the second', () => {
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });

    selectOnly([pushbutton('pb1'), pushbutton('pb2')], ['pb2']);
    view.rerender(<Inspector />);

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
    // The newly selected button must not inherit the previous one's pressed state.
    expect(forId('pb2')).toHaveLength(0);
  });

  it('the newly selected pushbutton still presses and releases normally', () => {
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    selectOnly([pushbutton('pb1'), pushbutton('pb2')], ['pb2']);
    view.rerender(<Inspector />);

    fireEvent.pointerDown(btn('pb2'), { pointerId: 2 });
    fireEvent.pointerUp(btn('pb2'), { pointerId: 2 });

    expect(presses('pb2')).toBe(1);
    expect(releases('pb2')).toBe(1);
  });

  it('unmounting the Inspector while pressed releases', () => {
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    expect(isHeldDown('pb1')).toBe(true);

    view.unmount();

    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('an unrelated re-render while pressed does NOT release the button', () => {
    // The Inspector re-renders continuously while the simulation runs (cycle counter, pin
    // states, ~60 FPS). If the release effect re-runs on every render rather than only when
    // the selected component changes, the press is cancelled within a frame and the sketch
    // never sees it.
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });

    view.rerender(<Inspector />);
    view.rerender(<Inspector />);
    view.rerender(<Inspector />);

    expect(releases('pb1')).toBe(0);
    expect(isHeldDown('pb1')).toBe(true);
  });

  it('a simulation state update while pressed does NOT release the button', () => {
    render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });

    // What the running simulation actually does to this panel, several times a second.
    for (let tick = 0; tick < 5; tick += 1) {
      useAppStore.setState((s) => ({ simulation: { ...s.simulation, cycles: tick } }));
    }

    expect(releases('pb1')).toBe(0);
    expect(isHeldDown('pb1')).toBe(true);
  });

  it('unmounting after a normal release sends no second release', () => {
    const view = render(<Inspector />);
    fireEvent.pointerDown(btn('pb1'), { pointerId: 1 });
    fireEvent.pointerUp(btn('pb1'), { pointerId: 1 });

    view.unmount();

    expect(releases('pb1')).toBe(1);
  });
});

describe('keyboard activation', () => {
  it('Space down presses and Space up releases', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: ' ', repeat: false });
    expect(isHeldDown('pb1')).toBe(true);

    fireEvent.keyUp(btn('pb1'), { key: ' ' });
    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('Enter down presses and Enter up releases', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: 'Enter', repeat: false });
    expect(isHeldDown('pb1')).toBe(true);

    fireEvent.keyUp(btn('pb1'), { key: 'Enter' });
    expect(isHeldDown('pb1')).toBe(false);
    expect(releases('pb1')).toBe(1);
  });

  it('auto-repeat keydown creates no duplicate press', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: ' ', repeat: false });
    // Holding the key streams repeats; only the first is a real press.
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(btn('pb1'), { key: ' ', repeat: true });

    expect(presses('pb1')).toBe(1);
    expect(isHeldDown('pb1')).toBe(true);
  });

  it('a keyup after the press has already ended is harmless', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: ' ', repeat: false });
    fireEvent.blur(btn('pb1'));
    fireEvent.keyUp(btn('pb1'), { key: ' ' });

    expect(releases('pb1')).toBe(1);
  });

  it('ignores keys that do not activate a button', () => {
    render(<Inspector />);
    fireEvent.keyDown(btn('pb1'), { key: 'a', repeat: false });
    fireEvent.keyDown(btn('pb1'), { key: 'Tab', repeat: false });
    fireEvent.keyDown(btn('pb1'), { key: 'Escape', repeat: false });

    expect(forId('pb1')).toHaveLength(0);
  });
});

describe('isolation from the editor and other controls', () => {
  it('registers no global key listener, so typing elsewhere cannot press the button', () => {
    render(<Inspector />);

    // Keys delivered to the document rather than to the focused control must be ignored.
    // This is what keeps Monaco and ordinary form fields isolated from the pushbutton:
    // activation is only ever reached through the control's own focused element.
    fireEvent.keyDown(document.body, { key: ' ', repeat: false });
    fireEvent.keyUp(document.body, { key: ' ' });
    fireEvent.keyDown(window, { key: 'Enter', repeat: false });

    expect(forId('pb1')).toHaveLength(0);
  });

  it('the Name field in the same panel receives Space without pressing the button', () => {
    render(<Inspector />);
    const nameField = document.getElementById('label-pb1') as HTMLInputElement | null;
    expect(nameField, 'Inspector renders a Name field to type into').not.toBeNull();

    // Typing a space into a sibling field of the pushbutton must stay in that field.
    fireEvent.keyDown(nameField as HTMLInputElement, { key: ' ', repeat: false });
    fireEvent.keyUp(nameField as HTMLInputElement, { key: ' ' });

    expect(forId('pb1')).toHaveLength(0);
  });

  it('the window pointerup fallback never initiates a press', () => {
    render(<Inspector />);

    // A stray release with no preceding press must be a no-op, not a phantom press.
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(forId('pb1')).toHaveLength(0);
  });
});
