/**
 * Where a conductor ends, and where a wire lands, must be the same point.
 *
 * The bug this exists to prevent is subtle and was present for a long time: bodies were
 * drawn from hand-tuned numbers while wires attached to registry anchors, so a wire met
 * empty space beside a part. Two things keep that from coming back — conductors deriving
 * their endpoints from the registry rather than storing their own, and the 3D group's
 * rotation agreeing with the anchors' rotation.
 *
 * That second one is easy to get wrong. Schematic rotation turns +X toward +Y, and the
 * schematic +Y maps to world +Z, but `Object3D.rotation.y` turns +X toward −Z. The renderer
 * therefore negates the yaw. If someone "tidies" that sign away, every rotated part's body
 * turns one way while its anchors turn the other.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { componentPhysical, physicalKinds } from '../src/renderer/app/circuit/hardware/component-geometry';
import { conductorOrientation } from '../src/renderer/app/circuit/hardware/parts-3d';
import {
  bodyBoundsMm,
  conductorAttachmentMm,
  footprintBoundsMm,
} from '../src/renderer/app/circuit/hardware/component-bounds';
import { schematicToMm, schematicToWorld } from '../src/renderer/app/circuit/hardware/geometry-units';

const KINDS = physicalKinds();
const ROTATIONS = [0, 90, 180, 270] as const;

/** The canonical schematic rotation both renderers apply. */
function rotateSchematic(x: number, y: number, degrees: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * A local point inside the 3D component group, after the group's own yaw.
 * Mirrors `rotation={[0, yaw, 0]}` with `yaw = -rotation`.
 */
function applyGroupYaw(localX: number, localZ: number, degrees: number): { x: number; z: number } {
  const yaw = (-degrees * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: localX * cos + localZ * sin, z: -localX * sin + localZ * cos };
}

describe('the 3D group turns the same way as the anchors', () => {
  it.each(ROTATIONS)('agrees at %i degrees', (degrees) => {
    for (const kind of KINDS) {
      for (const terminal of getComponentDefinition(kind)!.terminals) {
        // Where the wiring layer puts the anchor: rotate in schematic space, then map.
        const schematic = rotateSchematic(terminal.x, terminal.y, degrees);
        const wiring = { x: schematicToWorld(schematic.x), z: schematicToWorld(schematic.y) };

        // Where the drawing puts it: unrotated local position, then the group's yaw.
        const drawing = applyGroupYaw(
          schematicToWorld(terminal.x),
          schematicToWorld(terminal.y),
          degrees,
        );

        expect(drawing.x).toBeCloseTo(wiring.x, 12);
        expect(drawing.z).toBeCloseTo(wiring.z, 12);
      }
    }
  });

  it('is a real constraint — the un-negated yaw fails it', () => {
    // Guards the guard: if this rotation were a no-op, the test above would pass vacuously.
    const wrong = applyGroupYaw(schematicToWorld(10), 0, 90);
    const right = rotateSchematic(10, 0, 90);
    expect(wrong.z).toBeCloseTo(schematicToWorld(right.y), 12);
    expect(wrong.z).not.toBeCloseTo(-schematicToWorld(right.y), 6);
  });
});

describe('every conductor reaches its own anchor and its own body', () => {
  it.each(KINDS)('%s', (kind: ComponentKind) => {
    const definition = getComponentDefinition(kind)!;
    const physical = componentPhysical(kind)!;
    const terminals = definition.terminals;
    const body = bodyBoundsMm(kind, terminals)!;

    for (const terminal of terminals) {
      const style = physical.conductors[terminal.id];
      expect(style, `${kind}:${terminal.id} has no conductor`).toBeDefined();

      const attach = conductorAttachmentMm(kind, terminal.id, terminals)!;
      expect(attach).toBeDefined();

      // The conductor meets the body — it does not stop in mid-air.
      const grace = 1e-9;
      expect(attach.x).toBeGreaterThanOrEqual(body.minX - grace);
      expect(attach.x).toBeLessThanOrEqual(body.maxX + grace);
      expect(attach.z).toBeGreaterThanOrEqual(body.minZ - grace);
      expect(attach.z).toBeLessThanOrEqual(body.maxZ + grace);
    }
  });

  it.each(KINDS)('%s conductors have a non-zero run', (kind: ComponentKind) => {
    // A zero-length conductor is an anchor hidden at its attachment point: nothing visibly
    // connects the wire to the part.
    const terminals = getComponentDefinition(kind)!.terminals;
    for (const terminal of terminals) {
      const attach = conductorAttachmentMm(kind, terminal.id, terminals)!;
      const dx = attach.x - schematicToMm(terminal.x);
      const dz = attach.z - schematicToMm(terminal.y);
      const dy = attach.y;
      expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(0.05);
    }
  });
});

describe('anchors sit where the physical part puts them', () => {
  it.each(KINDS)('%s anchors are inside the footprint', (kind: ComponentKind) => {
    const terminals = getComponentDefinition(kind)!.terminals;
    const footprint = footprintBoundsMm(kind, terminals)!;
    for (const terminal of terminals) {
      const x = schematicToMm(terminal.x);
      const z = schematicToMm(terminal.y);
      expect(x).toBeGreaterThanOrEqual(footprint.minX - 1e-9);
      expect(x).toBeLessThanOrEqual(footprint.maxX + 1e-9);
      expect(z).toBeGreaterThanOrEqual(footprint.minZ - 1e-9);
      expect(z).toBeLessThanOrEqual(footprint.maxZ + 1e-9);
    }
  });

  it('puts the servo plug outside the case, not inside it', () => {
    // The SG90's terminals are on a cable. If they ended up inside the case, every wire to
    // this part would vanish into an opaque body.
    const terminals = getComponentDefinition('servo')!.terminals;
    const body = bodyBoundsMm('servo', terminals)!;
    for (const terminal of terminals) {
      const z = schematicToMm(terminal.y);
      expect(z).toBeGreaterThan(body.maxZ);
    }
  });

  it('puts the LCD header on the board edge, not in the middle of the screen', () => {
    const terminals = getComponentDefinition('lcd1602')!.terminals;
    const body = bodyBoundsMm('lcd1602', terminals)!;
    const headerZ = schematicToMm(terminals[0].y);
    // Header within 3 mm of the near edge of an 80 x 36 board.
    expect(Math.abs(headerZ - body.minZ)).toBeLessThan(3);
  });
});

describe('the servo pigtail keeps its identity-mapped colours', () => {
  it('colours by terminal id, never by position', () => {
    const physical = componentPhysical('servo')!;
    expect(physical.conductors.vcc.colorRole).toBe('vcc-red');
    expect(physical.conductors.gnd.colorRole).toBe('ground-black');
    expect(physical.conductors.signal.colorRole).toBe('signal-orange');
  });

  it('leaves the case as a flying lead rather than rigid pins', () => {
    const physical = componentPhysical('servo')!;
    for (const style of Object.values(physical.conductors)) {
      expect(style.exit).toBe('pigtail');
    }
  });
});

describe('conductor orientation survives rotation', () => {
  /**
   * The memoised quaternion in `Conductor` stands a unit-Y cylinder up along the lead.
   *
   * Its inputs are the endpoint differences in the component's LOCAL frame. Rotation is
   * applied by the parent group's yaw, so those inputs are rotation-invariant by
   * construction — the memo cannot go stale when a part is turned, because turning the part
   * does not change what the memo reads. These tests hold that reasoning in place: they
   * check the local orientation is the same at every rotation, and that composing it with
   * the group yaw still points the lead the right way in the world.
   */
  const UP = new THREE.Vector3(0, 1, 0);

  function localConductor(kind: ComponentKind, terminalId: string) {
    const terminals = getComponentDefinition(kind)!.terminals;
    const terminal = terminals.find((t) => t.id === terminalId)!;
    const attach = conductorAttachmentMm(kind, terminalId, terminals)!;
    const from = new THREE.Vector3(schematicToWorld(terminal.x), 0, schematicToWorld(terminal.y));
    const to = new THREE.Vector3(attach.x / 25.4, attach.y / 25.4, attach.z / 25.4);
    const d = to.clone().sub(from);
    return { from, to, d, length: d.length() };
  }

  it.each(KINDS)('%s: the quaternion aims the cylinder along the lead', (kind: ComponentKind) => {
    for (const terminal of getComponentDefinition(kind)!.terminals) {
      const { d, length } = localConductor(kind, terminal.id);
      const q = conductorOrientation(d.x, d.y, d.z, length);
      const aimed = UP.clone().applyQuaternion(q);
      const expected = d.clone().normalize();
      expect(aimed.x).toBeCloseTo(expected.x, 10);
      expect(aimed.y).toBeCloseTo(expected.y, 10);
      expect(aimed.z).toBeCloseTo(expected.z, 10);
    }
  });

  it.each(ROTATIONS)('at %i degrees the lead points the right way in the world', (degrees) => {
    for (const kind of KINDS) {
      for (const terminal of getComponentDefinition(kind)!.terminals) {
        const { d, length } = localConductor(kind, terminal.id);
        const local = conductorOrientation(d.x, d.y, d.z, length);

        // The group's yaw, exactly as the renderer applies it.
        const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (-degrees * Math.PI) / 180);
        const world = UP.clone().applyQuaternion(local).applyQuaternion(yaw);

        // Independently: rotate the local direction in schematic space and map it across.
        const rotated = rotateSchematic(d.x, d.z, degrees);
        const expected = new THREE.Vector3(rotated.x, d.y, rotated.y).normalize();

        expect(world.x).toBeCloseTo(expected.x, 10);
        expect(world.y).toBeCloseTo(expected.y, 10);
        expect(world.z).toBeCloseTo(expected.z, 10);
      }
    }
  });

  it('recomputes when the geometry changes, which is what the memo keys on', () => {
    const a = conductorOrientation(0, 1, 0, 1);
    const b = conductorOrientation(1, 0, 0, 1);
    // Different inputs must give a different orientation, or the memo keys are meaningless.
    expect(a.equals(b)).toBe(false);
  });
});
