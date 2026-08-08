// @vitest-environment jsdom
/**
 * MAJOR-1: an unchanged wire must not rebuild its curve when something unrelated re-renders.
 *
 * `buildWireCurve` samples the rendered path 4096 times per clearance pass, up to eight
 * passes, evaluating every obstacle volume at every sample. NetWire has always wrapped it in
 * a `useMemo` keyed on `[points, clearance]` — but both were built inline in the JSX of
 * `DynamicNetlist3D`, and `sceneWireClearance`, `wirePointsWithPortals` and `[a, ...mids, b]`
 * each return a fresh object. The memo could therefore never hit, and selecting a wire or
 * re-rendering the panel re-ran the whole routing computation for every wire on the bench.
 *
 * The spy wraps the real implementation on the production module `DynamicNetlist3D` actually
 * imports from, so these tests count how often the shipped code runs and compare the routes
 * it really produced. Nothing was added to production for this suite to observe.
 *
 * NO WEBGL HERE, following the pattern the earlier 3D suites established. react-three-fiber
 * intrinsics render as inert custom elements under react-dom, which is enough to execute the
 * real component tree and its hooks — nothing here asserts on pixels.
 *
 * Two sibling nodes cannot mount without a live renderer, so the scene avoids them:
 * `ComponentNode` calls `useThree`, and `BreadboardNode` renders an instanced mesh whose
 * effect calls `setMatrixAt` on a real `THREE.InstancedMesh`. `BreadboardNode` is stubbed to
 * render nothing so a board can still be present in the circuit. That costs the wire path
 * nothing: `breadboardPlacements`, `wirePointsWithPortals`, `wireApproachExemptions` and
 * `sceneWireClearance` are all called by `DynamicNetlist3D` itself, so hole portals, board
 * moves and board rotations are exercised for real. Only the board's own visual node — which
 * is not under test and has its own suite — is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import * as THREE from 'three';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';

// The board's own visual node needs a real InstancedMesh; the routing it feeds does not.
vi.mock('../src/renderer/app/circuit/hardware/BreadboardNode', () => ({
  BreadboardNode: (): null => null,
}));

vi.mock('../src/renderer/app/circuit/hardware/wire-path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/app/circuit/hardware/wire-path')>();
  return { ...actual, buildWireCurve: vi.fn(actual.buildWireCurve) };
});

import { DynamicNetlist3D } from '../src/renderer/app/circuit/DynamicNetlist3D';
import { buildWireCurve } from '../src/renderer/app/circuit/hardware/wire-path';
import { useAppStore } from '../src/renderer/state/store';

const spy = vi.mocked(buildWireCurve);

const UNO = {
  id: 'uno1', kind: 'uno-r3', x: 300, y: 250, rotation: 0, label: 'Uno', properties: {},
} as CircuitComponent;

const board = (x = 620, y = 250): CircuitComponent =>
  ({ id: 'bb1', kind: 'breadboard', x, y, rotation: 0, label: 'Breadboard', properties: {} }) as CircuitComponent;

const wire = (
  id: string,
  from: [string, string],
  to: [string, string],
  waypoints: { x: number; y: number }[] = [],
): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    waypoints,
    colorRole: 'signal-yellow',
  }) as CircuitWire;

function seed(components: CircuitComponent[], wires: CircuitWire[]): void {
  useAppStore.setState((s) => ({
    circuit: {
      ...s.circuit,
      components,
      wires,
      junctions: [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
  }));
}

/** Every curve the production code produced, in call order. */
const curves = (): THREE.CatmullRomCurve3[] =>
  spy.mock.results
    .map((r) => r.value)
    .filter((v): v is THREE.CatmullRomCurve3 => v instanceof THREE.CatmullRomCurve3);

const latest = (): THREE.CatmullRomCurve3 => curves()[curves().length - 1];

/** A curve's endpoints — the terminal positions the wiring layer computed. */
const ends = (c: THREE.CatmullRomCurve3): [THREE.Vector3, THREE.Vector3] => [
  c.points[0].clone(),
  c.points[c.points.length - 1].clone(),
];

/** Densely sampled path, so "same route" means the drawn line, not just its ends. */
const path = (c: THREE.CatmullRomCurve3, n = 64): THREE.Vector3[] =>
  Array.from({ length: n + 1 }, (_, i) => c.getPoint(i / n));

const maxDeviation = (a: THREE.CatmullRomCurve3, b: THREE.CatmullRomCurve3): number => {
  const pa = path(a);
  const pb = path(b);
  return pa.reduce((worst, p, i) => Math.max(worst, p.distanceTo(pb[i])), 0);
};

beforeEach(() => {
  seed([UNO, board()], [wire('w1', ['uno1', 'D13'], ['bb1', 'E15'])]);
  spy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('MAJOR-1 — unchanged wires do not rebuild their curve', () => {
  it('builds exactly one curve per rendered wire on first render', () => {
    seed([UNO, board()], [
      wire('w1', ['uno1', 'D13'], ['bb1', 'E15']),
      wire('w2', ['uno1', 'D12'], ['bb1', 'E20']),
    ]);
    spy.mockClear();
    render(<DynamicNetlist3D />);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('performs zero additional builds when the parent re-renders with unchanged inputs', () => {
    const view = render(<DynamicNetlist3D />);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => { view.rerender(<DynamicNetlist3D />); });
    act(() => { view.rerender(<DynamicNetlist3D />); });
    act(() => { view.rerender(<DynamicNetlist3D />); });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('performs zero additional builds when only the selection changes', () => {
    render(<DynamicNetlist3D />);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => { useAppStore.getState().actions.selectIds(['w1']); });
    expect(useAppStore.getState().circuit.selectedIds).toEqual(['w1']);
    act(() => { useAppStore.getState().actions.selectIds([]); });

    // Selection re-renders NetWire and changes the tube radius and material, but the route
    // is untouched — so the curve must survive.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('performs zero additional builds when the wire is hovered and unhovered', () => {
    const view = render(<DynamicNetlist3D />);
    expect(spy).toHaveBeenCalledTimes(1);

    const mesh = view.container.querySelector('mesh');
    expect(mesh).not.toBeNull();
    // NetWire's own hover state, driven through its real handler.
    act(() => { fireEvent.pointerOver(mesh!); });
    act(() => { fireEvent.pointerOut(mesh!); });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('performs zero additional builds when an unrelated store slice changes', () => {
    render(<DynamicNetlist3D />);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.setState((s) => ({ circuit: { ...s.circuit, placementKind: 'led' } }));
    });
    act(() => {
      useAppStore.setState((s) => ({ circuit: { ...s.circuit, placementKind: null } }));
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps every wire on its own curve', () => {
    seed([UNO, board()], [
      wire('w1', ['uno1', 'D13'], ['bb1', 'E15']),
      wire('w2', ['uno1', 'D12'], ['bb1', 'E20']),
    ]);
    spy.mockClear();
    render(<DynamicNetlist3D />);

    const [first, second] = curves();
    expect(first).not.toBe(second);
    // Different holes, so the far endpoints must genuinely differ.
    expect(ends(first)[1].distanceTo(ends(second)[1])).toBeGreaterThan(0.1);
  });
});

describe('MAJOR-1 — genuine route changes still recompute', () => {
  it('rebuilds when an endpoint changes, and ends at the new terminal', () => {
    render(<DynamicNetlist3D />);
    const before = ends(curves()[0])[1];

    act(() => {
      useAppStore.setState((s) => ({
        circuit: { ...s.circuit, wires: [wire('w1', ['uno1', 'D13'], ['bb1', 'E28'])] },
      }));
    });

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    const after = ends(latest())[1];
    expect(after.distanceTo(before)).toBeGreaterThan(0.1);
  });

  it('rebuilds when a waypoint is added, and the drawn path actually moves', () => {
    render(<DynamicNetlist3D />);
    const original = curves()[0];

    act(() => {
      useAppStore.setState((s) => ({
        circuit: {
          ...s.circuit,
          wires: [wire('w1', ['uno1', 'D13'], ['bb1', 'E15'], [{ x: 460, y: 90 }])],
        },
      }));
    });

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(maxDeviation(latest(), original)).toBeGreaterThan(0.1);
    // The endpoints are still the terminals; only the middle was rerouted.
    expect(ends(latest())[0].distanceTo(ends(original)[0])).toBeLessThan(1e-9);
    expect(ends(latest())[1].distanceTo(ends(original)[1])).toBeLessThan(1e-9);
  });

  it('rebuilds when the board moves, and the route follows it', () => {
    render(<DynamicNetlist3D />);
    const before = ends(curves()[0])[1];

    act(() => { useAppStore.getState().actions.moveComponent('bb1', 760, 380); });

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(ends(latest())[1].distanceTo(before)).toBeGreaterThan(0.5);
  });

  it('rebuilds when the board rotates', () => {
    render(<DynamicNetlist3D />);
    const before = ends(curves()[0])[1];

    act(() => { useAppStore.getState().actions.rotateComponent('bb1', 1); });

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(ends(latest())[1].distanceTo(before)).toBeGreaterThan(0.1);
  });

  it('never shows a stale route: a move then a move back returns the original path', () => {
    render(<DynamicNetlist3D />);
    const original = curves()[0];

    act(() => { useAppStore.getState().actions.moveComponent('bb1', 760, 380); });
    const moved = latest();
    expect(maxDeviation(moved, original)).toBeGreaterThan(0.5);

    act(() => { useAppStore.getState().actions.moveComponent('bb1', 620, 250); });
    // Back where it started: the recomputed route matches the original, so nothing stale was
    // held and nothing was cached against a key that had stopped meaning what it said.
    expect(maxDeviation(latest(), original)).toBeLessThan(1e-9);
  });

  it('adding a second wire leaves the first wire on an identical route', () => {
    render(<DynamicNetlist3D />);
    const original = curves()[0];

    act(() => {
      useAppStore.setState((s) => ({
        circuit: {
          ...s.circuit,
          wires: [...s.circuit.wires, wire('w2', ['uno1', 'D12'], ['bb1', 'E20'])],
        },
      }));
    });

    const w1Again = curves().filter((c) => ends(c)[1].distanceTo(ends(original)[1]) < 1e-9);
    expect(w1Again.length).toBeGreaterThan(1);
    expect(maxDeviation(w1Again[w1Again.length - 1], original)).toBeLessThan(1e-9);
  });
});

describe('MAJOR-1 — the real router ran', () => {
  it('produces a genuine routed curve, not a substitute', () => {
    render(<DynamicNetlist3D />);
    const curve = curves()[0];
    expect(curve).toBeInstanceOf(THREE.CatmullRomCurve3);
    // A real routed path: interior control points, and finite everywhere.
    expect(curve.points.length).toBeGreaterThan(2);
    for (const p of path(curve)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });
});
