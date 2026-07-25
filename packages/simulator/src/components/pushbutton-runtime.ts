/**
 * Pushbutton control-event helpers. The four-leg permanent connectivity is handled by
 * the trusted component registry / netlist compiler; this module only produces the
 * deterministic teaching-bounce edge sequence. Source: spec §11.2.
 *
 * Bounce is OFF by default. When enabled, a single logical press expands into a fixed,
 * seeded edge sequence so behavior is reproducible for grading/demoing.
 */

const F_CPU = 16_000_000;

/** Fixed bounce offsets in microseconds from the initiating edge (spec §11.2). */
const BOUNCE_OFFSETS_MICROS = [0, 180, 410, 730, 1100] as const;

export interface BounceEdge {
  /** Absolute simulated cycle for this edge. */
  cycle: number;
  /** Logical pressed/released state at this edge. */
  pressed: boolean;
}

/**
 * Expands a single press/release transition into a bounce sequence, alternating around
 * the target state, ending on `pressed`. Cycle-based (not React render timestamps).
 */
export function expandBounceSequence(pressed: boolean, atCycle: number): BounceEdge[] {
  return BOUNCE_OFFSETS_MICROS.map((offsetMicros, index) => {
    const cycle = atCycle + Math.round((offsetMicros * F_CPU) / 1_000_000);
    // Alternate, ending on the requested final state on the last edge.
    const isLast = index === BOUNCE_OFFSETS_MICROS.length - 1;
    const edgeState = isLast ? pressed : index % 2 === 0 ? pressed : !pressed;
    return { cycle, pressed: edgeState };
  });
}
