/**
 * The unit conversions shared by everything that draws or wires.
 *
 * These lived only in the renderer (`geometry-units.ts`), which was fine while the renderer
 * was the only thing that needed them. The simulator's component registry now has to turn
 * the canonical breadboard's millimetre coordinates into the schematic units terminal
 * anchors are expressed in, and the simulator cannot import from the desktop app. Rather
 * than write the same 0.254 down a second time, the constants moved here — `contracts`
 * depends on nothing, so both sides can reach them.
 *
 * `geometry-units.ts` re-exports these, so the renderer's API is unchanged.
 *
 * One schematic unit is 0.01 in = 0.254 mm, so ten units are exactly 0.1 in = 2.54 mm: the
 * header pitch the board, every lead in the library and the breadboard all share.
 */

/** Inches per schematic unit. */
export const SCHEMATIC_UNIT_INCHES = 0.01;

/** Millimetres per inch. */
export const MM_PER_INCH = 25.4;

/** Millimetres per schematic unit — 0.254 mm exactly. */
export const MM_PER_SCHEMATIC_UNIT = SCHEMATIC_UNIT_INCHES * MM_PER_INCH;

export function mmToSchematicUnits(mm: number): number {
  return mm / MM_PER_SCHEMATIC_UNIT;
}

export function schematicUnitsToMm(units: number): number {
  return units * MM_PER_SCHEMATIC_UNIT;
}
