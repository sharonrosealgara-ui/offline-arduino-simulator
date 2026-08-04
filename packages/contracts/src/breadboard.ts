/**
 * The canonical 400 tie-point breadboard: hole identity, local geometry, and which holes are
 * electrically one thing.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A pure, deterministic description of one breadboard, generated rather than transcribed. It
 * is the single source of truth that the simulator's component registry and the renderer's
 * 2D and 3D layers will both consume later. It lives in `contracts` because that package
 * depends on nothing but zod, so both of those consumers can reach it without either one
 * having to depend on the other.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is not wired into anything yet. No `ComponentKind`, no project schema, no registry, no
 * catalog, no netlist, no renderer, no obstacle volume. It is deliberately absent from the
 * package barrel (`index.ts`) so that "not yet exposed" is a property a test can assert
 * rather than a claim in a comment.
 *
 * It contains no React, three.js, Electron or DOM code, no colours, no materials, and no
 * scene positions — only the board's own local frame. Where a board sits in a workspace and
 * how it is rotated are the caller's business, exactly as they are for every other part.
 *
 * PROVENANCE
 * ----------
 * Dimensions and topology come from the BusBoard Prototype Systems BB400 datasheet (Rev 6)
 * and the BB300+BB400 datasheet (Rev 5), recorded in full at
 * `vendor/licenses/app-3d-assets/BREADBOARD_GEOMETRY_SOURCES.md`. The component modelled
 * here is a *generic* educational breadboard; no manufacturer name, part number, logo or
 * artwork is reproduced.
 *
 * Every exported dimension is tagged DOCUMENTED, DERIVED or APPROXIMATED. That distinction is
 * load-bearing: an approximation presented as a manufacturer measurement is how a drawing
 * ends up asserting something the datasheet never said.
 */

/** How a dimension came to be, so nothing has to guess later. */
export type DimensionProvenance =
  /** Stated verbatim in the pinned datasheets. */
  | 'documented'
  /** Computed from documented values, introducing no new measurement. */
  | 'derived'
  /** A rendering choice this project made. NOT a manufacturer measurement. */
  | 'approximated';

// ---------------------------------------------------------------------------------------
// Documented constants
// ---------------------------------------------------------------------------------------

/** DOCUMENTED — "Hole Pitch: 0.1" / 2.54 mm" (BB400 Rev 6; BB300+BB400 Rev 5). */
export const HOLE_PITCH_MM = 2.54;

/** DOCUMENTED — "400 total tie points … 400 wire insertion holes". */
export const TOTAL_HOLES = 400;

/** DOCUMENTED — "a 300 tie-point IC circuit area". */
export const TERMINAL_STRIP_HOLES = 300;

/** DOCUMENTED — "60 vertical columns in the circuit area … with 5 connected holes in each". */
export const TERMINAL_GROUP_COUNT = 60;
export const TERMINAL_GROUP_SIZE = 5;

/** DOCUMENTED — "four 25 tie-point power rails". */
export const RAIL_COUNT = 4;
export const RAIL_GROUP_SIZE = 25;

/** DERIVED — 300 holes over 10 rows. */
export const COLUMN_COUNT = 30;

/** DERIVED — 60 groups of 5 over 30 columns, in two banks. */
export const ROWS_PER_BANK = 5;

/**
 * DOCUMENTED — "Size: 3.3 x 2.1 x 0.3in (84 x 54.3 x 8.5mm)" (BB300+BB400 Rev 5).
 *
 * Not present in the BB400 Rev 6 datasheet, which states no overall dimensions.
 */
export const BODY_LENGTH_MM = 84;
export const BODY_DEPTH_MM = 54.3;
export const BODY_HEIGHT_MM = 8.5;

// ---------------------------------------------------------------------------------------
// Derived constants
// ---------------------------------------------------------------------------------------

/** DERIVED — 29 gaps at the documented pitch. */
export const COLUMN_SPAN_MM = (COLUMN_COUNT - 1) * HOLE_PITCH_MM;

/** DERIVED — 4 gaps at the documented pitch, within one bank of rows. */
export const BANK_SPAN_MM = (ROWS_PER_BANK - 1) * HOLE_PITCH_MM;

// ---------------------------------------------------------------------------------------
// Approximated constants — rendering choices, not measurements
// ---------------------------------------------------------------------------------------

/**
 * APPROXIMATED — the E-to-F hole-CENTRE spacing across the middle of the board.
 *
 * Neither datasheet states it. Three times the documented pitch is chosen because the
 * circuit area exists to straddle 0.3 inch DIP packages, and because an integer multiple
 * keeps every hole on one lattice.
 *
 * This is a distance between hole centres. It is NOT the width of the visible plastic
 * trench, which is a smaller, separate quantity that this module does not model and that no
 * source documents. Conflating the two would put a rendered opening where the datasheet
 * never put one.
 */
export const CENTRE_GAP_MM = 3 * HOLE_PITCH_MM;

/**
 * APPROXIMATED — depth from the board edge to the outer rail row, and rail row separation.
 *
 * No source documents rail placement relative to the circuit area, and in particular no
 * source confirms any half-pitch (1.27 mm) offset — so none is applied. Rail holes are laid
 * out at uniform documented pitch and centred on the body length.
 */
export const RAIL_EDGE_MARGIN_MM = 3.5;
export const RAIL_ROW_SEPARATION_MM = HOLE_PITCH_MM;

// ---------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------

/**
 * Row letters, in the order they appear along the local +Y axis.
 *
 * DOCUMENTED that a legend gives "numbers and letters for columns and rows"; the physical
 * top-view orientation is not specified by either source. The order below is therefore this
 * project's fixed convention, stated once here so 2D and 3D cannot disagree about it.
 */
export const BANK_AE_ROWS = ['A', 'B', 'C', 'D', 'E'] as const;
export const BANK_FJ_ROWS = ['F', 'G', 'H', 'I', 'J'] as const;

export type BankId = 'AE' | 'FJ';
export type RailSide = 'top' | 'bottom';
export type RailPolarity = 'positive' | 'negative';

/** Rail terminal-id prefixes: T/B for side, P/N for polarity. */
const RAIL_PREFIX: Record<RailSide, Record<RailPolarity, string>> = {
  top: { positive: 'TP', negative: 'TN' },
  bottom: { positive: 'BP', negative: 'BN' },
};

/**
 * A single hole.
 *
 * `x` and `y` are millimetres in the BOARD'S OWN frame, origin at the centre of the body.
 * No workspace position and no rotation is baked in — a placed board applies those itself,
 * the same way every other component does.
 */
export interface BreadboardHole {
  /** Stable terminal id, e.g. `A1`, `J30`, `TP7`, `BN25`. */
  id: string;
  /** Stable id of the group this hole is electrically part of. Exactly one. */
  groupId: string;
  /** +X, from column 1 toward column 30. */
  x: number;
  /** +Y, from the top edge toward the bottom edge. */
  y: number;
}

/** An electrically common set of holes. Nothing outside it is connected to it. */
export interface BreadboardGroup {
  /** Stable, human-readable topology id, e.g. `strip:14:AE`, `rail:top:positive`. */
  id: string;
  kind: 'strip' | 'rail';
  /** Hole ids, in generation order. */
  holeIds: string[];
}

/** The whole board: identity, geometry and topology, with nothing else attached. */
export interface BreadboardModel {
  holes: BreadboardHole[];
  groups: BreadboardGroup[];
  body: { lengthMm: number; depthMm: number; heightMm: number };
}

/** Terminal-strip group id for a column and bank. */
export function stripGroupId(column: number, bank: BankId): string {
  return `strip:${column}:${bank}`;
}

/** Rail group id for a side and polarity. */
export function railGroupId(side: RailSide, polarity: RailPolarity): string {
  return `rail:${side}:${polarity}`;
}

// ---------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------

/**
 * Row order along +Y, from the top edge of the board downward:
 *
 *   TP TN   A B C D E   (centre gap)   F G H I J   BN BP
 *
 * The two rail rows at each edge, then the A–E bank, the gap no connection crosses, the F–J
 * bank, then the two rail rows at the far edge. Which of the pair is positive is an
 * APPROXIMATED convention (inner row positive); the source does not say.
 */
const TOP_RAIL_OUTER_Y = -BODY_DEPTH_MM / 2 + RAIL_EDGE_MARGIN_MM;
const TOP_RAIL_INNER_Y = TOP_RAIL_OUTER_Y + RAIL_ROW_SEPARATION_MM;
const BOTTOM_RAIL_OUTER_Y = BODY_DEPTH_MM / 2 - RAIL_EDGE_MARGIN_MM;
const BOTTOM_RAIL_INNER_Y = BOTTOM_RAIL_OUTER_Y - RAIL_ROW_SEPARATION_MM;

/** The circuit area is centred on the body depth. */
const CIRCUIT_HALF_DEPTH = BANK_SPAN_MM + CENTRE_GAP_MM / 2;
const BANK_AE_FIRST_Y = -CIRCUIT_HALF_DEPTH;
const BANK_FJ_FIRST_Y = CENTRE_GAP_MM / 2;

/** Column 1 sits at −span/2 so the circuit area is centred on the body length. */
function columnX(column: number): number {
  return -COLUMN_SPAN_MM / 2 + (column - 1) * HOLE_PITCH_MM;
}

/** Rail holes run at uniform documented pitch, centred on the body length. */
function railHoleX(index: number): number {
  const span = (RAIL_GROUP_SIZE - 1) * HOLE_PITCH_MM;
  return -span / 2 + index * HOLE_PITCH_MM;
}

function rowY(bank: BankId, rowIndex: number): number {
  const first = bank === 'AE' ? BANK_AE_FIRST_Y : BANK_FJ_FIRST_Y;
  return first + rowIndex * HOLE_PITCH_MM;
}

function railY(side: RailSide, polarity: RailPolarity): number {
  if (side === 'top') return polarity === 'positive' ? TOP_RAIL_INNER_Y : TOP_RAIL_OUTER_Y;
  return polarity === 'positive' ? BOTTOM_RAIL_INNER_Y : BOTTOM_RAIL_OUTER_Y;
}

/**
 * Builds the board.
 *
 * Generated from the counts above rather than written out: a hand-typed list of 400 holes is
 * a list of 400 chances to typo a coordinate, and it could not be checked against the
 * documented pitch at all.
 *
 * Called fresh each time and returns fresh arrays, so no caller can mutate a shared model
 * out from under another. Same inputs, same output, every time — there is no state, no clock
 * and no randomness anywhere in it.
 */
export function createBreadboardModel(): BreadboardModel {
  const holes: BreadboardHole[] = [];
  const groups: BreadboardGroup[] = [];

  // Terminal strips: for each numbered column, one group per bank. The centre gap is not
  // crossed here and there is no code path that could cross it — the two banks are built
  // as separate groups, never merged.
  for (let column = 1; column <= COLUMN_COUNT; column += 1) {
    for (const [bank, rows] of [
      ['AE', BANK_AE_ROWS],
      ['FJ', BANK_FJ_ROWS],
    ] as const) {
      const groupId = stripGroupId(column, bank);
      const holeIds: string[] = [];
      rows.forEach((row, rowIndex) => {
        const id = `${row}${column}`;
        holes.push({ id, groupId, x: columnX(column), y: rowY(bank, rowIndex) });
        holeIds.push(id);
      });
      groups.push({ id: groupId, kind: 'strip', holeIds });
    }
  }

  // Rails: each is one continuous run of 25 holes. The sources describe four distribution
  // strips of 25 tie-points and mention no break, split or segment, so none is modelled.
  for (const side of ['top', 'bottom'] as const) {
    for (const polarity of ['positive', 'negative'] as const) {
      const groupId = railGroupId(side, polarity);
      const prefix = RAIL_PREFIX[side][polarity];
      const y = railY(side, polarity);
      const holeIds: string[] = [];
      for (let i = 0; i < RAIL_GROUP_SIZE; i += 1) {
        const id = `${prefix}${i + 1}`;
        holes.push({ id, groupId, x: railHoleX(i), y });
        holeIds.push(id);
      }
      groups.push({ id: groupId, kind: 'rail', holeIds });
    }
  }

  return {
    holes,
    groups,
    body: { lengthMm: BODY_LENGTH_MM, depthMm: BODY_DEPTH_MM, heightMm: BODY_HEIGHT_MM },
  };
}

/** Every hole id, in generation order. */
export function breadboardHoleIds(): string[] {
  return createBreadboardModel().holes.map((h) => h.id);
}

/** Group memberships as plain id arrays — the shape a registry's permanently-common list wants. */
export function breadboardGroupMemberships(): string[][] {
  return createBreadboardModel().groups.map((g) => [...g.holeIds]);
}

/** The group a hole belongs to, or undefined if the id is not a hole on this board. */
export function breadboardGroupIdForHole(holeId: string): string | undefined {
  return createBreadboardModel().holes.find((h) => h.id === holeId)?.groupId;
}

/**
 * Where each exported dimension came from.
 *
 * Exported so the distinction is machine-checkable rather than a claim in prose: a value
 * that quietly turns from approximated into documented is exactly the drift this guards.
 */
export const BREADBOARD_DIMENSION_PROVENANCE: Record<string, DimensionProvenance> = {
  HOLE_PITCH_MM: 'documented',
  TOTAL_HOLES: 'documented',
  TERMINAL_STRIP_HOLES: 'documented',
  TERMINAL_GROUP_COUNT: 'documented',
  TERMINAL_GROUP_SIZE: 'documented',
  RAIL_COUNT: 'documented',
  RAIL_GROUP_SIZE: 'documented',
  BODY_LENGTH_MM: 'documented',
  BODY_DEPTH_MM: 'documented',
  BODY_HEIGHT_MM: 'documented',
  COLUMN_COUNT: 'derived',
  ROWS_PER_BANK: 'derived',
  COLUMN_SPAN_MM: 'derived',
  BANK_SPAN_MM: 'derived',
  CENTRE_GAP_MM: 'approximated',
  RAIL_EDGE_MARGIN_MM: 'approximated',
  RAIL_ROW_SEPARATION_MM: 'approximated',
};
