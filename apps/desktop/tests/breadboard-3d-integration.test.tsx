// @vitest-environment jsdom
/**
 * The 3D breadboard's state cues, its instancing behaviour, and the gate that still keeps it
 * out of the production workspace.
 *
 * NO WEBGL HERE. The project has no R3F test renderer and this checkpoint does not justify
 * adding one, so the pattern Phase B established is followed instead: the parts worth testing
 * are pure, and real three.js objects are exercised directly. `Breadboard3D.tsx` is a thin
 * shell over `breadboard-3d-geometry.ts` precisely so that this is possible.
 *
 * The gate is the point of the last group. C3 makes a breadboard renderable; C4 has not made
 * it *routable*, so a wire ending in a hole would have nothing to clear and nowhere
 * legitimate to enter. Until then a breadboard project must still be unable to mount the 3D
 * canvas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import type { CircuitWire } from '@offline-arduino/contracts/circuit';
import {
  breadboardHoleInstances,
  breadboardInstanceCount,
  holeVisualState,
  resolveInstanceTerminal,
  terminalInstanceIndex,
  HOLE_OPENING_DEPTH,
  HOLE_OPENING_SIZE,
} from '../src/renderer/app/circuit/hardware/breadboard-3d-geometry';
import { holesInSameGroup, occupiedHoles } from '../src/renderer/app/circuit/breadboard-connections';
import { useAppStore, lastWirePickResult } from '../src/renderer/state/store';
import { CircuitPane, BREADBOARD_3D_NOTICE } from '../src/renderer/app/components/CircuitPane';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import type { ProjectFileDTO } from '../src/preload/electron-api-types';

const UNO = { id: 'uno1', kind: 'uno-r3', x: 60, y: 60, rotation: 0, label: 'Uno', properties: {} };
const bb = (id = 'bb1', x = 300, y = 250) =>
  ({ id, kind: 'breadboard', x, y, rotation: 0, label: 'Breadboard', properties: {} });
const LED = { id: 'led1', kind: 'led', x: 600, y: 400, rotation: 0, label: 'LED', properties: {} };

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

function seed(components: unknown[], wires: CircuitWire[] = [], mode: '2d' | '3d' = '2d'): void {
  useAppStore.setState((s) => ({
    circuit: { ...s.circuit, components: components as never, wires, junctions: [], selectedIds: [], pendingWireFrom: null },
    layout: { ...s.layout, viewportMode: mode },
    history: { past: [], future: [] },
  }));
}

function project(components: unknown[]): ProjectFileDTO {
  return {
    schemaVersion: 2,
    projectId: 'p',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    boardId: 'uno',
    sources: { 'Sketch.ino': '' },
    circuit: { schemaVersion: 2, components, wires: [], junctions: [] },
  } as ProjectFileDTO;
}

const circuit = () => useAppStore.getState().circuit;
const actions = () => useAppStore.getState().actions;

beforeEach(() => seed([UNO, bb()]));
afterEach(cleanup);

describe('25-32: state cues and their precedence', () => {
  it('gives every hole exactly one state', () => {
    const occupied = new Set(['A5']);
    const connected = new Set(holesInSameGroup('A5'));
    for (const hole of breadboardHoleInstances()) {
      const state = holeVisualState(hole.id, { currentHoleId: 'C5', occupied, connected });
      expect(['current', 'occupied', 'connected', 'idle']).toContain(state);
    }
  });

  it('ranks current above occupied above connected', () => {
    const occupied = new Set(['A5', 'B5']);
    const connected = new Set(['A5', 'B5', 'C5', 'D5', 'E5']);
    expect(holeVisualState('A5', { currentHoleId: 'A5', occupied, connected })).toBe('current');
    expect(holeVisualState('B5', { currentHoleId: 'A5', occupied, connected })).toBe('occupied');
    expect(holeVisualState('C5', { currentHoleId: 'A5', occupied, connected })).toBe('connected');
    expect(holeVisualState('J30', { currentHoleId: 'A5', occupied, connected })).toBe('idle');
  });

  it('never highlights a group across the centre channel', () => {
    const connected = new Set(holesInSameGroup('C5'));
    for (const across of ['F5', 'G5', 'H5', 'I5', 'J5']) {
      expect(`${across}:${holeVisualState(across, { connected })}`).toBe(`${across}:idle`);
    }
    for (const same of ['A5', 'B5', 'D5', 'E5']) {
      expect(`${same}:${holeVisualState(same, { connected })}`).toBe(`${same}:connected`);
    }
  });

  it('highlights each of the four rails independently', () => {
    for (const prefix of ['TP', 'TN', 'BP', 'BN']) {
      const connected = new Set(holesInSameGroup(`${prefix}1`));
      expect(connected.size).toBe(25);
      for (const other of ['TP', 'TN', 'BP', 'BN'].filter((p) => p !== prefix)) {
        expect(`${prefix}->${other}`).toBe(`${prefix}->${other}`);
        expect(holeVisualState(`${other}1`, { connected })).toBe('idle');
      }
    }
  });

  it('derives occupancy from both ends of every wire, qualified by component', () => {
    const wires = [wire('w1', ['uno1', 'D13'], ['bb1', 'A5']), wire('w2', ['bb1', 'J30'], ['led1', 'anode'])];
    const occupied = occupiedHoles(wires, 'bb1');
    expect(occupied).toEqual(new Set(['A5', 'J30']));
    expect(holeVisualState('A5', { occupied })).toBe('occupied');
    expect(holeVisualState('J30', { occupied })).toBe('occupied');
  });

  it('does not let the Uno A1 or D13 mark the matching hole occupied', () => {
    const wires = [wire('w1', ['uno1', 'A1'], ['led1', 'anode']), wire('w2', ['uno1', 'D13'], ['led1', 'cathode'])];
    const occupied = occupiedHoles(wires, 'bb1');
    expect(occupied.size).toBe(0);
    expect(holeVisualState('A1', { occupied })).toBe('idle');
    expect(holeVisualState('D13', { occupied })).toBe('idle');
  });

  it('keeps two boards with the same hole id independent', () => {
    const wires = [wire('w1', ['uno1', 'D13'], ['bb2', 'A1'])];
    expect(holeVisualState('A1', { occupied: occupiedHoles(wires, 'bb1') })).toBe('idle');
    expect(holeVisualState('A1', { occupied: occupiedHoles(wires, 'bb2') })).toBe('occupied');
  });
});

describe('43-47: instancing, structurally', () => {
  it('draws 400 openings from ONE instanced mesh, not 400 meshes', () => {
    const geometry = new THREE.BoxGeometry(HOLE_OPENING_SIZE, HOLE_OPENING_DEPTH, HOLE_OPENING_SIZE);
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, breadboardInstanceCount());

    expect(mesh.count).toBe(400);
    expect(mesh.isInstancedMesh).toBe(true);
    // One object in the scene graph, one geometry, one material — regardless of hole count.
    expect(mesh.children).toHaveLength(0);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);

    mesh.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('writes one local matrix per canonical hole, in canonical order', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 400);
    const matrix = new THREE.Matrix4();
    for (const hole of breadboardHoleInstances()) {
      matrix.makeTranslation(hole.x, 0, hole.z);
      mesh.setMatrixAt(hole.index, matrix);
    }

    const read = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (const hole of breadboardHoleInstances()) {
      mesh.getMatrixAt(hole.index, read);
      position.setFromMatrixPosition(read);
      expect(position.x).toBeCloseTo(hole.x, 6);
      expect(position.z).toBeCloseTo(hole.z, 6);
    }
    mesh.dispose();
    geometry.dispose();
  });

  it('keeps the instance mapping stable across repeated reads', () => {
    const first = breadboardHoleInstances().map((h) => `${h.index}:${h.id}`);
    const second = breadboardHoleInstances().map((h) => `${h.index}:${h.id}`);
    expect(second).toEqual(first);
    expect(instanceIdsOf()).toEqual(instanceIdsOf());
  });

  it('does not let one board mutate another board’s instance data', () => {
    // The shared array is read-only data; per-board state lives in the derived sets, which
    // are built per component id.
    const a = occupiedHoles([wire('w1', ['uno1', 'D13'], ['bb1', 'A1'])], 'bb1');
    const b = occupiedHoles([wire('w1', ['uno1', 'D13'], ['bb1', 'A1'])], 'bb2');
    expect(a.has('A1')).toBe(true);
    expect(b.has('A1')).toBe(false);
    a.add('MUTATED');
    expect(b.has('MUTATED')).toBe(false);
  });

  it('disposes what it owns without touching shared scene resources', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    let disposed = false;
    geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    geometry.dispose();
    expect(disposed).toBe(true);
  });
});

function instanceIdsOf(): string[] {
  return breadboardHoleInstances().map((h) => h.id);
}

describe('16-24: picking goes through the existing command path', () => {
  it('resolves an instance and starts a wire through actions.pickTerminal', () => {
    const ref = resolveInstanceTerminal('bb1', terminalInstanceIndex('C7')!)!;
    actions().pickTerminal(ref);
    expect(circuit().pendingWireFrom).toEqual({ componentId: 'bb1', terminalId: 'C7' });
  });

  it('produces the identical qualified endpoint as the 2D path', async () => {
    const { resolveHoleAt, holeCanvasPosition } = await import('../src/renderer/app/circuit/breadboard-geometry');
    const placement = { x: 300, y: 250, rotation: 0 };
    const twoD = resolveHoleAt(holeCanvasPosition('C7', placement)!, placement);
    const threeD = resolveInstanceTerminal('bb1', terminalInstanceIndex('C7')!);
    expect(threeD).toEqual({ componentId: 'bb1', terminalId: twoD });
  });

  it('does nothing for an invalid or out-of-range instance', () => {
    for (const id of [undefined, null, -1, 400, 1.5, Number.NaN]) {
      const ref = resolveInstanceTerminal('bb1', id as never);
      expect(`${id}:${ref}`).toBe(`${id}:null`);
    }
    expect(circuit().pendingWireFrom).toBeNull();
    expect(circuit().wires).toHaveLength(0);
  });

  it('keeps the same-terminal cancellation gesture working', () => {
    const ref = resolveInstanceTerminal('bb1', terminalInstanceIndex('A5')!)!;
    actions().pickTerminal(ref);
    expect(circuit().pendingWireFrom).not.toBeNull();
    actions().pickTerminal(ref);
    expect(circuit().pendingWireFrom).toBeNull();
    expect(circuit().wires).toHaveLength(0);
  });

  it('keeps the occupied-hole refusal atomic through the shared command', () => {
    seed([UNO, bb()], [wire('w1', ['uno1', 'D13'], ['bb1', 'A5'])]);
    const before = JSON.stringify(circuit());
    actions().pickTerminal(resolveInstanceTerminal('bb1', terminalInstanceIndex('A5')!)!);
    expect(JSON.stringify(circuit())).toBe(before);
    expect(lastWirePickResult().ok).toBe(false);
  });

  it('targets the right board when two share a hole id', () => {
    seed([UNO, bb('bb1'), bb('bb2', 700, 250)]);
    const index = terminalInstanceIndex('A1')!;
    actions().pickTerminal(resolveInstanceTerminal('bb1', index)!);
    actions().pickTerminal(resolveInstanceTerminal('bb2', index)!);
    const [w] = circuit().wires;
    expect(w.from).toEqual({ componentId: 'bb1', terminalId: 'A1' });
    expect(w.to).toEqual({ componentId: 'bb2', terminalId: 'A1' });
  });
});

describe('33-42: the application gate is still complete', () => {
  it('keeps a breadboard project off the production 3D canvas', () => {
    seed([UNO, bb()], [], '3d');
    render(<CircuitPane />);
    // The 2D canvas mounted, not the 3D one.
    expect(screen.getByTestId('breadboard-bb1')).toBeTruthy();
    expect(screen.getByTestId('viewport-3d-disabled-reason').textContent).toBe(BREADBOARD_3D_NOTICE);
  });

  it('disables the 3D tab with an accessible explanation', () => {
    seed([UNO, bb()], [], '2d');
    render(<CircuitPane />);
    const tab = screen.getByRole('tab', { name: /3D Workspace/i });
    expect(tab.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('viewport-3d-disabled-reason').textContent).toMatch(/next milestone/i);
  });

  it('still enters 2D atomically when a breadboard project is loaded from 3D', () => {
    seed([UNO], [], '3d');
    const result = loadProjectIntoStore(project([UNO, bb()]));
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().layout.viewportMode).toBe('2d');
  });

  it('restores 3D once the last breadboard is removed', () => {
    seed([UNO, bb()], [], '2d');
    const { rerender } = render(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeTruthy();
    actions().deleteComponents(['bb1']);
    rerender(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeNull();
  });

  it('leaves non-breadboard projects free to use 3D', () => {
    seed([UNO, LED], [], '2d');
    render(<CircuitPane />);
    expect(screen.queryByTestId('viewport-3d-disabled-reason')).toBeNull();
  });

  it('sends no breadboard endpoint into Phase B routing', async () => {
    const obstacles = await import('../src/renderer/app/circuit/hardware/scene-obstacles');
    expect(obstacles.unoObstacleVolumes().some((v) => v.id.includes('breadboard'))).toBe(false);
    const geometry = await import('../src/renderer/app/circuit/hardware/component-geometry');
    // Defined since C4, but still contributing no obstacle to the Uno's table: a breadboard
    // is composed into the scene from outside, never merged into Phase B's own volumes.
    expect(geometry.componentPhysical('breadboard' as never)).toBeDefined();
  });
});
