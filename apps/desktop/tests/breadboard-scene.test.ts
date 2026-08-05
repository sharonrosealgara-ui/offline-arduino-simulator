/**
 * What the 3D scene derives about breadboards, and the guarantee that suppressing 400 anchor
 * objects suppressed only *rendering*.
 *
 * `DynamicNetlist3D` no longer emits a `TerminalAnchor` for a breadboard's holes — 400 of them
 * would defeat the point of instancing. That is a drawing decision, and it must stay one: the
 * identities, the routing lookup, the portals and the occupancy path all have to keep working
 * exactly as if the anchors were there. Most of this file exists to prove that separation,
 * because it is the kind of optimisation that quietly takes functionality with it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import {
  breadboardPlacements,
  breadboardTerminalPositions,
  placementFor,
  sceneWireClearance,
  wireApproachExemptions,
  wirePointsWithPortals,
} from '../src/renderer/app/circuit/hardware/breadboard-scene';
import { breadboardHoleInstances } from '../src/renderer/app/circuit/hardware/breadboard-3d-geometry';
import { breadboardHoleAttachment } from '../src/renderer/app/circuit/hardware/breadboard-obstacles';
import {
  BOARD_AT_SCENE_ORIGIN,
  unoWireClearance,
} from '../src/renderer/app/circuit/hardware/scene-obstacles';
import { WIRE_MIN_CENTRE_Y } from '../src/renderer/app/circuit/hardware/wire-path';
import { SCHEMATIC_UNIT_INCHES } from '../src/renderer/app/circuit/hardware/geometry-units';

const ORIGIN = { x: 300, y: 250 };
const bb = (id: string, x: number, y: number, rotation = 0): CircuitComponent =>
  ({ id, kind: 'breadboard', x, y, rotation, label: 'Breadboard', properties: {} }) as CircuitComponent;
const uno = { id: 'uno1', kind: 'uno-r3', x: 300, y: 250, rotation: 0, label: 'Uno', properties: {} } as CircuitComponent;
const led = { id: 'led1', kind: 'led', x: 500, y: 400, rotation: 0, label: 'LED', properties: {} } as CircuitComponent;

const wire = (from: [string, string], to: [string, string]): Pick<CircuitWire, 'from' | 'to'> => ({
  from: { componentId: from[0], terminalId: from[1] },
  to: { componentId: to[0], terminalId: to[1] },
});

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('placements come from the components, in scene units', () => {
  it('selects only breadboards, and converts through the shared scale', () => {
    const placements = breadboardPlacements([uno, bb('bb1', 400, 250), led], ORIGIN);
    expect(placements).toHaveLength(1);
    expect(placements[0].componentId).toBe('bb1');
    expect(placements[0].x).toBeCloseTo((400 - 300) * SCHEMATIC_UNIT_INCHES, 12);
    expect(placements[0].z).toBeCloseTo(0, 12);
  });

  it('carries the rotation of each board', () => {
    const placements = breadboardPlacements([bb('bb1', 300, 250, 90), bb('bb2', 500, 250, 270)], ORIGIN);
    expect(placements.map((p) => p.rotationDegrees)).toEqual([90, 270]);
  });

  it('returns nothing for a circuit with no breadboard', () => {
    expect(breadboardPlacements([uno, led], ORIGIN)).toEqual([]);
  });

  it('resolves a terminal to its own board and to no other', () => {
    const placements = breadboardPlacements([bb('bb1', 300, 250), bb('bb2', 600, 250)], ORIGIN);
    expect(placementFor({ componentId: 'bb2', terminalId: 'A1' }, placements)?.componentId).toBe('bb2');
    expect(placementFor({ componentId: 'uno1', terminalId: 'A1' }, placements)).toBeUndefined();
  });
});

describe('all 400 identities survive the anchor suppression', () => {
  const placements = breadboardPlacements([bb('bb1', 300, 250)], ORIGIN);
  const positions = breadboardTerminalPositions(placements);

  it('offers a routing position for every canonical hole', () => {
    expect(positions.size).toBe(400);
    for (const hole of breadboardHoleInstances()) {
      expect(positions.has(`bb1:${hole.id}`)).toBe(true);
    }
  });

  it('keys them exactly as the netlist keys terminals', () => {
    // `componentId:terminalId` — the same string the compiler and the 2D canvas use.
    expect(positions.has('bb1:A1')).toBe(true);
    expect(positions.has('A1')).toBe(false);
    expect(positions.has('uno1:A1')).toBe(false);
  });

  it('agrees with the production anchor for every hole', () => {
    for (const hole of breadboardHoleInstances()) {
      const expected = breadboardHoleAttachment('bb1', hole.id, placements[0])!.anchor;
      expect(positions.get(`bb1:${hole.id}`)!.distanceTo(expected)).toBeLessThan(1e-12);
    }
  });

  it('keeps two boards independent, 800 entries with no collisions', () => {
    const two = breadboardPlacements([bb('bb1', 200, 250), bb('bb2', 600, 250)], ORIGIN);
    const map = breadboardTerminalPositions(two);
    expect(map.size).toBe(800);
    expect(map.get('bb1:A1')!.distanceTo(map.get('bb2:A1')!)).toBeGreaterThan(1);
  });

  it('moves positions but never keys when a board moves or turns', () => {
    const moved = breadboardTerminalPositions(breadboardPlacements([bb('bb1', 700, 90, 270)], ORIGIN));
    expect([...moved.keys()].sort()).toEqual([...positions.keys()].sort());
    expect(moved.get('bb1:E14')!.distanceTo(positions.get('bb1:E14')!)).toBeGreaterThan(0.5);
  });
});

describe('wire points carry an anchor and a portal at each breadboard end', () => {
  const placements = breadboardPlacements([bb('bb1', 300, 250)], ORIGIN);
  const anchorOf = (id: string) => breadboardHoleAttachment('bb1', id, placements[0])!;

  it('produces anchor, portal, portal, anchor for a hole-to-hole wire', () => {
    const a = anchorOf('A5');
    const b = anchorOf('J20');
    const points = wirePointsWithPortals(wire(['bb1', 'A5'], ['bb1', 'J20']), { from: a.anchor, to: b.anchor }, [], placements);

    expect(points).toHaveLength(4);
    expect(points[0].distanceTo(a.anchor)).toBeLessThan(1e-12);
    expect(points[1].distanceTo(a.portal)).toBeLessThan(1e-12);
    expect(points[2].distanceTo(b.portal)).toBeLessThan(1e-12);
    expect(points[3].distanceTo(b.anchor)).toBeLessThan(1e-12);
  });

  it('leaves a non-breadboard end as a bare anchor', () => {
    const a = anchorOf('A5');
    const unoEnd = v(0, 0.33, 0);
    const points = wirePointsWithPortals(wire(['bb1', 'A5'], ['uno1', 'D13']), { from: a.anchor, to: unoEnd }, [], placements);
    expect(points).toHaveLength(3); // anchor, portal, uno anchor
    expect(points[2].distanceTo(unoEnd)).toBeLessThan(1e-12);
  });

  it('keeps interior waypoints between the two portals', () => {
    const mid = v(1, 0.5, 1);
    const points = wirePointsWithPortals(
      wire(['bb1', 'A5'], ['bb1', 'J20']),
      { from: anchorOf('A5').anchor, to: anchorOf('J20').anchor },
      [mid],
      placements,
    );
    expect(points).toHaveLength(5);
    expect(points[2].distanceTo(mid)).toBeLessThan(1e-12);
  });

  it('starts and ends on the exact chosen openings, whichever way round', () => {
    const forward = wirePointsWithPortals(wire(['bb1', 'A5'], ['bb1', 'J20']), { from: anchorOf('A5').anchor, to: anchorOf('J20').anchor }, [], placements);
    const reversed = wirePointsWithPortals(wire(['bb1', 'J20'], ['bb1', 'A5']), { from: anchorOf('J20').anchor, to: anchorOf('A5').anchor }, [], placements);
    expect(forward[0].distanceTo(reversed[3])).toBeLessThan(1e-12);
    expect(forward[3].distanceTo(reversed[0])).toBeLessThan(1e-12);
  });

  it('passes an unknown terminal through untouched rather than guessing', () => {
    const fallback = v(9, 9, 9);
    const points = wirePointsWithPortals(wire(['bb1', 'K1'], ['uno1', 'D13']), { from: fallback, to: v(0, 0, 0) }, [], placements);
    expect(points[0].distanceTo(fallback)).toBeLessThan(1e-12);
  });
});

describe('exemptions are earned per end, and only by real holes', () => {
  const placements = breadboardPlacements([bb('bb1', 300, 250), bb('bb2', 600, 250)], ORIGIN);

  it('grants one per breadboard end, naming the volume that board owns', () => {
    const exemptions = wireApproachExemptions(wire(['bb1', 'A5'], ['bb2', 'J20']), placements);
    expect(exemptions.map((e) => e.volumeId).sort()).toEqual(['bb1:body', 'bb2:body']);
  });

  it('grants none to an Uno end', () => {
    const exemptions = wireApproachExemptions(wire(['uno1', 'D13'], ['bb1', 'A5']), placements);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0].volumeId).toBe('bb1:body');
  });

  it('grants none for a hole that does not exist', () => {
    expect(wireApproachExemptions(wire(['bb1', 'K1'], ['uno1', 'D13']), placements)).toEqual([]);
  });

  it('is unchanged by endpoint order', () => {
    const forward = wireApproachExemptions(wire(['bb1', 'A5'], ['bb2', 'J20']), placements);
    const reversed = wireApproachExemptions(wire(['bb2', 'J20'], ['bb1', 'A5']), placements);
    expect(reversed.map((e) => e.volumeId).sort()).toEqual(forward.map((e) => e.volumeId).sort());
  });
});

describe('scene clearance composes the Uno with every board', () => {
  // Boards placed clear of the Uno on purpose. At the origin the Uno's own PCB and headers
  // dominate the composite, which would mask whether a breadboard exemption did anything —
  // the test would pass while proving nothing.
  const placements = breadboardPlacements([bb('bb1', 900, 250), bb('bb2', 1500, 250)], ORIGIN);
  const unoClearance = unoWireClearance(BOARD_AT_SCENE_ORIGIN, []);

  it('never returns less than the Uno alone', () => {
    const clearance = sceneWireClearance(unoClearance, placements, []);
    for (let x = -3; x <= 16; x += 0.5) {
      const point = v(x, 0, 0);
      expect(clearance.requiredCentreYAt(point)).toBeGreaterThanOrEqual(
        unoClearance.requiredCentreYAt(point) - 1e-12,
      );
    }
  });

  it('makes both boards block', () => {
    const clearance = sceneWireClearance(unoClearance, placements, []);
    expect(clearance.requiredCentreYAt(v(6, 0, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    expect(clearance.requiredCentreYAt(v(12, 0, 0))).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
    // ...and the space between them is free.
    expect(clearance.requiredCentreYAt(v(9, 0, 0))).toBeCloseTo(WIRE_MIN_CENTRE_Y, 9);
  });

  it('routes an exemption only to the board that owns it', () => {
    const own = wireApproachExemptions(wire(['bb1', 'A5'], ['uno1', 'D13']), placements);
    const clearance = sceneWireClearance(unoClearance, placements, own);
    const anchor = breadboardHoleAttachment('bb1', 'A5', placements[0])!.anchor;
    // Exempt at its own opening...
    expect(clearance.requiredCentreYAt(anchor)).toBeLessThan(
      sceneWireClearance(unoClearance, placements, []).requiredCentreYAt(anchor),
    );
    // ...and bb2 is still solid, because nothing named bb2:body.
    const otherAnchor = breadboardHoleAttachment('bb2', 'A5', placements[1])!.anchor;
    expect(clearance.requiredCentreYAt(otherAnchor)).toBeGreaterThan(WIRE_MIN_CENTRE_Y);
  });

  it('falls back to the Uno rule when no board is present', () => {
    const clearance = sceneWireClearance(unoClearance, [], []);
    const point = v(0, 0, 0);
    expect(clearance.requiredCentreYAt(point)).toBeCloseTo(unoClearance.requiredCentreYAt(point), 12);
  });
});
