/**
 * The canonical conversions between the four units this app draws in.
 *
 *   millimetres      what physical parts are specified in (component-geometry.ts)
 *   schematic units  what project files store, and what terminal anchors are in
 *   world inches     the 3D scene (uno-geometry.ts already works in inches)
 *   SVG user units   the 2D canvas — identical to schematic units
 *
 * One schematic unit is 0.01 in = 0.254 mm, so **ten units are exactly 0.1 in = 2.54 mm**:
 * the header pitch the board is already built on. That is not a coincidence chosen for
 * neatness — it is what makes the registry's existing 10-unit terminal spacing come out at
 * a real lead pitch. The LCD's sixteen anchors span 38.10 mm, exactly a 16-way 2.54 mm
 * header; the LED's two span 2.54 mm, exactly its lead pitch; the servo's three span
 * 5.08 mm, exactly a JR connector.
 *
 * The previous value, 0.012, made those spans 45.7 / 3.05 / 6.10 mm — wrong by 20%, and the
 * reason wires attached beside parts rather than to them.
 *
 * This constant was also duplicated: DynamicNetlist3D and CircuitCanvas3D each declared it,
 * kept equal only by a comment, while one converts forward (draw) and the other converts
 * back (click-to-place). They now share this one export, because a round trip through two
 * different numbers silently misplaces every part a student drops.
 */

/**
 * The three constants now live in `@offline-arduino/contracts/units` and are re-exported
 * here unchanged. The simulator's component registry needs the same millimetre-to-schematic
 * conversion to place the breadboard's 400 anchors, and it cannot import from this app —
 * so the values moved to the package both sides can reach rather than being written twice.
 * Every export of this module keeps its previous name and value.
 */
export { SCHEMATIC_UNIT_INCHES, MM_PER_INCH, MM_PER_SCHEMATIC_UNIT } from '@offline-arduino/contracts/units';
import { MM_PER_SCHEMATIC_UNIT, SCHEMATIC_UNIT_INCHES, MM_PER_INCH } from '@offline-arduino/contracts/units';

/** 2.54 mm — the pitch the board, the headers and every lead in the library share. */
export const HEADER_PITCH_MM = 2.54;

export function mmToSchematic(mm: number): number {
  return mm / MM_PER_SCHEMATIC_UNIT;
}

export function schematicToMm(units: number): number {
  return units * MM_PER_SCHEMATIC_UNIT;
}

export function schematicToWorld(units: number): number {
  return units * SCHEMATIC_UNIT_INCHES;
}

export function worldToSchematic(inches: number): number {
  return inches / SCHEMATIC_UNIT_INCHES;
}

export function mmToWorld(mm: number): number {
  return mm / MM_PER_INCH;
}

export function worldToMm(inches: number): number {
  return inches * MM_PER_INCH;
}
