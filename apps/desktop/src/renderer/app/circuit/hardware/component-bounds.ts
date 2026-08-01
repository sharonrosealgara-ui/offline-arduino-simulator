/**
 * Everything derived from the physical table plus the registry's terminal anchors.
 *
 * Nothing here is stored. Body placement, footprint, selection bounds, label position and
 * conductor attachment are all computed, every time, from two inputs: the millimetre
 * dimensions in component-geometry.ts and the anchor coordinates in component-registry.ts.
 * That is what stops a resized body from drifting off its own pins.
 *
 * Coordinates are in the component's LOCAL frame, before rotation and before the component
 * is placed — callers apply the canonical rotation and offset themselves.
 */
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { componentPhysical, type ComponentPhysical } from './component-geometry';
import { mmToSchematic, mmToWorld, schematicToMm, schematicToWorld } from './geometry-units';

/** A registry terminal, reduced to what geometry needs. Anchors are in schematic units. */
export interface TerminalAnchor {
  id: string;
  x: number;
  y: number;
}

export interface BoundsMm {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const boundsWidth = (b: BoundsMm): number => b.maxX - b.minX;
export const boundsDepth = (b: BoundsMm): number => b.maxZ - b.minZ;
export const boundsCenter = (b: BoundsMm): { x: number; z: number } => ({
  x: (b.minX + b.maxX) / 2,
  z: (b.minZ + b.maxZ) / 2,
});

/** Centroid of a component's anchors, in millimetres. */
export function anchorCentroidMm(terminals: readonly TerminalAnchor[]): { x: number; z: number } {
  if (terminals.length === 0) return { x: 0, z: 0 };
  const sx = terminals.reduce((total, t) => total + t.x, 0) / terminals.length;
  const sy = terminals.reduce((total, t) => total + t.y, 0) / terminals.length;
  return { x: schematicToMm(sx), z: schematicToMm(sy) };
}

/**
 * Where the body sits, in millimetres.
 *
 * With `bodyOffset: null` the body centres on the terminal group, which is what keeps a
 * part attached to its own pins when B6 moves them.
 */
export function bodyCenterMm(
  physical: ComponentPhysical,
  terminals: readonly TerminalAnchor[],
): { x: number; z: number } {
  const centroid = anchorCentroidMm(terminals);
  const offset = physical.bodyOffset ?? { x: 0, z: 0 };
  return { x: centroid.x + offset.x, z: centroid.z + offset.z };
}

export function bodyBoundsMm(kind: ComponentKind, terminals: readonly TerminalAnchor[]): BoundsMm | undefined {
  const physical = componentPhysical(kind);
  if (!physical) return undefined;
  const c = bodyCenterMm(physical, terminals);
  return {
    minX: c.x - physical.body.width / 2,
    maxX: c.x + physical.body.width / 2,
    minZ: c.z - physical.body.depth / 2,
    maxZ: c.z + physical.body.depth / 2,
  };
}

/**
 * The complete footprint: the body plus every conductor endpoint.
 *
 * This — not the body — is what a terminal must lie within. Real parts have leads outside
 * their bodies: a formed resistor's leads reach past the ceramic, a tactile switch's legs
 * splay past the case, an LCD's header sits proud of the board edge, and a servo's plug is
 * on the end of a cable. A test that demanded anchors sit inside the *body* would be
 * demanding the parts be drawn wrong.
 */
export function footprintBoundsMm(kind: ComponentKind, terminals: readonly TerminalAnchor[]): BoundsMm | undefined {
  const body = bodyBoundsMm(kind, terminals);
  if (!body) return undefined;
  const bounds = { ...body };
  for (const t of terminals) {
    const x = schematicToMm(t.x);
    const z = schematicToMm(t.y);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

/** Footprint plus the component's selection padding, floored at its minimum size. */
export function selectionBoundsMm(
  kind: ComponentKind,
  terminals: readonly TerminalAnchor[],
): BoundsMm | undefined {
  const physical = componentPhysical(kind);
  const footprint = footprintBoundsMm(kind, terminals);
  if (!physical || !footprint) return undefined;
  const pad = physical.selection.paddingMm;
  const padded = {
    minX: footprint.minX - pad,
    maxX: footprint.maxX + pad,
    minZ: footprint.minZ - pad,
    maxZ: footprint.maxZ + pad,
  };
  // A minimum keeps a 2.4 mm-thin resistor clickable without restating its body size.
  const min = physical.selection.minSizeMm;
  const c = boundsCenter(padded);
  const halfW = Math.max(boundsWidth(padded) / 2, min / 2);
  const halfD = Math.max(boundsDepth(padded) / 2, min / 2);
  return { minX: c.x - halfW, maxX: c.x + halfW, minZ: c.z - halfD, maxZ: c.z + halfD };
}

/** Label baseline, in schematic units, below the selection bounds. */
export function labelOffsetSchematic(
  kind: ComponentKind,
  terminals: readonly TerminalAnchor[],
): { x: number; y: number } | undefined {
  const physical = componentPhysical(kind);
  const selection = selectionBoundsMm(kind, terminals);
  if (!physical || !selection) return undefined;
  return {
    x: mmToSchematic(boundsCenter(selection).x),
    y: mmToSchematic(selection.maxZ + physical.label.gapMm),
  };
}

/** Width ÷ height of the footprint, for fitting a thumbnail into its icon box. */
export function footprintAspect(kind: ComponentKind, terminals: readonly TerminalAnchor[]): number {
  const f = footprintBoundsMm(kind, terminals);
  if (!f) return 1;
  const w = boundsWidth(f);
  const d = boundsDepth(f);
  return d === 0 ? 1 : w / d;
}

/**
 * Where a conductor meets the part, in millimetres — derived, never stored.
 *
 * 'down'    the lead drops from the body's underside; the attachment is the anchor's own
 *           (x, z) pulled onto the body footprint, so a leg outside the body slopes in to
 *           meet it rather than floating.
 * 'pigtail' the cable leaves a side face; the attachment is the point on the body edge
 *           nearest the terminal group, so the lead always exits toward its own plug.
 */
export function conductorAttachmentMm(
  kind: ComponentKind,
  terminalId: string,
  terminals: readonly TerminalAnchor[],
): { x: number; z: number; y: number } | undefined {
  const physical = componentPhysical(kind);
  const body = bodyBoundsMm(kind, terminals);
  const terminal = terminals.find((t) => t.id === terminalId);
  if (!physical || !body || !terminal) return undefined;

  const style = physical.conductors[terminalId];
  const anchorX = schematicToMm(terminal.x);
  const anchorZ = schematicToMm(terminal.y);

  if (style?.exit === 'pigtail') {
    const group = anchorCentroidMm(terminals);
    const c = boundsCenter(body);
    // Leave through whichever face the plug is on.
    const dx = group.x - c.x;
    const dz = group.z - c.z;
    const useX = Math.abs(dx) >= Math.abs(dz);
    return {
      x: useX ? (dx >= 0 ? body.maxX : body.minX) : clamp(anchorX, body.minX, body.maxX),
      z: useX ? clamp(anchorZ, body.minZ, body.maxZ) : dz >= 0 ? body.maxZ : body.minZ,
      y: physical.standoff + physical.features.caseHeight / 2,
    };
  }

  return {
    x: clamp(anchorX, body.minX, body.maxX),
    z: clamp(anchorZ, body.minZ, body.maxZ),
    y: physical.standoff,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------------------
// Where a wire meets a part
// ---------------------------------------------------------------------------------------

/**
 * The canonical schematic rotation: +X turns toward +Y.
 *
 * Exported so the wiring layer, the drawing layer and the tests all turn a point the same
 * way instead of each carrying its own copy of the formula.
 */
export function rotateSchematic(x: number, y: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * The yaw a component's 3D group is given, in radians.
 *
 * Negated on purpose: `Object3D.rotation.y` turns +X toward −Z, while the schematic turns
 * +X toward +Y, which maps to +Z. Without the negation a rotated part's body turns one way
 * and its anchors the other.
 */
export function componentYawRadians(rotationDegrees: number): number {
  return (-rotationDegrees * Math.PI) / 180;
}

/**
 * The point on a terminal's conductor where a wire connects, in local millimetres.
 *
 * This is the fix for wires ending in midair. Wire endpoints used to sit at a fixed height
 * above the bench (WIRE_LIFT) while the conductors drawn for each part start at the anchor
 * at bench level, so every wire stopped 3.56 mm short of the lead it was supposed to meet —
 * at every rotation, on every component. The height has to come from the part, not from a
 * constant, because each part holds its leads at its own height.
 *
 *  - a leg or lead ('down') is met at its upper end, where it enters the body: the exact
 *    point `conductorAttachmentMm` returns, so the two coincide by construction;
 *  - a flying lead ('pigtail') is met at its plug, which sits on the anchor itself — a servo
 *    is wired at the connector, not up on the case the cable runs to.
 */
export function terminalConnectionPointMm(
  kind: ComponentKind,
  terminalId: string,
  terminals: readonly TerminalAnchor[],
): { x: number; z: number; y: number } | undefined {
  const physical = componentPhysical(kind);
  const terminal = terminals.find((t) => t.id === terminalId);
  if (!physical || !terminal) return undefined;

  if (physical.conductors[terminalId]?.exit === 'pigtail') {
    return {
      x: schematicToMm(terminal.x),
      z: schematicToMm(terminal.y),
      y: physical.features.connectorHeight / 2,
    };
  }
  return conductorAttachmentMm(kind, terminalId, terminals);
}

/** A component placed in the scene: what the wiring layer needs to position its terminals. */
export interface PlacedComponent {
  kind: ComponentKind;
  /** Schematic position. */
  x: number;
  y: number;
  rotation: number;
}

/**
 * Where a wire must end, in world inches relative to the scene origin.
 *
 * The single production answer to "where is this terminal in 3D", used for wire endpoints
 * and for the clickable anchor, so the two cannot disagree.
 */
export function terminalScenePosition(
  component: PlacedComponent,
  terminalId: string,
  terminals: readonly TerminalAnchor[],
  origin: { x: number; y: number },
): { x: number; y: number; z: number } | undefined {
  const local = terminalConnectionPointMm(component.kind, terminalId, terminals);
  if (!local) return undefined;
  const rotated = rotateSchematic(mmToSchematic(local.x), mmToSchematic(local.z), component.rotation);
  return {
    x: schematicToWorld(component.x - origin.x + rotated.x),
    y: mmToWorld(local.y),
    z: schematicToWorld(component.y - origin.y + rotated.y),
  };
}
