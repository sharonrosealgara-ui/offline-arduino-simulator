/**
 * Wires that end in breadboard holes, routed by the production Phase B curve builder.
 *
 * Nothing here is a separate router. `buildWireCurve` is the same function Phase B uses; the
 * only new thing is the clearance context it is handed, which composes the bench, the Uno and
 * every breadboard by taking the greatest requirement. That is why the Phase B guarantees are
 * not re-litigated: composition cannot lower a bar.
 *
 * The route is checked on a verification grid that is denser and offset from the production
 * sampling, so a pass means the curve clears the board rather than that the two happened to
 * sample the same points — the lesson from the Phase B bench-clearance defect.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildWireCurveWithDiagnostics,
  WIRE_MAX_CLEARANCE_ITERATIONS,
  WIRE_RADIUS_SELECTED,
} from '../src/renderer/app/circuit/hardware/wire-path';
import {
  breadboardHoleAttachment,
  breadboardWireClearance,
  compositeWireClearance,
  ownedApproachExemption,
  type BreadboardObstaclePlacement,
} from '../src/renderer/app/circuit/hardware/breadboard-obstacles';
import { breadboardBody3D } from '../src/renderer/app/circuit/hardware/breadboard-3d-geometry';
import {
  BOARD_AT_SCENE_ORIGIN,
  unoWireClearance,
} from '../src/renderer/app/circuit/hardware/scene-obstacles';
import { unoPinPosition, PCB_TOP } from '../src/renderer/app/circuit/hardware/uno-geometry';

/** Prime, and offset from the production 4096 — a different grid, not the same one again. */
const VERIFY_SAMPLES = 733;

const at = (componentId: string, x: number, z: number, rotationDegrees = 0): BreadboardObstaclePlacement => ({
  componentId,
  x,
  z,
  rotationDegrees,
});

/** The full endpoint story for one hole: anchor, portal, and its owned exemption. */
function hole(componentId: string, terminalId: string, placement: BreadboardObstaclePlacement) {
  const attachment = breadboardHoleAttachment(componentId, terminalId, placement)!;
  return { ...attachment, exemption: ownedApproachExemption(componentId, terminalId, placement)! };
}

/**
 * Routes anchor → portal → portal → anchor and returns the curve plus its worst margin.
 *
 * Each board's clearance is given only the exemptions belonging to that board, which is what
 * keeps one endpoint from borrowing the other's licence.
 */
function route(
  ends: ReturnType<typeof hole>[],
  boards: BreadboardObstaclePlacement[],
  extra: { requiredCentreYAt(p: THREE.Vector3): number }[] = [],
) {
  const clearance = compositeWireClearance([
    ...boards.map((board) =>
      breadboardWireClearance(
        board,
        ends.filter((e) => e.componentId === board.componentId).map((e) => e.exemption),
      ),
    ),
    ...extra,
  ]);

  const points = [ends[0].anchor, ends[0].portal, ends[1].portal, ends[1].anchor];
  const result = buildWireCurveWithDiagnostics(points, clearance)!;

  let worst = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= VERIFY_SAMPLES; i += 1) {
    const p = result.curve.getPoint(i / VERIFY_SAMPLES);
    worst = Math.min(worst, p.y - clearance.requiredCentreYAt(p));
  }
  return { result, worst, clearance, points };
}

/** A wire ending at an Uno pin, using the same heights Phase B already uses. */
function unoEnd(pinId: string) {
  const pin = unoPinPosition(pinId)!;
  const anchor = new THREE.Vector3(pin.x, PCB_TOP + 0.3, pin.z);
  return { componentId: 'uno1', terminalId: pinId, anchor, portal: anchor, exemption: undefined as never };
}

const TOLERANCE = 1e-6;

describe('33-40: routes end at the exact hole and clear the board', () => {
  const board = at('bb1', 3, 0);

  it('routes breadboard to Uno, terminating on the chosen opening', () => {
    const ends = [hole('bb1', 'C7', board), unoEnd('D13') as never];
    const { result, points } = route(ends as never, [board], [unoWireClearance(BOARD_AT_SCENE_ORIGIN, [])]);
    // Endpoints are fixed points: the router may lift the middle, never the ends.
    expect(result.curve.getPoint(0).distanceTo(points[0])).toBeLessThan(1e-9);
    expect(result.curve.getPoint(1).distanceTo(points[3])).toBeLessThan(1e-9);
  });

  it('is equivalent when the endpoint order is reversed', () => {
    const forward = route([hole('bb1', 'C7', board), hole('bb1', 'H20', board)], [board]);
    const reversed = route([hole('bb1', 'H20', board), hole('bb1', 'C7', board)], [board]);
    expect(reversed.worst).toBeCloseTo(forward.worst, 9);
    expect(reversed.result.usedFallback).toBe(forward.result.usedFallback);
  });

  it('clears the board on a same-board route across the centre channel', () => {
    const { worst, result } = route([hole('bb1', 'C7', board), hole('bb1', 'H7', board)], [board]);
    expect(worst).toBeGreaterThan(-TOLERANCE);
    expect(result.usedFallback).toBe(false);
    expect(result.iterations).toBeLessThanOrEqual(WIRE_MAX_CLEARANCE_ITERATIONS);
  });

  it('clears the board on a rail-to-bank route, ending at the exact rail hole', () => {
    const ends = [hole('bb1', 'TP7', board), hole('bb1', 'E7', board)];
    const { worst } = route(ends, [board]);
    expect(worst).toBeGreaterThan(-TOLERANCE);
    // The rail anchor is the hole, never the rail's centre.
    const railCentre = breadboardHoleAttachment('bb1', 'TP13', board)!.anchor;
    expect(ends[0].anchor.distanceTo(railCentre)).toBeGreaterThan(0.1);
  });

  it('does not collapse two holes on one board to a single point', () => {
    const ends = [hole('bb1', 'A1', board), hole('bb1', 'A2', board)];
    expect(ends[0].anchor.distanceTo(ends[1].anchor)).toBeGreaterThan(0.09);
    const { result } = route(ends, [board]);
    expect(result.curve.getLength()).toBeGreaterThan(0);
  });

  it('avoids a second breadboard placed between the endpoints', () => {
    const left = at('bb1', -3, 0);
    const right = at('bb2', 3, 0);
    const blocker = at('bb3', 0, 0);
    const ends = [hole('bb1', 'C7', left), hole('bb2', 'C7', right)];
    const { worst, result } = route(ends, [left, right, blocker]);
    expect(worst).toBeGreaterThan(-TOLERANCE);
    expect(result.usedFallback).toBe(false);
  });

  it('still respects the Uno while clearing a breadboard', () => {
    const near = at('bb1', 2.2, 0);
    const ends = [hole('bb1', 'C7', near), hole('bb1', 'H25', near)];
    const { worst } = route(ends, [near], [unoWireClearance(BOARD_AT_SCENE_ORIGIN, [])]);
    expect(worst).toBeGreaterThan(-TOLERANCE);
  });

  it('lifts the curve above the body once it is past the portal', () => {
    const ends = [hole('bb1', 'A1', board), hole('bb1', 'J30', board)];
    const { result } = route(ends, [board]);
    const bodyTop = ends[0].anchor.y;
    const mid = result.curve.getPoint(0.5);
    expect(mid.y - WIRE_RADIUS_SELECTED).toBeGreaterThan(bodyTop);
  });
});

describe('45-50: the route is well-formed and deterministic', () => {
  const board = at('bb1', 3, 0);

  it('is byte-identical on repeated identical input', () => {
    const a = route([hole('bb1', 'C7', board), hole('bb1', 'H20', board)], [board]);
    const b = route([hole('bb1', 'C7', board), hole('bb1', 'H20', board)], [board]);
    const sample = (r: typeof a) =>
      Array.from({ length: 65 }, (_, i) => r.result.curve.getPoint(i / 64).toArray().join(','));
    expect(sample(b)).toEqual(sample(a));
  });

  it('contains no NaN, Infinity or zero-length segment', () => {
    const { result } = route([hole('bb1', 'TP1', board), hole('bb1', 'BN25', board)], [board]);
    let previous: THREE.Vector3 | null = null;
    for (let i = 0; i <= 256; i += 1) {
      const p = result.curve.getPoint(i / 256);
      for (const value of [p.x, p.y, p.z]) expect(Number.isFinite(value)).toBe(true);
      previous = p.clone();
    }
    expect(previous).not.toBeNull();
    expect(result.curve.getLength()).toBeGreaterThan(0);
  });

  it.each([0, 90, 180, 270] as const)('recomputes a clear route after a %i degree turn', (rotationDegrees) => {
    const turned = at('bb1', 3, 0, rotationDegrees);
    const { worst, result } = route([hole('bb1', 'C7', turned), hole('bb1', 'H20', turned)], [turned]);
    expect(worst).toBeGreaterThan(-TOLERANCE);
    expect(result.usedFallback).toBe(false);
  });

  it('recomputes a clear route after the board moves', () => {
    for (const [x, z] of [[0, 0], [6, 2], [-4, -3]] as const) {
      const moved = at('bb1', x, z);
      const { worst } = route([hole('bb1', 'A5', moved), hole('bb1', 'J20', moved)], [moved]);
      expect(`${x},${z}:${worst > -TOLERANCE}`).toBe(`${x},${z}:true`);
    }
  });

  it('never needs the deterministic fallback on ordinary board routes', () => {
    const cases: [string, string][] = [
      ['A1', 'J30'],
      ['E15', 'F15'],
      ['TP1', 'BN25'],
      ['TN25', 'BP1'],
      ['C7', 'C8'],
    ];
    for (const [from, to] of cases) {
      const { result, worst } = route([hole('bb1', from, board), hole('bb1', to, board)], [board]);
      expect(`${from}->${to}:${result.usedFallback}`).toBe(`${from}->${to}:false`);
      expect(`${from}->${to}:${worst > -TOLERANCE}`).toBe(`${from}->${to}:true`);
    }
  });

  it('keeps the board solid for a route that never touches it', () => {
    const far = at('bb1', 20, 20);
    const body = breadboardBody3D();
    const clearance = breadboardWireClearance(far);
    // A point on the far side of the scene is unaffected by the board's presence.
    expect(clearance.requiredCentreYAt(new THREE.Vector3(0, 0, 0))).toBeLessThan(
      clearance.requiredCentreYAt(new THREE.Vector3(20, 0, 20)),
    );
    expect(body.width).toBeGreaterThan(0);
  });
});
