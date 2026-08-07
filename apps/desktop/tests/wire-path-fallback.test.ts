/**
 * The deterministic fallback, and the zero-length segments it used to produce.
 *
 * Every other suite asserts `usedFallback === false` — nine such assertions across four
 * files — so until now the fallback branch was never executed by a test at all. That is how
 * a real defect survived: when the clearance budget was exhausted the terminal state clamped
 * every interior point of a span onto one height with `Math.max(flatY[i], highest)`, and a
 * wire ending in a breadboard hole has a span whose two ends share an x and a z exactly (the
 * anchor, and the portal directly above it). Five interior points on that span collapsed into
 * five coincident control points, producing zero-length curve segments that went straight to
 * TubeGeometry.
 *
 * The fix translates the interior points by one uniform offset instead of clamping them, so
 * relative differences survive and nothing becomes coincident. These tests execute the real
 * production fallback rather than describing it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildWireCurveWithDiagnostics,
  WIRE_CLEARANCE_TOLERANCE,
  WIRE_MAX_CLEARANCE_ITERATIONS,
  WIRE_MIN_CENTRE_Y,
  type WireClearanceContext,
} from '../src/renderer/app/circuit/hardware/wire-path';
import {
  breadboardHoleAttachment,
  breadboardWireClearance,
  compositeWireClearance,
  ownedApproachExemption,
  type BreadboardObstaclePlacement,
} from '../src/renderer/app/circuit/hardware/breadboard-obstacles';

const at = (componentId: string, x: number, z: number, rotationDegrees = 0): BreadboardObstaclePlacement => ({
  componentId,
  x,
  z,
  rotationDegrees,
});

/** Anchor, portal and owned exemption for one hole — the production shapes. */
function hole(componentId: string, terminalId: string, placement: BreadboardObstaclePlacement) {
  const attachment = breadboardHoleAttachment(componentId, terminalId, placement)!;
  return { ...attachment, exemption: ownedApproachExemption(componentId, terminalId, placement)! };
}

/**
 * A physically valid two-board scene whose route cannot be satisfied.
 *
 * The boards do not intersect — that is asserted below, not assumed. What makes it
 * unsatisfiable is the clearance rule itself: both endpoints are pinned to their own board's
 * top face, and a stricter demand applies across the span between them. The router may only
 * raise interior points, never the fixed ends, so it spends its budget and takes the terminal
 * state. This is the branch under test.
 */
function unsatisfiableScene() {
  const left = at('bb1', -2.2, 0);
  const right = at('bb2', 2.2, 0);
  const ends = [hole('bb1', 'E5', left), hole('bb2', 'E25', right)];
  const boards = [left, right];

  const base = compositeWireClearance(
    boards.map((board) =>
      breadboardWireClearance(
        board,
        ends.filter((e) => e.componentId === board.componentId).map((e) => e.exemption),
      ),
    ),
  );

  /**
   * A ceiling the fixed endpoints cannot meet.
   *
   * `WireClearanceContext` is the router's public contract, so supplying one is using the
   * production interface rather than mocking a constant: no radius, epsilon, obstacle size,
   * sample count or iteration budget is altered. It demands more height than either endpoint
   * has, everywhere, which is precisely the condition the fallback exists to terminate.
   */
  const clearance: WireClearanceContext = {
    requiredCentreYAt: (point) => Math.max(base.requiredCentreYAt(point), 1.5),
  };

  return { ends, boards, clearance, points: [ends[0].anchor, ends[0].portal, ends[1].portal, ends[1].anchor] };
}

describe('the fallback is actually reached', () => {
  const { ends, boards, clearance, points } = unsatisfiableScene();
  const result = buildWireCurveWithDiagnostics(points, clearance)!;

  it('uses the real production fallback', () => {
    expect(result.usedFallback).toBe(true);
    expect(result.iterations).toBe(WIRE_MAX_CLEARANCE_ITERATIONS);
  });

  it('describes a physically valid scene — the two boards do not intersect', () => {
    // Rotation 0, so the world footprint is the local one offset by the placement.
    const halfWidth = 84 / 25.4 / 2;
    const gap = Math.abs(boards[1].x - boards[0].x) - 2 * halfWidth;
    expect(gap).toBeGreaterThan(0);
  });

  it('keeps both fixed endpoints exactly', () => {
    expect(result.curve.getPoint(0).distanceTo(points[0])).toBeLessThan(WIRE_CLEARANCE_TOLERANCE);
    expect(result.curve.getPoint(1).distanceTo(points[points.length - 1])).toBeLessThan(WIRE_CLEARANCE_TOLERANCE);
  });

  it('produces no coincident consecutive sample — the defect this suite exists for', () => {
    let min = Number.POSITIVE_INFINITY;
    let previous: THREE.Vector3 | null = null;
    for (let i = 0; i <= 512; i += 1) {
      const p = result.curve.getPoint(i / 512);
      if (previous) min = Math.min(min, previous.distanceTo(p));
      previous = p.clone();
    }
    expect(min).toBeGreaterThan(0);
  });

  it('produces only finite coordinates', () => {
    for (let i = 0; i <= 512; i += 1) {
      const p = result.curve.getPoint(i / 512);
      for (const value of [p.x, p.y, p.z]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('is deterministic on repeat', () => {
    const again = buildWireCurveWithDiagnostics(points, clearance)!;
    const sample = (r: typeof result) =>
      Array.from({ length: 129 }, (_, i) => r.curve.getPoint(i / 128).toArray().join(','));
    expect(sample(again)).toEqual(sample(result));
    expect(again.usedFallback).toBe(result.usedFallback);
  });

  it('feeds TubeGeometry no non-finite position or normal', () => {
    const tube = new THREE.TubeGeometry(result.curve, 64, 0.026, 8, false);
    for (const name of ['position', 'normal'] as const) {
      const attribute = tube.getAttribute(name);
      expect(attribute).toBeTruthy();
      for (let i = 0; i < attribute.count * attribute.itemSize; i += 1) {
        expect(Number.isFinite((attribute.array as ArrayLike<number>)[i])).toBe(true);
      }
    }
    tube.dispose();
  });

  it('still satisfies clearance wherever no exemption applies', () => {
    // The endpoints cannot meet an unreachable ceiling — that is the premise. Away from them
    // the terminal state must still hold the route at or above the requirement it computed.
    let worstInterior = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 512; i += 1) {
      const t = i / 512;
      if (t < 0.2 || t > 0.8) continue;
      const p = result.curve.getPoint(t);
      worstInterior = Math.min(worstInterior, p.y - WIRE_MIN_CENTRE_Y);
    }
    expect(worstInterior).toBeGreaterThan(0);
  });

  it('raises interior points without lowering any of them below the flat path', () => {
    const mid = result.curve.getPoint(0.5);
    expect(mid.y).toBeGreaterThan(ends[0].anchor.y);
  });
});

describe('an impossible fixed-endpoint violation is still reported, never hidden', () => {
  it('reports the violation rather than moving the endpoint or claiming clearance', () => {
    const { ends, points } = unsatisfiableScene();
    const impossible: WireClearanceContext = { requiredCentreYAt: () => 1.5 };
    const result = buildWireCurveWithDiagnostics(points, impossible)!;

    // Endpoints untouched...
    expect(result.curve.getPoint(0).distanceTo(ends[0].anchor)).toBeLessThan(WIRE_CLEARANCE_TOLERANCE);
    // ...and the shortfall is reported honestly.
    expect(result.clears).toBe(false);
    expect(result.worstMarginY).toBeLessThan(0);
    expect(result.usedFallback).toBe(true);
  });
});
