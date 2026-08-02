// @vitest-environment jsdom
/**
 * The colour rule reaches the pixels — in both canvases, and only where it should.
 *
 * wire-display-colors.test.tsx proves the resolver. This proves the two renderers actually
 * ask it, that the 2D canvas follows the OS theme, and — the part most likely to go wrong —
 * that the parts which merely happen to share #1c1f24 were left alone. A servo's ground lead
 * is black because real JR servo cable is black; that is component fidelity, not workspace
 * legibility, and it must not follow the wire substitution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CircuitCanvas } from '../src/renderer/circuit/CircuitCanvas';
import { Inspector } from '../src/renderer/app/panels/Inspector';
import { ComponentGlyph } from '../src/renderer/circuit/renderers/ComponentGlyph';
import { useAppStore } from '../src/renderer/state/store';
import { WIRE_HEX } from '../src/renderer/app/circuit/hardware/wire-colors';

/** Drives `prefers-color-scheme` for the component under test. */
function setScheme(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: dark && query.includes('dark'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

const board = { id: 'uno1', kind: 'uno-r3', x: 100, y: 100, rotation: 0, label: 'Uno', properties: {} };
const led = { id: 'led1', kind: 'led', x: 200, y: 160, rotation: 0, label: 'LED', properties: {} };

/** A ground wire and a yellow signal wire, so a control role is always in frame. */
function wireWorkspace(): void {
  useAppStore.setState((s) => ({
    circuit: {
      ...s.circuit,
      components: [board, led] as never,
      wires: [
        {
          id: 'wg',
          from: { componentId: 'led1', terminalId: 'cathode' },
          to: { componentId: 'uno1', terminalId: 'GND' },
          colorRole: 'ground-black',
          waypoints: [],
        },
        {
          id: 'wy',
          from: { componentId: 'uno1', terminalId: 'D13' },
          to: { componentId: 'led1', terminalId: 'anode' },
          colorRole: 'signal-yellow',
          waypoints: [],
        },
      ] as never,
      junctions: [],
      selectedIds: [],
    },
  }));
}

/** Every stroke drawn in the wire layer. */
function wireStrokes(): string[] {
  const layer = document.querySelector('.wireVisibleLayer');
  return [...(layer?.querySelectorAll('path') ?? [])]
    .map((p) => p.getAttribute('stroke') ?? '')
    .filter((s) => s !== 'transparent');
}

beforeEach(() => {
  wireWorkspace();
  setScheme(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the 2D canvas follows the theme', () => {
  it('draws ground slate in dark mode', () => {
    setScheme(true);
    render(<CircuitCanvas />);
    expect(wireStrokes()).toContain('#94a3b8');
    expect(wireStrokes()).not.toContain('#1c1f24');
  });

  it('draws ground black in light mode, keeping its 14.47:1', () => {
    setScheme(false);
    render(<CircuitCanvas />);
    expect(wireStrokes()).toContain('#1c1f24');
    expect(wireStrokes()).not.toContain('#94a3b8');
  });

  it('draws the signal wire identically in both themes', () => {
    setScheme(true);
    render(<CircuitCanvas />);
    expect(wireStrokes()).toContain(WIRE_HEX['signal-yellow']);
    cleanup();

    setScheme(false);
    render(<CircuitCanvas />);
    expect(wireStrokes()).toContain(WIRE_HEX['signal-yellow']);
  });

  it('survives an environment with no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => render(<CircuitCanvas />)).not.toThrow();
    // Falls back to the CSS default, which is the light palette.
    expect(wireStrokes()).toContain('#1c1f24');
  });
});

describe('parts that merely share the hex are untouched', () => {
  it('keeps the servo pigtail in real JR black', () => {
    const servo = { id: 's1', kind: 'servo', x: 100, y: 100, rotation: 0 as const, label: 'S', properties: {} };
    render(
      <svg>
        <ComponentGlyph component={servo as never} selected={false} pinDisplay={{}} onSelect={() => {}} />
      </svg>,
    );
    const leads = [...document.querySelectorAll('line')].map((l) => l.getAttribute('stroke'));
    expect(leads).toContain('#1c1f24');
    expect(leads).not.toContain('#94a3b8');
  });

  it('the display substitution is not reachable from the physical table', () => {
    // A regression here would mean someone re-pointed pigtails at the display resolver.
    expect(WIRE_HEX['ground-black']).toBe('#1c1f24');
  });
});

describe('the Inspector', () => {
  it('names a selected ground wire "Black (GND)"', () => {
    useAppStore.setState((s) => ({ circuit: { ...s.circuit, selectedIds: ['wg'] } }));
    render(<Inspector />);
    expect(screen.getByText('Black (GND)')).toBeTruthy();
    expect(screen.queryByText('ground black')).toBeNull();
  });

  it('leaves a signal wire reading as before', () => {
    useAppStore.setState((s) => ({ circuit: { ...s.circuit, selectedIds: ['wy'] } }));
    render(<Inspector />);
    expect(screen.getByText('signal yellow')).toBeTruthy();
  });
});
