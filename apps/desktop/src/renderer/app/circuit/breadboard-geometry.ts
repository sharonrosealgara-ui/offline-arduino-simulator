/**
 * Where a breadboard's holes are on the 2D canvas, and which one a click or an arrow key
 * means.
 *
 * Every position here is COMPUTED from the canonical model in
 * `@offline-arduino/contracts/breadboard` through the shared millimetre-to-schematic
 * conversion. There is no second hole list, no second topology table, and no separate set of
 * coordinates for the pointer, the keyboard or a future 3D view — one generator feeds all of
 * them, so they cannot disagree about where `E14` is.
 *
 * Nothing in this file is stored in a project. A project holds the breadboard's position and
 * rotation, exactly as it does for every other component; hole positions are derived on
 * demand from that plus the canonical model.
 *
 * Identity is always `componentId:terminalId`. Bare hole ids are NOT globally unique — `A1`
 * is both a hole on this board and the Uno's analog pin 1, and two breadboards each have
 * their own `A1`. Nothing here resolves a terminal without being told which component it
 * belongs to.
 */
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import { mmToSchematicUnits } from '@offline-arduino/contracts/units';
import { rotateSchematic } from './hardware/component-bounds';

/** A hole placed in the board's own frame, in schematic units (1 unit = 0.01 in). */
export interface BreadboardHolePoint {
  id: string;
  groupId: string;
  /** Local X, before the component's position and rotation. */
  x: number;
  /** Local Y, before the component's position and rotation. */
  y: number;
  /** Position in canonical generation order — the deterministic tie-break. */
  order: number;
}

/** The board's own extent in schematic units. */
export interface BreadboardBodyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let cachedHoles: BreadboardHolePoint[] | null = null;

/**
 * All 400 holes in local schematic units.
 *
 * Computed once and shared read-only. The canonical model is regenerated per call by design,
 * and paying for 400 conversions on every pointer move would be wasteful; the array is never
 * handed out in a form callers are expected to mutate.
 */
export function breadboardHolePoints(): readonly BreadboardHolePoint[] {
  if (cachedHoles) return cachedHoles;
  cachedHoles = createBreadboardModel().holes.map((hole, index) => ({
    id: hole.id,
    groupId: hole.groupId,
    x: mmToSchematicUnits(hole.x),
    y: mmToSchematicUnits(hole.y),
    order: index,
  }));
  return cachedHoles;
}

/** The documented body envelope, converted — centred on the component's origin. */
export function breadboardBodyRect(): BreadboardBodyRect {
  const { body } = createBreadboardModel();
  const w = mmToSchematicUnits(body.lengthMm);
  const h = mmToSchematicUnits(body.depthMm);
  return { x: -w / 2, y: -h / 2, w, h };
}

/** Hole pitch in schematic units — 2.54 mm is exactly 10. */
export const HOLE_PITCH_UNITS = mmToSchematicUnits(2.54);

/**
 * How far from a hole's centre a click still counts as that hole.
 *
 * Deliberately well under half the pitch. At 4 units the capture circles are 8 units across
 * and 10 apart, so adjacent regions never overlap and a 2-unit band between them belongs to
 * no hole at all. That gap is the point: a board that always snapped to the nearest hole
 * would silently attach a wire to a hole the student never aimed at, and there would be no
 * way to express "I missed".
 */
export const HOLE_CAPTURE_RADIUS_UNITS = 4;

/** Board-local point for a canvas point, undoing the component's position and rotation. */
export function toBoardLocal(
  point: { x: number; y: number },
  component: { x: number; y: number; rotation: number },
): { x: number; y: number } {
  return rotateSchematic(point.x - component.x, point.y - component.y, -component.rotation);
}

/** Canvas point for a board-local point — the exact inverse of `toBoardLocal`. */
export function toCanvas(
  local: { x: number; y: number },
  component: { x: number; y: number; rotation: number },
): { x: number; y: number } {
  const rotated = rotateSchematic(local.x, local.y, component.rotation);
  return { x: component.x + rotated.x, y: component.y + rotated.y };
}

/** Where a hole sits on the canvas, or undefined if that id is not a hole on this board. */
export function holeCanvasPosition(
  holeId: string,
  component: { x: number; y: number; rotation: number },
): { x: number; y: number } | undefined {
  const hole = breadboardHolePoints().find((h) => h.id === holeId);
  return hole ? toCanvas(hole, component) : undefined;
}

/**
 * The hole a canvas point selects, or null when the point missed.
 *
 * Nearest-hole within a strict radius, ties broken by canonical order so the same click
 * always gives the same answer. Returns a bare hole id; callers pair it with the component
 * id they already hold — this function has no way to know which board it was asked about and
 * deliberately does not guess.
 */
export function resolveHoleAt(
  point: { x: number; y: number },
  component: { x: number; y: number; rotation: number },
  captureRadiusUnits: number = HOLE_CAPTURE_RADIUS_UNITS,
): string | null {
  const local = toBoardLocal(point, component);
  const limit = captureRadiusUnits * captureRadiusUnits;

  let best: BreadboardHolePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hole of breadboardHolePoints()) {
    const dx = local.x - hole.x;
    const dy = local.y - hole.y;
    const distance = dx * dx + dy * dy;
    if (distance > limit) continue;
    // Strictly-less keeps the earliest canonical hole on an exact tie.
    if (distance < bestDistance) {
      best = hole;
      bestDistance = distance;
    }
  }

  return best ? best.id : null;
}

// ---------------------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------------------

/**
 * The board's physical rows, top to bottom, each ordered left to right.
 *
 * Derived by grouping the canonical holes on their local Y rather than by listing the rows
 * out. Fourteen rows come back — two rail rows, the A–E bank, the F–J bank, two more rail
 * rows — and the rails are 25 holes against the strips' 30, which is exactly the asymmetry
 * vertical movement has to cope with.
 */
export function breadboardRows(): readonly (readonly BreadboardHolePoint[])[] {
  const byRow = new Map<string, BreadboardHolePoint[]>();
  for (const hole of breadboardHolePoints()) {
    // Rounded so floating-point noise cannot split one physical row into two.
    const key = hole.y.toFixed(6);
    const row = byRow.get(key);
    if (row) row.push(hole);
    else byRow.set(key, [hole]);
  }
  return [...byRow.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, row]) => row.sort((a, b) => a.x - b.x || a.order - b.order));
}

/** Which row and index a hole occupies, or undefined for an unknown id. */
export function locateHole(holeId: string): { row: number; index: number } | undefined {
  const rows = breadboardRows();
  for (let row = 0; row < rows.length; row += 1) {
    const index = rows[row].findIndex((h) => h.id === holeId);
    if (index !== -1) return { row, index };
  }
  return undefined;
}

export type BreadboardArrow = 'left' | 'right' | 'up' | 'down';

/**
 * The hole an arrow key moves to.
 *
 * Horizontal movement clamps at the row ends rather than wrapping — wrapping from column 30
 * to column 1 crosses the whole board and reads as a glitch. Vertical movement keeps the
 * nearest local X, which is what makes stepping between a 30-hole strip row and a 25-hole
 * rail row land somewhere predictable instead of at an index that means nothing in the other
 * row. Exact X ties take the earlier canonical hole.
 */
export function moveHole(fromHoleId: string, arrow: BreadboardArrow): string {
  const rows = breadboardRows();
  const at = locateHole(fromHoleId);
  if (!at) return fromHoleId;

  if (arrow === 'left' || arrow === 'right') {
    const row = rows[at.row];
    const next = at.index + (arrow === 'right' ? 1 : -1);
    if (next < 0 || next >= row.length) return fromHoleId;
    return row[next].id;
  }

  const targetRow = at.row + (arrow === 'down' ? 1 : -1);
  if (targetRow < 0 || targetRow >= rows.length) return fromHoleId;

  const currentX = rows[at.row][at.index].x;
  let best = rows[targetRow][0];
  let bestDelta = Math.abs(best.x - currentX);
  for (const candidate of rows[targetRow]) {
    const delta = Math.abs(candidate.x - currentX);
    if (delta < bestDelta - 1e-9 || (Math.abs(delta - bestDelta) <= 1e-9 && candidate.order < best.order)) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best.id;
}

/** Where keyboard navigation starts when the board is entered. */
export function firstNavigableHole(): string {
  return breadboardRows()[0][0].id;
}

// ---------------------------------------------------------------------------------------
// Focused (magnified) selection
// ---------------------------------------------------------------------------------------

/**
 * CSS pixels per schematic unit while a hole is being chosen.
 *
 * The accessibility floor is on the SELECTION REGION, not the drawn dot: a real hole is
 * 1 mm and drawing it 32 px across would be a lie about the hardware. The capture region is
 * 2 x 4 = 8 units, so 4.5 px per unit makes it 36 CSS px — over the 32 px minimum — while
 * adjacent centres land 45 px apart, leaving a 9 px band that belongs to no hole.
 */
export const FOCUSED_PIXELS_PER_UNIT = 4.5;

/** The minimum this project holds itself to, from the Phase A hit-target work. */
export const MIN_TARGET_CSS_PX = 32;

/** Effective selection-region size and spacing at a given magnification. */
export function focusedTargetMetrics(pixelsPerUnit: number = FOCUSED_PIXELS_PER_UNIT): {
  targetPx: number;
  centreSpacingPx: number;
  rejectionBandPx: number;
  meetsMinimum: boolean;
} {
  const targetPx = 2 * HOLE_CAPTURE_RADIUS_UNITS * pixelsPerUnit;
  const centreSpacingPx = HOLE_PITCH_UNITS * pixelsPerUnit;
  return {
    targetPx,
    centreSpacingPx,
    rejectionBandPx: centreSpacingPx - targetPx,
    meetsMinimum: targetPx >= MIN_TARGET_CSS_PX,
  };
}

/**
 * A bounded viewBox centred on the current hole.
 *
 * Bounded on purpose: magnifying the whole 84 mm board enough to hit a hole reliably would
 * need a viewport no screen has. This shows a window around wherever the student is working
 * and moves with them.
 */
export function focusedViewBox(
  holeId: string,
  component: { x: number; y: number; rotation: number },
  viewportPx: { width: number; height: number },
  pixelsPerUnit: number = FOCUSED_PIXELS_PER_UNIT,
): { x: number; y: number; width: number; height: number } | undefined {
  const centre = holeCanvasPosition(holeId, component);
  if (!centre) return undefined;
  const width = viewportPx.width / pixelsPerUnit;
  const height = viewportPx.height / pixelsPerUnit;
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}
