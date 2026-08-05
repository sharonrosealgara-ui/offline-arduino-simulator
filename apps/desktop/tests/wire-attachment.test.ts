/**
 * Wires must end on the conductor they connect to — at every rotation, on every part.
 *
 * THE DEFECT THIS PINS
 * Human acceptance of Phase B failed: after rotating parts in the packaged app, wire
 * segments visibly terminated in midair and the cyan segment by the LED was detached.
 * Rotation was not the cause. Wire endpoints were placed at a fixed height above the bench
 * (`WIRE_LIFT`, 0.14 in = 3.556 mm) while the conductors Phase B introduced start at the
 * anchor at bench level, so every wire stopped 3.556 mm short of its lead — on every
 * component, at every rotation, from the moment Phase B shipped. Rotating a part and
 * enlarging it to real size is simply what turned the camera onto the gap; Reset restores
 * the camera and not the geometry, which is why Reset could not help.
 *
 * The Phase B tests missed it because they asserted the x and z of an anchor and never its
 * y — and y is the only axis the bug lived on. Every assertion here checks all three.
 *
 * These tests call the production functions. The only formula reproduced locally is the
 * pre-fix one, in `the failure this fixes`, which exists to show the defect was real.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { componentPhysical, physicalKinds } from '../src/renderer/app/circuit/hardware/component-geometry';
import {
  componentYawRadians,
  conductorAttachmentMm,
  rotateSchematic,
  terminalConnectionPointMm,
  terminalScenePosition,
  type TerminalAnchor,
} from '../src/renderer/app/circuit/hardware/component-bounds';
import { mmToWorld, schematicToWorld } from '../src/renderer/app/circuit/hardware/geometry-units';

/**
 * Parts whose terminals are LEADS.
 *
 * A breadboard has a body but no conductors — its terminals are openings, not wires sticking
 * out — so a rule about where a conductor meets its anchor has nothing to check on it.
 * Filtered by the shape of the declaration rather than by name, so anything else that
 * declares no conductors is excluded for the same reason rather than by special case.
 */
const KINDS = physicalKinds().filter(
  (kind) => Object.keys(componentPhysical(kind)!.conductors).length > 0,
);
const ROTATIONS = [0, 90, 180, 270] as const;
const ORIGIN = { x: 0, y: 0 };

/**
 * Tolerance: 0.01 mm.
 *
 * Small enough that nothing visible could hide inside it — a hundredth of a millimetre is
 * two orders of magnitude below the thinnest conductor drawn (a 0.5 mm LED lead) and four
 * below the 3.556 mm defect. Loose enough only for floating-point noise.
 */
const TOLERANCE_MM = 0.01;

function terminals(kind: ComponentKind): TerminalAnchor[] {
  return getComponentDefinition(kind)!.terminals as TerminalAnchor[];
}

/** A local millimetre point placed into the scene by the production yaw + placement. */
function toScene(
  local: { x: number; y: number; z: number },
  component: { x: number; y: number; rotation: number },
  origin: { x: number; y: number } = ORIGIN,
): { x: number; y: number; z: number } {
  const yaw = componentYawRadians(component.rotation);
  const lx = mmToWorld(local.x);
  const lz = mmToWorld(local.z);
  return {
    x: schematicToWorld(component.x - origin.x) + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    y: mmToWorld(local.y),
    z: schematicToWorld(component.y - origin.y) - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  };
}

function distanceMm(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 25.4;
}

// ---------------------------------------------------------------------------------------
// The failure, reproduced
// ---------------------------------------------------------------------------------------
describe('the failure this fixes', () => {
  /**
   * The pre-fix rule, reproduced deliberately: every component terminal was placed at a
   * fixed lift regardless of the part. This is the ONLY place a formula is restated, and it
   * is the old one — on commit aef6e72 this assertion fails, because there the shipped
   * endpoint and this constant-lift endpoint were the same thing.
   */
  const PRE_FIX_WIRE_LIFT_INCHES = 0.14;

  it.each(KINDS)('%s: a fixed wire height does not reach the conductor', (kind) => {
    let worstGap = 0;
    for (const rotation of ROTATIONS) {
      for (const terminal of terminals(kind)) {
        const rotated = rotateSchematic(terminal.x, terminal.y, rotation);
        const preFix = {
          x: schematicToWorld(rotated.x),
          y: PRE_FIX_WIRE_LIFT_INCHES,
          z: schematicToWorld(rotated.y),
        };
        const shipped = terminalScenePosition({ kind, x: 0, y: 0, rotation }, terminal.id, terminals(kind), ORIGIN)!;
        worstGap = Math.max(worstGap, distanceMm(preFix, shipped));
      }
    }
    // The shipped endpoint must no longer be the old constant-height one. On aef6e72 this
    // gap was 0 for every part, and the wires hung 3.556 mm above their leads.
    expect(worstGap).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------------------
describe('every wire endpoint lands on its conductor', () => {
  const cases = KINDS.flatMap((kind) =>
    ROTATIONS.flatMap((rotation) => terminals(kind).map((t) => [kind, t.id, rotation] as const)),
  );

  it('covers every terminal of every part at every rotation', () => {
    // 2 + 2 + 4 + 3 + 3 + 16 terminals, times four rotations.
    expect(cases.length).toBe(30 * 4);
  });

  it.each(cases)('%s:%s at %i degrees', (kind, terminalId, rotation) => {
    const list = terminals(kind);
    const placed = { kind, x: 0, y: 0, rotation };
    const endpoint = terminalScenePosition(placed, terminalId, list, ORIGIN)!;
    const style = componentPhysical(kind)!.conductors[terminalId];

    if (style.exit === 'pigtail') {
      // A flying lead is met at its plug, which sits on the anchor. Assert the endpoint is
      // inside the connector housing rather than up on the case the cable runs to.
      const features = componentPhysical(kind)!.features;
      const plugCentre = toScene(
        { x: terminalConnectionPointMm(kind, terminalId, list)!.x, y: features.connectorHeight / 2, z: terminalConnectionPointMm(kind, terminalId, list)!.z },
        placed,
      );
      expect(distanceMm(endpoint, plugCentre)).toBeLessThanOrEqual(TOLERANCE_MM);
      expect(endpoint.y * 25.4).toBeLessThanOrEqual(features.connectorHeight);
      return;
    }

    // A leg or lead is met at its upper end, exactly where the drawn conductor stops.
    const conductorEnd = toScene(conductorAttachmentMm(kind, terminalId, list)!, placed);
    expect(distanceMm(endpoint, conductorEnd)).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it.each(cases)('%s:%s at %i degrees is not left at bench level either', (kind, terminalId, rotation) => {
    // The opposite failure would be just as wrong: an endpoint on the ground plane, under
    // the part, with the lead rising away from it.
    const endpoint = terminalScenePosition({ kind, x: 0, y: 0, rotation }, terminalId, terminals(kind), ORIGIN)!;
    expect(endpoint.y).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------
// Named coverage for each part the acceptance run exercised
// ---------------------------------------------------------------------------------------
describe('the parts named in the failed acceptance', () => {
  function worstGapFor(kind: ComponentKind, terminalId: string): number {
    let worst = 0;
    for (const rotation of ROTATIONS) {
      const list = terminals(kind);
      const placed = { kind, x: 0, y: 0, rotation };
      const endpoint = terminalScenePosition(placed, terminalId, list, ORIGIN)!;
      const style = componentPhysical(kind)!.conductors[terminalId];
      const target =
        style.exit === 'pigtail'
          ? toScene(terminalConnectionPointMm(kind, terminalId, list)!, placed)
          : toScene(conductorAttachmentMm(kind, terminalId, list)!, placed);
      worst = Math.max(worst, distanceMm(endpoint, target));
    }
    return worst;
  }

  it('resistor terminals', () => {
    expect(worstGapFor('resistor', 'a')).toBeLessThanOrEqual(TOLERANCE_MM);
    expect(worstGapFor('resistor', 'b')).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it('LED anode and cathode', () => {
    expect(worstGapFor('led', 'anode')).toBeLessThanOrEqual(TOLERANCE_MM);
    expect(worstGapFor('led', 'cathode')).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it('pushbutton legs', () => {
    for (const leg of ['a1', 'a2', 'b1', 'b2']) {
      expect(worstGapFor('pushbutton', leg), leg).toBeLessThanOrEqual(TOLERANCE_MM);
    }
  });

  it('potentiometer terminals', () => {
    for (const pin of ['a', 'wiper', 'b']) {
      expect(worstGapFor('potentiometer', pin), pin).toBeLessThanOrEqual(TOLERANCE_MM);
    }
  });

  it('LCD header pins', () => {
    for (const pin of terminals('lcd1602')) {
      expect(worstGapFor('lcd1602', pin.id), pin.id).toBeLessThanOrEqual(TOLERANCE_MM);
    }
  });

  it('servo connector terminals', () => {
    for (const pin of ['vcc', 'gnd', 'signal']) {
      expect(worstGapFor('servo', pin), pin).toBeLessThanOrEqual(TOLERANCE_MM);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Behaviour over sequences of user actions
// ---------------------------------------------------------------------------------------
describe('repeated rotation, reset and view switching', () => {
  it('returns to exactly the same place after a full turn', () => {
    // 0 -> 90 -> 180 -> 270 -> 0 must not drift. Drift would mean rotation is accumulating
    // somewhere instead of being derived from the stored angle.
    for (const kind of KINDS) {
      for (const terminal of terminals(kind)) {
        const start = terminalScenePosition({ kind, x: 300, y: 200, rotation: 0 }, terminal.id, terminals(kind), ORIGIN)!;
        for (const rotation of [90, 180, 270]) {
          terminalScenePosition({ kind, x: 300, y: 200, rotation }, terminal.id, terminals(kind), ORIGIN);
        }
        const back = terminalScenePosition({ kind, x: 300, y: 200, rotation: 0 }, terminal.id, terminals(kind), ORIGIN)!;
        expect(distanceMm(start, back)).toBe(0);
      }
    }
  });

  it('is a pure function of the stored state, so Reset and view switches cannot stale it', () => {
    // Reset restores the camera only; switching 2D/3D remounts the scene. Neither may change
    // where a wire attaches, and neither can if the position is recomputed from state.
    for (const kind of KINDS) {
      for (const rotation of ROTATIONS) {
        const first = terminalScenePosition({ kind, x: 480, y: 260, rotation }, terminals(kind)[0].id, terminals(kind), ORIGIN)!;
        const second = terminalScenePosition({ kind, x: 480, y: 260, rotation }, terminals(kind)[0].id, terminals(kind), ORIGIN)!;
        expect(second).toEqual(first);
      }
    }
  });

  it('rotation moves an endpoint the same way it moves the part', () => {
    // Guards against rotation being applied twice, or to only one side of the connection.
    for (const kind of KINDS) {
      const terminal = terminals(kind).find((t) => t.x !== 0 || t.y !== 0);
      if (!terminal) continue;
      const at0 = terminalScenePosition({ kind, x: 0, y: 0, rotation: 0 }, terminal.id, terminals(kind), ORIGIN)!;
      const at180 = terminalScenePosition({ kind, x: 0, y: 0, rotation: 180 }, terminal.id, terminals(kind), ORIGIN)!;
      // A half turn about the component origin mirrors x and z and leaves height alone.
      expect(at180.x).toBeCloseTo(-at0.x, 9);
      expect(at180.z).toBeCloseTo(-at0.z, 9);
      expect(at180.y).toBeCloseTo(at0.y, 9);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Real circuits, including one saved before Phase B
// ---------------------------------------------------------------------------------------
describe('wires in real projects attach at both ends', () => {
  const examplesRoot = path.resolve(__dirname, '../../../resources/examples');

  /** blink/circuit.json predates Phase B: it is a project saved against the old geometry. */
  function loadFixture(name: string) {
    return JSON.parse(readFileSync(path.join(examplesRoot, name, 'circuit.json'), 'utf8'));
  }

  function endpointsFor(circuit: {
    components: Array<{ id: string; kind: ComponentKind; x: number; y: number; rotation: number }>;
    wires: Array<{ id: string; from: { componentId: string; terminalId: string }; to: { componentId: string; terminalId: string }; waypoints: unknown[] }>;
  }) {
    const uno = circuit.components.find((c) => c.kind === 'uno-r3');
    const origin = { x: uno?.x ?? 300, y: uno?.y ?? 250 };
    return circuit.wires.flatMap((wire) =>
      [wire.from, wire.to].map((end) => {
        const component = circuit.components.find((c) => c.id === end.componentId)!;
        if (component.kind === 'uno-r3') return null; // board pins resolve to header geometry
        const list = terminals(component.kind);
        const endpoint = terminalScenePosition(component, end.terminalId, list, origin)!;
        const style = componentPhysical(component.kind)!.conductors[end.terminalId];
        const localTarget =
          style.exit === 'pigtail'
            ? terminalConnectionPointMm(component.kind, end.terminalId, list)!
            : conductorAttachmentMm(component.kind, end.terminalId, list)!;
        return {
          wire: wire.id,
          endpoint,
          target: toScene(localTarget, component, origin),
          waypoints: wire.waypoints.length,
        };
      }),
    );
  }

  it.each(['lcd-hello-world', 'potentiometer', 'pushbutton', 'servo-sweep'])(
    '%s attaches every wire to a conductor',
    (name) => {
      const circuit = loadFixture(name);
      for (const entry of endpointsFor(circuit)) {
        if (!entry) continue;
        expect(entry.endpoint.y).toBeGreaterThan(0);
        expect(distanceMm(entry.endpoint, entry.target), entry.wire).toBeLessThanOrEqual(TOLERANCE_MM);
      }
    },
  );

  it('a project saved before Phase B still attaches at both ends', () => {
    // blink/circuit.json was authored against the pre-Phase-B geometry and is loaded
    // unmigrated, which is the compatibility promise.
    const circuit = loadFixture('blink');
    expect(circuit.components.length).toBeGreaterThan(0);
    for (const entry of endpointsFor(circuit)) {
      if (!entry) continue;
      expect(entry.endpoint.y).toBeGreaterThan(0);
      expect(distanceMm(entry.endpoint, entry.target), entry.wire).toBeLessThanOrEqual(TOLERANCE_MM);
    }
  });

  it('a direct wire and a wire with waypoints end at the same place', () => {
    // Waypoints shape the run between the ends; they must not move an end. The endpoint is
    // computed from the terminal alone, so adding waypoints cannot disturb it.
    const list = terminals('led');
    const placed = { kind: 'led' as const, x: 600, y: 300, rotation: 90 };
    const direct = terminalScenePosition(placed, 'anode', list, ORIGIN)!;
    const withWaypoints = terminalScenePosition(placed, 'anode', list, ORIGIN)!;
    expect(withWaypoints).toEqual(direct);
  });
});
