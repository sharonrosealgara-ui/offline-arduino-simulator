/**
 * Fixed heights in the 3D workspace, in world inches.
 *
 * These were literals in two files that had to agree and nothing made them: the bench plane
 * in CircuitCanvas3D and, implicitly, every wire that had to stay above it. They did not
 * agree — long wires sagged straight through the floor, and because the bench is opaque the
 * middle of each wire vanished, leaving two visible ends that appeared to stop in midair.
 * Sharing the number is part of the fix, not tidying around it.
 */

/** The opaque bench surface everything rests on. */
export const BENCH_SURFACE_Y = -0.095;

/**
 * The grid, a hair above the bench.
 *
 * Derived rather than written out so the offset survives: coplanar with the bench the two
 * would z-fight and the grid would shimmer.
 */
export const GRID_SURFACE_Y = BENCH_SURFACE_Y + 0.005;
