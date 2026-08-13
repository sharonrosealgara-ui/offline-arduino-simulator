/**
 * What the 3D scene needs to know about the breadboards in a circuit.
 *
 * `DynamicNetlist3D` already does four things per frame: place terminals, build a clearance
 * context, route wires, and render parts. A breadboard changes the answer to each of them,
 * and doing that inline would bury four unrelated special cases in a component that is
 * already long. This module answers them as pure functions instead, so they can be tested
 * without a scene and the renderer keeps one line per concern.
 *
 * Nothing here is a second router or a second source of geometry. Anchors and portals come
 * from `breadboard-obstacles.ts`, clearance composes the existing Phase B contexts, and the
 * route is still built by `buildWireCurve`.
 */
import * as THREE from 'three';
import type { CircuitComponent, CircuitWire, TerminalRef } from '@offline-arduino/contracts/circuit';
import { SCHEMATIC_UNIT_INCHES } from './geometry-units';
import { breadboardHoleInstances } from './breadboard-3d-geometry';
import {
  breadboardHoleAttachment,
  breadboardWireClearance,
  compositeWireClearance,
  ownedApproachExemption,
  type BreadboardObstaclePlacement,
  type OwnedApproachExemption,
} from './breadboard-obstacles';
import type { WireClearanceContextLike } from './scene-obstacles';

/** Every breadboard in the circuit, placed in scene coordinates. */
export function breadboardPlacements(
  components: readonly CircuitComponent[],
  origin: { x: number; y: number },
): BreadboardObstaclePlacement[] {
  return components
    .filter((c) => c.kind === 'breadboard')
    .map((c) => ({
      componentId: c.id,
      x: (c.x - origin.x) * SCHEMATIC_UNIT_INCHES,
      z: (c.y - origin.y) * SCHEMATIC_UNIT_INCHES,
      rotationDegrees: c.rotation,
    }));
}

/**
 * Scene positions for every hole of every breadboard, keyed `componentId:terminalId`.
 *
 * Merged into the renderer's existing terminal map rather than replacing it: a breadboard
 * hole is an ordinary wire endpoint, and the rest of the scene should not have to know which
 * kind of terminal it is holding.
 */
export function breadboardTerminalPositions(
  placements: readonly BreadboardObstaclePlacement[],
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  for (const placement of placements) {
    for (const hole of breadboardHoleInstances()) {
      const attachment = breadboardHoleAttachment(placement.componentId, hole.id, placement);
      if (attachment) positions.set(`${placement.componentId}:${hole.id}`, attachment.anchor);
    }
  }
  return positions;
}

/** The placement a terminal belongs to, or undefined when it is not a breadboard hole. */
export function placementFor(
  ref: TerminalRef,
  placements: readonly BreadboardObstaclePlacement[],
): BreadboardObstaclePlacement | undefined {
  return placements.find((p) => p.componentId === ref.componentId);
}

/**
 * The full point list for one wire: exact anchors with a portal inside each breadboard end.
 *
 * anchor → portal → (global route) → portal → anchor. The portals are what let the router
 * treat the middle of the wire as an ordinary span while each end still terminates in the
 * opening the student chose. An end that is not a breadboard hole contributes its anchor
 * alone, exactly as before.
 */
export function wirePointsWithPortals(
  wire: Pick<CircuitWire, 'from' | 'to'>,
  ends: { from: THREE.Vector3; to: THREE.Vector3 },
  interior: readonly THREE.Vector3[],
  placements: readonly BreadboardObstaclePlacement[],
): THREE.Vector3[] {
  const lead = (ref: TerminalRef, anchor: THREE.Vector3): THREE.Vector3[] => {
    const placement = placementFor(ref, placements);
    if (!placement) return [anchor];
    const attachment = breadboardHoleAttachment(ref.componentId, ref.terminalId, placement);
    return attachment ? [attachment.anchor, attachment.portal] : [anchor];
  };

  const from = lead(wire.from, ends.from);
  const to = lead(wire.to, ends.to);
  return [...from, ...interior, ...to.slice().reverse()];
}

/**
 * The exemptions one wire's endpoints are entitled to.
 *
 * Only an end that is genuinely a hole on a genuinely present board earns one, and it names
 * only that board's own volume. Reversing the endpoints produces the same set, so which end
 * was drawn first cannot change what the route is allowed to pass through.
 */
export function wireApproachExemptions(
  wire: Pick<CircuitWire, 'from' | 'to'>,
  placements: readonly BreadboardObstaclePlacement[],
): OwnedApproachExemption[] {
  const exemptions: OwnedApproachExemption[] = [];
  for (const ref of [wire.from, wire.to]) {
    const placement = placementFor(ref, placements);
    if (!placement) continue;
    const exemption = ownedApproachExemption(ref.componentId, ref.terminalId, placement);
    if (exemption) exemptions.push(exemption);
  }
  return exemptions;
}

/**
 * The clearance context for one wire: the Uno's rule plus every breadboard's.
 *
 * Each board is given only the exemptions belonging to it, which is what stops one endpoint
 * borrowing the other's licence when both ends are on different boards.
 */
export function sceneWireClearance(
  unoClearance: WireClearanceContextLike,
  placements: readonly BreadboardObstaclePlacement[],
  exemptions: readonly OwnedApproachExemption[],
): WireClearanceContextLike {
  return compositeWireClearance([
    unoClearance,
    ...placements.map((placement) =>
      breadboardWireClearance(
        placement,
        exemptions.filter((e) => e.volumeId.startsWith(`${placement.componentId}:`)),
      ),
    ),
  ]);
}
