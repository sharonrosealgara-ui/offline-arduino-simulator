/**
 * Where a breadboard's 400 holes sit in the 3D scene, and which instance is which hole.
 *
 * Everything is COMPUTED from the canonical model in `@offline-arduino/contracts/breadboard`
 * through the shared unit conversion. There is no second hole table, no separate 3D ordering
 * and no hand-maintained instance map: instance *i* is canonical hole *i*, which is what
 * makes `instanceId` → `terminalId` a lookup rather than a bookkeeping exercise that can
 * drift from the 2D view.
 *
 * The whole module is pure. Instanced rendering is the reason it exists — 400 separate
 * meshes would be 400 draw calls for a part that is one object — and an InstancedMesh hands
 * back nothing but an integer on a click, so the integer has to mean something reliable.
 *
 * SCENE CONVENTIONS, matching the rest of the workspace:
 *   world unit = 1 inch; schematic x → world x; schematic y → world **z**; +y is up.
 * Rotation follows the existing component transform, including the negated yaw that
 * `componentYawRadians` applies because Object3D turns +X toward −Z while the schematic
 * turns +X toward +Y.
 *
 * IDENTITY. A terminal is `componentId:terminalId` and nothing here resolves one without
 * both. `A1` is a hole, the Uno's analog pin 1, and a different hole on a second board;
 * `D13` is a hole and the Uno's digital pin 13.
 *
 * VISUAL APPROXIMATIONS — body thickness above the bench, opening diameter and depth, edge
 * bevel, channel appearance, markings, rail decoration and every material property are this
 * project's design choices. The canonical contract supplies the pitch, the hole count, the
 * group topology and the body envelope; nothing else in here is a manufacturer measurement.
 * See `vendor/licenses/app-3d-assets/BREADBOARD_GEOMETRY_SOURCES.md`.
 */
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import type { TerminalRef } from '@offline-arduino/contracts/circuit';
import { mmToWorld, schematicToWorld } from './geometry-units';
import { componentYawRadians } from './component-bounds';
import { BENCH_SURFACE_Y } from './scene-layout';

/** A hole as one instance of the shared opening geometry, in the board's own frame. */
export interface BreadboardHoleInstance {
  /** Instance index — identical to canonical order. */
  index: number;
  id: string;
  groupId: string;
  /** Local world inches along the board's length. */
  x: number;
  /** Local world inches across the board's depth (scene z before rotation). */
  z: number;
}

/** Where a breadboard sits in the scene. Mirrors the placement every other part uses. */
export interface BreadboardPlacement {
  /** Schematic position, as stored in the project. */
  x: number;
  y: number;
  rotation: number;
}

let cached: readonly BreadboardHoleInstance[] | null = null;

/**
 * All 400 holes, in canonical order, as instance data.
 *
 * Built once and shared read-only. The order is the contract: it is what lets a click on
 * instance 137 be answered without storing a map alongside the mesh.
 */
export function breadboardHoleInstances(): readonly BreadboardHoleInstance[] {
  if (cached) return cached;
  cached = createBreadboardModel().holes.map((hole, index) => ({
    index,
    id: hole.id,
    groupId: hole.groupId,
    x: mmToWorld(hole.x),
    z: mmToWorld(hole.y),
  }));
  return cached;
}

/** How many instances the renderer must draw. Always the canonical hole count. */
export function breadboardInstanceCount(): number {
  return breadboardHoleInstances().length;
}

/** The body, in world inches. Width and depth are documented; height is an approximation. */
export function breadboardBody3D(): { width: number; depth: number; height: number } {
  const { body } = createBreadboardModel();
  return {
    width: mmToWorld(body.lengthMm),
    depth: mmToWorld(body.depthMm),
    height: mmToWorld(body.heightMm),
  };
}

/** Height of the board's top face above the scene origin — where the openings are cut. */
export function breadboardTopY(): number {
  return BENCH_SURFACE_Y + breadboardBody3D().height;
}

/** APPROXIMATION — how far an opening is recessed into the top face. */
export const HOLE_OPENING_DEPTH = mmToWorld(1.2);
/** APPROXIMATION — square opening across the flats, sized around the documented 0.4–0.7 mm wire. */
export const HOLE_OPENING_SIZE = mmToWorld(1.4);
/** APPROXIMATION — visible width of the centre channel. NOT the E-to-F hole-centre distance. */
export const CHANNEL_VISIBLE_WIDTH = mmToWorld(3.6);

/** The canonical terminal id for an instance index, or undefined when out of range. */
export function instanceTerminalId(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  return breadboardHoleInstances()[index]?.id;
}

/** The instance index for a canonical terminal id, or undefined when it is not a hole. */
export function terminalInstanceIndex(terminalId: string): number | undefined {
  const hole = breadboardHoleInstances().find((h) => h.id === terminalId);
  return hole?.index;
}

/**
 * The qualified terminal a picked instance means.
 *
 * Returns null for anything out of range, non-integer or missing rather than guessing —
 * an InstancedMesh reports `undefined` for a miss, and answering that with "the nearest
 * hole" would wire up a hole nobody aimed at.
 */
export function resolveInstanceTerminal(
  componentId: string,
  instanceId: number | undefined | null,
): TerminalRef | null {
  if (instanceId === undefined || instanceId === null) return null;
  const terminalId = instanceTerminalId(instanceId);
  if (!terminalId) return null;
  return { componentId, terminalId };
}

/**
 * Where a hole is in world space, given the board's placement.
 *
 * Uses the same origin-relative convention as `terminalScenePosition`, so a breadboard hole
 * and an Uno pin are positioned by the same rule rather than by two rules that agree today.
 */
export function breadboardHoleWorldPosition(
  terminalId: string,
  placement: BreadboardPlacement,
  origin: { x: number; y: number },
): { x: number; y: number; z: number } | undefined {
  const hole = breadboardHoleInstances().find((h) => h.id === terminalId);
  if (!hole) return undefined;

  const yaw = componentYawRadians(placement.rotation);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Object3D yaw turns +X toward -Z, which is what the negated angle above already encodes.
  const rotatedX = hole.x * cos + hole.z * sin;
  const rotatedZ = -hole.x * sin + hole.z * cos;

  return {
    x: schematicToWorld(placement.x - origin.x) + rotatedX,
    y: breadboardTopY(),
    z: schematicToWorld(placement.y - origin.y) + rotatedZ,
  };
}

/**
 * The cue a hole should show.
 *
 * Extracted from the renderer so the precedence is testable without WebGL, and so it is
 * stated once: the hole under the pointer wins over everything, an occupied hole reads as
 * occupied even when it is part of the highlighted group, and the group ring is the weakest
 * of the three. Reversing any of those would tell a student the wrong thing at the moment
 * they are deciding where to put a wire.
 *
 * Each state gets its own geometry in the renderer as well as its own colour, so the board
 * is readable in greyscale.
 */
export type BreadboardHoleState = 'current' | 'occupied' | 'connected' | 'idle';

export function holeVisualState(
  holeId: string,
  view: { currentHoleId?: string | null; occupied?: ReadonlySet<string>; connected?: ReadonlySet<string> },
): BreadboardHoleState {
  if (view.currentHoleId === holeId) return 'current';
  if (view.occupied?.has(holeId)) return 'occupied';
  if (view.connected?.has(holeId)) return 'connected';
  return 'idle';
}

/** The board group's own scene position and yaw, for the renderer to apply once. */
export function breadboardGroupTransform(
  placement: BreadboardPlacement,
  origin: { x: number; y: number },
): { position: [number, number, number]; rotationY: number } {
  return {
    position: [
      schematicToWorld(placement.x - origin.x),
      BENCH_SURFACE_Y,
      schematicToWorld(placement.y - origin.y),
    ],
    rotationY: componentYawRadians(placement.rotation),
  };
}
