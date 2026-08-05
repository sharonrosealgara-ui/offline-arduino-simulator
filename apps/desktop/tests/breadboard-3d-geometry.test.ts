/**
 * The 3D breadboard's geometry and its instance-to-terminal contract.
 *
 * The contract that matters is the boring one: instance *i* is canonical hole *i*. An
 * InstancedMesh hands back nothing but an integer when it is clicked, so that integer is the
 * only link between a pixel and a terminal id. If the order were an accident of construction
 * rather than a promise, a click would wire up a different hole than the one under the
 * pointer — and it would do so consistently enough to look deliberate.
 *
 * Everything here is pure, so none of it needs WebGL.
 */
import { describe, expect, it } from 'vitest';
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import {
  CHANNEL_VISIBLE_WIDTH,
  HOLE_OPENING_DEPTH,
  HOLE_OPENING_SIZE,
  breadboardBody3D,
  breadboardGroupTransform,
  breadboardHoleInstances,
  breadboardHoleWorldPosition,
  breadboardInstanceCount,
  breadboardTopY,
  instanceTerminalId,
  resolveInstanceTerminal,
  terminalInstanceIndex,
} from '../src/renderer/app/circuit/hardware/breadboard-3d-geometry';
import { mmToWorld } from '../src/renderer/app/circuit/hardware/geometry-units';
import { BENCH_SURFACE_Y } from '../src/renderer/app/circuit/hardware/scene-layout';
import { componentPhysical } from '../src/renderer/app/circuit/hardware/component-geometry';
import { unoObstacleVolumes } from '../src/renderer/app/circuit/hardware/scene-obstacles';

const model = createBreadboardModel();
const ORIGIN = { x: 0, y: 0 };
const place = (x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0) => ({ x, y, rotation });
const ROTATIONS = [0, 90, 180, 270] as const;

describe('1-4: instances are canonical holes, in canonical order', () => {
  it('produces exactly 400 instances', () => {
    expect(breadboardHoleInstances()).toHaveLength(400);
    expect(breadboardInstanceCount()).toBe(400);
    expect(breadboardInstanceCount()).toBe(model.holes.length);
  });

  it('represents every canonical terminal exactly once', () => {
    const ids = breadboardHoleInstances().map((h) => h.id);
    expect(new Set(ids).size).toBe(400);
    expect(new Set(ids)).toEqual(new Set(model.holes.map((h) => h.id)));
  });

  it('keeps instance order identical to canonical order', () => {
    expect(breadboardHoleInstances().map((h) => h.id)).toEqual(model.holes.map((h) => h.id));
    expect(breadboardHoleInstances().map((h) => h.index)).toEqual(model.holes.map((_, i) => i));
  });

  it('maps the first, a middle and the last instance to the right terminals', () => {
    const expectedFirst = model.holes[0].id;
    const expectedMiddle = model.holes[199].id;
    const expectedLast = model.holes[399].id;
    expect(instanceTerminalId(0)).toBe(expectedFirst);
    expect(instanceTerminalId(199)).toBe(expectedMiddle);
    expect(instanceTerminalId(399)).toBe(expectedLast);
  });

  it('round-trips index and terminal id in both directions for all 400', () => {
    for (const hole of breadboardHoleInstances()) {
      expect(terminalInstanceIndex(hole.id)).toBe(hole.index);
      expect(instanceTerminalId(hole.index)).toBe(hole.id);
    }
  });

  it('is stable across repeated calls — the order is a contract, not a build artefact', () => {
    expect(breadboardHoleInstances().map((h) => h.id)).toEqual(breadboardHoleInstances().map((h) => h.id));
  });

  it('carries the canonical group with each instance', () => {
    for (const hole of breadboardHoleInstances()) {
      expect(hole.groupId).toBe(model.holes.find((h) => h.id === hole.id)!.groupId);
    }
  });
});

describe('7-8: dimensions come through the shared conversion', () => {
  it('converts the documented body envelope to world inches', () => {
    const body = breadboardBody3D();
    expect(body.width).toBeCloseTo(mmToWorld(84), 9);
    expect(body.depth).toBeCloseTo(mmToWorld(54.3), 9);
    expect(body.height).toBeCloseTo(mmToWorld(8.5), 9);
  });

  it('converts every hole position from canonical millimetres', () => {
    for (const hole of model.holes) {
      const instance = breadboardHoleInstances().find((h) => h.id === hole.id)!;
      expect(instance.x).toBeCloseTo(mmToWorld(hole.x), 9);
      expect(instance.z).toBeCloseTo(mmToWorld(hole.y), 9);
    }
  });

  it('puts the top face one body-height above the bench', () => {
    expect(breadboardTopY()).toBeCloseTo(BENCH_SURFACE_Y + breadboardBody3D().height, 9);
  });

  it('keeps the visual approximations plausible and clearly separate from the canonical gap', () => {
    // The channel a student sees is narrower than the 7.62 mm E-to-F centre distance, and
    // they are different quantities. Conflating them would draw an opening the datasheets
    // never described.
    expect(CHANNEL_VISIBLE_WIDTH).toBeLessThan(mmToWorld(7.62));
    expect(HOLE_OPENING_SIZE).toBeGreaterThan(mmToWorld(0.7)); // clears the documented wire
    expect(HOLE_OPENING_DEPTH).toBeLessThan(breadboardBody3D().height);
  });

  it('fits every opening inside the body footprint', () => {
    const body = breadboardBody3D();
    for (const hole of breadboardHoleInstances()) {
      expect(Math.abs(hole.x)).toBeLessThan(body.width / 2);
      expect(Math.abs(hole.z)).toBeLessThan(body.depth / 2);
    }
  });
});

describe('10-15: transforms move holes without touching identity', () => {
  it('positions holes correctly at 0 degrees', () => {
    const hole = breadboardHoleInstances().find((h) => h.id === 'A1')!;
    const world = breadboardHoleWorldPosition('A1', place(0, 0), ORIGIN)!;
    expect(world.x).toBeCloseTo(hole.x, 9);
    expect(world.z).toBeCloseTo(hole.z, 9);
    expect(world.y).toBeCloseTo(breadboardTopY(), 9);
  });

  it.each(ROTATIONS)('keeps every hole on the board at %i degrees', (rotation) => {
    const body = breadboardBody3D();
    const radius = Math.hypot(body.width, body.depth) / 2;
    for (const hole of breadboardHoleInstances()) {
      const world = breadboardHoleWorldPosition(hole.id, place(0, 0, rotation), ORIGIN)!;
      expect(Math.hypot(world.x, world.z)).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it.each([90, 180, 270] as const)('relocates holes at %i degrees', (rotation) => {
    const upright = breadboardHoleWorldPosition('A1', place(0, 0, 0), ORIGIN)!;
    const turned = breadboardHoleWorldPosition('A1', place(0, 0, rotation), ORIGIN)!;
    expect(`${turned.x.toFixed(6)},${turned.z.toFixed(6)}`).not.toBe(
      `${upright.x.toFixed(6)},${upright.z.toFixed(6)}`,
    );
    // Distance from the board centre is a rigid-body invariant.
    expect(Math.hypot(turned.x, turned.z)).toBeCloseTo(Math.hypot(upright.x, upright.z), 9);
  });

  it.each(ROTATIONS)('rotates exactly as every other part does, at %i degrees', async (rotation) => {
    // Checked against the shared transform rather than by restating the formula here: a
    // second copy of the maths would agree with itself and could still disagree with the
    // Uno's pins, which is precisely the class of bug this project has already had once.
    const { rotateSchematic } = await import('../src/renderer/app/circuit/hardware/component-bounds');
    for (const id of ['A1', 'E14', 'TP1', 'BN25', 'J30']) {
      const local = breadboardHoleInstances().find((h) => h.id === id)!;
      const expected = rotateSchematic(local.x, local.z, rotation);
      const world = breadboardHoleWorldPosition(id, place(0, 0, rotation), ORIGIN)!;
      expect(world.x).toBeCloseTo(expected.x, 9);
      expect(world.z).toBeCloseTo(expected.y, 9);
    }
  });

  it('moves world position but never identity when the board moves', () => {
    const before = breadboardHoleWorldPosition('E14', place(0, 0), ORIGIN)!;
    const after = breadboardHoleWorldPosition('E14', place(400, 0), ORIGIN)!;
    expect(after.x - before.x).toBeCloseTo(4, 9); // 400 schematic units = 4 inches
    expect(instanceTerminalId(terminalInstanceIndex('E14')!)).toBe('E14');
  });

  it('applies the board transform once, on the group', () => {
    const transform = breadboardGroupTransform(place(300, 250, 90), ORIGIN);
    expect(transform.position[0]).toBeCloseTo(3, 9);
    expect(transform.position[2]).toBeCloseTo(2.5, 9);
    expect(transform.position[1]).toBeCloseTo(BENCH_SURFACE_Y, 9);
    expect(transform.rotationY).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('keeps two boards at different transforms distinct in world space and in identity', () => {
    const a = breadboardHoleWorldPosition('A1', place(0, 0), ORIGIN)!;
    const b = breadboardHoleWorldPosition('A1', place(600, 200, 180), ORIGIN)!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
    expect(resolveInstanceTerminal('bb1', 0)).not.toEqual(resolveInstanceTerminal('bb2', 0));
  });

  it('returns nothing for an id that is not a hole', () => {
    for (const id of ['K1', 'A31', 'A0', 'TP26', '5V']) {
      expect(`${id}:${breadboardHoleWorldPosition(id, place(0, 0), ORIGIN)}`).toBe(`${id}:undefined`);
      expect(`${id}:${terminalInstanceIndex(id)}`).toBe(`${id}:undefined`);
    }
  });

  it('treats D13 and A1 as real holes despite colliding with Uno pin names', () => {
    for (const id of ['A1', 'D13']) {
      expect(terminalInstanceIndex(id)).toBeTypeOf('number');
      expect(breadboardHoleWorldPosition(id, place(0, 0), ORIGIN)).toBeDefined();
    }
    // Qualification is the only thing separating them, and it is on the caller's side.
    expect(resolveInstanceTerminal('bb1', terminalInstanceIndex('A1')!)).toEqual({
      componentId: 'bb1',
      terminalId: 'A1',
    });
  });
});

describe('16-22: what a picked instance resolves to', () => {
  it('resolves a valid instance to the exact component and terminal', () => {
    const index = terminalInstanceIndex('C7')!;
    expect(resolveInstanceTerminal('bb1', index)).toEqual({ componentId: 'bb1', terminalId: 'C7' });
  });

  it('targets the correct board when two share a terminal id', () => {
    const index = terminalInstanceIndex('A1')!;
    expect(resolveInstanceTerminal('bb1', index)).toEqual({ componentId: 'bb1', terminalId: 'A1' });
    expect(resolveInstanceTerminal('bb2', index)).toEqual({ componentId: 'bb2', terminalId: 'A1' });
  });

  it('ignores a missing instance id rather than guessing', () => {
    expect(resolveInstanceTerminal('bb1', undefined)).toBeNull();
    expect(resolveInstanceTerminal('bb1', null)).toBeNull();
  });

  it.each([-1, 400, 401, 99999, 1.5, Number.NaN])('ignores the out-of-range instance id %s', (id) => {
    expect(resolveInstanceTerminal('bb1', id)).toBeNull();
  });

  it('agrees with the 2D canonical layout about which hole is which', async () => {
    // Same canonical source, two views: the id at a given index must match.
    const { breadboardHolePoints } = await import('../src/renderer/app/circuit/breadboard-geometry');
    const twoD = breadboardHolePoints();
    for (const instance of breadboardHoleInstances()) {
      expect(`${instance.index}:${instance.id}`).toBe(`${instance.index}:${twoD[instance.index].id}`);
    }
  });
});

describe('39-42: the C4 boundaries are still untouched', () => {
  it('defines no physical body for the breadboard, so nothing else can render it', () => {
    expect(componentPhysical('breadboard' as never)).toBeUndefined();
  });

  it('registers no breadboard obstacle volume', () => {
    const ids = unoObstacleVolumes().map((v) => v.id);
    expect(ids).toHaveLength(12);
    expect(ids.some((id) => id.includes('breadboard'))).toBe(false);
  });

  it('creates no wire anchor or attachment portal', async () => {
    // A hole's world position exists for the renderer, but nothing feeds it to the router:
    // scene-obstacles has no breadboard volumes and wire-path has no breadboard exemption.
    const obstacles = await import('../src/renderer/app/circuit/hardware/scene-obstacles');
    for (const hole of ['A1', 'TP1', 'J30', 'BN25']) {
      expect(`${hole}:${obstacles.headerVolumeIdForPin(hole)}`).toBe(
        `${hole}:${hole === 'A1' ? 'header-analog' : 'undefined'}`,
      );
    }
  });
});
