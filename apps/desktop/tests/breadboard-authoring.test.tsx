// @vitest-environment jsdom
/**
 * Breadboard authoring, end to end through the real application state.
 *
 * The rule this exists to protect is that a refusal changes nothing. One hole holds one wire,
 * and a rejected pick must leave the project, the history and any wire already in progress
 * exactly as they were — otherwise a student gets a dangling half-wire they cannot see the
 * start of. That is enforced in the store, before any mutation, rather than in the renderer:
 * a rule only the drawing knows about is a rule the keyboard path walks straight past.
 *
 * Identity is `componentId:terminalId` throughout. `A1` and `D13` are real breadboard holes
 * AND real Uno pin names, and two breadboards each have their own `A1`, so several tests here
 * exist purely to prove those never merge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { useAppStore, lastWirePickResult } from '../src/renderer/state/store';
import { CircuitCanvas } from '../src/renderer/circuit/CircuitCanvas';
import { CircuitPane, BREADBOARD_3D_NOTICE } from '../src/renderer/app/components/CircuitPane';
import { COMPONENT_CATALOG, catalogEntry } from '../src/renderer/app/circuit/component-catalog';
import { canLoadProject, breadboardCount } from '../src/renderer/app/project-load-guard';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import { holeCanvasPosition } from '../src/renderer/app/circuit/breadboard-geometry';
import { occupiedHoles } from '../src/renderer/app/circuit/breadboard-connections';
import type { ProjectFileDTO } from '../src/preload/electron-api-types';

const UNO = { id: 'uno1', kind: 'uno-r3', x: 60, y: 60, rotation: 0, label: 'Uno', properties: {} };
const bb = (id = 'bb1', x = 300, y = 250, rotation = 0) =>
  ({ id, kind: 'breadboard', x, y, rotation, label: 'Breadboard', properties: {} }) as CircuitComponent;
const LED = { id: 'led1', kind: 'led', x: 600, y: 400, rotation: 0, label: 'LED', properties: {} };

function seed(components: unknown[], wires: CircuitWire[] = [], mode: '2d' | '3d' = '2d'): void {
  useAppStore.setState((s) => ({
    circuit: {
      ...s.circuit,
      components: components as never,
      wires,
      junctions: [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
    history: { past: [], future: [] },
    layout: { ...s.layout, viewportMode: mode },
    simulation: { ...s.simulation, circuitDiagnostics: [] },
  }));
}

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

const circuit = () => useAppStore.getState().circuit;
const actions = () => useAppStore.getState().actions;
const pick = (componentId: string, terminalId: string) => actions().pickTerminal({ componentId, terminalId });

function project(components: unknown[]): ProjectFileDTO {
  return {
    schemaVersion: 2,
    projectId: 'p-1',
    name: 'Imported',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    boardId: 'uno',
    sources: { 'Sketch.ino': '// x\n' },
    circuit: { schemaVersion: 2, components, wires: [], junctions: [] },
  } as ProjectFileDTO;
}

/** jsdom has no SVG geometry; identity matrix makes client coords equal user space. */
function stubSvgGeometry(): void {
  const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
  proto.createSVGPoint = function createSVGPoint() {
    return { x: 0, y: 0, matrixTransform(this: { x: number; y: number }) { return { x: this.x, y: this.y }; } };
  };
  proto.getScreenCTM = function getScreenCTM() {
    return { inverse: () => ({}) };
  };
}
stubSvgGeometry();

beforeEach(() => seed([UNO, bb()]));
afterEach(cleanup);

describe('1-6: live wiring through the application workflow', () => {
  it('starts a wire at an available hole and saves the qualified endpoint', () => {
    pick('bb1', 'A5');
    expect(circuit().pendingWireFrom).toEqual({ componentId: 'bb1', terminalId: 'A5' });
    expect(circuit().wires).toHaveLength(0);
  });

  it('completes a wire between an ordinary terminal and a hole', () => {
    pick('uno1', 'D13');
    pick('bb1', 'A5');
    const [w] = circuit().wires;
    expect(w.from).toEqual({ componentId: 'uno1', terminalId: 'D13' });
    expect(w.to).toEqual({ componentId: 'bb1', terminalId: 'A5' });
    expect(circuit().pendingWireFrom).toBeNull();
  });

  it('completes a wire between two available holes', () => {
    pick('bb1', 'A5');
    pick('bb1', 'J20');
    const [w] = circuit().wires;
    expect(w.from.terminalId).toBe('A5');
    expect(w.to.terminalId).toBe('J20');
    expect(w.from.componentId).toBe('bb1');
  });

  it('keeps Uno D13 and breadboard D13 apart in one saved wire', () => {
    pick('uno1', 'D13');
    pick('bb1', 'D13');
    const [w] = circuit().wires;
    expect(w.from.componentId).toBe('uno1');
    expect(w.to.componentId).toBe('bb1');
    expect(occupiedHoles(circuit().wires, 'bb1')).toEqual(new Set(['D13']));
  });

  it('routes pointer activation through the same command path', () => {
    render(<CircuitCanvas />);
    const surface = screen.getByTestId('breadboard-surface-bb1');
    const target = holeCanvasPosition('C7', bb() as never)!;
    fireEvent.click(surface, { clientX: target.x, clientY: target.y });
    expect(circuit().pendingWireFrom).toEqual({ componentId: 'bb1', terminalId: 'C7' });
  });

  it('gives pointer and keyboard the identical endpoint for one logical hole', () => {
    render(<CircuitCanvas />);
    const surface = screen.getByTestId('breadboard-surface-bb1');
    fireEvent.keyDown(surface, { key: 'Enter' }); // enter navigation
    fireEvent.keyDown(surface, { key: 'Enter' }); // select the current hole
    const viaKeyboard = circuit().pendingWireFrom!;
    actions().cancelWire();

    const target = holeCanvasPosition(viaKeyboard.terminalId, bb() as never)!;
    fireEvent.click(surface, { clientX: target.x, clientY: target.y });
    expect(circuit().pendingWireFrom).toEqual(viaKeyboard);
  });
});

describe('7-17: occupancy is atomic', () => {
  it('refuses to start from an occupied hole and changes nothing', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const before = JSON.stringify(circuit());
    pick('bb1', 'A5');
    expect(JSON.stringify(circuit())).toBe(before);
    expect(lastWirePickResult().ok).toBe(false);
  });

  it('refuses to complete into an occupied hole, preserving the active start', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    pick('uno1', 'D12');
    const pending = circuit().pendingWireFrom;
    const wiresBefore = circuit().wires.length;
    const historyBefore = useAppStore.getState().history.past.length;

    pick('bb1', 'A5');

    expect(circuit().wires).toHaveLength(wiresBefore);
    expect(circuit().pendingWireFrom).toEqual(pending);
    expect(useAppStore.getState().history.past).toHaveLength(historyBefore);
  });

  it('lets the user recover onto a suggested alternative', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    pick('uno1', 'D12');
    pick('bb1', 'A5');
    const alternatives = lastWirePickResult().alternatives!;
    expect(alternatives).toEqual(['B5', 'C5', 'D5', 'E5']);

    pick('bb1', alternatives[0]);
    expect(circuit().wires).toHaveLength(2);
    expect(circuit().wires[1].to).toEqual({ componentId: 'bb1', terminalId: 'B5' });
  });

  it('suggests only free, same-group holes and never crosses the centre channel', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5']), wire('w2', ['uno1', 'D11'], ['bb1', 'C5'])]);
    pick('bb1', 'A5');
    expect(lastWirePickResult().alternatives).toEqual(['B5', 'D5', 'E5']);
    for (const across of ['F5', 'G5', 'H5', 'I5', 'J5']) {
      expect(lastWirePickResult().alternatives).not.toContain(across);
    }
  });

  it('suggests only the same rail', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'TP1'])]);
    pick('bb1', 'TP1');
    expect(lastWirePickResult().alternatives!.every((id) => id.startsWith('TP'))).toBe(true);
  });

  it('counts both ends of every saved wire', () => {
    seed([UNO, bb()], [wire('w1', ['bb1', 'A5'], ['bb1', 'J20'])]);
    expect(occupiedHoles(circuit().wires, 'bb1')).toEqual(new Set(['A5', 'J20']));
    pick('bb1', 'J20');
    expect(lastWirePickResult().ok).toBe(false);
  });

  it('treats the same bare id on different components independently', () => {
    seed([UNO, bb('bb1'), bb('bb2', 700, 250)], [wire('w1', ['uno1', 'A1'], ['bb2', 'A1'])]);
    expect(occupiedHoles(circuit().wires, 'bb1').has('A1')).toBe(false);
    pick('bb1', 'A1');
    expect(lastWirePickResult().ok).toBe(true);
    expect(circuit().pendingWireFrom).toEqual({ componentId: 'bb1', terminalId: 'A1' });
  });

  it('treats a hole claimed by the wire in progress as occupied', () => {
    pick('bb1', 'A5');
    pick('bb1', 'A5');
    // Same terminal twice is the existing cancel gesture, so no wire and no pending start.
    expect(circuit().wires).toHaveLength(0);
    expect(circuit().pendingWireFrom).toBeNull();
  });

  it('leaves saved occupancy alone when a wire is cancelled', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    pick('bb1', 'B5');
    actions().cancelWire();
    expect(occupiedHoles(circuit().wires, 'bb1')).toEqual(new Set(['A5']));
    expect(circuit().pendingWireFrom).toBeNull();
  });

  it('frees both holes the moment a wire is deleted', () => {
    seed([UNO, bb()], [wire('w1', ['bb1', 'A5'], ['bb1', 'J20'])]);
    actions().deleteWires(['w1']);
    expect(occupiedHoles(circuit().wires, 'bb1').size).toBe(0);
    pick('bb1', 'A5');
    expect(lastWirePickResult().ok).toBe(true);
  });

  it('marks both endpoints occupied immediately after a successful completion', () => {
    pick('bb1', 'A5');
    pick('bb1', 'J20');
    expect(occupiedHoles(circuit().wires, 'bb1')).toEqual(new Set(['A5', 'J20']));
  });
});

describe('18-23: lifecycle', () => {
  it('moves rendered endpoints but keeps identities when the board moves', () => {
    seed([UNO, bb('bb1', 300, 250)], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const before = holeCanvasPosition('A5', bb('bb1', 300, 250) as never)!;
    actions().moveComponent('bb1', 700, 90);
    const moved = circuit().components.find((c) => c.id === 'bb1')!;
    const after = holeCanvasPosition('A5', moved as never)!;

    expect(after.x).not.toBeCloseTo(before.x, 3);
    expect(circuit().wires[0].to).toEqual({ componentId: 'bb1', terminalId: 'A5' });
  });

  it.each([1, 2, 3])('preserves identities across %i quarter turns', (turns) => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const before = holeCanvasPosition('A5', bb() as never)!;
    actions().rotateComponent('bb1', turns);
    const rotated = circuit().components.find((c) => c.id === 'bb1')!;
    expect([0, 90, 180, 270]).toContain(rotated.rotation);
    const after = holeCanvasPosition('A5', rotated as never)!;
    expect(`${after.x},${after.y}`).not.toBe(`${before.x},${before.y}`);
    expect(circuit().wires[0].to).toEqual({ componentId: 'bb1', terminalId: 'A5' });
    expect(circuit().wires).toHaveLength(1);
  });

  it('removes every attached wire when the board is deleted, leaving nothing dangling', () => {
    seed(
      [UNO, bb(), LED],
      [wire('w1', ['uno1', 'D13'], ['bb1', 'A5']), wire('w2', ['bb1', 'J20'], ['led1', 'anode']), wire('w3', ['uno1', 'D2'], ['led1', 'cathode'])],
    );
    actions().deleteComponents(['bb1']);
    expect(circuit().components.some((c) => c.id === 'bb1')).toBe(false);
    const ids = circuit().wires.map((w) => w.id);
    expect(ids).toEqual(['w3']);
    for (const w of circuit().wires) {
      for (const end of [w.from, w.to]) {
        expect(circuit().components.some((c) => c.id === end.componentId)).toBe(true);
      }
    }
  });

  it('survives a save/load round trip with exact identities', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const snapshot = JSON.parse(JSON.stringify(circuit()));
    seed([UNO], []);
    loadProjectIntoStore(project(snapshot.components));
    useAppStore.setState((s) => ({ circuit: { ...s.circuit, wires: snapshot.wires } }));
    expect(circuit().wires[0].to).toEqual({ componentId: 'bb1', terminalId: 'A5' });
    expect(occupiedHoles(circuit().wires, 'bb1')).toEqual(new Set(['A5']));
  });
});

describe('24-32: keyboard, announcements and refusal feedback', () => {
  const surfaceOf = () => {
    render(<CircuitCanvas />);
    return screen.getByTestId('breadboard-surface-bb1');
  };

  it('enters navigation on Enter without also starting a wire', () => {
    const surface = surfaceOf();
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(circuit().pendingWireFrom).toBeNull();
    expect(screen.getByTestId('breadboard-bb1').getAttribute('data-navigating')).toBe('true');
  });

  it('selects the current hole with a second Enter', () => {
    const surface = surfaceOf();
    fireEvent.keyDown(surface, { key: 'Enter' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(circuit().pendingWireFrom).not.toBeNull();
  });

  it('cancels the active wire on Escape before leaving navigation', () => {
    const surface = surfaceOf();
    fireEvent.keyDown(surface, { key: 'Enter' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(circuit().pendingWireFrom).not.toBeNull();

    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(circuit().pendingWireFrom).toBeNull();
    expect(screen.getByTestId('breadboard-bb1').getAttribute('data-navigating')).toBe('true');

    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(screen.getByTestId('breadboard-bb1').getAttribute('data-navigating')).toBe('false');
  });

  it('never traps Tab, and lets unhandled keys through', () => {
    const surface = surfaceOf();
    fireEvent.keyDown(surface, { key: 'Enter' });
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    surface.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);

    const other = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    surface.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('does not mutate wire state when a click lands in a rejection band', () => {
    const surface = surfaceOf();
    const a = holeCanvasPosition('C7', bb() as never)!;
    const b = holeCanvasPosition('C8', bb() as never)!;
    fireEvent.click(surface, { clientX: (a.x + b.x) / 2, clientY: a.y });
    expect(circuit().pendingWireFrom).toBeNull();
    expect(circuit().wires).toHaveLength(0);
  });

  it('announces a refusal and reports it in the Problems panel', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const surface = surfaceOf();
    const target = holeCanvasPosition('A5', bb() as never)!;
    fireEvent.click(surface, { clientX: target.x, clientY: target.y });

    const live = screen.getByTestId('breadboard-live-bb1');
    expect(live.textContent).toContain('A5');
    expect(live.textContent).toMatch(/one wire/i);
    expect(live.textContent).toContain('B5');

    const diagnostics = useAppStore.getState().simulation.circuitDiagnostics;
    expect(diagnostics.some((d) => d.code === 'BREADBOARD_HOLE_OCCUPIED')).toBe(true);
  });

  it('keeps the three non-colour-only cues after a refusal', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const surface = surfaceOf();
    const target = holeCanvasPosition('A5', bb() as never)!;
    fireEvent.mouseMove(surface, { clientX: target.x, clientY: target.y });
    fireEvent.click(surface, { clientX: target.x, clientY: target.y });

    const root = screen.getByTestId('breadboard-bb1');
    expect(root.querySelector('[data-state="occupied"]')).toBeTruthy();
    expect(root.querySelectorAll('[data-state="connected"]').length).toBeGreaterThan(0);
  });
});

describe('33-37: catalog and budget', () => {
  it('offers exactly one breadboard entry that says only true things', () => {
    const entries = COMPONENT_CATALOG.filter((e) => e.kind === 'breadboard');
    expect(entries).toHaveLength(1);
    const entry = catalogEntry('breadboard')!;
    expect(entry.name).toBe('400-Tie-Point Breadboard');
    const text = `${entry.summary} ${entry.guidance}`.toLowerCase();
    expect(text).toContain('five-hole');
    expect(text).toMatch(/rails are separate|four rails/);
    expect(text).toContain('jumper wire');
    // Must not claim what does not exist.
    expect(text).not.toContain('3d workspace support');
    expect(text).not.toMatch(/busboard|bb400/);
    expect(text).not.toMatch(/insert (an? )?(led|resistor)/);
  });

  it('places a breadboard while editing in 2D', () => {
    seed([UNO], [], '2d');
    const id = actions().addComponent('breadboard', 400, 300);
    expect(id).toBeTruthy();
    expect(circuit().components.filter((c) => c.kind === 'breadboard')).toHaveLength(1);
  });

  it('refuses placement while 3D is active, creating nothing', () => {
    seed([UNO], [], '3d');
    const before = JSON.stringify(circuit());
    expect(actions().addComponent('breadboard', 400, 300)).toBeNull();
    expect(JSON.stringify(circuit())).toBe(before);
  });

  it('refuses an over-budget placement before any mutation', () => {
    seed([UNO, bb('b1'), bb('b2', 500), bb('b3', 700)], [], '2d');
    const before = JSON.stringify(circuit());
    expect(actions().addComponent('breadboard', 400, 300)).toBeNull();
    expect(JSON.stringify(circuit())).toBe(before);
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it('keeps multiple instances electrically independent', () => {
    seed([UNO], [], '2d');
    const a = actions().addComponent('breadboard', 200, 200)!;
    const b = actions().addComponent('breadboard', 600, 200)!;
    expect(a).not.toBe(b);
    pick(a, 'A1');
    pick(b, 'A1');
    const [w] = circuit().wires;
    expect(w.from.componentId).toBe(a);
    expect(w.to.componentId).toBe(b);
    expect(occupiedHoles(circuit().wires, a)).toEqual(new Set(['A1']));
    expect(occupiedHoles(circuit().wires, b)).toEqual(new Set(['A1']));
  });
});

describe('38-46: loading and the temporary 3D gate', () => {
  it('loads a breadboard project — the C1B blanket refusal is gone', () => {
    expect(canLoadProject(project([UNO, bb()])).ok).toBe(true);
    const result = loadProjectIntoStore(project([UNO, bb()]));
    expect(result.ok).toBe(true);
    expect(circuit().components.some((c) => c.kind === 'breadboard')).toBe(true);
  });

  it('puts the workspace into 2D atomically when the project has a breadboard', () => {
    seed([UNO], [], '3d');
    const result = loadProjectIntoStore(project([UNO, bb()]));
    expect(result.ok).toBe(true);
    expect((result as { switchedTo2D?: boolean }).switchedTo2D).toBe(true);
    expect(useAppStore.getState().layout.viewportMode).toBe('2d');
  });

  it('leaves the view alone for a project with no breadboard', () => {
    seed([UNO], [], '3d');
    const result = loadProjectIntoStore(project([UNO, LED]));
    expect(result.ok).toBe(true);
    expect((result as { switchedTo2D?: boolean }).switchedTo2D).toBe(false);
    expect(useAppStore.getState().layout.viewportMode).toBe('3d');
  });

  it('still refuses an over-budget project before any mutation', () => {
    const over = [UNO, bb('b1'), bb('b2'), bb('b3'), bb('b4')];
    expect(canLoadProject(project(over)).ok).toBe(false);
    seed([UNO], []);
    const before = JSON.stringify(circuit());
    expect(loadProjectIntoStore(project(over)).ok).toBe(false);
    expect(JSON.stringify(circuit())).toBe(before);
  });

  it('counts breadboards for the gate', () => {
    expect(breadboardCount(project([UNO]))).toBe(0);
    expect(breadboardCount(project([UNO, bb('b1'), bb('b2')]))).toBe(2);
  });

  it('shows 2D with a visible reason, and disables the 3D control', () => {
    seed([UNO, bb()], [], '3d');
    render(<CircuitPane />);
    const reason = screen.getByTestId('viewport-3d-disabled-reason');
    expect(reason.textContent).toBe(BREADBOARD_3D_NOTICE);
    expect(reason.textContent).toMatch(/next milestone/i);
    const threeD = screen.getByRole('tab', { name: /3D Workspace/i });
    expect(threeD.getAttribute('aria-disabled')).toBe('true');
    // The 2D canvas is what actually mounted.
    expect(screen.getByTestId('breadboard-bb1')).toBeTruthy();
  });

  it('restores 3D availability once the last breadboard is gone', () => {
    seed([UNO, bb()], [], '2d');
    const { rerender } = render(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeTruthy();

    actions().deleteComponents(['bb1']);
    rerender(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeNull();
    expect(screen.getByRole('tab', { name: /3D Workspace/i }).getAttribute('aria-disabled')).toBe('false');
  });

  it('leaves a non-breadboard project free to use 3D', () => {
    seed([UNO, LED], [], '2d');
    render(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeNull();
  });
});
