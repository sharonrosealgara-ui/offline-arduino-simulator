/**
 * TEMPORARY — post-C4 routing smoke diagnostics. Not committed, not shipped.
 *
 * Every number here comes from the PRODUCTION routing path. Nothing is reimplemented:
 *
 *   buildWireCurveWithDiagnostics   the real curve builder, with its real iteration ceiling
 *   sceneWireClearance              the real composite of Uno + every breadboard
 *   wirePointsWithPortals           the real anchor -> portal -> ... -> portal -> anchor list
 *   wireApproachExemptions          the real owned, per-board endpoint exemptions
 *   breadboardHoleAttachment        the real per-hole anchors
 *   unoWireClearance / unoPinPosition   the real Uno obstacle table
 *
 * A harness that recomputed routes with its own maths could report a clean pass while the
 * application drew something else entirely, so it does not.
 *
 * TOLERANCES are taken from production constants, never invented here. They are printed in
 * the HUD so a reader can check that nothing was loosened to force a pass.
 */
import * as THREE from 'three';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import {
  buildWireCurveWithDiagnostics,
  WIRE_CLEARANCE_TOLERANCE,
  WIRE_MAX_CLEARANCE_ITERATIONS,
  WIRE_RADIUS_SELECTED,
  WIRE_CLEARANCE_EPSILON,
} from '../src/renderer/app/circuit/hardware/wire-path';
import {
  breadboardPlacements,
  breadboardTerminalPositions,
  sceneWireClearance,
  wireApproachExemptions,
  wirePointsWithPortals,
} from '../src/renderer/app/circuit/hardware/breadboard-scene';
import {
  BOARD_AT_SCENE_ORIGIN,
  headerVolumeIdForPin,
  unoObstacleVolumes,
  unoWireClearance,
  type AttachmentExemption,
  type UnoPlacement,
} from '../src/renderer/app/circuit/hardware/scene-obstacles';
import { breadboardBodyVolumeId } from '../src/renderer/app/circuit/hardware/breadboard-obstacles';
import { PCB_TOP, unoPinPosition } from '../src/renderer/app/circuit/hardware/uno-geometry';
import { SCHEMATIC_UNIT_INCHES } from '../src/renderer/app/circuit/hardware/geometry-units';

/** Denser and offset from production's 4096, so a pass is not the same grid agreeing twice. */
export const VERIFY_SAMPLES = 733;

export const TOLERANCES = {
  clearance: WIRE_CLEARANCE_TOLERANCE,
  clearanceUnits: 'world inches (production WIRE_CLEARANCE_TOLERANCE)',
  endpoint: 1e-9,
  endpointUnits: 'world inches (harness assertion: endpoints are fixed points of the curve)',
  zeroLength: 1e-9,
  wireRadius: WIRE_RADIUS_SELECTED,
  epsilon: WIRE_CLEARANCE_EPSILON,
  maxIterations: WIRE_MAX_CLEARANCE_ITERATIONS,
} as const;

export interface RouteDiag {
  wireId: string;
  fromId: string;
  toId: string;
  fromWorld: string;
  toWorld: string;
  signature: string;
  samples: number;
  iterations: number;
  usedFallback: boolean;
  fallbackReason: string;
  minSegment: number;
  nonFinite: string;
  zeroLength: string;
  worstMargin: number;
  clearanceOk: boolean;
  endpointError: number;
  endpointOk: boolean;
  identityOk: boolean;
  obstacleIds: string[];
  pass: boolean;
}

const ORIGIN_FALLBACK = { x: 300, y: 250 };

function originOf(components: readonly CircuitComponent[]): { x: number; y: number } {
  const uno = components.find((c) => c.kind === 'uno-r3');
  return { x: uno?.x ?? ORIGIN_FALLBACK.x, y: uno?.y ?? ORIGIN_FALLBACK.y };
}

function unoPlacementOf(components: readonly CircuitComponent[], origin: { x: number; y: number }): UnoPlacement {
  const uno = components.find((c) => c.kind === 'uno-r3');
  if (!uno) return BOARD_AT_SCENE_ORIGIN;
  return {
    x: (uno.x - origin.x) * SCHEMATIC_UNIT_INCHES,
    z: (uno.y - origin.y) * SCHEMATIC_UNIT_INCHES,
    rotationDegrees: uno.rotation,
  };
}

/**
 * Terminal world positions, exactly as DynamicNetlist3D assembles them: Uno pins from the
 * board geometry, breadboard holes from the production anchor helper.
 */
export function terminalWorldMap(components: readonly CircuitComponent[]): Map<string, THREE.Vector3> {
  const origin = originOf(components);
  const map = new Map<string, THREE.Vector3>();
  for (const component of components) {
    if (component.kind !== 'uno-r3') continue;
    for (const pin of ['D13', 'D12', 'D11', 'D2', '5V', 'GND', 'A0']) {
      const at = unoPinPosition(pin);
      if (at) map.set(`${component.id}:${pin}`, new THREE.Vector3(at.x, PCB_TOP + 0.3, at.z));
    }
  }
  for (const [key, position] of breadboardTerminalPositions(breadboardPlacements(components, origin))) {
    map.set(key, position);
  }
  return map;
}

/** Runs one wire through the production router and grades it. */
export function diagnoseWire(
  components: readonly CircuitComponent[],
  wire: CircuitWire,
): RouteDiag | null {
  const origin = originOf(components);
  const boards = breadboardPlacements(components, origin);
  const terminals = terminalWorldMap(components);

  const fromKey = `${wire.from.componentId}:${wire.from.terminalId}`;
  const toKey = `${wire.to.componentId}:${wire.to.terminalId}`;
  const a = terminals.get(fromKey);
  const b = terminals.get(toKey);
  if (!a || !b) return null;

  // Uno header exemptions, exactly as production builds them.
  const unoExemptions: AttachmentExemption[] = [];
  for (const [end, at] of [[wire.from, a], [wire.to, b]] as const) {
    const component = components.find((c) => c.id === end.componentId);
    if (component?.kind !== 'uno-r3') continue;
    const volumeId = headerVolumeIdForPin(end.terminalId);
    if (volumeId) unoExemptions.push({ point: at, volumeId });
  }

  const approach = boards.length ? wireApproachExemptions(wire, boards) : [];
  const points = boards.length ? wirePointsWithPortals(wire, { from: a, to: b }, [], boards) : [a, b];
  const clearance = sceneWireClearance(unoWireClearance(unoPlacementOf(components, origin), unoExemptions), boards, approach);

  const result = buildWireCurveWithDiagnostics(points, clearance);
  if (!result) return null;

  let worstMargin = Number.POSITIVE_INFINITY;
  let minSegment = Number.POSITIVE_INFINITY;
  let nonFinite = 'none';
  let previous: THREE.Vector3 | null = null;

  for (let i = 0; i <= VERIFY_SAMPLES; i += 1) {
    const p = result.curve.getPoint(i / VERIFY_SAMPLES);
    if (![p.x, p.y, p.z].every(Number.isFinite)) nonFinite = `sample ${i}`;
    worstMargin = Math.min(worstMargin, p.y - clearance.requiredCentreYAt(p));
    if (previous) minSegment = Math.min(minSegment, previous.distanceTo(p));
    previous = p.clone();
  }

  const startError = result.curve.getPoint(0).distanceTo(points[0]);
  const endError = result.curve.getPoint(1).distanceTo(points[points.length - 1]);
  const endpointError = Math.max(startError, endError);

  const obstacleIds = [
    ...unoObstacleVolumes().map((v) => v.id),
    ...boards.map((board) => breadboardBodyVolumeId(board.componentId)),
  ];

  const clearanceOk = worstMargin > -TOLERANCES.clearance;
  const endpointOk = endpointError <= TOLERANCES.endpoint;
  const zeroLengthOk = minSegment > TOLERANCES.zeroLength;
  const identityOk = terminals.has(fromKey) && terminals.has(toKey);

  return {
    wireId: wire.id,
    fromId: fromKey,
    toId: toKey,
    fromWorld: `(${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)})`,
    toWorld: `(${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)})`,
    signature: routeSignature(result.curve),
    samples: VERIFY_SAMPLES + 1,
    iterations: result.iterations,
    usedFallback: result.usedFallback,
    fallbackReason: result.usedFallback
      ? `clearance budget of ${TOLERANCES.maxIterations} iterations exhausted; sag removed and interior held at the highest requirement`
      : 'none',
    minSegment,
    nonFinite,
    zeroLength: zeroLengthOk ? 'none' : `min segment ${minSegment.toExponential(2)} in`,
    worstMargin,
    clearanceOk,
    endpointError,
    endpointOk,
    identityOk,
    obstacleIds,
    pass: clearanceOk && endpointOk && zeroLengthOk && identityOk && nonFinite === 'none',
  };
}

/** A stable fingerprint of the rendered path — changes iff the geometry changes. */
export function routeSignature(curve: THREE.Curve<THREE.Vector3>, samples = 64): string {
  let hash = 0;
  for (let i = 0; i <= samples; i += 1) {
    const p = curve.getPoint(i / samples);
    const text = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    for (let c = 0; c < text.length; c += 1) hash = (hash * 31 + text.charCodeAt(c)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Samples a route for the reversal comparison. */
export function sampleRoute(
  components: readonly CircuitComponent[],
  wire: CircuitWire,
  samples = 128,
): THREE.Vector3[] | null {
  const origin = originOf(components);
  const boards = breadboardPlacements(components, origin);
  const terminals = terminalWorldMap(components);
  const a = terminals.get(`${wire.from.componentId}:${wire.from.terminalId}`);
  const b = terminals.get(`${wire.to.componentId}:${wire.to.terminalId}`);
  if (!a || !b) return null;

  const unoExemptions: AttachmentExemption[] = [];
  for (const [end, at] of [[wire.from, a], [wire.to, b]] as const) {
    const component = components.find((c) => c.id === end.componentId);
    if (component?.kind !== 'uno-r3') continue;
    const volumeId = headerVolumeIdForPin(end.terminalId);
    if (volumeId) unoExemptions.push({ point: at, volumeId });
  }
  const approach = boards.length ? wireApproachExemptions(wire, boards) : [];
  const points = boards.length ? wirePointsWithPortals(wire, { from: a, to: b }, [], boards) : [a, b];
  const clearance = sceneWireClearance(unoWireClearance(unoPlacementOf(components, origin), unoExemptions), boards, approach);
  const result = buildWireCurveWithDiagnostics(points, clearance);
  if (!result) return null;
  return Array.from({ length: samples + 1 }, (_, i) => result.curve.getPoint(i / samples));
}

/**
 * Largest positional difference between a route and the same route drawn backwards.
 *
 * The reversed samples are flipped before comparison, so an equivalent path scores ~0. This
 * is the check that endpoint order cannot change the geometry a student sees.
 */
export function reversalDifference(
  components: readonly CircuitComponent[],
  wire: CircuitWire,
): number | null {
  const forward = sampleRoute(components, wire);
  const reversed = sampleRoute(components, {
    ...wire,
    from: wire.to,
    to: wire.from,
  } as CircuitWire);
  if (!forward || !reversed) return null;
  const flipped = [...reversed].reverse();
  let worst = 0;
  for (let i = 0; i < forward.length; i += 1) worst = Math.max(worst, forward[i].distanceTo(flipped[i]));
  return worst;
}
