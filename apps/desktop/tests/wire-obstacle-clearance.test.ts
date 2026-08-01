/**
 * Wires must clear the board, not just the bench.
 *
 * THE DEFECT THIS PINS
 * Bench clearance kept wires above −0.095 in while the Uno stands on that same floor: its
 * PCB spans −0.0315 to +0.0315 and its headers reach +0.3515. A wire crossing the board sagged
 * to the bench-clearance height and went through it. Measured on Blink's D13 route: the tube
 * sat 0.0575 in inside a PCB 0.063 in thick, with 39.6% of the curve over the board footprint.
 * The buried middle is what read as two disconnected segments. Blink's ground route clipped
 * the analog header by 0.0278 in on its way to a power pin.
 *
 * The verification grid here is deliberately offset AND denser than production's, so these
 * tests do not merely re-check the exact sample positions the algorithm optimised against.
 * If the correction only satisfied its own sample points, this grid would find the gap.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { STARTER_TEMPLATES } from '../src/renderer/app/dialogs/examples-data';
import {
  buildWireCurveWithDiagnostics,
  BENCH_CLEARANCE,
  WIRE_CLEARANCE_TOLERANCE,
  WIRE_MAX_CLEARANCE_ITERATIONS,
  WIRE_RADIUS_SELECTED,
} from '../src/renderer/app/circuit/hardware/wire-path';
import {
  ATTACHMENT_ESCAPE_MARGIN,
  BOARD_AT_SCENE_ORIGIN,
  OBSTACLE_HEADER_ANALOG,
  OBSTACLE_HEADER_DIGITAL,
  OBSTACLE_HEADER_POWER,
  OBSTACLE_PCB,
  headerVolumeIdForPin,
  requiredWireCentreYAt,
  unoObstacleVolumes,
  unoWireClearance,
  type AttachmentExemption,
  type UnoPlacement,
} from '../src/renderer/app/circuit/hardware/scene-obstacles';
import { terminalScenePosition, type TerminalAnchor } from '../src/renderer/app/circuit/hardware/component-bounds';
import { PCB_TOP, unoPinPosition } from '../src/renderer/app/circuit/hardware/uno-geometry';

/**
 * 733 is prime and larger than production's 512, so the verification points are both denser
 * and almost entirely different parameter values.
 */
const VERIFY_SAMPLES = 733;
/** See the note in `assertRoute`: sampling a step-function constraint on a finer grid. */
const GRID_STEP_ALLOWANCE = 1e-5;
const WIRE_LIFT = 0.14;
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

interface Route {
  points: THREE.Vector3[];
  exemptions: AttachmentExemption[];
  placement: UnoPlacement;
}

function build(route: Route) {
  return buildWireCurveWithDiagnostics(route.points, unoWireClearance(route.placement, route.exemptions))!;
}

/** Worst margin on the offset grid: negative means something is intersected. */
function verifyMargin(route: Route): { margin: number; at: number } {
  const result = build(route);
  let margin = Infinity;
  let at = 0;
  for (let i = 0; i <= VERIFY_SAMPLES; i += 1) {
    const t = i / VERIFY_SAMPLES;
    const p = result.curve.getPoint(t);
    const m = p.y - requiredWireCentreYAt(p, route.placement, route.exemptions);
    if (m < margin) {
      margin = m;
      at = t;
    }
  }
  return { margin, at };
}

function assertRoute(route: Route, label: string) {
  const result = build(route);
  const { margin, at } = verifyMargin(route);

  /*
   * The binding requirement is physical: the bottom of the tube must be above the obstacle's
   * actual surface. `margin` here is measured against the NOMINAL target, which already
   * includes the tube radius plus a 0.002 in epsilon — so a small negative margin still means
   * the tube physically clears, by epsilon minus that amount.
   *
   * GRID_STEP_ALLOWANCE covers one specific, understood effect: the required height is a step
   * function at every obstacle edge, and this verification grid is denser than production's,
   * so it can land inside a step production never sampled. Measured worst case across all
   * bundled circuits is 1.3e-6 in — a thirty-thousandth of a millimetre. It is set an order of
   * magnitude above that and remains three orders below the epsilon, so nothing that could
   * ever be seen can hide inside it.
   */
  expect(margin, `${label} intersects at t=${at.toFixed(3)}`).toBeGreaterThan(-GRID_STEP_ALLOWANCE);
  expect(result.clears, label).toBe(true);
  expect(result.usedFallback, `${label} fell back`).toBe(false);
  expect(result.iterations, label).toBeLessThanOrEqual(WIRE_MAX_CLEARANCE_ITERATIONS);

  // Endpoints untouched.
  const first = result.curve.getPoint(0);
  const last = result.curve.getPoint(1);
  const target = route.points[route.points.length - 1];
  expect(first.x).toBeCloseTo(route.points[0].x, 12);
  expect(first.y).toBeCloseTo(route.points[0].y, 12);
  expect(first.z).toBeCloseTo(route.points[0].z, 12);
  expect(last.x).toBeCloseTo(target.x, 12);
  expect(last.y).toBeCloseTo(target.y, 12);
  expect(last.z).toBeCloseTo(target.z, 12);
  return result;
}

// ---------------------------------------------------------------------------------------
// Bundled circuits
// ---------------------------------------------------------------------------------------
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
const FIXTURES: Fixture[] = [
  ...readdirSync(examplesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(examplesRoot, e.name, 'circuit.json')))
    .map((e) => {
      const c = JSON.parse(readFileSync(path.join(examplesRoot, e.name, 'circuit.json'), 'utf8'));
      return { name: `packaged/${e.name}`, components: c.components ?? [], wires: c.wires ?? [] };
    }),
  ...STARTER_TEMPLATES.map((t) => ({
    name: `starter/${t.id}`,
    components: t.circuit.components as Fixture['components'],
    wires: (t.circuit.wires ?? []) as Fixture['wires'],
  })),
];

function routeFor(fixture: Fixture, wire: Fixture['wires'][number]): Route | null {
  const uno = fixture.components.find((c) => c.kind === 'uno-r3');
  const origin = { x: uno?.x ?? 300, y: uno?.y ?? 250 };
  const placement: UnoPlacement = uno
    ? { x: (uno.x - origin.x) * 0.01, z: (uno.y - origin.y) * 0.01, rotationDegrees: uno.rotation }
    : BOARD_AT_SCENE_ORIGIN;

  const endpoint = (ref: { componentId: string; terminalId: string }): THREE.Vector3 | null => {
    const component = fixture.components.find((c) => c.id === ref.componentId);
    if (!component) return null;
    if (component.kind === 'uno-r3') {
      const pin = unoPinPosition(ref.terminalId);
      if (pin) return v(pin.x, PCB_TOP + 0.3, pin.z);
    }
    const list = getComponentDefinition(component.kind)!.terminals as TerminalAnchor[];
    const scene = terminalScenePosition(component, ref.terminalId, list, origin);
    return scene ? v(scene.x, scene.y, scene.z) : null;
  };

  const a = endpoint(wire.from);
  const b = endpoint(wire.to);
  if (!a || !b) return null;

  const exemptions: AttachmentExemption[] = [];
  for (const [ref, point] of [
    [wire.from, a],
    [wire.to, b],
  ] as const) {
    const component = fixture.components.find((c) => c.id === ref.componentId);
    if (component?.kind !== 'uno-r3') continue;
    const volumeId = headerVolumeIdForPin(ref.terminalId);
    if (volumeId) exemptions.push({ point, volumeId });
  }

  const mids = (wire.waypoints ?? []).map((wp) =>
    v((wp.x - origin.x) * 0.01, WIRE_LIFT, (wp.y - origin.y) * 0.01),
  );
  return { points: [a, ...mids, b], exemptions, placement };
}

const ALL_WIRES = FIXTURES.flatMap((f) => f.wires.map((w) => [`${f.name}:${w.id}`, f, w] as const));

describe('all bundled circuits clear the board', () => {
  it('covers 44 wires across ten circuits', () => {
    expect(FIXTURES.length).toBe(10);
    expect(ALL_WIRES.length).toBe(44);
  });

  it.each(ALL_WIRES)('%s', (name, fixture, wire) => {
    const route = routeFor(fixture, wire);
    if (!route) return;
    assertRoute(route, name);
  });
});

// ---------------------------------------------------------------------------------------
// The specific routes that failed acceptance
// ---------------------------------------------------------------------------------------
describe('the Blink routes that failed', () => {
  const blink = FIXTURES.find((f) => f.name === 'starter/blink')!;
  const route = (id: string) => routeFor(blink, blink.wires.find((w) => w.id === id)!)!;

  it('w1 no longer passes through the PCB', () => {
    const r = route('w1');
    const result = build(r);

    // It used to sit 0.0575 in inside a 0.063 in board.
    let worstPcb = Infinity;
    const pcb = unoObstacleVolumes().find((o) => o.id === OBSTACLE_PCB)!;
    for (let i = 0; i <= VERIFY_SAMPLES; i += 1) {
      const p = result.curve.getPoint(i / VERIFY_SAMPLES);
      const overBoard = p.x >= pcb.minX && p.x <= pcb.maxX && p.z >= pcb.minZ && p.z <= pcb.maxZ;
      if (overBoard) worstPcb = Math.min(worstPcb, p.y - WIRE_RADIUS_SELECTED - pcb.top);
    }
    expect(worstPcb).toBeGreaterThan(0);
  });

  it('w1 may still attach inside the digital header it plugs into', () => {
    const r = route('w1');
    expect(r.exemptions.map((e) => e.volumeId)).toContain(OBSTACLE_HEADER_DIGITAL);
    assertRoute(r, 'w1');
  });

  it('w3 keeps its power-header attachment and stops clipping the analog header', () => {
    const r = route('w3');
    expect(r.exemptions.map((e) => e.volumeId)).toContain(OBSTACLE_HEADER_POWER);
    // The analog header is NOT exempt: w3 does not plug into it.
    expect(r.exemptions.map((e) => e.volumeId)).not.toContain(OBSTACLE_HEADER_ANALOG);

    const result = build(r);
    const analog = unoObstacleVolumes().find((o) => o.id === OBSTACLE_HEADER_ANALOG)!;
    let worst = Infinity;
    for (let i = 0; i <= VERIFY_SAMPLES; i += 1) {
      const p = result.curve.getPoint(i / VERIFY_SAMPLES);
      const over = p.x >= analog.minX && p.x <= analog.maxX && p.z >= analog.minZ && p.z <= analog.maxZ;
      if (over) worst = Math.min(worst, p.y - WIRE_RADIUS_SELECTED - analog.top);
    }
    // Either it clears the analog header or it never crosses it; both are acceptable.
    expect(worst === Infinity || worst > 0).toBe(true);
  });

  it('w2 is nowhere near the board and is unchanged', () => {
    const r = route('w2');
    const withBoard = build(r).curve;
    const benchOnly = buildWireCurveWithDiagnostics(r.points, BENCH_CLEARANCE)!.curve;

    // Same curve to strict tolerance: the correction is local to the obstacle.
    for (let i = 0; i <= 128; i += 1) {
      const t = i / 128;
      const a = withBoard.getPoint(t);
      const b = benchOnly.getPoint(t);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.y).toBeCloseTo(b.y, 12);
      expect(a.z).toBeCloseTo(b.z, 12);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Adversarial routes over the board
// ---------------------------------------------------------------------------------------
const OVER_BOARD: Array<[string, THREE.Vector3[]]> = [
  ['straight over the MCU', [v(-2, 0.1, 0.34), v(2, 0.1, 0.34)]],
  ['straight over the PCB centre', [v(-2.5, 0.08, 0), v(2.5, 0.08, 0)]],
  ['over the USB connector', [v(-2.5, 0.1, -0.55), v(2.5, 0.1, -0.55)]],
  ['along the digital header row', [v(-2, 0.1, -0.95), v(2, 0.1, -0.95)]],
  ['along the analog header row', [v(-2, 0.1, 0.95), v(2, 0.1, 0.95)]],
  ['diagonally across the board', [v(-2.5, 0.1, -1.5), v(2.5, 0.1, 1.5)]],
  ['corner to corner', [v(-2, 0.063, -2), v(2, 0.063, 2)]],
  ['long run crossing the board', [v(-8, 0.33, -4), v(8, 0.063, 4)]],
  ['short hop over the board edge', [v(1.2, 0.45, 0), v(1.6, 0.45, 0)]],
  ['waypoints over the board', [v(-3, 0.33, 0), v(0, 0.45, 0), v(3, 0.063, 0)]],
  ['clustered waypoints over the MCU', [v(-2, 0.3, 0.34), v(0.2, 0.45, 0.34), v(0.4, 0.45, 0.34), v(2, 0.063, 0.34)]],
];

describe('adversarial routes over the board', () => {
  it.each(OVER_BOARD)('%s', (label, points) => {
    assertRoute({ points, exemptions: [], placement: BOARD_AT_SCENE_ORIGIN }, label);
  });

  it('every category of board pin can be reached', () => {
    // Digital, analog, power and ground pins, each wired out to a part on the bench.
    for (const pinId of ['D13', 'D2', 'A0', 'A5', '5V', '3.3V', 'GND', 'AREF']) {
      const pin = unoPinPosition(pinId);
      if (!pin) continue;
      const start = v(pin.x, PCB_TOP + 0.3, pin.z);
      const volumeId = headerVolumeIdForPin(pinId);
      const exemptions: AttachmentExemption[] = volumeId ? [{ point: start, volumeId }] : [];
      assertRoute(
        { points: [start, v(3.5, 0.063, 1.6)], exemptions, placement: BOARD_AT_SCENE_ORIGIN },
        `pin ${pinId}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('a board that is not at the scene origin', () => {
  const translated: UnoPlacement = { x: 2.5, z: -1.75, rotationDegrees: 0 };

  it.each([0, 90, 180, 270])('routes correctly with the board rotated %i degrees', (rotationDegrees) => {
    const placement: UnoPlacement = { ...translated, rotationDegrees };
    // A run that would cross the board wherever the board happens to be.
    const points = [v(placement.x - 3, 0.33, placement.z - 2), v(placement.x + 3, 0.063, placement.z + 2)];
    assertRoute({ points, exemptions: [], placement }, `board at ${rotationDegrees}deg`);
  });

  it('raises the floor over the translated board, not over the origin', () => {
    const placement: UnoPlacement = { ...translated, rotationDegrees: 0 };
    const overBoard = requiredWireCentreYAt(v(placement.x, 0, placement.z), placement);
    const overOrigin = requiredWireCentreYAt(v(0, 0, 0), placement);
    expect(overBoard).toBeGreaterThan(overOrigin);
  });
});

// ---------------------------------------------------------------------------------------
describe('a fixed point inside a solid is a limitation, not a silent failure', () => {
  /*
   * Endpoints and waypoints are author-supplied and never moved. If one is placed inside the
   * board — a hand-authored waypoint in the middle of the MCU, say — no lift can clear it
   * without relocating a point the author fixed, and relocating it would quietly change the
   * circuit's drawing. The algorithm routes everything it controls and reports honestly that
   * it could not reach the target, rather than pretending.
   *
   * The UI cannot create waypoints, so this is only reachable by editing a project file.
   */
  it('reports rather than hides a waypoint buried in the MCU', () => {
    const buried = [v(-2, 0.3, 0.34), v(0.2, WIRE_LIFT, 0.34), v(2, 0.063, 0.34)];
    const result = build({ points: buried, exemptions: [], placement: BOARD_AT_SCENE_ORIGIN });

    // The waypoint stays exactly where the author put it.
    expect(result.curve.getPoint(0.5).y).toBeLessThan(0.25);
    // And the result says plainly that the target was not reached.
    expect(result.clears).toBe(false);
  });

  it('still clears everything away from that point', () => {
    const buried = [v(-2, 0.3, 0.34), v(0.2, WIRE_LIFT, 0.34), v(2, 0.063, 0.34)];
    const result = build({ points: buried, exemptions: [], placement: BOARD_AT_SCENE_ORIGIN });
    // The far end, well away from the buried waypoint, is routed properly.
    const p = result.curve.getPoint(0.95);
    expect(p.y).toBeGreaterThan(requiredWireCentreYAt(p, BOARD_AT_SCENE_ORIGIN) - GRID_STEP_ALLOWANCE);
  });
});

describe('the clearance rule itself', () => {
  it('returns a required WIRE-CENTRE height, not a surface height', () => {
    const pcb = unoObstacleVolumes().find((o) => o.id === OBSTACLE_PCB)!;
    const required = requiredWireCentreYAt(v(0, 0, 0), BOARD_AT_SCENE_ORIGIN);
    // Strictly above the surface by at least the tube's radius.
    expect(required).toBeGreaterThan(pcb.top + WIRE_RADIUS_SELECTED);
  });

  it('inflates the footprint so the tube flank clears, not just the centreline', () => {
    const pcb = unoObstacleVolumes().find((o) => o.id === OBSTACLE_PCB)!;
    const justOutside = v(pcb.maxX + WIRE_RADIUS_SELECTED * 0.5, 0, 0);
    // A centreline beyond the edge still has half a tube over the board.
    expect(requiredWireCentreYAt(justOutside, BOARD_AT_SCENE_ORIGIN)).toBeGreaterThan(pcb.top);
  });

  it('exempts only the connected header, and only near the pin', () => {
    const pin = unoPinPosition('D13')!;
    const at = v(pin.x, PCB_TOP + 0.3, pin.z);
    const exemptions = [{ point: at, volumeId: OBSTACLE_HEADER_DIGITAL }];

    // At the pin: the digital header is exempt, so only the PCB governs.
    const nearRequired = requiredWireCentreYAt(at, BOARD_AT_SCENE_ORIGIN, exemptions);
    const nearUnexempt = requiredWireCentreYAt(at, BOARD_AT_SCENE_ORIGIN, []);
    expect(nearRequired).toBeLessThan(nearUnexempt);

    // Well past its own connector, the header governs again.
    const far = v(pin.x + 4, PCB_TOP + 0.3, pin.z + ATTACHMENT_ESCAPE_MARGIN * 6);
    expect(requiredWireCentreYAt(far, BOARD_AT_SCENE_ORIGIN, exemptions)).toBeCloseTo(
      requiredWireCentreYAt(far, BOARD_AT_SCENE_ORIGIN, []),
      12,
    );
  });

  it('never exempts the PCB', () => {
    const pin = unoPinPosition('D13')!;
    const at = v(pin.x, PCB_TOP + 0.3, pin.z);
    const pcb = unoObstacleVolumes().find((o) => o.id === OBSTACLE_PCB)!;
    // Even with a header exemption in force, the board itself still has to be cleared.
    const required = requiredWireCentreYAt(at, BOARD_AT_SCENE_ORIGIN, [
      { point: at, volumeId: OBSTACLE_HEADER_DIGITAL },
    ]);
    expect(required).toBeGreaterThanOrEqual(pcb.top + WIRE_RADIUS_SELECTED);
  });

  it('leaves points away from the board at the bench minimum', () => {
    const far = v(9, 0, 9);
    expect(requiredWireCentreYAt(far, BOARD_AT_SCENE_ORIGIN)).toBeCloseTo(
      BENCH_CLEARANCE.requiredCentreYAt(far),
      12,
    );
  });

  it('models every opaque board volume', () => {
    const ids = unoObstacleVolumes().map((o) => o.id);
    for (const id of [
      'pcb',
      'header-digital',
      'header-analog',
      'header-power',
      'mcu',
      'usb',
      'power-jack',
      'crystal',
      'regulator',
      'reset-button',
      'icsp-main',
      'icsp-usb',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('is bounded and never falls back on any tested route', () => {
    let worstIterations = 0;
    for (const [label, points] of OVER_BOARD) {
      const r = build({ points, exemptions: [], placement: BOARD_AT_SCENE_ORIGIN });
      expect(r.usedFallback, label).toBe(false);
      worstIterations = Math.max(worstIterations, r.iterations);
    }
    expect(worstIterations).toBeLessThan(WIRE_MAX_CLEARANCE_ITERATIONS);
    expect(WIRE_CLEARANCE_TOLERANCE).toBe(1e-6);
  });
});
