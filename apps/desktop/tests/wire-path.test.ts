/**
 * No part of a wire may pass under the bench.
 *
 * THE DEFECT THIS PINS
 * Human acceptance failed a second time: in the Blink circuit the Uno-to-resistor route
 * appeared split, one yellow segment leaving the Uno and another leaving the resistor, each
 * stopping in midair. The endpoints were correct and rotation was not involved. The sag that
 * makes a wire read as a physical jumper was unbounded relative to the scene floor:
 *
 *   mid.y -= Math.min(0.45, distance * 0.18)
 *
 * On the 4.49 in run from D13 to the resistor that pulled the midpoint to −0.253 in, a full
 * 0.158 in beneath an opaque bench at −0.095 in. The tube travelled under the floor and only
 * its two ends stayed visible — which is exactly what a "split" wire looks like.
 *
 * Endpoint tests could never have caught this: both ends were exactly right. What was wrong
 * was everything in between, so these tests sample the whole path.
 *
 * They sample the real `buildWireCurve`. The only formula restated here is the pre-fix sag,
 * in `the failure this fixes`, to show what the old path did.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { STARTER_TEMPLATES } from '../src/renderer/app/dialogs/examples-data';
import {
  buildWireCurve,
  wireRadius,
  WIRE_CLEARANCE_EPSILON,
  WIRE_MAX_SAG,
  WIRE_MIN_CENTRE_Y,
  WIRE_RADIUS,
  WIRE_RADIUS_SELECTED,
  WIRE_SAG_PER_INCH,
} from '../src/renderer/app/circuit/hardware/wire-path';
import { BENCH_SURFACE_Y, GRID_SURFACE_Y } from '../src/renderer/app/circuit/hardware/scene-layout';
import { terminalScenePosition, type TerminalAnchor } from '../src/renderer/app/circuit/hardware/component-bounds';
import { PCB_TOP, unoPinPosition } from '../src/renderer/app/circuit/hardware/uno-geometry';

/** How wire endpoints reach the scene; matches DynamicNetlist3D. */
const WIRE_LIFT = 0.14;
const SAMPLES = 128; // twice the required floor of 64
/** Three.js curve sampling carries ordinary float error; this is well below one wire radius. */
const SAMPLE_TOLERANCE = 1e-9;

interface Fixture {
  name: string;
  components: Array<{ id: string; kind: ComponentKind; x: number; y: number; rotation: number }>;
  wires: Array<{
    id: string;
    from: { componentId: string; terminalId: string };
    to: { componentId: string; terminalId: string };
    waypoints: Array<{ x: number; y: number }>;
  }>;
}

const examplesRoot = path.resolve(__dirname, '../../../resources/examples');

function packaged(): Fixture[] {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(examplesRoot, e.name, 'circuit.json')))
    .map((e) => {
      const circuit = JSON.parse(readFileSync(path.join(examplesRoot, e.name, 'circuit.json'), 'utf8'));
      return {
        name: `packaged/${e.name}`,
        components: circuit.components ?? [],
        wires: circuit.wires ?? [],
      };
    });
}

function starters(): Fixture[] {
  return STARTER_TEMPLATES.map((t) => ({
    name: `starter/${t.id}`,
    components: t.circuit.components as Fixture['components'],
    wires: (t.circuit.wires ?? []) as Fixture['wires'],
  }));
}

const FIXTURES = [...packaged(), ...starters()];

/** The scene points a wire is built from — the same inputs DynamicNetlist3D passes. */
function wirePoints(fixture: Fixture, wire: Fixture['wires'][number]): THREE.Vector3[] | null {
  const uno = fixture.components.find((c) => c.kind === 'uno-r3');
  const origin = { x: uno?.x ?? 300, y: uno?.y ?? 250 };

  const endpoint = (ref: { componentId: string; terminalId: string }): THREE.Vector3 | null => {
    const component = fixture.components.find((c) => c.id === ref.componentId);
    if (!component) return null;
    if (component.kind === 'uno-r3') {
      const pin = unoPinPosition(ref.terminalId);
      if (pin) return new THREE.Vector3(pin.x, PCB_TOP + 0.3, pin.z);
    }
    const list = getComponentDefinition(component.kind)!.terminals as TerminalAnchor[];
    const scene = terminalScenePosition(component, ref.terminalId, list, origin);
    return scene ? new THREE.Vector3(scene.x, scene.y, scene.z) : null;
  };

  const from = endpoint(wire.from);
  const to = endpoint(wire.to);
  if (!from || !to) return null;
  const mids = (wire.waypoints ?? []).map(
    (wp) => new THREE.Vector3((wp.x - origin.x) * 0.01, WIRE_LIFT, (wp.y - origin.y) * 0.01),
  );
  return [from, ...mids, to];
}

function lowestCentre(curve: THREE.CatmullRomCurve3): number {
  let lowest = Infinity;
  for (let i = 0; i <= SAMPLES; i += 1) {
    lowest = Math.min(lowest, curve.getPoint(i / SAMPLES).y);
  }
  return lowest;
}

const ALL_WIRES = FIXTURES.flatMap((fixture) =>
  fixture.wires.map((wire) => [`${fixture.name}:${wire.id}`, fixture, wire] as const),
);

// ---------------------------------------------------------------------------------------
describe('the failure this fixes', () => {
  /** The pre-fix rule, restated deliberately: sag with no awareness of the floor. */
  function preFixLowestCentre(points: THREE.Vector3[]): number {
    let lowest = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p = points[i];
      const q = points[i + 1];
      const midY = (p.y + q.y) / 2 - Math.min(WIRE_MAX_SAG, p.distanceTo(q) * WIRE_SAG_PER_INCH);
      lowest = Math.min(lowest, midY, p.y, q.y);
    }
    return lowest;
  }

  const blink = FIXTURES.find((f) => f.name === 'starter/blink')!;

  it('Blink w1 used to sink about 0.158 in beneath the bench', () => {
    const wire = blink.wires.find((w) => w.id === 'w1')!;
    const points = wirePoints(blink, wire)!;
    const before = preFixLowestCentre(points);

    // The measured value from the failing build: −0.253 in, against a bench at −0.095 in.
    expect(before).toBeCloseTo(-0.253, 2);
    expect(BENCH_SURFACE_Y - before).toBeCloseTo(0.158, 2);
    expect(before).toBeLessThan(BENCH_SURFACE_Y);

    // On 36fe8c8 the shipped curve was that path. It no longer is.
    expect(lowestCentre(buildWireCurve(points)!)).toBeGreaterThan(BENCH_SURFACE_Y);
  });

  it('Blink w3 was submerged too', () => {
    const wire = blink.wires.find((w) => w.id === 'w3')!;
    const points = wirePoints(blink, wire)!;

    expect(preFixLowestCentre(points)).toBeLessThan(BENCH_SURFACE_Y);
    expect(lowestCentre(buildWireCurve(points)!)).toBeGreaterThan(BENCH_SURFACE_Y);
  });

  it('Blink w2 shows why a centreline check would not have been enough', () => {
    const wire = blink.wires.find((w) => w.id === 'w2')!;
    const points = wirePoints(blink, wire)!;
    const before = preFixLowestCentre(points);

    // Its CENTRELINE cleared the bench, so a centreline-only test would have passed it...
    expect(before).toBeGreaterThan(BENCH_SURFACE_Y);
    // ...while the bottom of the tube was buried 0.016 in deep.
    expect(before - WIRE_RADIUS_SELECTED).toBeLessThan(BENCH_SURFACE_Y);
    expect(lowestCentre(buildWireCurve(points)!) - WIRE_RADIUS_SELECTED).toBeGreaterThan(BENCH_SURFACE_Y);
  });
});

// ---------------------------------------------------------------------------------------
describe('every wire in every bundled circuit clears the bench', () => {
  it('covers all ten fixtures', () => {
    expect(FIXTURES.length).toBe(10);
    expect(ALL_WIRES.length).toBeGreaterThan(0);
  });

  it.each(ALL_WIRES)('%s', (_name, fixture, wire) => {
    const points = wirePoints(fixture, wire);
    if (!points) return;
    const curve = buildWireCurve(points)!;
    expect(curve).toBeTruthy();

    for (let i = 0; i <= SAMPLES; i += 1) {
      const y = curve.getPoint(i / SAMPLES).y;
      // The whole TUBE must clear, not just its centreline: subtract the radius it is drawn
      // with. Checking the centreline alone would leave the lower half of every wire buried.
      expect(y - WIRE_RADIUS_SELECTED).toBeGreaterThan(BENCH_SURFACE_Y - SAMPLE_TOLERANCE);
      expect(y - WIRE_RADIUS).toBeGreaterThan(BENCH_SURFACE_Y - SAMPLE_TOLERANCE);
    }
  });

  it.each(ALL_WIRES)('%s keeps both endpoints exactly where the wiring layer put them', (_name, fixture, wire) => {
    const points = wirePoints(fixture, wire);
    if (!points) return;
    const curve = buildWireCurve(points)!;

    // Only inserted midpoints are ever clamped; a terminal keeps its computed position.
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    expect(start.x).toBeCloseTo(points[0].x, 12);
    expect(start.y).toBeCloseTo(points[0].y, 12);
    expect(start.z).toBeCloseTo(points[0].z, 12);
    const last = points[points.length - 1];
    expect(end.x).toBeCloseTo(last.x, 12);
    expect(end.y).toBeCloseTo(last.y, 12);
    expect(end.z).toBeCloseTo(last.z, 12);
  });
});

// ---------------------------------------------------------------------------------------
describe('wires still behave like jumpers', () => {
  const blink = FIXTURES.find((f) => f.name === 'starter/blink')!;

  it('a long wire still droops visibly below its endpoints', () => {
    // The fix must not flatten wires into laser beams — that would trade one visual defect
    // for another.
    const wire = blink.wires.find((w) => w.id === 'w1')!;
    const points = wirePoints(blink, wire)!;
    const endpointMid = (points[0].y + points[points.length - 1].y) / 2;
    const lowest = lowestCentre(buildWireCurve(points)!);

    expect(lowest).toBeLessThan(endpointMid);
    // A droop of at least a tenth of an inch is plainly visible at working zoom.
    expect(endpointMid - lowest).toBeGreaterThan(0.1);
  });

  it('a short wire that never needed clamping is untouched', () => {
    // A span whose natural sag already sits above the floor: the clamp must not touch it.
    // Blink's w2 does NOT qualify — its centreline cleared the bench but its tube did not,
    // so it is legitimately clamped; see the test above.
    const from = new THREE.Vector3(0, 0.3, 0);
    const to = new THREE.Vector3(0.4, 0.3, 0);
    const unclamped = (from.y + to.y) / 2 - Math.min(WIRE_MAX_SAG, from.distanceTo(to) * WIRE_SAG_PER_INCH);
    expect(unclamped).toBeGreaterThan(WIRE_MIN_CENTRE_Y);

    const lowest = lowestCentre(buildWireCurve([from, to])!);
    // Sags by its own amount, not lifted to the floor.
    expect(lowest).toBeLessThan(from.y);
    expect(lowest).toBeCloseTo(unclamped, 3);
  });

  it('sag grows with span until it reaches the cap', () => {
    const near = buildWireCurve([new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.5, 0.3, 0)])!;
    const far = buildWireCurve([new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(3, 0.9, 0)])!;
    expect(0.3 - lowestCentre(near)).toBeLessThan(0.9 - lowestCentre(far));
  });
});

// ---------------------------------------------------------------------------------------
describe('the constants the clamp is built from', () => {
  it('derives the clearance from the radius actually rendered', () => {
    expect(wireRadius(false)).toBe(WIRE_RADIUS);
    expect(wireRadius(true)).toBe(WIRE_RADIUS_SELECTED);
    // The thickest tube sets the floor, so selecting a wire cannot push it into the bench.
    expect(WIRE_MIN_CENTRE_Y).toBeCloseTo(BENCH_SURFACE_Y + WIRE_RADIUS_SELECTED + WIRE_CLEARANCE_EPSILON, 12);
    expect(WIRE_MIN_CENTRE_Y - WIRE_RADIUS_SELECTED).toBeGreaterThan(BENCH_SURFACE_Y);
  });

  it('keeps the grid off the bench plane so the two cannot z-fight', () => {
    expect(GRID_SURFACE_Y).toBeCloseTo(BENCH_SURFACE_Y + 0.005, 12);
    expect(GRID_SURFACE_Y).not.toBe(BENCH_SURFACE_Y);
  });

  it('returns nothing for a path that is not a path', () => {
    expect(buildWireCurve([])).toBeNull();
    expect(buildWireCurve([new THREE.Vector3(0, 0, 0)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
describe('waypoint wires use the same clamped path', () => {
  it('clamps every span, not just the first', () => {
    // A hand-authored project may carry waypoints even though the UI cannot create them, and
    // each span between them sags independently.
    const points = [
      new THREE.Vector3(0, 0.33, 0),
      new THREE.Vector3(2, WIRE_LIFT, 0),
      new THREE.Vector3(4, 0.06, 0),
    ];
    const curve = buildWireCurve(points)!;
    for (let i = 0; i <= SAMPLES; i += 1) {
      expect(curve.getPoint(i / SAMPLES).y - WIRE_RADIUS_SELECTED).toBeGreaterThan(
        BENCH_SURFACE_Y - SAMPLE_TOLERANCE,
      );
    }
    expect(curve.getPoint(0).y).toBeCloseTo(0.33, 12);
    expect(curve.getPoint(1).y).toBeCloseTo(0.06, 12);
  });
});
