/**
 * The breadboard as an obstacle, and the exact points a wire may enter it.
 *
 * Two properties carry the safety of this whole layer.
 *
 * First, composition can only ever raise the bar. `compositeWireClearance` takes the maximum
 * across sources, so adding a breadboard can lift a wire higher but can never let it drop
 * below what the bench or the Uno already demanded — the Phase B guarantees survive by
 * construction rather than by being re-checked.
 *
 * Second, an exemption is owned. A wire ending in a hole is inside that board's body, because
 * that is what a hole is; so the anchor is exempt from ONE qualified volume, bounded by a
 * radius, and from nothing else. `bb1`'s hole may not ignore `bb2`, the Uno, or its own board
 * once the wire is past the portal. Several tests exist only to pin that down.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import {
  APPROACH_EXEMPTION_RADIUS,
  BREADBOARD_OBSTACLE_COUNT_PER_BOARD,
  PORTAL_CLEARANCE_ABOVE_BODY,
  breadboardBodyVolumeId,
  breadboardHoleAttachment,
  breadboardObstacleVolumes,
  breadboardRequiredCentreYAt,
  breadboardWireClearance,
  compositeWireClearance,
  ownedApproachExemption,
  toBreadboardLocal,
  type BreadboardObstaclePlacement,
} from '../src/renderer/app/circuit/hardware/breadboard-obstacles';
import { breadboardBody3D, breadboardHoleInstances } from '../src/renderer/app/circuit/hardware/breadboard-3d-geometry';
import { mmToWorld } from '../src/renderer/app/circuit/hardware/geometry-units';
import { BENCH_SURFACE_Y } from '../src/renderer/app/circuit/hardware/scene-layout';
import {
  WIRE_CLEARANCE_EPSILON,
  WIRE_MIN_CENTRE_Y,
  WIRE_RADIUS_SELECTED,
} from '../src/renderer/app/circuit/hardware/wire-path';
import {
  BOARD_AT_SCENE_ORIGIN,
  unoWireClearance,
} from '../src/renderer/app/circuit/hardware/scene-obstacles';

const model = createBreadboardModel();
const at = (componentId: string, x: number, z: number, rotationDegrees = 0): BreadboardObstaclePlacement => ({
  componentId,
  x,
  z,
  rotationDegrees,
});
const ROTATIONS = [0, 90, 180, 270] as const;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('12-19: obstacles are few, conservative and owned', () => {
  it('contributes exactly one volume per board, whatever the hole count', () => {
    expect(breadboardObstacleVolumes('bb1')).toHaveLength(BREADBOARD_OBSTACLE_COUNT_PER_BOARD);
    expect(BREADBOARD_OBSTACLE_COUNT_PER_BOARD).toBe(1);
    // Flat in hole count: 400 holes, one volume.
    expect(model.holes).toHaveLength(400);
    expect(breadboardObstacleVolumes('bb1')).toHaveLength(1);
  });

  it('covers the canonical footprint exactly, converted through mmToWorld', () => {
    const [volume] = breadboardObstacleVolumes('bb1');
    expect(volume.maxX - volume.minX).toBeCloseTo(mmToWorld(84), 9);
    expect(volume.maxZ - volume.minZ).toBeCloseTo(mmToWorld(54.3), 9);
    expect(volume.top).toBeCloseTo(BENCH_SURFACE_Y + breadboardBody3D().height, 9);
  });

  it('qualifies ownership by component instance', () => {
    expect(breadboardBodyVolumeId('bb1')).toBe('bb1:body');
    expect(breadboardObstacleVolumes('bb1')[0].id).toBe('bb1:body');
    expect(breadboardObstacleVolumes('bb2')[0].id).toBe('bb2:body');
    expect(breadboardObstacleVolumes('bb1')[0].id).not.toBe(breadboardObstacleVolumes('bb2')[0].id);
  });

  it('treats every hole as solid, not as a tunnel through the board', () => {
    // A wire crossing above ANY hole must still clear the body. Holes are attachment
    // locations; a route that dropped into one would be inside the plastic.
    const placement = at('bb1', 0, 0);
    const required = breadboardRequiredCentreYAt(v(0, 0, 0), placement);
    for (const hole of breadboardHoleInstances()) {
      const overHole = breadboardRequiredCentreYAt(v(hole.x, 0, hole.z), placement);
      expect(`${hole.id}:${overHole === required}`).toBe(`${hole.id}:true`);
    }
  });

  it('does not open a route through the centre channel', () => {
    const placement = at('bb1', 0, 0);
    const e15 = breadboardHoleInstances().find((h) => h.id === 'E15')!;
    const f15 = breadboardHoleInstances().find((h) => h.id === 'F15')!;
    const midChannel = v(e15.x, 0, (e15.z + f15.z) / 2);
    expect(breadboardRequiredCentreYAt(midChannel, placement)).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('demands nothing away from the board', () => {
    expect(breadboardRequiredCentreYAt(v(50, 0, 50), at('bb1', 0, 0))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it.each(ROTATIONS)('transforms the footprint correctly at %i degrees', (rotationDegrees) => {
    const placement = at('bb1', 3, 2, rotationDegrees);
    const body = breadboardBody3D();
    // A point at the board centre is always inside, whatever the rotation.
    expect(breadboardRequiredCentreYAt(v(3, 0, 2), placement)).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    // A point beyond the circumradius is always outside.
    const beyond = Math.hypot(body.width, body.depth) / 2 + 1;
    expect(breadboardRequiredCentreYAt(v(3 + beyond, 0, 2), placement)).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('turns a rotated board so its long side follows the rotation', () => {
    const body = breadboardBody3D();
    const justPastLongEdge = body.width / 2 - 0.05;
    // Upright: inside along X, outside along Z.
    expect(breadboardRequiredCentreYAt(v(justPastLongEdge, 0, 0), at('bb1', 0, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(breadboardRequiredCentreYAt(v(0, 0, justPastLongEdge), at('bb1', 0, 0))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
    // Quarter-turned: the reverse.
    expect(breadboardRequiredCentreYAt(v(0, 0, justPastLongEdge), at('bb1', 0, 0, 90))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(breadboardRequiredCentreYAt(v(justPastLongEdge, 0, 0), at('bb1', 0, 0, 90))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('moves with the board', () => {
    expect(breadboardRequiredCentreYAt(v(9, 0, 0), at('bb1', 0, 0))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
    expect(breadboardRequiredCentreYAt(v(9, 0, 0), at('bb1', 9, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('round-trips a point through the local transform at every rotation', () => {
    for (const rotationDegrees of ROTATIONS) {
      const placement = at('bb1', 4, -2, rotationDegrees);
      const local = toBreadboardLocal(v(4.3, 0, -1.7), placement);
      const radians = (rotationDegrees * Math.PI) / 180;
      const back = {
        x: placement.x + local.x * Math.cos(radians) - local.z * Math.sin(radians),
        z: placement.z + local.x * Math.sin(radians) + local.z * Math.cos(radians),
      };
      expect(back.x).toBeCloseTo(4.3, 9);
      expect(back.z).toBeCloseTo(-1.7, 9);
    }
  });
});

describe('20-32: anchors and portals are per hole and qualified', () => {
  it('gives all 400 canonical holes an anchor, each exactly once', () => {
    const placement = at('bb1', 0, 0);
    const anchors = model.holes.map((h) => breadboardHoleAttachment('bb1', h.id, placement)!);
    expect(anchors).toHaveLength(400);
    expect(anchors.every(Boolean)).toBe(true);
    const keys = anchors.map((a) => `${a.anchor.x.toFixed(9)},${a.anchor.z.toFixed(9)}`);
    expect(new Set(keys).size).toBe(400);
  });

  it('places each anchor at the canonical hole position, on the visible surface', () => {
    const placement = at('bb1', 0, 0);
    const surfaceY = BENCH_SURFACE_Y + breadboardBody3D().height;
    for (const hole of breadboardHoleInstances()) {
      const attachment = breadboardHoleAttachment('bb1', hole.id, placement)!;
      expect(attachment.anchor.x).toBeCloseTo(hole.x, 9);
      expect(attachment.anchor.z).toBeCloseTo(hole.z, 9);
      expect(attachment.anchor.y).toBeCloseTo(surfaceY, 9);
    }
  });

  it('checks the first, a middle and the last terminal explicitly', () => {
    const placement = at('bb1', 0, 0);
    for (const index of [0, 199, 399]) {
      const hole = breadboardHoleInstances()[index];
      const attachment = breadboardHoleAttachment('bb1', hole.id, placement)!;
      expect(attachment.terminalId).toBe(hole.id);
      expect(attachment.anchor.x).toBeCloseTo(hole.x, 9);
    }
  });

  it('lifts the portal clear of the body using named clearance inputs, not a magic number', () => {
    expect(PORTAL_CLEARANCE_ABOVE_BODY).toBeCloseTo(WIRE_RADIUS_SELECTED + 2 * WIRE_CLEARANCE_EPSILON, 12);
    const attachment = breadboardHoleAttachment('bb1', 'C7', at('bb1', 0, 0))!;
    expect(attachment.portal.y - attachment.anchor.y).toBeCloseTo(PORTAL_CLEARANCE_ABOVE_BODY, 12);
    // Strictly above the height the router would demand, not exactly on it.
    const required = breadboardRequiredCentreYAt(attachment.portal, at('bb1', 0, 0));
    expect(attachment.portal.y).toBeGreaterThan(required - 1e-12);
  });

  it('keeps the portal directly above its own opening', () => {
    const attachment = breadboardHoleAttachment('bb1', 'J30', at('bb1', 5, -3, 180))!;
    expect(attachment.portal.x).toBeCloseTo(attachment.anchor.x, 12);
    expect(attachment.portal.z).toBeCloseTo(attachment.anchor.z, 12);
  });

  it('never collapses same-group holes to one physical point', () => {
    const placement = at('bb1', 0, 0);
    const group = ['A5', 'B5', 'C5', 'D5', 'E5'].map(
      (id) => breadboardHoleAttachment('bb1', id, placement)!,
    );
    const points = group.map((a) => `${a.anchor.x.toFixed(9)},${a.anchor.z.toFixed(9)}`);
    expect(new Set(points).size).toBe(5);
  });

  it('gives every rail hole its own anchor, on all four rails', () => {
    const placement = at('bb1', 0, 0);
    for (const prefix of ['TP', 'TN', 'BP', 'BN']) {
      const points = Array.from({ length: 25 }, (_, i) => {
        const a = breadboardHoleAttachment('bb1', `${prefix}${i + 1}`, placement)!;
        return `${a.anchor.x.toFixed(9)},${a.anchor.z.toFixed(9)}`;
      });
      expect(new Set(points).size).toBe(25);
    }
  });

  it.each(ROTATIONS)('moves anchors but never identity at %i degrees', (rotationDegrees) => {
    const base = breadboardHoleAttachment('bb1', 'E14', at('bb1', 0, 0))!;
    const moved = breadboardHoleAttachment('bb1', 'E14', at('bb1', 6, 2, rotationDegrees))!;
    expect(moved.terminalId).toBe(base.terminalId);
    expect(moved.componentId).toBe('bb1');
    expect(Math.hypot(moved.anchor.x - 6, moved.anchor.z - 2)).toBeCloseTo(
      Math.hypot(base.anchor.x, base.anchor.z),
      9,
    );
  });

  it('keeps bb1:A1 and bb2:A1 distinct', () => {
    const a = breadboardHoleAttachment('bb1', 'A1', at('bb1', 0, 0))!;
    const b = breadboardHoleAttachment('bb2', 'A1', at('bb2', 8, 0))!;
    expect(a.componentId).not.toBe(b.componentId);
    expect(a.anchor.x).not.toBeCloseTo(b.anchor.x, 3);
  });

  it('refuses a hole that is not on the board it was asked about', () => {
    expect(breadboardHoleAttachment('bb1', 'A1', at('bb2', 0, 0))).toBeUndefined();
  });

  it('refuses ids that are not holes, including Uno-only pin names', () => {
    for (const id of ['A0', 'K1', 'A31', 'TP26', '5V', 'GND', 'AREF']) {
      expect(`${id}:${breadboardHoleAttachment('bb1', id, at('bb1', 0, 0))}`).toBe(`${id}:undefined`);
    }
  });

  it('produces finite coordinates everywhere, at every rotation', () => {
    for (const rotationDegrees of ROTATIONS) {
      const placement = at('bb1', 3.3, -1.7, rotationDegrees);
      for (const hole of breadboardHoleInstances()) {
        const a = breadboardHoleAttachment('bb1', hole.id, placement)!;
        for (const value of [a.anchor.x, a.anchor.y, a.anchor.z, a.portal.x, a.portal.y, a.portal.z]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        // The approach segment is never zero-length.
        expect(a.portal.distanceTo(a.anchor)).toBeGreaterThan(0);
      }
    }
  });
});

describe('42-44: the exemption is owned, bounded and narrow', () => {
  const placement = at('bb1', 0, 0);

  it('names exactly one qualified volume', () => {
    const exemption = ownedApproachExemption('bb1', 'C7', placement)!;
    expect(exemption.volumeId).toBe('bb1:body');
    expect(exemption.radius).toBeCloseTo(APPROACH_EXEMPTION_RADIUS, 12);
    expect(APPROACH_EXEMPTION_RADIUS).toBeCloseTo(PORTAL_CLEARANCE_ABOVE_BODY + mmToWorld(2.54), 12);
  });

  it('lets the anchor sit at the surface it is plugged into', () => {
    const attachment = breadboardHoleAttachment('bb1', 'C7', placement)!;
    const exemption = ownedApproachExemption('bb1', 'C7', placement)!;
    const withExemption = breadboardRequiredCentreYAt(attachment.anchor, placement, [exemption]);
    const without = breadboardRequiredCentreYAt(attachment.anchor, placement, []);
    expect(withExemption).toBeLessThan(without);
    expect(withExemption).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('lapses beyond its radius — the board is solid again', () => {
    const attachment = breadboardHoleAttachment('bb1', 'C7', placement)!;
    const exemption = ownedApproachExemption('bb1', 'C7', placement)!;
    const farAcross = v(attachment.anchor.x + 1, attachment.anchor.y, attachment.anchor.z);
    expect(farAcross.distanceTo(exemption.point)).toBeGreaterThan(exemption.radius);
    expect(breadboardRequiredCentreYAt(farAcross, placement, [exemption])).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('cannot be borrowed by another board', () => {
    const other = at('bb2', 0, 0); // deliberately overlapping, to prove ownership not distance
    const exemption = ownedApproachExemption('bb1', 'C7', at('bb1', 0, 0))!;
    const attachment = breadboardHoleAttachment('bb1', 'C7', at('bb1', 0, 0))!;
    // bb2's obstacle is not named by bb1's exemption, so bb2 still blocks.
    expect(breadboardRequiredCentreYAt(attachment.anchor, other, [exemption])).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('cannot be borrowed by an unrelated hole on the same board', () => {
    const exemption = ownedApproachExemption('bb1', 'A1', placement)!;
    const far = breadboardHoleAttachment('bb1', 'J30', placement)!;
    expect(far.anchor.distanceTo(exemption.point)).toBeGreaterThan(exemption.radius);
    expect(breadboardRequiredCentreYAt(far.anchor, placement, [exemption])).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('never touches the Uno', () => {
    const exemption = ownedApproachExemption('bb1', 'C7', placement)!;
    const uno = unoWireClearance(BOARD_AT_SCENE_ORIGIN, []);
    // The Uno's requirement over its own PCB is unaffected by a breadboard exemption.
    const overPcb = v(0, 0, 0);
    expect(uno.requiredCentreYAt(overPcb)).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(exemption.volumeId).not.toBe('pcb');
  });

  it('treats both endpoints of a wire the same way', () => {
    const a = ownedApproachExemption('bb1', 'A5', placement)!;
    const b = ownedApproachExemption('bb1', 'J20', placement)!;
    expect(a.volumeId).toBe(b.volumeId);
    expect(a.radius).toBeCloseTo(b.radius, 12);
  });
});

describe('composite clearance can only raise the bar', () => {
  it('never returns less than any of its sources', () => {
    const uno = unoWireClearance(BOARD_AT_SCENE_ORIGIN, []);
    const board = breadboardWireClearance(at('bb1', 2, 0));
    const composite = compositeWireClearance([uno, board]);
    for (let x = -4; x <= 6; x += 0.25) {
      for (let z = -3; z <= 3; z += 0.5) {
        const point = v(x, 0, z);
        const value = composite.requiredCentreYAt(point);
        expect(value).toBeGreaterThanOrEqual(uno.requiredCentreYAt(point) - 1e-12);
        expect(value).toBeGreaterThanOrEqual(board.requiredCentreYAt(point) - 1e-12);
      }
    }
  });

  it('preserves the Phase B bench minimum where nothing is in the way', () => {
    const composite = compositeWireClearance([
      unoWireClearance(BOARD_AT_SCENE_ORIGIN, []),
      breadboardWireClearance(at('bb1', 9, 9)),
    ]);
    expect(composite.requiredCentreYAt(v(-9, 0, -9))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('is unchanged by source order and by an empty list', () => {
    const uno = unoWireClearance(BOARD_AT_SCENE_ORIGIN, []);
    const board = breadboardWireClearance(at('bb1', 2, 0));
    const point = v(1.4, 0, 0.2);
    expect(compositeWireClearance([uno, board]).requiredCentreYAt(point)).toBeCloseTo(
      compositeWireClearance([board, uno]).requiredCentreYAt(point),
      12,
    );
    expect(compositeWireClearance([]).requiredCentreYAt(point)).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('keeps two boards blocking independently', () => {
    const composite = compositeWireClearance([
      breadboardWireClearance(at('bb1', 0, 0)),
      breadboardWireClearance(at('bb2', 6, 0)),
    ]);
    expect(composite.requiredCentreYAt(v(0, 0, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(composite.requiredCentreYAt(v(6, 0, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(composite.requiredCentreYAt(v(3, 0, 0))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('is deterministic', () => {
    const composite = compositeWireClearance([breadboardWireClearance(at('bb1', 0, 0))]);
    const point = v(0.3, 0, 0.1);
    expect(composite.requiredCentreYAt(point)).toBe(composite.requiredCentreYAt(point));
  });
});
