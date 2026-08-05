/**
 * The breadboard as something a wire must go around, and the exact points a wire may enter.
 *
 * This is the C4 safety foundation. Phase B already knows how to keep a wire off the bench
 * and off the Uno: `ObstacleVolume` describes a solid, `requiredWireCentreYAt` turns a point
 * into a minimum wire-centre height, and `WireClearanceContext` hands that to the router.
 * Nothing here replaces any of it — a breadboard becomes another source of the same kind of
 * volume, and `compositeWireClearance` combines sources by taking the greatest requirement,
 * which is the only combination that cannot weaken an existing guarantee.
 *
 * ONE VOLUME PER BOARD. The body is a rectangular slab, so its exact conservative union is a
 * single box. The centre channel is a recess in the top face, not a hole through the board,
 * and modelling it as open would invite a route to tunnel through solid plastic. Rail
 * stripes and printed markings are paint and are not obstacles at all. The count is one, and
 * it stays one whether the board has 400 holes or 4000.
 *
 * ANCHORS ARE PER HOLE, NEVER PER GROUP. `A5` and `B5` are the same electrical node and two
 * different physical places. A wire drawn to the centre of a group, a strip or the board
 * would be a wire that does not go where the student put it.
 *
 * OWNERSHIP. Every volume id is qualified with the component instance — `bb1:body`, not
 * `body` — so an exemption granted at one board's hole can never apply to another board, to
 * the Uno, or to an ordinary component.
 *
 * APPROXIMATIONS. The body's *height* is the C3 visual thickness, and the portal height is
 * derived from the Phase B wire radius and clearance epsilon by name. The footprint is
 * canonical. Nothing here is written into a project file.
 */
import * as THREE from 'three';
import { mmToWorld } from './geometry-units';
import { BENCH_SURFACE_Y } from './scene-layout';
import { WIRE_CLEARANCE_EPSILON, WIRE_MIN_CENTRE_Y, WIRE_RADIUS_SELECTED } from './wire-path';
import {
  OBSTACLE_FOOTPRINT_INFLATION,
  type ObstacleVolume,
  type WireClearanceContextLike,
} from './scene-obstacles';
import { breadboardBody3D, breadboardHoleInstances } from './breadboard-3d-geometry';

/** Where a breadboard instance sits in the scene, and which instance it is. */
export interface BreadboardObstaclePlacement {
  /** The component instance — what makes an obstacle and an exemption ownable. */
  componentId: string;
  /** World inches, the board's centre. */
  x: number;
  z: number;
  rotationDegrees: number;
}

/** The one volume id a board owns. Qualified, so `bb1` and `bb2` never collide. */
export function breadboardBodyVolumeId(componentId: string): string {
  return `${componentId}:body`;
}

/** How many obstacle volumes one breadboard contributes. Constant, and flat in hole count. */
export const BREADBOARD_OBSTACLE_COUNT_PER_BOARD = 1;

/**
 * The board's solid, in its own local frame.
 *
 * Footprint is canonical (84 x 54.3 mm). The top is the C3 visual body thickness above the
 * bench — an approximation, named as one.
 */
export function breadboardObstacleVolumes(componentId: string): readonly ObstacleVolume[] {
  const body = breadboardBody3D();
  return [
    {
      id: breadboardBodyVolumeId(componentId),
      minX: -body.width / 2,
      maxX: body.width / 2,
      minZ: -body.depth / 2,
      maxZ: body.depth / 2,
      top: BENCH_SURFACE_Y + body.height,
    },
  ];
}

/** Turns a scene point into one board's local frame — the inverse of its placement. */
export function toBreadboardLocal(
  point: { x: number; z: number },
  placement: BreadboardObstaclePlacement,
): { x: number; z: number } {
  const radians = (placement.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - placement.x;
  const dz = point.z - placement.z;
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
}

// ---------------------------------------------------------------------------------------
// Anchors and portals
// ---------------------------------------------------------------------------------------

/**
 * Extra height above the board a wire must reach before it is clear of the body.
 *
 * Derived from the Phase B rules by name rather than chosen: the tube's own radius plus the
 * clearance epsilon is exactly what `requiredWireCentreYAt` demands above any solid, and one
 * further epsilon keeps the portal strictly above the threshold rather than exactly on it,
 * where floating-point comparison is a coin toss.
 */
export const PORTAL_CLEARANCE_ABOVE_BODY = WIRE_RADIUS_SELECTED + 2 * WIRE_CLEARANCE_EPSILON;

/** The exact attachment point and the safe point above it, for one qualified hole. */
export interface HoleAttachment {
  componentId: string;
  terminalId: string;
  /** Where the wire visually terminates: the opening itself. */
  anchor: THREE.Vector3;
  /** The first point clear of this board's body. */
  portal: THREE.Vector3;
}

/**
 * The anchor and portal for one hole on one board.
 *
 * Requires BOTH ids. A bare terminal id cannot identify a terminal: `A1` and `D13` are holes
 * and Uno pin names, and every board has its own `A1`.
 */
export function breadboardHoleAttachment(
  componentId: string,
  terminalId: string,
  placement: BreadboardObstaclePlacement,
): HoleAttachment | undefined {
  if (placement.componentId !== componentId) return undefined;
  const hole = breadboardHoleInstances().find((h) => h.id === terminalId);
  if (!hole) return undefined;

  const radians = (placement.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const worldX = placement.x + hole.x * cos - hole.z * sin;
  const worldZ = placement.z + hole.x * sin + hole.z * cos;

  const body = breadboardBody3D();
  const surfaceY = BENCH_SURFACE_Y + body.height;

  return {
    componentId,
    terminalId,
    anchor: new THREE.Vector3(worldX, surfaceY, worldZ),
    portal: new THREE.Vector3(worldX, surfaceY + PORTAL_CLEARANCE_ABOVE_BODY, worldZ),
  };
}

/**
 * The exemption an endpoint's approach segment needs, and nothing more.
 *
 * A wire ending in a hole is inside that board's body by definition — that is what a hole is.
 * So the anchor-to-portal segment is exempt from ONE volume: the body of the board the hole
 * belongs to. It is never exempt from another board, from the Uno, from an ordinary
 * component, or from its own board once it is past the portal.
 *
 * The radius is the portal height plus one pitch of slack, which bounds the exemption to the
 * immediate neighbourhood of the opening rather than to the board.
 */
export const APPROACH_EXEMPTION_RADIUS = PORTAL_CLEARANCE_ABOVE_BODY + mmToWorld(2.54);

export interface OwnedApproachExemption {
  /** The exact anchor the exemption is centred on. */
  point: THREE.Vector3;
  /** The one qualified volume it applies to. */
  volumeId: string;
  radius: number;
}

/** The exemption for one qualified hole, or undefined when the hole is not on that board. */
export function ownedApproachExemption(
  componentId: string,
  terminalId: string,
  placement: BreadboardObstaclePlacement,
): OwnedApproachExemption | undefined {
  const attachment = breadboardHoleAttachment(componentId, terminalId, placement);
  if (!attachment) return undefined;
  return {
    point: attachment.anchor,
    volumeId: breadboardBodyVolumeId(componentId),
    radius: APPROACH_EXEMPTION_RADIUS,
  };
}

// ---------------------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------------------

/**
 * The minimum wire-centre height one breadboard demands at a point.
 *
 * Same shape as the Uno's rule and the same inflation: the footprint grows by the tube's
 * radius plus epsilon so a wire's flank clears an edge it merely grazes, not just its
 * centreline.
 */
export function breadboardRequiredCentreYAt(
  point: THREE.Vector3,
  placement: BreadboardObstaclePlacement,
  exemptions: readonly OwnedApproachExemption[] = [],
): number {
  let required = WIRE_MIN_CENTRE_Y;
  const local = toBreadboardLocal(point, placement);

  for (const volume of breadboardObstacleVolumes(placement.componentId)) {
    if (
      local.x < volume.minX - OBSTACLE_FOOTPRINT_INFLATION ||
      local.x > volume.maxX + OBSTACLE_FOOTPRINT_INFLATION ||
      local.z < volume.minZ - OBSTACLE_FOOTPRINT_INFLATION ||
      local.z > volume.maxZ + OBSTACLE_FOOTPRINT_INFLATION
    ) {
      continue;
    }

    // Only an exemption naming THIS board's volume, within its bounded radius, applies.
    const exempt = exemptions.some(
      (e) => e.volumeId === volume.id && point.distanceTo(e.point) <= e.radius,
    );
    if (exempt) continue;

    required = Math.max(required, volume.top + WIRE_RADIUS_SELECTED + WIRE_CLEARANCE_EPSILON);
  }

  return required;
}

/** One breadboard's clearance rule, ready for the router. */
export function breadboardWireClearance(
  placement: BreadboardObstaclePlacement,
  exemptions: readonly OwnedApproachExemption[] = [],
): WireClearanceContextLike {
  return { requiredCentreYAt: (point) => breadboardRequiredCentreYAt(point, placement, exemptions) };
}

/**
 * Several clearance sources as one.
 *
 * The greatest requirement wins, which is the only way to combine them that cannot weaken a
 * guarantee: adding a breadboard can raise the height a wire must fly at, never lower it, so
 * the Phase B bench and Uno results are preserved by construction.
 */
export function compositeWireClearance(
  sources: readonly WireClearanceContextLike[],
): WireClearanceContextLike {
  return {
    requiredCentreYAt(point) {
      let required = WIRE_MIN_CENTRE_Y;
      for (const source of sources) required = Math.max(required, source.requiredCentreYAt(point));
      return required;
    },
  };
}
