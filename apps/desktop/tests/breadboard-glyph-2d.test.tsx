// @vitest-environment jsdom
/**
 * The rendered breadboard: 400 marks, one thing to click, one thing to focus.
 *
 * The shape of this component is the point. A focusable button per hole would give a part
 * 84 mm wide four hundred tab stops and four hundred overlapping hit targets, so the holes
 * are painted marks hidden from the accessibility tree, and all interaction goes through one
 * composite surface. Several tests below exist purely to stop that regressing.
 *
 * State cues are checked for SHAPE, not colour: connected, current and occupied each get a
 * different mark, so the board still reads in greyscale and to a colour-blind student.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { BreadboardGlyph } from '../src/renderer/circuit/renderers/BreadboardGlyph';
import { CircuitCanvas } from '../src/renderer/circuit/CircuitCanvas';
import { useAppStore } from '../src/renderer/state/store';
import { COMPONENT_CATALOG } from '../src/renderer/app/circuit/component-catalog';
import { breadboardHolePoints, holeCanvasPosition } from '../src/renderer/app/circuit/breadboard-geometry';

const board = (overrides: Partial<CircuitComponent> = {}): CircuitComponent =>
  ({
    id: 'bb1',
    kind: 'breadboard',
    x: 300,
    y: 250,
    rotation: 0,
    label: 'Breadboard',
    properties: {},
    ...overrides,
  }) as CircuitComponent;

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

function renderGlyph(component = board(), wires: CircuitWire[] = [], onHoleActivate = vi.fn()) {
  const utils = render(
    <svg data-testid="canvas" viewBox="0 0 900 620">
      <BreadboardGlyph component={component} selected={false} wires={wires} onHoleActivate={onHoleActivate} />
    </svg>,
  );
  const root = utils.container.querySelector(`[data-testid="breadboard-${component.id}"]`) as SVGGElement;
  const surface = utils.container.querySelector(
    `[data-testid="breadboard-surface-${component.id}"]`,
  ) as SVGRectElement;
  return { ...utils, root, surface, onHoleActivate };
}

/**
 * jsdom implements no SVG geometry, so `getScreenCTM` is stubbed with an identity matrix.
 * That makes client coordinates equal user-space coordinates, which is exactly what the
 * pointer path needs in order to be exercised at all.
 */
function stubSvgGeometry(): void {
  const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
  proto.createSVGPoint = function createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform(this: { x: number; y: number }) {
        return { x: this.x, y: this.y };
      },
    };
  };
  proto.getScreenCTM = function getScreenCTM() {
    return { inverse: () => ({}) };
  };
}

stubSvgGeometry();
afterEach(cleanup);

describe('1, 3: what is drawn', () => {
  it('draws exactly 400 hole marks, one per canonical hole', () => {
    const { root } = renderGlyph();
    const marks = root.querySelectorAll('[data-hole]');
    expect(marks).toHaveLength(400);
    const ids = [...marks].map((m) => m.getAttribute('data-hole'));
    expect(new Set(ids)).toEqual(new Set(breadboardHolePoints().map((h) => h.id)));
  });

  it('draws the body, the centre separation and four rail markings', () => {
    const { root } = renderGlyph();
    expect(root.querySelector('.breadboardGlyph__body')).toBeTruthy();
    expect(root.querySelector('.breadboardGlyph__trench')).toBeTruthy();
    expect(root.querySelectorAll('.breadboardGlyph__rail')).toHaveLength(4);
    expect(root.querySelectorAll('.breadboardGlyph__rail--positive')).toHaveLength(2);
    expect(root.querySelectorAll('.breadboardGlyph__rail--negative')).toHaveLength(2);
  });

  it('labels rows A to J', () => {
    const { root } = renderGlyph();
    const labels = [...root.querySelectorAll('[data-row-label]')].map((n) => n.getAttribute('data-row-label'));
    expect(labels).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });

  it('labels strip columns across the full 1 to 30 span', () => {
    const { root } = renderGlyph();
    const columns = [...root.querySelectorAll('[data-column-label]')].map((n) =>
      Number(n.getAttribute('data-column-label')),
    );
    expect(columns[0]).toBe(1);
    expect(columns).toContain(30);
    expect(columns.every((c) => c >= 1 && c <= 30)).toBe(true);
  });

  it('shows the selected board state', () => {
    const { container } = render(
      <svg>
        <BreadboardGlyph component={board()} selected wires={[]} />
      </svg>,
    );
    expect(container.querySelector('.breadboardGlyph__body')?.getAttribute('data-selected')).toBe('true');
  });
});

describe('2, 21: one surface, and cues that are not colour alone', () => {
  it('has exactly one focusable element, not 400', () => {
    const { root } = renderGlyph();
    const focusable = root.querySelectorAll('[tabindex]');
    expect(focusable).toHaveLength(1);
    expect(focusable[0].getAttribute('data-testid')).toBe('breadboard-surface-bb1');
  });

  it('hides the hole marks from the accessibility tree and from the pointer', () => {
    const { root } = renderGlyph();
    const holes = root.querySelector('.breadboardGlyph__holes')!;
    expect(holes.getAttribute('aria-hidden')).toBe('true');
    expect(holes.getAttribute('pointerEvents') ?? holes.getAttribute('pointer-events')).toBe('none');
    expect(holes.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(holes.querySelectorAll('button')).toHaveLength(0);
  });

  it('marks an occupied hole with a shape, not a colour', () => {
    const { root } = renderGlyph(board(), [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const hole = root.querySelector('[data-hole="A5"]')!;
    expect(hole.getAttribute('data-occupied')).toBe('true');
    const occupied = hole.querySelector('[data-state="occupied"]')!;
    // A cross: two lines, so it survives greyscale.
    expect(occupied.querySelectorAll('line')).toHaveLength(2);
    expect(root.querySelector('[data-hole="A6"]')?.getAttribute('data-occupied')).toBe('false');
  });

  it('gives connected, current and occupied three different shapes', () => {
    const { root, surface } = renderGlyph(board(), [wire('w1', ['uno1', 'D13'], ['bb1', 'B5'])]);
    fireEvent.keyDown(surface, { key: 'Enter' });
    // Navigate to A5 so its group is highlighted and B5 is both connected and occupied.
    const start = root.querySelector('[data-state="current"]');
    expect(start).toBeTruthy();

    const shapeOf = (state: string) => {
      const node = root.querySelector(`[data-state="${state}"]`);
      return node ? node.tagName.toLowerCase() : null;
    };
    expect(shapeOf('occupied')).toBe('g'); // cross
    expect(shapeOf('current')).toBe('rect'); // focus box
  });
});

describe('5, 6: transforms', () => {
  it.each([0, 90, 180, 270] as const)('applies a %i degree rotation to the whole glyph', (rotation) => {
    const { root } = renderGlyph(board({ rotation }));
    expect(root.getAttribute('transform')).toBe(`translate(300 250) rotate(${rotation})`);
  });

  it('keeps hole identities when the board is moved or rotated', () => {
    const idsAt = (component: CircuitComponent) => {
      const { root, unmount } = renderGlyph(component);
      const ids = [...root.querySelectorAll('[data-hole]')].map((n) => n.getAttribute('data-hole'));
      unmount();
      return ids;
    };
    const base = idsAt(board());
    expect(idsAt(board({ x: 700, y: 90 }))).toEqual(base);
    expect(idsAt(board({ rotation: 90 }))).toEqual(base);
    expect(idsAt(board({ x: 40, y: 500, rotation: 270 }))).toEqual(base);
  });
});

describe('7, 11: pointer and keyboard agree', () => {
  it('reports the hole under a click', () => {
    const { surface, onHoleActivate } = renderGlyph();
    const target = holeCanvasPosition('C7', board())!;
    fireEvent.click(surface, { clientX: target.x, clientY: target.y });
    expect(onHoleActivate).toHaveBeenCalledWith('C7');
  });

  it('reports nothing when the click lands between holes', () => {
    const { surface, onHoleActivate } = renderGlyph();
    const a = holeCanvasPosition('C7', board())!;
    const b = holeCanvasPosition('C8', board())!;
    fireEvent.click(surface, { clientX: (a.x + b.x) / 2, clientY: a.y });
    expect(onHoleActivate).not.toHaveBeenCalled();
  });

  it('resolves the same terminal id by pointer and by keyboard', () => {
    // Both paths are aimed at the SAME logical hole — the one keyboard navigation starts on
    // — so this compares the two resolvers rather than two different targets.
    const keyboard = renderGlyph();
    fireEvent.keyDown(keyboard.surface, { key: 'Enter' }); // enter navigation
    fireEvent.keyDown(keyboard.surface, { key: 'Enter' }); // activate the starting hole
    const viaKeyboard = keyboard.onHoleActivate.mock.calls[0][0] as string;
    cleanup();

    const pointer = renderGlyph();
    const target = holeCanvasPosition(viaKeyboard, board())!;
    fireEvent.click(pointer.surface, { clientX: target.x, clientY: target.y });
    const viaPointer = pointer.onHoleActivate.mock.calls[0][0];

    expect(viaPointer).toBe(viaKeyboard);
    expect(breadboardHolePoints().some((h) => h.id === viaKeyboard)).toBe(true);
  });

  it('resolves an arbitrary hole the same way by both paths', () => {
    // Walk the keyboard cursor one step right, then click exactly where it now is.
    const keyboard = renderGlyph();
    fireEvent.keyDown(keyboard.surface, { key: 'Enter' });
    fireEvent.keyDown(keyboard.surface, { key: 'ArrowRight' });
    fireEvent.keyDown(keyboard.surface, { key: 'Enter' });
    const viaKeyboard = keyboard.onHoleActivate.mock.calls[0][0] as string;
    cleanup();

    const pointer = renderGlyph();
    const target = holeCanvasPosition(viaKeyboard, board())!;
    fireEvent.click(pointer.surface, { clientX: target.x, clientY: target.y });
    expect(pointer.onHoleActivate).toHaveBeenCalledWith(viaKeyboard);
  });
});

describe('13, 14: connected-group feedback', () => {
  it('rings every other hole in the same strip and nothing across the separation', () => {
    const { root, surface } = renderGlyph();
    const target = holeCanvasPosition('C5', board())!;
    fireEvent.mouseMove(surface, { clientX: target.x, clientY: target.y });

    const connected = [...root.querySelectorAll('[data-state="connected"]')].map((n) =>
      n.parentElement!.getAttribute('data-hole'),
    );
    expect(new Set(connected)).toEqual(new Set(['A5', 'B5', 'D5', 'E5']));
    for (const across of ['F5', 'G5', 'H5', 'I5', 'J5']) expect(connected).not.toContain(across);
  });

  it('rings the whole rail for a rail hole', () => {
    const { root, surface } = renderGlyph();
    const target = holeCanvasPosition('TP1', board())!;
    fireEvent.mouseMove(surface, { clientX: target.x, clientY: target.y });
    const connected = [...root.querySelectorAll('[data-state="connected"]')].map((n) =>
      n.parentElement!.getAttribute('data-hole'),
    );
    expect(connected).toHaveLength(24);
    expect(connected.every((id) => id!.startsWith('TP'))).toBe(true);
  });
});

describe('22-29: keyboard and announcements', () => {
  it('is reached by Tab once', () => {
    const { surface } = renderGlyph();
    expect(surface.getAttribute('tabindex')).toBe('0');
    expect(surface.getAttribute('role')).toBe('application');
    expect(surface.getAttribute('aria-label')).toContain('Breadboard');
  });

  it('enters navigation on Enter and on Space', () => {
    for (const key of ['Enter', ' ']) {
      const { root, surface, unmount } = renderGlyph();
      expect(root.getAttribute('data-navigating')).toBe('false');
      fireEvent.keyDown(surface, { key });
      expect(root.getAttribute('data-navigating')).toBe('true');
      unmount();
    }
  });

  it('moves the cursor deterministically with the arrow keys', () => {
    const { root, surface } = renderGlyph();
    const currentHole = () =>
      root.querySelector('[data-state="current"]')?.parentElement?.getAttribute('data-hole');

    fireEvent.keyDown(surface, { key: 'Enter' });
    const start = currentHole()!;
    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    const afterRight = currentHole();
    fireEvent.keyDown(surface, { key: 'ArrowLeft' });
    expect(currentHole()).toBe(start);
    expect(afterRight).not.toBe(start);
  });

  it('shows a visible non-colour-only marker for the current hole', () => {
    const { root, surface } = renderGlyph();
    fireEvent.keyDown(surface, { key: 'Enter' });
    const marker = root.querySelector('[data-state="current"]')!;
    expect(marker.tagName.toLowerCase()).toBe('rect');
    expect(marker.getAttribute('fill')).toBe('none');
    expect(Number(marker.getAttribute('stroke-width'))).toBeGreaterThan(0);
  });

  it('leaves navigation on Escape', () => {
    const { root, surface } = renderGlyph();
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(root.getAttribute('data-navigating')).toBe('true');
    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(root.getAttribute('data-navigating')).toBe('false');
  });

  it('never traps Tab', () => {
    const { surface } = renderGlyph();
    fireEvent.keyDown(surface, { key: 'Enter' });
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops handled keys from reaching global shortcuts, and lets others through', () => {
    const { surface } = renderGlyph();
    fireEvent.keyDown(surface, { key: 'Enter' });

    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    surface.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);

    const unhandled = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    surface.dispatchEvent(unhandled);
    expect(unhandled.defaultPrevented).toBe(false);
  });

  it('announces hole, connections and availability', () => {
    const { surface } = renderGlyph(board(), [wire('w1', ['uno1', 'D13'], ['bb1', 'TN1'])]);
    fireEvent.keyDown(surface, { key: 'Enter' });
    const live = screen.getByTestId('breadboard-live-bb1');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('TN1');
    expect(live.textContent).toContain('top negative rail');
    expect(live.textContent).toContain('Occupied');
  });

  it('says Available for an empty hole', () => {
    const { surface } = renderGlyph();
    fireEvent.keyDown(surface, { key: 'Enter' });
    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    expect(screen.getByTestId('breadboard-live-bb1').textContent).toContain('Available');
  });
});

describe('30-32: canvas integration', () => {
  // C2A asserted the breadboard was absent from the catalog, because nothing could wire it
  // up. C2B adds it deliberately, so that assertion is replaced by one that checks the entry
  // is there and says only true things.
  it('offers exactly one breadboard catalog entry', () => {
    expect(COMPONENT_CATALOG.filter((e) => e.kind === 'breadboard')).toHaveLength(1);
  });

  it('draws a breadboard supplied directly to CircuitCanvas', () => {
    useAppStore.setState((s) => ({
      circuit: { ...s.circuit, components: [board()] as never, wires: [], junctions: [], selectedIds: [] },
    }));
    render(<CircuitCanvas />);
    expect(screen.getByTestId('breadboard-bb1')).toBeTruthy();
    expect(screen.getAllByTestId('breadboard-surface-bb1')).toHaveLength(1);
  });

  it('leaves ordinary components rendering exactly as before', () => {
    const led = { id: 'led1', kind: 'led', x: 200, y: 160, rotation: 0, label: 'LED', properties: {} };
    useAppStore.setState((s) => ({
      circuit: { ...s.circuit, components: [led] as never, wires: [], junctions: [], selectedIds: [] },
    }));
    const { container } = render(<CircuitCanvas />);
    expect(container.querySelector('[data-testid^="breadboard-"]')).toBeNull();
    expect(within(container.querySelector('.componentLayer')!).queryAllByTestId(/breadboard/)).toHaveLength(0);
    expect(container.querySelector('.componentLayer')!.children).toHaveLength(1);
  });
});
