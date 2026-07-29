// @vitest-environment jsdom
/**
 * Inspector interactive controls — pushbutton and potentiometer.
 *
 * WHY THIS FILE LIVES HERE
 * It was previously at apps/desktop/src/renderer/app/panels/Inspector.test.tsx, which the
 * vitest `include` globs do not cover, so it was silently never collected — the suite total
 * stayed at 140 while two tests were believed to be running. It now sits under
 * apps/desktop/tests/ alongside every other suite. The glob was also widened to accept
 * `.tsx`, because `apps/desktop/tests/**\/*.test.ts` would still not have matched this file.
 *
 * The per-file jsdom pragma above is required: the project default environment is `node`
 * (see vitest.config.ts), and rendering React needs a DOM.
 *
 * The invariant that matters most is the last group: the value handed to simulationClient
 * must never differ from the value the student can see on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Inspector } from '../src/renderer/app/panels/Inspector';
import { useAppStore } from '../src/renderer/state/store';
import { simulationClient } from '../src/renderer/simulation/simulation-client';

const BOARD = { id: 'uno1', kind: 'uno-r3' as const, x: 0, y: 0, rotation: 0 as const, label: 'Uno', properties: {} };

/** Replaces the workspace with `components` and selects `selectedIds`. */
function selectOnly(components: Array<Record<string, unknown>>, selectedIds: string[]): void {
  useAppStore.setState((s) => ({
    circuit: { ...s.circuit, components: components as never, selectedIds },
    simulation: { ...s.simulation, components: {} },
  }));
}

const pushbutton = (id: string) => ({ id, kind: 'pushbutton', x: 0, y: 0, rotation: 0, label: 'PB', properties: {} });
const potentiometer = (id: string, initialPosition = 0.5) => ({
  id, kind: 'potentiometer', x: 0, y: 0, rotation: 0, label: 'POT', properties: { initialPosition },
});

/** Every setControl call, in order. */
const calls = () => (simulationClient.setControl as unknown as ReturnType<typeof vi.fn>).mock.calls;
const pressCalls = (id: string) => calls().filter((c) => c[0] === id && c[1] === true);
/** The Inspector gives the hold-button a stable id; query that rather than depending on
 *  accessible-name computation, which also has to disambiguate Rotate/Delete. */
const holdButton = (id: string) => document.getElementById(`pb-${id}`) as HTMLButtonElement;
const releaseCalls = (id: string) => calls().filter((c) => c[0] === id && c[1] === false);

beforeEach(() => {
  selectOnly([BOARD], []);
  vi.spyOn(simulationClient, 'setControl').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pushbutton keyboard control', () => {
  it('Space presses on keydown and releases on keyup', () => {
    selectOnly([pushbutton('pb1')], ['pb1']);
    render(<Inspector />);
    const btn = holdButton('pb1');

    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: false });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pb1', true);

    fireEvent.keyUp(btn, { key: ' ', code: 'Space' });
    expect(simulationClient.setControl).toHaveBeenCalledWith('pb1', false);
  });

  it('Enter presses on keydown and releases on keyup', () => {
    selectOnly([pushbutton('pb1')], ['pb1']);
    render(<Inspector />);
    const btn = holdButton('pb1');

    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter', repeat: false });
    expect(pressCalls('pb1')).toHaveLength(1);

    fireEvent.keyUp(btn, { key: 'Enter', code: 'Enter' });
    expect(releaseCalls('pb1')).toHaveLength(1);
  });

  it('auto-repeat keydown does not create a duplicate press', () => {
    selectOnly([pushbutton('pb1')], ['pb1']);
    render(<Inspector />);
    const btn = holdButton('pb1');

    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: false });
    // Holding the key down fires a stream of repeats; only the first is a real press.
    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: true });
    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: true });
    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: true });

    expect(pressCalls('pb1')).toHaveLength(1);
  });

  it('blur releases an active press', () => {
    selectOnly([pushbutton('pb1')], ['pb1']);
    render(<Inspector />);
    const btn = holdButton('pb1');

    fireEvent.keyDown(btn, { key: ' ', code: 'Space', repeat: false });
    expect(releaseCalls('pb1')).toHaveLength(0);

    // Tabbing or clicking away must not leave the button stuck down.
    fireEvent.blur(btn);
    expect(releaseCalls('pb1')).toHaveLength(1);
  });

  it('pointer down presses and pointer up / cancel releases', () => {
    selectOnly([pushbutton('pb1')], ['pb1']);
    render(<Inspector />);
    const btn = holdButton('pb1');

    fireEvent.pointerDown(btn);
    expect(pressCalls('pb1')).toHaveLength(1);
    fireEvent.pointerUp(btn);
    expect(releaseCalls('pb1')).toHaveLength(1);

    fireEvent.pointerDown(btn);
    fireEvent.pointerCancel(btn);
    expect(releaseCalls('pb1')).toHaveLength(2);
  });
});

describe('potentiometer control', () => {
  it('sends normalized 0, 0.5 and 1 to the simulator', () => {
    selectOnly([potentiometer('pot1')], ['pot1']);
    render(<Inspector />);
    const slider = screen.getByRole('slider');

    fireEvent.change(slider, { target: { value: '0' } });
    expect(simulationClient.setControl).toHaveBeenLastCalledWith('pot1', 0);

    fireEvent.change(slider, { target: { value: '50' } });
    expect(simulationClient.setControl).toHaveBeenLastCalledWith('pot1', 0.5);

    fireEvent.change(slider, { target: { value: '100' } });
    expect(simulationClient.setControl).toHaveBeenLastCalledWith('pot1', 1);
  });

  it('those positions correspond to ADC 0, ~512 and 1023', () => {
    selectOnly([potentiometer('pot1')], ['pot1']);
    render(<Inspector />);
    const slider = screen.getByRole('slider');

    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText(/Estimated ADC/i).textContent).toContain('0');

    fireEvent.change(slider, { target: { value: '50' } });
    // 50 % of the 10-bit range: 0.5 * 1023 = 511.5, displayed rounded.
    expect(screen.getByText(/Estimated ADC/i).textContent).toContain('512');

    fireEvent.change(slider, { target: { value: '100' } });
    expect(screen.getByText(/Estimated ADC/i).textContent).toContain('1023');
  });

  it('synchronizes the displayed control when a different potentiometer is selected', () => {
    selectOnly([potentiometer('potA', 0.25), potentiometer('potB', 0.75)], ['potA']);
    const view = render(<Inspector />);
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('25');

    // Selecting the other part must show ITS position, not the previous one's.
    selectOnly([potentiometer('potA', 0.25), potentiometer('potB', 0.75)], ['potB']);
    view.rerender(<Inspector />);
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('75');
  });
});

describe('the sent value and the displayed value cannot diverge', () => {
  it('holds for every slider position', () => {
    selectOnly([potentiometer('pot1')], ['pot1']);
    render(<Inspector />);
    const slider = screen.getByRole('slider');

    for (const percent of [0, 1, 17, 33, 50, 66, 84, 99, 100]) {
      fireEvent.change(slider, { target: { value: String(percent) } });

      const displayedPercent = Number((screen.getByRole('slider') as HTMLInputElement).value);
      const sentValue = calls().filter((c) => c[0] === 'pot1').at(-1)?.[1] as number;
      const shownAdc = Number(/Estimated ADC \(wiper position\): (\d+)/.exec(screen.getByText(/Estimated ADC/i).textContent ?? '')?.[1]);

      expect(displayedPercent, `slider display at ${percent}%`).toBe(percent);
      expect(sentValue, `value sent at ${percent}%`).toBeCloseTo(percent / 100, 10);
      // The readout the student reads must describe the value the worker received.
      expect(shownAdc, `ADC readout at ${percent}%`).toBe(Math.round(sentValue * 1023));
    }
  });
});
